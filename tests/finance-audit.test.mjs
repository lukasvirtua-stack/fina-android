import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const web=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
const audit=readFileSync(new URL("../scripts/fina-financial-integrity-audit.sql",import.meta.url),"utf8");
function segment(from,to){
 const a=web.indexOf(from);const b=web.indexOf(to,a+from.length);
 assert.ok(a>=0&&b>a,from+" missing");
 return web.slice(a,b);
}

test("cashflow uses only POSTED bank data without double-counting own or couple Pix",()=>{
 const code=segment("const finaCashIsInternal=","\nconst real=");
 const tx=[
  {id:"r1",owner:"lucas",real:true,kind:"in",value:12000,category:"Income",date:"14/11",month:10,year:2026,status:"POSTED"},
  {id:"r2",owner:"lucas",real:true,kind:"in",value:10000,category:"Same person transfer",date:"14/11",month:10,year:2026,status:"POSTED"},
  {id:"r3",owner:"naara",real:true,kind:"in",value:30000,category:"transfer-spouse",date:"14/11",month:10,year:2026,status:"POSTED"},
  {id:"r4",owner:"lucas",real:true,kind:"out",value:80000,category:"Housing",date:"14/11",month:10,year:2026,status:"PENDING"},
  {id:"r5",owner:"lucas",real:true,kind:"out",value:7500,category:"Groceries",date:"14/11",month:10,year:2026,status:"POSTED"},
  {id:"r6",owner:"lucas",real:true,kind:"out",value:50000,category:"Groceries",date:"14/11",month:10,year:2026,status:"POSTED",bank:false},
  {id:"r7",owner:"lucas",real:true,kind:"in",value:19000,category:"Income",date:"01/10",month:9,year:2026,status:"POSTED"}
 ];
 const bankOnly=tx.filter(t=>t.id!=="r6");
 for(const mode of ["casal","lucas","naara"]){
  const S={scope:mode,transactions:bankOnly};
  const ctx={S,finaCoupleTransferTxIds:new Set(),
    ownerShown:o=>mode==="casal"||mode===o,finaCurrentBankMonth:()=>({month:10,year:2026,day:14})};
  const result=vm.runInNewContext(code+"\n({eligible:finaCurrentCashTransactions().filter(finaCashCountable)})",ctx);
  const eligible=result.eligible;
  const income=eligible.filter(t=>t.kind==="in").reduce((n,t)=>n+t.value,0);
  const expenses=eligible.filter(t=>t.kind==="out").reduce((n,t)=>n+t.value,0);
  assert.equal(income,mode==="casal"?12000:mode==="lucas"?12000:30000);
  assert.equal(expenses,mode==="naara"?0:7500);
 }
 assert.match(web,/S\.transactions=\(txs\|\|\[\]\)\.filter\(t=>bankIds\.has\(t\.bank_account_id\)\)/);
});

test("projection uses current balance, legitimate forecast and pending bills once",()=>{
 const code=segment("const monthResult=()","\nconst scopeForCouple=");
 const balances={lucas:500000,naara:200000};
 const S={scope:"casal",
   future:[{owner:"lucas",value:100000,month:10,year:2026},{owner:"naara",value:50000,month:10,year:2026}],
   bills:[{owner:"lucas",value:220000,state:"open",month:10,year:2026},
          {owner:"lucas",value:80000,state:"reserved",month:10,year:2026},
          {owner:"lucas",value:100000,state:"posted",month:10,year:2026},
          {owner:"naara",value:60000,state:"reported",month:10,year:2026}]};
 const ctx={S,partnerOwner:()=>"naara",selfOwner:()=>"lucas",partnerReady:()=>true,
   ownerBalance:o=>balances[o],sameMonth:x=>x.month===10&&x.year===2026,
   sum:(items,fun)=>items.reduce((n,x)=>n+fun(x),0),
   pending:x=>["open","reserved","reported"].includes(x.state),billValue:x=>x.value};
 const result=vm.runInNewContext(code+"\n({lucas:ownerProjected('lucas'),naara:ownerProjected('naara'),casal:monthResult()})",ctx);
 assert.equal(result.lucas,300000);
 assert.equal(result.naara,190000);
 assert.equal(result.casal,490000);
});

test("audit SQL is read-only and scopes cashflow to posted BANK transactions",()=>{
 assert.match(audit,/UPPER\(a\.type\)='BANK'/);
 assert.match(audit,/posted AS \(SELECT \* FROM bank_month WHERE status='POSTED'\)/);
 assert.match(audit,/NOT same_person AND NOT between_couple/);
 assert.match(audit,/paid_amount>total_amount/);
 assert.match(audit,/DATE_TRUNC\('month', NOW\(\) AT TIME ZONE 'America\/Sao_Paulo'\)/);
 assert.doesNotMatch(audit,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\s+(?:TABLE|FROM|INTO|public)/i);
});
