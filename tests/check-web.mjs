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
  "return Math.min(titular,parceiro)",
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
