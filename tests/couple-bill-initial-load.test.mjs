import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const between=(first,last)=>{
 const start=html.indexOf(first),end=html.indexOf(last,start+first.length);
 assert.ok(start>=0&&end>start,'Missing live function '+first);
 return html.slice(start,end);
};

test('faturas oficiais do casal são carregadas independentemente do extrato completo',()=>{
 const couple=between('async function loadCoupleStatus(user){','\nfunction paintCouple(){');
 assert.match(couple,/window\.FinaPartnerReady=Number\(row\.member_count\)>=2/);
 const independent=couple.indexOf('void finaLoadOfficialCardBills();');
 const fullBank=couple.indexOf('void finaLoadRealBankData();');
 const loadUserState=couple.indexOf('await finaLoadPersistentState(user)');
 assert.ok(independent>=0&&fullBank>=0&&independent<loadUserState,
  'Invoice RPC must not depend on slow transactions or personal state');
 const realtime=between('function finaStartDataRealtime(){','\nwindow.addEventListener(\'fina:auth-ready\',()=>setTimeout(finaStartDataRealtime');
 assert.match(realtime,/table:'fina_card_bills'/);
 const focus=between('async function finaRefreshVisibleData(){','\nwindow.addEventListener(\'focus\'');
 assert.match(focus,/await finaLoadOfficialCardBills\(\)/);
});

test('login Lucas e Naara recebem as mesmas faturas do casal sem duplicar',async()=>{
 const code=between('async function finaLoadOfficialCardBills(){','\nwindow.FinaLoadOfficialCardBills=');
 const rows=[
  {id:'bill-l',user_id:'lucas-google',bank_account_id:'card-l',due_date:'2026-11-09',closing_date:'2026-11-02',total_amount:100,paid_amount:0,currency_code:'BRL'},
  {id:'bill-n',user_id:'naara-google',bank_account_id:'card-n',due_date:'2026-11-10',closing_date:'2026-11-03',total_amount:120,paid_amount:20,currency_code:'BRL'}
 ];
 for(const loggedIn of ['lucas','naara']){
  const selfId=loggedIn+'-google';
  const S={bills:[],cards:[
   {id:'real-card-card-l',owner:'lucas',bank:'Santander',digits:'1234'},
   {id:'real-card-card-n',owner:'naara',bank:'Nubank',digits:'5678'}
  ]};
  const w={FinaCurrentUser:{id:selfId},FinaOwnerResolvedForUserId:selfId,
   FinaSelfOwnerKey:loggedIn,FinaPartnerReady:true,FinaRender:()=>{}};
  const sb={rpc:async method=>({error:null,data:method==='fina_couple_card_bills'?rows:[]})};
  const scope={window:w,S,sb,Math,Number,String,Array,money:c=>String(c),pending:()=>true};
  vm.createContext(scope);
  vm.runInContext(code+'\nthis.load=finaLoadOfficialCardBills;',scope);
  await scope.load();
  assert.equal(S.bills.filter(b=>b.type==='bank').length,2,loggedIn+' should see both');
  assert.deepEqual(S.bills.filter(b=>b.type==='bank').map(x=>x.owner).sort(),['lucas','naara']);
  await scope.load();
  assert.equal(S.bills.filter(b=>b.type==='bank').length,2,'No duplicate after refresh');
  assert.equal(w.FinaCardBillsLoadError,'');
 }
});

test('falha da API é mostrada sem apagar a última fatura conhecida',async()=>{
 const code=between('async function finaLoadOfficialCardBills(){','\nwindow.FinaLoadOfficialCardBills=');
 const S={bills:[{id:'prior',type:'bank'}],cards:[]};
 const w={FinaCurrentUser:{id:'lucas-google'},FinaOwnerResolvedForUserId:'lucas-google',
  FinaSelfOwnerKey:'lucas',FinaPartnerReady:true,FinaRender:()=>{}};
 const scope={S,window:w,sb:{rpc:async()=>({data:null,error:{message:'offline'}})},Number,String,Array,Math};
 vm.createContext(scope);
 vm.runInContext(code+'\nthis.load=finaLoadOfficialCardBills;',scope);
 await scope.load();
 assert.equal(S.bills.length,1,'Do not replace known data with empty on request failure');
 assert.match(w.FinaCardBillsLoadError,/Não foi possível atualizar as faturas/);
 assert.match(html,/window\.FinaCardBillsLoadError\?\x60<p class="hint"/);
});

test('falha da previsão opcional não esconde faturas oficiais do casal',async()=>{
 const code=between('async function finaLoadOfficialCardBills(){','\nwindow.FinaLoadOfficialCardBills=');
 const bill={id:'bill-verified',user_id:'lucas-google',bank_account_id:'card-l',
  due_date:'2026-11-12',closing_date:'2026-11-02',total_amount:320,paid_amount:0,currency_code:'BRL'};
 const S={bills:[],cards:[{id:'real-card-card-l',bank:'Santander',digits:'1234'}]};
 const w={FinaCurrentUser:{id:'lucas-google'},FinaOwnerResolvedForUserId:'lucas-google',
  FinaSelfOwnerKey:'lucas',FinaPartnerReady:true,FinaRender:()=>{}};
 const sb={rpc:async method=>{
  if(method==='fina_projected_card_spend')throw Error('Projeção temporariamente indisponível');
  return {data:[bill],error:null};
 }};
 const scope={S,window:w,sb,Math,Number,String,Array,money:c=>String(c),pending:()=>true};
 vm.createContext(scope);
 vm.runInContext(code+'\nthis.load=finaLoadOfficialCardBills;',scope);
 await scope.load();
 assert.equal(S.bills.filter(x=>x.type==='bank').length,1);
 assert.equal(S.bills[0].value,32000);
 assert.equal(w.FinaCardBillsLoadError,'');
});
