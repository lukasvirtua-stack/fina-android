import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const src=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
const between=(start,end)=>{
 const from=src.indexOf(start),to=src.indexOf(end,from+start.length);
 assert.ok(from>=0&&to>from,"Required live segment missing: "+start);
 return src.slice(from,to);
};

test("o banco revela faturas parciais sem confundir uma sincronização válida com falha",()=>{
 const segment=between("const fmtBankTime=v=>"," const accounts=S.accounts.filter");
 const context={
   window:{FinaBankSyncHealth:[
     {label:"NUBANK",last_import_error:null,last_bills_warning:"bills_record_incomplete",
       last_bills_invalid_count:5,provider_execution_status:"SUCCESS",
       provider_last_updated_at:"2026-11-14T20:18:00Z",last_import_success_at:"2026-11-14T21:30:00Z"},
     {label:"SANTANDER",last_import_error:null,last_bills_warning:null,
       last_bills_invalid_count:0,provider_execution_status:"SUCCESS",
       provider_last_updated_at:"2026-11-14T20:18:00Z",last_import_success_at:"2026-11-14T21:30:00Z"}
   ]},
   escape:value=>String(value),
   Date,
   Number,
   Math
 };
 const actual=vm.runInNewContext(segment+"\nhealthRows",context);
 assert.match(actual,/NUBANK/);
 assert.match(actual,/Faturas parciais: 5 registro\(s\)/);
 assert.match(actual,/Valores ausentes não são zero/);
 assert.doesNotMatch(actual,/SANTANDER.*Faturas parciais/s);
});

test("cartão sem fatura não deve apresentar falsa quitação de R$ 0,00",()=>{
 const code=between("const cardRows=creditCards.map"," .join('')||'<p class=\"muted\">Nenhum cartão visível neste filtro.</p>'");
 assert.match(code,/invoice\?display\(billValue\(invoice\)\):'Fatura não informada'/);
 assert.doesNotMatch(code,/invoice\?display\(billValue\(invoice\)\):'R\$ 0,00'/);
});

test("Faturas + Contas avisa sobre payload incompleto e preserva segurança por login",()=>{
 assert.match(src,/last_bills_warning,last_bills_invalid_count'\)/);
 assert.match(src,/const incompleteBills=\(window\.FinaBankSyncHealth\|\|\[\]\)\.some/);
 assert.match(src,/Valores ausentes não significam fatura zerada/);
 assert.match(src,/if\(S\.tab==='banks'\|\|S\.tab==='bills'\)window\.FinaRender/);
 const reset=src.match(/window\.FinaSyncAlerts=\[\];window\.FinaBankSyncHealth=\[\];window\.FinaOfflineHistoryCount=0/g)||[];
 assert.equal(reset.length,2,"Session change and logout must clear previous user's warnings");
});
