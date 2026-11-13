import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
function segment(from, to) {
  const start = html.indexOf(from);
  assert.notEqual(start, -1, 'Função ausente: ' + from);
  const end = html.indexOf(to, start + from.length);
  assert.notEqual(end, -1, 'Delimitador ausente: ' + to);
  return html.slice(start, end);
}
function run(code, expression, scope) {
  return vm.runInNewContext(code + '\n' + expression, scope, { timeout: 3000 });
}

test('Scripts embutidos têm sintaxe válida', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(x => x[1]).filter(x => x.trim());
  assert.ok(scripts.length >= 3);
  for (const script of scripts) new vm.Script(script, { filename: 'web/index.html' });
});

test('Casal soma saldos das duas pessoas; individual conserva seu saldo', () => {
  const code = segment('const coupleBaseBalance=', '\nconst monthKey=');
  const bank = { lucas: 68570, naara: 714 };
  for (const scope of ['casal', 'lucas', 'naara']) {
    const ctx = { S: { scope }, ownerBalance: o => bank[o],
      selfOwner: () => 'lucas', partnerOwner: () => 'naara', partnerReady: () => true };
    const result = run(code, '({ casal: coupleBaseBalance(), exibido: scopeBalance() })', ctx);
    assert.equal(result.casal, 69284);
    assert.equal(result.exibido, scope === 'casal' ? 69284 : bank[scope]);
  }
});

test('Pix/TED entre Lucas e Naara contam; transferências próprias não contam', () => {
  const code = segment('const finaCashIsInternal=', '\nconst finaCurrentCashTransactions=')
    + '\n' + segment('const finaCashCountable=', '\nconst real=');
  const result = run(code, '({ propria:finaCashCountable({category:"transfer-self"}), propriaRaw:finaCashCountable({category:"Same person transfer"}), parceiro:finaCashCountable({category:"transfer-spouse"}), comum:finaCashCountable({category:"bank"}) })', {});
  assert.equal(result.propria, false);
  assert.equal(result.propriaRaw, false);
  assert.equal(result.parceiro, true);
  assert.equal(result.comum, true);
});

test('Entrou/Saiu do Casal somam exatamente os totais de Lucas e Naara', () => {
  const code = segment('const real=k=>{', '\nconst monthResult=');
  const snapshot = { userId:'u', ownerKey:'lucas', year:2026, month:10, transferKey:'',
    totals:{lucas:{in:240604,out:491361},naara:{in:239000,out:493795}},
    coupleTotals:{in:0,out:0} };
  for (const [scope, expectedIn, expectedOut] of [
    ['casal', 479604, 985156], ['lucas', 240604, 491361], ['naara', 239000, 493795]
  ]) {
    const ctx = { window:{FinaCurrentUser:{id:'u'},FinaCashTotalsByOwner:snapshot,FinaBankCacheState:'live'},
      S:{scope},finaCoupleTransferTxIds:new Set(),
      finaCurrentBankMonth:()=>({year:2026,month:10,day:13}),
      selfOwner:()=> 'lucas',partnerOwner:()=> 'naara',
      partnerReady:()=>true,ownerShown:()=>true };
    const results = run(code, '[real("in"),real("out")]', ctx);
    assert.equal(results[0], expectedIn);
    assert.equal(results[1], expectedOut);
  }
});

test('Resultado do Casal soma as duas projeções individuais', () => {
  const code = segment('const monthResult=', '\nconst ownerReserved=');
  const projected = { lucas: -42000, naara: 21000 };
  for (const scope of ['casal','lucas','naara']) {
    const ctx = { S:{scope},ownerProjected:o=>projected[o],
      selfOwner:()=> 'lucas',partnerOwner:()=> 'naara' };
    const actual = run(code, 'monthResult()', ctx);
    assert.equal(actual, scope === 'casal' ? -21000 : projected[scope]);
  }
});

test('Cache mantém extrato dos dois integrantes autorizados', () => {
  assert.match(html, /transactions:\(S\.transactions\|\|\[\]\)\.filter\(x=>x\.real===true&&\['lucas','naara'\]\.includes\(x\.owner\)&&ownerShown\(x\.owner\)\)/);
});
