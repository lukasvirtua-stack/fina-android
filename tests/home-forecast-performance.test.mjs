import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
function part(from,to){
 const start=html.indexOf(from),end=html.indexOf(to,start+from.length);
 assert.ok(start>=0&&end>start,"segment not found: "+from);
 return html.slice(start,end);
}
test("cache data local em São Paulo mantém exatidão na virada de mês e de ano",()=>{
 const script=part("const dateParts=new Intl.DateTimeFormat","    for(const movement of txs||[])");
 const values=vm.runInNewContext(script+String.raw`
 const raw=[
  '2026-11-14T01:30:00Z', // 13/11 22:30 BR
  '2026-11-14T03:30:00Z', // 14/11 00:30 BR
  '2027-01-01T01:59:00Z', // 31/12 22:59 BR
  '2027-01-01T03:01:00Z', // 01/01 00:01 BR
  '2026-11-14T03:59:59Z', // mesma hora UTC do segundo
  '2026-11-14T03:30:00Z'
 ];
 ({values:raw.map(finaLocalDay),cached:localDayCache.size});
 `);
 assert.deepEqual(Array.from(values.values,v=>[v.year,v.month,v.day]),[
 [2026,11,13],[2026,11,14],[2026,12,31],[2027,1,1],[2026,11,14],[2026,11,14]]);
 assert.equal(values.cached,4);
 assert.match(html,/date:String\(local\.day\)\.padStart\(2,'0'\)/);
 assert.doesNotMatch(part("const dateParts=new Intl.DateTimeFormat","const prettyBank=v=>"),/localPart\(/);
});
test("previsões mostram somente entradas do mês e ANO selecionados",()=>{
 const script=part("function forecast(){","\nfunction calendar(){");
 const ctx={
  S:{future:[
    {name:"Entrada vigente",owner:"lucas",month:0,year:2027,value:150000,day:20},
    {name:"Entrada ano passado",owner:"lucas",month:0,year:2026,value:990000,day:20},
    {name:"Entrada outro mês",owner:"lucas",month:1,year:2027,value:50000,day:20},
    {name:"Entrada outra pessoa",owner:"naara",month:0,year:2027,value:100000,day:20}
   ],monthForBills:0,billYear:2027,consent:false},
  ownerShown:o=>o==="lucas",heading:()=>"",switcher:()=>"",card:(name,content)=>name+content,
  row:name=>name+";",name:()=>"",money:v=>String(v),btn:()=>"",selfOwner:()=>"lucas",
  escape:v=>v,display:()=>"",monthResult:()=>0,scopeBalance:()=>0,future:()=>0,open:()=>0
 };
 const result=vm.runInNewContext(script+"\nforecast()",ctx);
 assert.match(result,/Entrada vigente/);
 assert.doesNotMatch(result,/Entrada ano passado|Entrada outro mês|Entrada outra pessoa/);
});
test("calendário usa uma única leitura de contas e não mistura saldos",()=>{
 const script=part("function calendar(){","\nfunction finaBankChatAlerts(){");
 let calls=0;
 const ctx={
  S:{year:2026,month:10},ownBills:()=>{calls++;return [
   {name:"Conta A",day:10,state:"open",value:100},
   {name:"Conta B",day:10,state:"reserved",value:200},
   {name:"Conta paga",day:10,state:"posted",value:100},
   {name:"Dia inválido",day:35,state:"open",value:100}
  ]},
  pending:b=>["open","reserved","reported"].includes(b.state),
  heading:()=>"",switcher:()=>"",card:(n,x)=>n+x,escape:v=>v,monthLabel:()=>"novembro",
  row:name=>name+";",status:{open:"Aberto",reserved:"Reservado",posted:"Pago"},
  money:v=>String(v),billValue:x=>x.value
 };
 const result=vm.runInNewContext(script+"\ncalendar()",ctx);
 assert.equal(calls,1);
 assert.match(result,/10<em>2 contas<\/em>/);
 assert.doesNotMatch(result,/35<em>/);
});
