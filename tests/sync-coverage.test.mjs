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

test('não omite lançamentos inválidos silenciosamente na sincronização',()=>{
 assert.match(sync,/transactions_page_invalid/);
 assert.match(sync,/transactions_record_incomplete/);
 assert.match(sync,/!Number\.isFinite\(Number\(x.amount\)\)/);
 assert.match(sync,/Number\.isNaN\(Date.parse\(String\(x.date\)\)\)/);
 assert.doesNotMatch(sync,/const rows=txs\.filter/);
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
 assert.match(sync,/if\(page>=totalPages\)return invalidBills>0\?/);
 assert.match(sync,/if\(billResult.error\)\{itemImportOk=false;itemImportErr=billResult.error;accountComplete=false;\}/);
});

async function simulateBillImport(pages){
 const start=sync.indexOf('async function finaImportOfficialBills(');
 const end=sync.indexOf('// O banco pode postar',start);
 assert.ok(start>=0&&end>start);
 const js=sync.slice(start,end).replaceAll(':any','').replaceAll(':string','').replaceAll(':number','');
 const requested=[],upserted=[];
 const ctx={
  encodeURIComponent,Number,Math,String,Array,Date,
  finaDatePart:v=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null,
  fetch:async url=>{
   const page=Number(new URL(url).searchParams.get('page'));
   requested.push(page);
   const data=pages[page-1];
   return data?{ok:true,json:async()=>data}:{ok:false,status:503};
  }
 };
 const fn=vm.runInNewContext(js+'\nfinaImportOfficialBills;',ctx);
 const admin={from:table=>{
  assert.equal(table,'fina_card_bills');
  return {upsert:async rows=>{upserted.push(...rows);return {error:null}}};
 }};
 const result=await fn(admin,'usuario','conta',{id:'cartao-1',type:'CREDIT'},'token');
 return {result,requested,upserted};
}

test('faturas são importadas de duas páginas em todos os cartões sem perder a última',async()=>{
 const bill=(id,date)=>({id,dueDate:date,billClosingDate:date,totalAmount:127.23,payments:[]});
 const {result,requested,upserted}=await simulateBillImport([
  {results:[bill('f1','2026-11-10')],totalPages:2},
  {results:[bill('f2','2026-12-10')],totalPages:2}
 ]);
 assert.equal(result.saved,2);
 assert.equal(result.error,undefined);
 assert.deepEqual(requested,[1,2]);
 assert.deepEqual(upserted.map(x=>x.external_bill_id),['f1','f2']);
});

test('falha em página posterior nunca retorna importação de faturas como sucesso',async()=>{
 const {result,requested}=await simulateBillImport([
  {results:[{id:'f1',dueDate:'2026-11-10',totalAmount:5}],totalPages:2}
 ]);
 assert.deepEqual(requested,[1,2]);
 assert.equal(result.saved,1);
 assert.equal(result.error,'bills_unavailable_503');
});


test('faturas válidas continuam sendo importadas quando o provedor envia registros incompletos',async()=>{
 const bill=(id,dueDate,totalAmount)=>({id,dueDate,totalAmount,payments:[]});
 const {result,requested,upserted}=await simulateBillImport([
  {results:[bill('ok-1','2026-11-10',125.10),bill('sem-data',null,45),bill('sem-valor','2026-12-10',null)],totalPages:2},
  {results:[bill('ok-2','2027-01-10',20),bill('negativo','2027-01-11',-10)],totalPages:2}
 ]);
 assert.equal(result.saved,2);
 assert.equal(result.error,undefined);
 assert.equal(result.warning,'bills_record_incomplete');
 assert.equal(result.invalidCount,3);
 assert.deepEqual(requested,[1,2]);
 assert.deepEqual(upserted.map(x=>x.external_bill_id),['ok-1','ok-2']);
 assert.deepEqual(upserted.map(x=>x.total_amount),[125.1,20]);
});
