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
 assert.match(html,/if\(!sharedBill&&!sharedForecast&&!sharedRefund\)setTimeout\(finaScheduleSave,80\)/);
 assert.match(html,/'delete','delete-forecast'/);
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

test('backup privado antigo só é oferecido; não restaura dados silenciosamente',()=>{
 const code=between('async function finaLoadPersistentState(user){','\nasync function finaLoadSharedBills(){');
 assert.match(code,/window\.FinaOfflineVault\?\.loadState\(user.id,window.FinaSelfOwnerKey\)/);
 assert.match(code,/missingBills\.length\|\|missingFuture\.length/);
 assert.match(code,/if\(!recoverable\)void window\.FinaOfflineVault\?\.saveState/);
 assert.match(html,/window\.confirm\('Recuperar os cadastros deste aparelho/);
 assert.match(html,/window\.FinaRecoverablePlanningState=null/);
});

const recoveryHelper=between('function finaFindRecoverablePlanning(local,remote){','async function finaLoadPersistentState(user){');

test('cofre de Lucas recupera contas destinadas a Naara, preservando dono e pagamentos',()=>{
 const f=vm.runInNewContext(recoveryHelper+'\nfinaFindRecoverablePlanning',
  {},{timeout:3000});
 const local={manualBills:[
  {...bill(50,'open'),owner:'naara'},
  {...bill(51,'posted'),owner:'naara'},
  {...bill(52,'removed'),owner:'lucas'},
  {...bill(53,'open'),owner:'lucas'},
  {...bill('not-a-number','open'),owner:'lucas'},
  {...bill(55,'open'),owner:'intruso'}
 ],future:[
  {...future(60),owner:'naara'},
  {...future(61),owner:'lucas'}
 ]};
 const server={manualBills:[{id:53}],future:[{id:61}]};
 const r=f(local,server);
 assert.deepEqual(Array.from(r.manualBills.map(x=>x.id)),[50,51]);
 assert.deepEqual(Array.from(r.manualBills.map(x=>x.owner)),['naara','naara']);
 assert.equal(r.manualBills[1].state,'posted');
 assert.deepEqual(Array.from(r.future.map(x=>x.id)),[60]);
 assert.equal(r.future[0].owner,'naara');
});

test('recuperação aceita registros de ambas as pessoas e não mexe em faturas oficiais',async()=>{
 const code=recoveryHelper+'\n'+between('window.FinaRecoverLocalPlanning=async()=>{','\nlet finaSharedProfileChannel=null;');
 for(const creator of ['lucas','naara']){
  const assigned=creator==='lucas'?'naara':'lucas';
  let saveCount=0,refreshCount=0;
  const S={bills:[{id:'bank',type:'bank'},{id:55,type:'manual',owner:creator,state:'open'}],
   future:[{id:'shared',type:'shared'}],formNotice:''};
  const window={FinaCurrentUser:{id:creator+'-google-id'},FinaSelfOwnerKey:creator,
   FinaRecoverablePlanningState:{userId:creator+'-google-id',manualBills:[
    {id:55,owner:creator,type:'manual',state:'open'},
    {id:56,owner:assigned,type:'manual',state:'open',name:'Conta cadastrada para outra pessoa'},
    {id:57,owner:creator,type:'manual',state:'removed'}
   ],future:[{id:123,owner:assigned,name:'Recebimento de outra pessoa'}]},
   FinaRender:()=>{}};
  const ctx={window,S,finaMarkStateDirty:()=>{},
   finaSavePersistentState:async()=>{saveCount++;return true;},
   finaLoadSharedBills:async()=>{refreshCount++;}};
  vm.createContext(ctx);
  vm.runInContext(code,ctx);
  const result=await ctx.window.FinaRecoverLocalPlanning();
  assert.equal(result,true);
  assert.equal(saveCount,1);
  assert.equal(refreshCount,1);
  assert.equal(S.bills.length,3);
  assert.equal(S.bills.find(x=>x.id==='bank')?.type,'bank');
  assert.equal(S.bills.filter(x=>x.id===55).length,1);
  assert.equal(S.bills.find(x=>x.id===56)?.owner,assigned);
  assert.equal(S.bills.some(x=>x.id===57),false);
  assert.equal(S.future.length,2);
  assert.equal(S.future.find(x=>x.id===123)?.owner,assigned);
  assert.equal(window.FinaRecoverablePlanningState,null);
 }
});
