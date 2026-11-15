import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261115175500_fina_privacy_revocation_rls.sql',import.meta.url),'utf8');
function extract(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing segment: '+start);
 return html.slice(a,b);
}
const factories=extract('const finaPersistManualBill=x=>','window.FinaExportPersistentState=()=>')
 +extract('let finaPersistTimer=null;','async function finaRestoreEncryptedLocalPreferences');
function merger(){
 const context={window:{},console,Date,Promise,Number,Math};
 return vm.runInNewContext(factories+'\n({normalize:finaNormalizeSavedState,merge:finaMergeSavedState})',context);
}
const bill=(id,attrs={})=>({id,owner:'lucas',type:'manual',name:'Internet',
 value:9999,day:10,month:10,year:2026,state:'open',...attrs});

test('edicoes simultaneas do mesmo cadastro preservam campos nao conflitantes',()=>{
 const {normalize,merge}=merger();
 const before=normalize({manualBills:[bill(30)],future:[],refunds:[]});
 const remote=normalize({manualBills:[bill(30,{name:'Fibra revisada',detail:'Importado do banco'})]});
 const local=normalize({manualBills:[bill(30,{state:'reserved'})]});
 const out=merge(remote,before,local);
 assert.equal(out.manualBills[0].name,'Fibra revisada');
 assert.equal(out.manualBills[0].state,'reserved');
 assert.equal(out.manualBills[0].detail,'Importado do banco');
});

test('o servidor vence conflito no mesmo campo e nunca desfaz pagamento confirmado',()=>{
 const {normalize,merge}=merger();
 const original=normalize({manualBills:[bill(1)]});
 const remote=normalize({manualBills:[bill(1,{name:'Energia',state:'posted',paidDate:'15/11/2026'})]});
 const local=normalize({manualBills:[bill(1,{name:'Condomínio',state:'reserved'})]});
 const merged=merge(remote,original,local);
 assert.equal(merged.manualBills[0].state,'posted');
 assert.equal(merged.manualBills[0].name,'Energia');
 assert.equal(merged.manualBills[0].paidDate,'15/11/2026');
 const remote2=normalize({manualBills:[bill(1,{name:'Energia'})]});
 const local2=normalize({manualBills:[bill(1,{name:'Condomínio'})]});
 assert.equal(merge(remote2,original,local2).manualBills[0].name,'Energia');
});

test('exclusao remota ou edicao concorrente nao ressuscita nem apaga registros',()=>{
 const {normalize,merge}=merger();
 const prior=normalize({manualBills:[bill(1),bill(2)]});
 const remote=normalize({manualBills:[bill(2,{name:'Alterado por Naara'})]});
 const local=normalize({manualBills:[bill(1,{state:'reserved'})]});
 const result=merge(remote,prior,local);
 assert.deepEqual(Array.from(result.manualBills.map(x=>x.id)),[2]);
 assert.equal(result.manualBills[0].name,'Alterado por Naara');
});

test('logout e troca do Google removem saldos, faturas, estornos e fotos sem trocar referencia do estado',()=>{
 const reset=extract('function finaClearPrivateSessionState(){','async function applySession(session){');
 let transferCleared=0;
 const S={
  accounts:[{balance:100}],cards:[{limit:1000}],transactions:[{value:200}],
  bills:[{value:300}],future:[{value:400}],refunds:[{value:50}],loans:[{value:50}],
  transfers:[{value:70}],bankFeedApplied:['old'],messages:[{text:'Salário R$ 3000'}],
  profiles:{lucas:{displayName:'Lucas',dob:'2000-01-01',photo:'data:image/private'},
    naara:{displayName:'Naara',photo:'data:image/private'}},
  weddingDate:'2019-02-10',scope:'naara',card:'nubank',tab:'cards'
 };
 const original=S;
 const window={FinaClearCoupleTransferCache:()=>{transferCleared++},
  FinaPartnerReady:true,FinaCoupleMemberIds:{lucas:'old',naara:'old2'},
  FinaBankBalancesReady:true,FinaRealBankLoaded:true,FinaBankLoadSequence:4};
 vm.runInNewContext(reset+'\nfinaClearPrivateSessionState()', {S,window,Number});
 assert.equal(S,original);
 for(const key of ['accounts','cards','transactions','bills','future','refunds','loans','transfers','messages']){
  assert.equal(S[key].length,0,key);
 }
 assert.equal(S.profiles.lucas.photo,null);
 assert.equal(S.profiles.naara.photo,null);
 assert.equal(S.weddingDate,'');
 assert.equal(S.scope,'casal');
 assert.equal(S.tab,'home');
 assert.equal(window.FinaPartnerReady,false);
 assert.equal(window.FinaBankLoadSequence,5);
 assert.equal(transferCleared,1);
 assert.match(html,/if\(!user\)\{\s*finaClearPrivateSessionState\(\);/);
 assert.match(html,/window\.FinaCurrentUser\.id!==user\.id\)\{\s*finaClearPrivateSessionState\(\);/);
});

test('respostas atrasadas de perfil, casal e transferencias nao atravessam contas Google',()=>{
 const profile=extract('async function loadFinaSharedProfiles(){','async function finaSaveSharedProfile');
 assert.match(profile,/window\.FinaCurrentUser\?\.id!==user\.id/g);
 const couple=extract('async function loadCoupleStatus(user){','\nfunction paintCouple()');
 assert.match(couple,/const \{data,error\}=await sb\.rpc\('fina_couple_status_v2'\);\s*if\(window\.FinaCurrentUser\?\.id!==user\.id\)return;/);
 const transfers=extract('async function loadFinaCoupleTransfers(){','\nwindow.FinaLoadCoupleTransfers=');
 assert.match(transfers,/window\.FinaCurrentUser\?\.id!==sourceUser/);
});

test('extrato bancario mostra primeiro as transacoes recentes',()=>{
 const bank=extract('function banks(){','function bankCard(c)');
 assert.match(bank,/t\.month===bankPeriod\.month&&t\.year===bankPeriod\.year\)\.slice\(\)/);
 assert.doesNotMatch(bank,/\.slice\(\)\.reverse\(\)/);
 assert.match(html,/\.sort\(\(a,b\)=>String\(b\.occurredAt/);
});

test('nenhum controle de teste injeta credito, debito ou baixa ficticia',()=>{
 assert.doesNotMatch(html,/Simular chegada do extrato|Simular crédito bancário confirmado|Simular chegada automática do extrato/);
 assert.doesNotMatch(html,/handleBankTransferEvent\(|function post\(b\)|if\(a==='auto-credit'\)|if\(a==='bank-event'\)|if\(type==='deposit'/);
 assert.match(html,/function tests\(\)/);
});

test('permissao financeira revogavel protege contas, extratos, faturas e financiamentos',()=>{
 assert.match(migration,/create or replace function private\.fina_financial_sharing_allowed\(target_user uuid\)/);
 assert.match(migration,/me\.sharing_level in \('planning','partial','total'\)/);
 assert.match(migration,/partner\.sharing_level in \('planning','partial','total'\)/);
 assert.match(migration,/deny\.revoked_at is not null/);
 assert.match(migration,/deny\.member_joined_at=partner\.joined_at/);
 assert.match(migration,/private\.fina_financial_sharing_allowed\(target_user\)/);
 assert.match(migration,/create policy fina_financings_select_couple/);
 assert.match(migration,/create policy fina_financing_installments_select_couple/);
 for(const name of [
 'fina_couple_card_bills','fina_shared_pending_bills','fina_shared_future_income',
 'fina_shared_pending_refunds','fina_change_shared_manual_bill',
 'fina_delete_shared_future_income','fina_delete_shared_refund'
 ])assert.match(migration,new RegExp('-- Hardened: '+name));
 assert.match(migration,/revoke all on function public\.fina_couple_card_bills\(\) from public,anon/);
});
