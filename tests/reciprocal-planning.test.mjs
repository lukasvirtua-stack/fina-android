import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261115131500_fina_reciprocal_planning_future.sql',import.meta.url),'utf8');
function between(start,end){
 const i=html.indexOf(start),j=html.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'Missing live source: '+start);
 return html.slice(i,j);
}
const factory=between('const finaPersistManualBill=x=>','window.FinaExportPersistentState=()=>')
 +between('let finaPersistTimer=null;','async function finaRestoreEncryptedLocalPreferences');
function stateFunctions(){
 const ctx={window:{},Promise,Date,console};
 return vm.runInNewContext(factory+'\n({normal:finaNormalizeSavedState,merge:finaMergeSavedState})',ctx,{timeout:3000});
}
const bill=(id,state='open')=>({id,owner:'lucas',type:'manual',name:'Condomínio',value:23500,
 day:10,month:10,year:2026,state,recurring:true,estimated:false});
const future=(id,name='Salário')=>({id,owner:'lucas',name,value:180000,day:22,month:10,year:2026});

test('prefêrencias próprias não apagam reserva feita no outro celular',()=>{
 const {normal,merge}=stateFunctions();
 const first=normal({schemaVersion:2,manualBills:[bill(1)],future:[future(2)],
  preferences:{theme:'light',birthdays:true}});
 const server=normal({schemaVersion:2,manualBills:[bill(1,'reserved')],future:[future(2),future(3,'Comissão')],
  preferences:{theme:'light',birthdays:true}});
 const current=structuredClone(first);current.preferences.theme='dark';
 const merged=merge(server,first,current);
 assert.equal(merged.preferences.theme,'dark');
 assert.equal(merged.manualBills[0].state,'reserved');
 assert.deepEqual(Array.from(merged.future.map(x=>x.id)),[2,3]);
});

test('pagamento confirmado remotamente nunca volta para aberto por uma edição antiga',()=>{
 const {normal,merge}=stateFunctions();
 const first=normal({manualBills:[bill(1,'open')],future:[]});
 const current=normal({manualBills:[{...bill(1,'open'),name:'Condomínio editado'}],future:[]});
 const server=normal({manualBills:[{...bill(1,'posted'),paidDate:'15/11/2026'}],future:[]});
 const result=merge(server,first,current);
 assert.equal(result.manualBills[0].state,'posted');
 assert.equal(result.manualBills[0].paidDate,'15/11/2026');
});

test('cadastros distintos conservam seus IDs, sem duplicar ou perder outros',()=>{
 const {normal,merge}=stateFunctions();
 const old=normal({future:[future(10)],manualBills:[bill(50)]});
 const remote=normal({future:[future(10),future(11,'Bônus')],manualBills:[bill(50),bill(60)]});
 const current=normal({future:[future(10),future(12,'Venda')],manualBills:[bill(50)]});
 const merged=merge(remote,old,current);
 assert.deepEqual(Array.from(merged.future.map(x=>x.id)),[10,11,12]);
 assert.deepEqual(Array.from(merged.manualBills.map(x=>x.id)),[50,60]);
 const deleted=merge(merged,current,normal({future:[],manualBills:[]}));
 assert.deepEqual(Array.from(deleted.future.map(x=>x.id)),[11]);
 assert.deepEqual(Array.from(deleted.manualBills.map(x=>x.id)),[60]);
});

test('o cliente salva por versao no Supabase e nao sobrescreve estados sem comparar',()=>{
 const save=between('function finaSavePersistentState(){','\nwindow.FinaPersistNow=finaSavePersistentState');
 assert.match(save,/select\('state,updated_at'\)/);
 assert.match(save,/\.eq\('updated_at',latest.updated_at\)\.select\('updated_at'\)/);
 assert.match(save,/for\(let attempt=0;attempt<4;attempt\+\+\)/);
 assert.match(save,/finaMergeSavedState\(latest\?\.state\|\|\{\},base,local\)/);
 const load=between('async function finaLoadPersistentState(user){','\nasync function finaLoadSharedBills');
 assert.match(load,/finaStateDirty\|\|finaStateSaving\|\|finaPersistTimer/);
});

test('sincronizacao de planos usa controle de login, fatura e previsao',()=>{
 const read=between('async function finaLoadSharedBills(){','window.FinaLoadSharedBills=finaLoadSharedBills;');
 assert.match(read,/window\.FinaCurrentUser\?\.id!==sourceUser/);
 assert.match(read,/sb\.rpc\('fina_shared_pending_bills'\)/);
 assert.match(read,/sb\.rpc\('fina_shared_future_income'\)/);
 assert.match(read,/FinaPlanningSyncError/);
 assert.match(html,/window\.FinaDeleteSharedForecast=async forecast=>/);
 assert.match(html,/fina_delete_shared_future_income/);
 assert.match(html,/if\(sharedForecast\)/);
 assert.match(html,/if\(!sharedBill&&!sharedForecast\)setTimeout\(finaScheduleSave,80\)/);
 assert.match(html,/\b'delete','delete-forecast'\b/);
 assert.match(html,/Responsável pela fatura informada/);
 assert.match(html,/partnerReady\(\)\?'<option value="'\+partnerOwner\(\)/);
});

test('SQL permite excluir previsao só do outro integrante autenticado do mesmo casal',()=>{
 assert.match(migration,/security definer set search_path = ''/);
 assert.match(migration,/mine.user_id=actor/);
 assert.match(migration,/other.user_id=p_owner_id/);
 assert.match(migration,/p_owner_id=actor/);
 assert.match(migration,/other.sharing_level in \('planning','partial','total'\)/);
 assert.match(migration,/for update/);
 assert.match(migration,/where user_id=p_owner_id/);
 assert.match(migration,/revoke all on function public.fina_delete_shared_future_income\(uuid,text\) from public,anon/);
 assert.match(migration,/grant execute on function public.fina_delete_shared_future_income\(uuid,text\) to authenticated/);
 assert.match(migration,/'sourceUserId',theirs.user_id::text/);
});
