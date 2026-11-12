const VERSION='fina-sw-v28-offline-snapshot-20261112';
// Apenas arquivos públicos do aplicativo ficam no cache do Service Worker.
// Nunca guardar extratos bancários, chaves de autenticação ou chamadas Supabase.
const SHELL_CACHE='fina-shell-v28-offline-bank-20261112';
const APP_FILES=['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/supabase.min.js'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL_CACHE);
 await Promise.all(APP_FILES.map(async url=>{try{await cache.add(url)}catch{}}));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const names=await caches.keys();
 await Promise.all(names.filter(x=>x.startsWith('fina-shell-')&&x!==SHELL_CACHE).map(x=>caches.delete(x)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const u=new URL(req.url);
 if(u.origin!==self.location.origin)return;
 const path=u.pathname;
 const isApp=req.mode==='navigate'||['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/supabase.min.js'].includes(path);
 if(!isApp)return;
 event.respondWith((async()=>{
  try{
   const response=await fetch(req);
   if(response.ok){
    const cache=await caches.open(SHELL_CACHE);
    await cache.put(req,response.clone());
   }
   return response;
  }catch{
   const cached=await caches.match(req,{ignoreSearch:true});
   if(cached)return cached;
   if(req.mode==='navigate'){
    const shell=await caches.match('/');
    if(shell)return shell;
   }
   return Response.error();
  }
 })());
});
self.addEventListener('push',event=>{
 if(!event.data)return;
 event.waitUntil((async()=>{
  let payload={};try{payload=event.data.json()}catch{}
  const body=String(payload.body||'Nova movimentação bancária sincronizada.').slice(0,220);
  await self.registration.showNotification('FINA • Movimentação bancária',{
   body,icon:'/icon-192.png',badge:'/icon-192.png',
   tag:String(payload.tag||'fina-movimentacao').slice(0,100),
   data:{url:'/?fina=chat'}
  });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const pages=await clients.matchAll({type:'window',includeUncontrolled:true});
  for(const page of pages){
   if(new URL(page.url).origin===self.location.origin){
    await page.focus();
    page.postMessage({type:'FINA_OPEN_CHAT'});
    return;
   }
  }
  await clients.openWindow('/?fina=chat');
 })());
});
