import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
function source(from,to){
 const a=html.indexOf(from),b=html.indexOf(to,a+from.length);
 assert.ok(a>=0&&b>a,'Missing code: '+from);
 return html.slice(a,b);
}
const early=source('let finaEarlyBalancesUser=null;','function finaSaveCachedBankData(user){');
const realData=[
 ...Array.from({length:8},(_,i)=>({id:'bank-'+i,user_id:i<4?'lucas-google':'naara-google',
  institution_name:i%2?'NUBANK':'SANTANDER',name:'Conta '+i,type:'BANK',
  subtype:'CHECKING_ACCOUNT',number_last4:'000'+i,balance:100+i})),
 ...Array.from({length:3},(_,i)=>({id:'credit-'+i,user_id:i<1?'lucas-google':'naara-google',
  institution_name:i%2?'NUBANK':'SANTANDER',name:'Visa '+i,type:'CREDIT',
  subtype:'CREDIT_CARD',number_last4:'123'+i,balance:15+i,credit_limit:5000,
  available_credit_limit:3900}))
];
function harness(owner,opts={}){
 const userId=owner+'-google';
 const w={FinaCurrentUser:{id:userId},FinaOwnerResolvedForUserId:userId,
  FinaSelfOwnerKey:owner,FinaPartnerReady:true,FinaRealBankLoaded:false,
  FinaRender:()=>{w.draws=(w.draws||0)+1}};
 const S={accounts:opts.cached?[{id:'from-vault',owner,type:'BANK',real:true,balance:100}]:[],
  cards:opts.cached?[{id:'old-credit',owner,digits:'1230',closing:3,due:10}]:[],
  card:'old-credit'};
 let invoiceReloads=0;
 const query=async()=>opts.data===undefined?{data:realData,error:null}:{data:opts.data,error:opts.error||null};
 const sb={from:table=>{
  assert.equal(table,'fina_bank_accounts');
  return {select:fields=>{
   assert.match(fields,/credit_limit,available_credit_limit/);
   return {order:async()=>query()};
  }};
 }};
 const scope={window:w,S,sb,Number,String,Math,Date,console,
  finaBankSort:(a,b)=>String(a.id).localeCompare(String(b.id)),
  finaLoadOfficialCardBills:async()=>{invoiceReloads++}};
 vm.createContext(scope);
 vm.runInContext(early+'\nthis.finaLoad=finaLoadEarlyBankBalances;',scope);
 return {scope,w,S,load:()=>scope.finaLoadEarlyBankBalances(userId),
  invoices:()=>invoiceReloads};
}

test('Lucas vê 8 contas e 3 cartões do casal antes do histórico completo',async()=>{
 const x=harness('lucas', {cached:true});
 await x.load();
 assert.equal(x.S.accounts.length,8);
 assert.equal(x.S.cards.length,3);
 assert.equal(x.S.accounts.filter(a=>a.owner==='lucas').length,4);
 assert.equal(x.S.accounts.filter(a=>a.owner==='naara').length,4);
 assert.equal(x.S.cards.filter(a=>a.owner==='lucas').length,1);
 assert.equal(x.S.cards.filter(a=>a.owner==='naara').length,2);
 assert.equal(x.w.FinaBankBalancesReady,true);
 assert.equal(x.w.FinaRealBankLoaded,false);
 assert.equal(x.invoices(),1);
 assert.ok(x.w.draws>=1);
});

test('Naara também vê as mesmas 8 contas e 3 cartões, invertendo a perspectiva',async()=>{
 const x=harness('naara',{cached:true});
 await x.load();
 assert.equal(x.S.accounts.length,8);
 assert.equal(x.S.cards.length,3);
 assert.equal(x.S.accounts.filter(a=>a.owner==='naara').length,4);
 assert.equal(x.S.accounts.filter(a=>a.owner==='lucas').length,4);
 assert.equal(x.S.cards.filter(a=>a.owner==='naara').length,2);
 assert.equal(x.S.cards.filter(a=>a.owner==='lucas').length,1);
 assert.equal(x.w.FinaBankBalancesReady,true);
 assert.equal(x.invoices(),1);
});

test('depois de carregado o extrato completo, a resposta rápida não substitui dados',async()=>{
 const x=harness('lucas',{cached:false});
 x.w.FinaRealBankLoaded=true;
 x.S.accounts=[{id:'history-done'}];
 await x.load();
 assert.equal(x.S.accounts[0].id,'history-done');
 assert.equal(x.invoices(),0);
});

test('consulta de contas vazia não apaga snapshot próprio conhecido',async()=>{
 const x=harness('lucas',{cached:true,data:[]});
 await x.load();
 assert.equal(x.S.accounts.length,1);
 assert.equal(x.S.accounts[0].id,'from-vault');
 assert.match(x.w.FinaCashDataError,/Não foi possível/);
});

test('leitura rápida busca bancos e cartões sem esperar pelo extrato histórico',()=>{
 assert.doesNotMatch(early,/finaReadAllAuthorizedBankTransactions\(\)/);
 assert.doesNotMatch(early,/\beq\('type','BANK'\)/);
 assert.doesNotMatch(early,/S\.accounts\|\|\[\]\)\.some\(a=>a\.real===true\)/);
 assert.match(early,/void finaLoadOfficialCardBills\(\)/);
 const loading=source('async function finaLoadRealBankDataOnce(){',"window.addEventListener('fina:auth-ready',()=>{");
 assert.match(loading,/await Promise\.all\(\[/);
});
