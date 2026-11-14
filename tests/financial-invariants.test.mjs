import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
function segment(a,b){
 const p=html.indexOf(a),end=html.indexOf(b,p+a.length);
 assert.ok(p>=0&&end>p,'Mudou a regra financeira: '+a);
 return html.slice(p,end);
}
const run=(code,expression,context)=>vm.runInNewContext(code+'\n'+expression,context,{timeout:3000});
const sum=(list,fn)=>list.reduce((total,x)=>total+fn(x),0);
test('Projeções, reservas e contas pagas não duplicam o saldo bancário',()=>{
 const code=segment('const ownerReserved=o=>','\nconst scopeForCouple=');
 const bills=[
  {id:'l-a',owner:'lucas',state:'open',value:20000,month:10,year:2026},
  {id:'l-r',owner:'lucas',state:'reserved',value:10000,month:10,year:2026},
  {id:'l-p',owner:'lucas',state:'posted',value:5000,month:10,year:2026},
  {id:'n-a',owner:'naara',state:'open',value:40000,month:10,year:2026},
  {id:'n-r',owner:'naara',state:'reserved',value:3000,month:10,year:2026},
  {id:'n-p',owner:'naara',state:'posted',value:20000,month:10,year:2026}
 ];
 const S={bills,future:[{owner:'lucas',value:50000,month:10,year:2026},{owner:'naara',value:10000,month:10,year:2026}]};
 const ctx={S,sum,billValue:b=>b.value,pending:b=>['open','reserved','reported'].includes(b.state),
    sameMonth:b=>b.month===10&&b.year===2026,
    partnerOwner:()=> 'naara',partnerReady:()=>true,ownerBalance:o=>o==='lucas'?100000:30000};
 const result=run(code,'({lucas:ownerProjected("lucas"),naara:ownerProjected("naara"),reservadoLucas:ownerReserved("lucas"),abertoNaara:ownerOpen("naara")})',ctx);
 assert.equal(result.lucas,120000);
 assert.equal(result.naara,-3000);
 assert.equal(result.reservadoLucas,10000);
 assert.equal(result.abertoNaara,43000);
 bills.find(b=>b.id==='l-r').state='posted';
 assert.equal(run(code,'ownerProjected("lucas")',ctx),130000);
});
test('Pix próprios e Pix de casal não entram no coração, mas débito real do cartão entra',()=>{
 const code=segment('const finaCashIsInternal=', '\nconst finaCurrentCashTransactions=')
  +'\n'+segment('const finaCashCountable=','\nconst real=');
 const S={scope:'casal'},ctx={S,finaCoupleTransferTxIds:new Set(['pix-lucas','pix-naara'])};
 const transactions=[
  {id:'real-self',owner:'lucas',category:'Same person transfer',kind:'out',value:174879},
  {id:'real-pix-lucas',owner:'lucas',category:'bank',kind:'out',value:216000},
  {id:'real-pix-naara',owner:'naara',category:'bank',kind:'in',value:216000},
  {id:'real-creditcard',owner:'naara',category:'card-payment',kind:'out',value:267195},
  {id:'real-condominio',owner:'naara',category:'bank',kind:'out',value:66691},
  {id:'real-salario',owner:'lucas',category:'Housing',kind:'in',value:211724}
 ];
 const val=(scope,kind)=>{
  S.scope=scope;
  const expr='transactions.filter(t=>t.kind==='+JSON.stringify(kind)+'&&(S.scope==="casal"||t.owner===S.scope)&&finaCashCountable(t)).reduce((n,t)=>n+t.value,0)';
  return run(code,expr,{...ctx,transactions});
 };
 assert.equal(val('casal','in'),211724);
 assert.equal(val('casal','out'),333886);
 assert.equal(val('lucas','out'),216000);
 assert.equal(val('naara','in'),216000);
 assert.equal(val('naara','out'),333886);
});
test('Movimento pendente e compra de cartão não contam no Entrou/Saiu bancário',()=>{
 assert.match(html,/t\.real===true&&ownerShown\(t\.owner\)/);
 assert.match(html,/String\(t\.status\|\|'POSTED'\)\.toUpperCase\(\)!=='PENDING'/);
 assert.match(html,/\.type==='BANK'/);
});
test('Sem TED confirmada, nenhum valor é criado pelo app',()=>{
 const rules=segment('const finaCashCountable=','\nconst monthResult=');
 const ctx={S:{scope:'casal'},window:{FinaCurrentUser:{id:'u'},FinaCashTotalsByOwner:null},
  finaCoupleTransferTxIds:new Set(),finaCurrentBankMonth:()=>({year:2026,month:10,day:13}),
  finaCurrentCashTransactions:()=>[],sum,
  selfOwner:()=> 'lucas',partnerOwner:()=> 'naara',partnerReady:()=>true,ownerShown:()=>true};
 assert.equal(run(rules,'real("in")',ctx),0);
 assert.match(html,/Carregando saldos reais dos bancos/);
});
