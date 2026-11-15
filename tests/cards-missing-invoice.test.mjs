import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const begin=html.indexOf('function cards(){');
const end=html.indexOf('function billActions(',begin);
assert.ok(begin>=0&&end>begin,'Cartões renderer not found');
const code=html.slice(begin,end);
const cardAccount={id:'real-card-demo',bank:'Nubank',digits:'1234',name:'Cartão',
 closing:3,due:10,limit:599000,used:60000};
function show(bill){
 const S={cards:[cardAccount],card:cardAccount.id,bills:bill?[bill]:[],
  refunds:[],invoiceAdd:false,formNotice:''};
 const ctx={
  S,ownerShown:()=>true,sameMonth:()=>true,cardRefundCredit:()=>0,
  heading:()=>'',monthPicker:()=>'',bankCard:()=>'',status:{open:'Em aberto',posted:'Pago'},
  escape:s=>String(s),money:v=>'R$ '+(v/100).toFixed(2),
  billValue:b=>b.value,cardCycle:()=>'',billActions:()=>'',btn:()=>'',row:(name,detail,value)=>name+': '+value,
  card:(title,content)=>title+content
 };
 return vm.runInNewContext(code+'\n cards()',ctx);
}
test('cartão sem registro não inventa fatura zerada',()=>{
 const rendered=show(null);
 assert.match(rendered,/Fatura não informada/);
 assert.match(rendered,/Não informada/);
 assert.match(rendered,/Não informado/);
 assert.doesNotMatch(rendered,/Compras do ciclo/);
 assert.doesNotMatch(rendered,/Fatura vigente/);
});
test('fatura oficial de R$ 0,00 continua indicada como zero real',()=>{
 const rendered=show({id:'bill0',card:cardAccount.id,state:'posted',value:0});
 assert.match(rendered,/Fatura do mês selecionado<\/small><strong>R\$ 0\.00/);
 assert.doesNotMatch(rendered,/Fatura não informada/);
});
test('a tela não apresenta saldo residual como compras do ciclo',()=>{
 const rendered=show({id:'bill1',card:cardAccount.id,state:'open',value:12049});
 assert.match(rendered,/Valor da fatura no período/);
 assert.match(rendered,/valor da fatura, não total de compras/);
 assert.match(rendered,/R\$ 120\.49/);
 assert.doesNotMatch(rendered,/Compras do ciclo/);
});
