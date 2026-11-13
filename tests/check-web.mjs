import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const required = [
  "const finaCurrentBankMonth=",
  "const finaBankLedgerSelectedPeriod=",
  "const finaCurrentCashTransactions=",
  "const finaCashCountable=",
  "const real=k=>",
  "return titular+parceiro",
  "cashCoupleTotals[kind]+=amount;",
  "let finaCoupleTransferTxIds",
  "window.FinaLoadCoupleTransfers=",
  "window.FinaOwnerResolvedForUserId",
  "fina_couple_card_bills",
  "fina_projected_card_spend",
  "fina_payment_candidates",
  "fina_confirm_bill_payment",
  "function finaCashLedger(){",
  "data-act=\"cash-month-prev\"",
  "data-act=\"cash-month-next\"",
  "window.FinaTeachPayment=async",
  "window.FinaConfirmPaymentFromBank=async",
  "fina_push_subscriptions"
];
for(const fragment of required){
  assert(app.includes(fragment), 'Essential FINA behavior is missing: '+fragment);
}
const scripts=[...app.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([,attrs,body])=>body.trim()&&!/\bsrc=/.test(attrs));
assert(scripts.length>0,'No inlined JavaScript found');
const folder=mkdtempSync(path.join(tmpdir(),'fina-qa-'));
try{
  for(let i=0;i<scripts.length;i++){
    const [,,body]=scripts[i];
    const filename=path.join(folder,'script-'+i+'.js');
    writeFileSync(filename,body);
    const checked=spawnSync(process.execPath,['--check',filename],{encoding:'utf8'});
    assert.equal(checked.status,0,'Syntax error in inline script '+i+': '+checked.stderr);
  }
}finally{rmSync(folder,{recursive:true,force:true});}
console.log('FINA WEB QA PASS · scripts='+scripts.length+' · rules='+required.length);


// Regressão executando AS FUNÇÕES FINANCEIRAS DO APLICATIVO (não uma cópia das regras).
// Verifica ambos os logins, Pix internos, Pix do casal e o fechamento do mês.
import vm from 'node:vm';
const ownerStart=app.indexOf('const selfOwner=');
const ownerEnd=app.indexOf('const monthKey=',ownerStart);
const flowsStart=app.indexOf('const finaCashIsInternal=');
const flowsEnd=app.indexOf('const monthResult=',flowsStart);
const projectionEnd=app.indexOf('const scopeForCouple=',flowsEnd);
assert(ownerStart>=0&&ownerEnd>ownerStart&&flowsStart>=0&&flowsEnd>flowsStart&&projectionEnd>flowsEnd,
  'Owner or cashflow implementation has changed; update financial QA before releasing');
const liveRules=app.slice(ownerStart,ownerEnd)+app.slice(flowsStart,projectionEnd);
assert(!app.includes('if(!betweenPartners)cashCoupleTotals[kind]+=amount;'), 'Casal must never exclude transfers between Lucas and Naara');
const movement=(id,owner,kind,value,category='bank',status='POSTED')=>({
  id:'real-'+id,owner,kind,value,category,status,month:10,year:2026,date:'09/11',real:true
});
const movements=[
 movement('lucas-wages','lucas','in',240604),
 movement('lucas-self-received','lucas','in',174879,'transfer-self'),
 movement('lucas-self-sent','lucas','out',174879,'transfer-self'),
 movement('lucas-to-naara','lucas','out',233000,'transfer-spouse'),
 movement('lucas-normal-bill','lucas','out',258361),
 movement('naara-from-lucas','naara','in',233000,'transfer-spouse'),
 movement('naara-external-income','naara','in',6000),
 movement('naara-normal-bill','naara','out',493795),
 movement('should-not-count','naara','in',900000,'bank','PENDING'),
 {...movement('card-purchase','naara','out',34500),real:false}
];
function checkCashRules(loggedIn){
 const S={scope:'casal',transactions:movements,monthForBills:10,billYear:2026,
  accounts:[{owner:'lucas',balance:100000},{owner:'naara',balance:260000}],
  future:[{owner:'lucas',value:5000},{owner:'naara',value:8000}],
  bills:[{owner:'lucas',value:10000},{owner:'naara',value:30000}]};
 const window={FinaSelfOwnerKey:loggedIn,FinaPartnerReady:true,
   FinaCurrentUser:{id:loggedIn+'-google'},FinaCashTotalsByOwner:null};
 const context={S,window,sum:(list,fn)=>list.reduce((sum,x)=>sum+fn(x),0),
   finaCurrentBankMonth:()=>({year:2026,month:10,day:13}),
   partnerReady:()=>true,sameMonth:()=>true,pending:()=>true,billValue:b=>b.value,
   finaCoupleTransferTxIds:new Set(['lucas-to-naara','naara-from-lucas'])};
 vm.createContext(context);
 vm.runInContext(liveRules+
   '\nthis.check=(scope,kind)=>{S.scope=scope;return real(kind)};\nthis.checkBalance=scope=>{S.scope=scope;return scopeBalance()};\nthis.checkResult=()=>{S.scope="casal";return monthResult()};\nthis.checkType=t=>finaCashCountable(t);',context,
   {timeout:1000});
 const results=[
   ['lucas','in',240604],['lucas','out',491361],
   ['naara','in',239000],['naara','out',493795],
   ['casal','in',479604],['casal','out',985156]
 ];
 for(const [scope,direction,expectedCents] of results){
  assert.equal(context.check(scope,direction),expectedCents,
    loggedIn+' · '+scope+' · '+direction+' must follow bank-only rules');
 }
 for(const [scope,expectedCents] of [['lucas',100000],['naara',260000],['casal',360000]]){
  assert.equal(context.checkBalance(scope),expectedCents,loggedIn+' · '+scope+' bank balance');
 }
 assert.equal(context.checkResult(),333000,loggedIn+' · couple projected result must sum both balances');
 assert.equal(context.checkType({category:'transfer-self'}),false,'self transfers excluded');
 assert.equal(context.checkType({category:'transfer-spouse'}),true,'spouse transfers counted');
}
checkCashRules('lucas');
checkCashRules('naara');
console.log('FINA FINANCIAL RULES PASS · logins=2 · assertions=24 · self transfers excluded; couple included');

