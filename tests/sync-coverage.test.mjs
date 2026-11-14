import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const sync=readFileSync(new URL('../supabase/functions/fina-safe-auto-sync/index.ts',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');

test('atualização automática percorre todos os itens, contas e cartões, inclusive páginas extras',()=>{
 assert.match(sync,/for\(const item of items\|\|\[\]\)/);
 assert.match(sync,/for\(const a of accounts\)/);
 assert.match(sync,/for\(let page=2;page<=morePages && page<=50;page\+\+\)/);
 assert.match(sync,/accounts\.push\(\.\.\.payload\.results\)/);
 assert.match(sync,/accounts_pagination_incomplete/);
 assert.match(sync,/for\(let guard=0;guard<30&&next;guard\+\+\)/);
 assert.match(sync,/transactionPages\+\+/);
 assert.match(sync,/if\(next\)\{fullHistoryOk=false/);
 assert.match(sync,/accountsScanned===accountsComplete/);
 assert.match(sync,/last_import_error:itemImportOk\?null:/);
 assert.match(sync,/last_import_success_at=new Date\(\)\.toISOString\(\)/);
 assert.match(sync,/const billResult=await finaImportOfficialBills/);
 assert.match(sync,/upsert\(rows,\{onConflict:"user_id,external_transaction_id"\}\)/);
});

test('reimporta movimentações atrasadas da virada do mês sem inventar lançamentos',()=>{
 const start=sync.indexOf('const finaRollingStart=');
 const end=sync.indexOf('\nDeno.serve',start);
 assert.ok(start>0 && end>start);
 const code=sync.slice(start,end).replace('today:Date','today');
 const func=vm.runInNewContext(code+'\nfinaRollingStart;');
 assert.equal(func(new Date(2026,10,14)),'2026-10-31');
 assert.equal(func(new Date(2026,10,30)),'2026-11-01');
 assert.equal(func(new Date(2026,11,1)),'2026-11-17');
 assert.equal(func(new Date(2027,0,3)),'2026-12-20');
 assert.match(sync,/const dateFrom=finaRollingStart\(nowBr\)/);
 assert.doesNotMatch(sync,/\/items\/.*method:"PATCH"/);
});

test('cada conta falha de forma visível, sem marcar sucesso silencioso',()=>{
 assert.match(sync,/accountsFailed\+\+;continue/);
 assert.match(sync,/accountComplete=false/);
 assert.match(sync,/if\(accountComplete\)accountsComplete\+\+;else accountsFailed\+\+/);
 assert.match(sync,/allConnectedProductsChecked:importFailures===0 && accountsFailed===0/);
});

test('interface informa o atraso do banco e sua próxima previsão de atualização',()=>{
 assert.match(html,/Próxima atualização prevista pelo provedor/);
 assert.match(html,/Atualização do banco atrasada/);
 assert.match(html,/Aguardando dados mais recentes do banco/);
 assert.match(html,/provider_next_auto_sync_at/);
 assert.match(html,/uma consulta da FINA não garante que novas transações já foram liberadas/);
});

test('faturas de TODOS os cartões são paginadas sem êxito silencioso',()=>{
 assert.match(sync,/for\(let page=1;page<=50;page\+\+\)/);
 assert.match(sync,/bills_page_invalid/);
 assert.match(sync,/bills_record_incomplete/);
 assert.match(sync,/bills_page_empty_before_end/);
 assert.match(sync,/bills_pagination_incomplete/);
 assert.match(sync,/if\(page>=totalPages\)return \{saved\};/);
 assert.match(sync,/if\(billResult.error\)\{itemImportOk=false;itemImportErr=billResult.error;accountComplete=false;\}/);
});
