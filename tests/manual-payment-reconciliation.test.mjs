import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
const start=html.indexOf("function finaNormText(v){");
const end=html.indexOf("function finaReconcileManualBills(){",start);
assert.ok(start>0&&end>start,"FINA payment code moved: review regression tests");
const functions=html.slice(start,end);
const makeBill=(extra={})=>({
 id:"manual-new",type:"manual",state:"open",owner:"lucas",value:13579,
 name:"Fatura Santander",day:10,month:10,year:2026, ...extra
});
const makeTx=(extra={})=>({
 id:"real-001",real:true,owner:"lucas",kind:"out",
 value:13579,month:10,year:2026,status:"POSTED",date:"10/11",
 name:"Pagamento fatura Santander",bank:"Santander",category:"Credit card payment",...extra
});
function verify(bill,transactions,otherBills=[]){
 const S={bills:[bill,...otherBills],transactions};
 const ctx={S,Math,Number,Set,String,Array,
  selfOwner:()=>"lucas",
  billValue:b=>b.value,
  finaCashIsInternal:t=>t.category==="transfer-self"||String(t.category||"").toLowerCase().includes("same person transfer"),
  finaCashIsBetweenCouple:t=>t.category==="transfer-spouse",
  money:cents=>"R$ "+(cents/100).toFixed(2)
 };
 const result=vm.runInNewContext(functions+"\n({ok:finaReconcileBill(S.bills[0]),bill:S.bills[0]})",ctx);
 return {ok:result.ok,bill:result.bill};
}
test("único débito POSTED do credor correto pode confirmar fatura sem descontar duas vezes",()=>{
 const b=makeBill(),r=verify(b,[makeTx()]);
 assert.equal(r.ok,true);assert.equal(r.bill.state,"posted");
 assert.equal(r.bill.paidTransactionId,"real-001");
 assert.deepEqual(Array.from(r.bill.paidTransactionIds),["real-001"]);
 assert.equal(r.bill.bankAlreadyReflectedInBalance,true);
 assert.equal(r.bill.bankPaidValueCents,13579);
 assert.equal(r.bill.reconciliationConfidence,"inferred");
});
test("igualdade de valor sem nome do credor não comprova pagamento",()=>{
 const r=verify(makeBill(),[makeTx({name:"Mercado da esquina"})]);
 assert.equal(r.ok,false);assert.equal(r.bill.state,"open");
});
test("transação pendente não é pagamento confirmado",()=>{
 const r=verify(makeBill(),[makeTx({status:"PENDING"})]);
 assert.equal(r.ok,false);assert.equal(r.bill.state,"open");
});
test("Pix próprio e Pix entre o casal não podem quitar fatura",()=>{
 for(const category of ["Same person transfer","transfer-self","transfer-spouse"]){
  const r=verify(makeBill(),[makeTx({category})]);
  assert.equal(r.ok,false,category);assert.equal(r.bill.state,"open");
 }
});
test("uma movimentação já vinculada a outra conta não é reutilizada",()=>{
 const other=makeBill({id:"another",state:"posted",paidTransactionId:"real-001",paidTransactionIds:["real-001"]});
 const r=verify(makeBill(),[makeTx()], [other]);
 assert.equal(r.ok,false);assert.equal(r.bill.state,"open");
});
test("pagamento fora do vencimento e do ciclo não é conciliado automaticamente",()=>{
 const invalid=[
 {date:"28/11"},{month:9},{year:2025},{owner:"naara"},{kind:"in"},
 {real:false},{date:"sem-data"},{status:""}
 ];
 for(const props of invalid){
  const r=verify(makeBill(),[makeTx(props)]);
  assert.equal(r.ok,false,JSON.stringify(props));assert.equal(r.bill.state,"open");
 }
});
test("dois pagamentos indistinguíveis exigem verificação manual",()=>{
 const r=verify(makeBill(),[makeTx({id:"real-001"}),makeTx({id:"real-002"})]);
 assert.equal(r.ok,false);assert.equal(r.bill.state,"open");
 assert.equal(r.bill.reconciliationCandidates,2);
});
test("critério de nome exato em palavras: Santander não confunde santanderino",()=>{
 const r=verify(makeBill(),[makeTx({name:"Compra Santanderino"})]);
 assert.equal(r.ok,false);assert.equal(r.bill.state,"open");
});
test("conta reservada aceita pagamento verdadeiro, mas permanece pendente se inconclusivo",()=>{
 for(const state of ["reserved","reported"]){
  assert.equal(verify(makeBill({state}),[makeTx()]).bill.state,"posted");
  assert.equal(verify(makeBill({state}),[makeTx({name:"Outra despesa"})]).bill.state,state);
 }
});
