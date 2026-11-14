import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../web/service-worker.js',import.meta.url),'utf8');

function swHarness(){
 const handlers=new Map(),stored=new Map(),networkCalls=[];
 let pendingRefresh=null,offline=false;
 function response(body){return {ok:true,body,clone(){return response(body)}};}
 const cache={
  match:async key=>stored.get(typeof key==='string'?key:key.url)||null,
  put:async (key,item)=>{stored.set(typeof key==='string'?key:key.url,item.clone());}
 };
 const context={
  URL,Request:class {constructor(path,opts={}){this.url=new URL(path,'https://fina-html-v14.vercel.app').href;this.method='GET';this.mode='navigate';this.credentials=opts.credentials;this.cache=opts.cache;}},
  Response:{error:()=>({ok:false,error:true})},
  caches:{open:async()=>cache,keys:async()=>['fina-shell-v29-balance-first-20261113','fina-shell-v30-fast-start-20261113'],delete:async()=>true},
  fetch:async req=>{
   const path=new URL(typeof req==='string'?req:req.url,'https://fina-html-v14.vercel.app').pathname;
   networkCalls.push(path);
   if(offline)throw Error('Sem internet');
   if(pendingRefresh&&path==='/index.html')return new Promise(resolve=>{pendingRefresh.resolve=resolve;});
   return response('ONLINE:'+path);
  },
  self:{
   location:{origin:'https://fina-html-v14.vercel.app'},
   addEventListener:(type,fn)=>handlers.set(type,fn),
   skipWaiting:async()=>{},
   clients:{claim:async()=>{}},
   registration:{showNotification:async()=>{}}
  },
  clients:{matchAll:async()=>[],openWindow:async()=>{}},
  console
 };
 vm.runInNewContext(source,context,{timeout:2000});
 async function install(){
  const pending=[];
  handlers.get('install')({waitUntil:p=>pending.push(p)});
  await Promise.all(pending);
 }
 function fetchEvent(url,mode='navigate'){
  let promise=null,called=false;
  const background=[];
  const event={
   request:{url,mode,method:'GET'},
   respondWith(p){called=true;promise=p;},
   waitUntil(p){background.push(p);}
  };
  handlers.get('fetch')(event);
  return {called,promise,background};
 }
 return {handlers,stored,networkCalls,response,install,fetchEvent,makeOffline:v=>{offline=v;},
  holdRefresh:()=>{pendingRefresh={};},
  releaseRefresh:()=>{pendingRefresh.resolve?.(response('ACTUALIZADO'));pendingRefresh=null;}};
}

test('Service Worker preserva notificação push e cache só do conteúdo público',()=>{
 const sw=swHarness();
 assert.ok(sw.handlers.has('push'));
 assert.ok(sw.handlers.has('notificationclick'));
 assert.match(source,/SHELL_PATHS\.has\(url\.pathname\)/);
 assert.doesNotMatch(source,/cache\.put\(.*(transaction|saldo|authorization|supabase\.co)/i);
 const privateApi=sw.fetchEvent('https://gdjswengldvvgjrpdtst.supabase.co/rest/v1/fina_bank_transactions','cors');
 assert.equal(privateApi.called,false);
 const unknown=sw.fetchEvent('https://fina-html-v14.vercel.app/contas/privadas','navigate');
 assert.equal(unknown.called,false);
});

test('Cache precarregado serve a tela imediatamente mesmo com rede lenta',async()=>{
 const sw=swHarness();
 await sw.install();
 assert.ok(sw.stored.has('/index.html'));
 assert.ok(sw.stored.has('/supabase.min.js'));
 sw.holdRefresh();
 const result=sw.fetchEvent('https://fina-html-v14.vercel.app/?fina=chat&code=oauth-sample');
 assert.equal(result.called,true);
 const answer=await Promise.race([result.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Abertura bloqueada pela rede')),200))]);
 assert.equal(answer.body,'ONLINE:/index.html');
 assert.equal(sw.stored.has('/?fina=chat&code=oauth-sample'),false,'OAuth nunca vai para o cache');
 assert.equal(result.background.length,1);
 sw.releaseRefresh();
 await Promise.all(result.background);
 assert.equal(sw.stored.get('/index.html').body,'ACTUALIZADO','A atualização ocorre para a próxima abertura');
});

test('App abre offline a partir de arquivos públicos previamente salvos',async()=>{
 const sw=swHarness();
 await sw.install();
 sw.makeOffline(true);
 const e=sw.fetchEvent('https://fina-html-v14.vercel.app/');
 const r=await e.promise;
 assert.equal(r.body,'ONLINE:/index.html');
 await Promise.all(e.background);
 const asset=sw.fetchEvent('https://fina-html-v14.vercel.app/supabase.min.js','no-cors');
 assert.equal((await asset.promise).body,'ONLINE:/supabase.min.js');
 await Promise.all(asset.background);
});
