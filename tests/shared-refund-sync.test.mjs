import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261115133500_fina_shared_pending_refunds.sql',import.meta.url),'utf8');
function between(start,end){
 const i=html.indexOf(start),j=html.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'Trecho ausente: '+start);
 return html.slice(i,j);
}
const refund=(id,owner='lucas')=>({id,owner,card:'nubank',name:'Compra devolvida',
 value:4589,month:10,year:2026,state:'pending',type:'manual'});
const data=()=>({state:{},manualBills:[],future:[],refunds:[]});
test('salva somente estornos pendentes, sem alterar valores bancários',()=>{
 const script=between('const finaPersistManualBill=x=>','window.FinaExportPersistentState=()=>')
  +between('let finaPersistTimer=null;','async function finaRestoreEncryptedLocalPreferences');
 const f=vm.runInNewContext(script+'\n({normalize:finaNormalizeSavedState,merge:finaMergeSavedState})',
  {window:{},console,Date,Promise},{timeout:2500});
 const raw={refunds:[refund(10),{...refund(11),state:'cash'}, {...refund(12),type:'shared'}],manualBills:[],future:[]};
 const norm=f.normalize(raw);
 assert.deepEqual(Array.from(norm.refunds.map(x=>x.id)),[10]);
 const remote=f.normalize({refunds:[refund(10),refund(14)],manualBills:[],future:[]});
 const edited=f.normalize({refunds:[refund(10),refund(13)],manualBills:[],future:[]});
 const merged=f.merge(remote,norm,edited);
 assert.deepEqual(Array.from(merged.refunds.map(x=>x.id)),[10,14,13]);
 assert.equal(merged.refunds[0].state,'pending');
});

test('duas contas carregam estornos compartilhados sem duplicar',async()=>{
 const fn=between('async function finaLoadSharedBills(){','window.FinaLoadSharedBills=finaLoadSharedBills;');
 const owner1='00000000-0000-4000-8000-000000000001';
 const owner2='00000000-0000-4000-8000-000000000002';
 for(const [login,other] of [[owner1,owner2],[owner2,owner1]]){
  const shared={id:'shared-refund-'+other+'-12345',sourceUserId:other,
   owner:'naara',card:'nubank',name:'Compra devolvida',state:'pending',
   value:4589,month:10,year:2026};
  const window={FinaCurrentUser:{id:login},FinaPartnerReady:true,FinaRender:()=>{}};
  const S={bills:[],future:[],refunds:[refund(45,'lucas')]};
  const sb={rpc:async name=>({data:name==='fina_shared_pending_refunds'?[shared]:[]})};
  const ctx={window,S,sb,Array,Math,Number,String,Set};
  vm.createContext(ctx);
  vm.runInContext(fn,ctx);
  await ctx.finaLoadSharedBills();
  await ctx.finaLoadSharedBills();
  assert.equal(S.refunds.length,2);
  assert.equal(S.refunds.filter(x=>x.type==='shared').length,1);
  assert.equal(S.refunds[1].sourceUserId,other);
  assert.equal(S.refunds[0].type,'manual');
  window.FinaPartnerReady=false;
  await ctx.finaLoadSharedBills();
  assert.equal(S.refunds.length,1);
 }
});

test('usuário diferente não pode receber resposta de sessão antiga',async()=>{
 const fn=between('async function finaLoadSharedBills(){','window.FinaLoadSharedBills=finaLoadSharedBills;');
 const window={FinaCurrentUser:{id:'A'},FinaPartnerReady:true,FinaRender:()=>{}};
 const S={bills:[],future:[],refunds:[refund(45)]};
 let resolve;
 const pending=new Promise(r=>resolve=r);
 const sb={rpc:async name=>name==='fina_shared_pending_refunds'?pending:{data:[]}};
 const ctx={window,S,sb,Array,Math,Number,String,Set};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 const task=ctx.finaLoadSharedBills();
 window.FinaCurrentUser={id:'B'};
 resolve({data:[{id:'shared-refund-123-9',type:'shared',state:'pending',value:100}]});
 await task;
 assert.equal(S.refunds.length,1);
});

test('botões de estorno não criam créditos, saldos ou lançamentos fictícios',()=>{
 const part=between('function refundRow(r){','\nfunction cards(){');
 assert.match(part,/refund-delete/);
 assert.doesNotMatch(html,/Simular crédito na fatura|Simular devolução na conta|Desfazer simulação/);
 assert.doesNotMatch(html,/function confirmRefund\(/);
 assert.match(html,/const cardRefundCredit=id=>0;/);
 const save=between('window.FinaExportPersistentState=()=>{','window.FinaApplyPersistentState=(p)=>');
 assert.match(save,/refunds:/);
 assert.match(html,/\['newbill','edit','forecast','invoice','refund'\]/);
 assert.match(html,/window\.FinaDeleteSharedRefund=async refund=>/);
});

test('RPC limita visibilidade a casal autorizado e permite só excluir pendentes',()=>{
 assert.match(sql,/mine.user_id=\(select auth.uid\(\)\)/);
 assert.match(sql,/them.sharing_level in \('planning','partial','total'\)/);
 assert.match(sql,/r.item->>'state'='pending'/);
 assert.match(sql,/p_owner_id=actor/);
 assert.match(sql,/for update/);
 assert.match(sql,/r.item->>'state'='pending'/);
 assert.match(sql,/revoke all on function public.fina_shared_pending_refunds\(\) from public,anon/);
 assert.match(sql,/grant execute on function public.fina_delete_shared_refund\(uuid,text\) to authenticated/);
 assert.match(sql,/state=jsonb_set\(current_state,'\{refunds\}',next_refunds,true\)/);
 assert.doesNotMatch(sql,/fina_bank_accounts|fina_card_bills|fina_bank_transactions/);
});
