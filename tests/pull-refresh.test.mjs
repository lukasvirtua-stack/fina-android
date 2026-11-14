import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');

const start=html.indexOf('const finaPullGestureMatches=');
const end=html.indexOf('\nfunction finaPullToast(',start);
assert.ok(start>=0&&end>start,'Gesto de atualização precisa existir');

const gesture=vm.runInNewContext(html.slice(start,end)+'\nfinaPullGestureMatches;');
test('deslizar no final, puxando para cima, faz a consulta',()=>{
 assert.equal(gesture({x:100,y:250,atTop:false,atBottom:true},{x:102,y:155}),true);
});
test('arrastar do topo para baixo também atualiza',()=>{
 assert.equal(gesture({x:100,y:150,atTop:true,atBottom:false},{x:103,y:245}),true);
});
test('scroll normal, arrasto lateral e gesto curto NÃO acionam a consulta',()=>{
 assert.equal(gesture({x:100,y:200,atTop:false,atBottom:false},{x:100,y:100}),false);
 assert.equal(gesture({x:100,y:200,atTop:true,atBottom:false},{x:210,y:215}),false);
 assert.equal(gesture({x:100,y:200,atTop:true,atBottom:false},{x:101,y:260}),false);
 assert.equal(gesture({x:100,y:200,atTop:false,atBottom:true},{x:100,y:300}),false);
});
test('gesto consulta Supabase, nunca força PATCH dos bancos ou conexão do parceiro',()=>{
 const endSource=html.indexOf('finaPullScreen?.addEventListener(\'touchcancel\'',start);
 const feature=html.slice(start,endSource);
 assert.match(feature,/await finaRefreshVisibleData\(\)/);
 assert.doesNotMatch(feature,/fina-pluggy-sync|method:[\s]*['"]PATCH['"]|FinaBank\?\.sync/);
 assert.match(feature,/finaPullLastAt<30000/);
 assert.match(feature,/finaPullBusy/);
 assert.match(feature,/window\.FinaCurrentUser\?\.id!==start\.userId/);
 assert.match(html,/finaAutoRefreshTimer=setInterval\(\(\)=>void finaRefreshVisibleData\(\),60000\)/);
 assert.match(html,/await finaLoadSharedBills\(\)/);
 assert.match(html,/await finaLoadHistorySharingStatus\(\)/);
});
