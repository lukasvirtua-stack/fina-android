const VERSION='fina-sw-v31-encrypted-history-20261113';
// Armazena SOMENTE arquivos estaticos publicos do aplicativo.
// Nunca interceptar nem armazenar OAuth, Supabase, Pluggy, extratos ou tokens.
const SHELL_CACHE='fina-shell-v31-encrypted-history-20261113';
const APP_FILES=['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/supabase.min.js','/offline-vault.js'];
const SHELL_PATHS=new Set(APP_FILES);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL_CACHE);
 await Promise.all(APP_FILES.map(async path=>{
  try{const response=await fetch(path,{cache:'reload'});if(response.ok)await cache.put(path,response)}catch{}
 }));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(k=>k.startsWith('fina-shell-')&&k!==SHELL_CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 // Somente a pagina inicial e os cinco arquivos publicados: requests do banco seguem diretos.
 if(!SHELL_PATHS.has(url.pathname))return;
 const key=url.pathname==='/'?'/index.html':url.pathname;
 event.respondWith((async()=>{
  const cache=await caches.open(SHELL_CACHE);
  const cached=await cache.match(key);
  // Stale-while-revalidate: devolve o arquivo do telefone imediatamente e
  // atualiza sua copia para a proxima abertura, sem congelar a tela.
  if(cached){
   event.waitUntil((async()=>{
    try{
     const fresh=await fetch(new Request(key,{cache:'no-cache',credentials:'same-origin'}));
     if(fresh.ok)await cache.put(key,fresh.clone());
    }catch{}
   })());
   return cached;
  }
  try{
   const fresh=await fetch(request);
   if(fresh.ok)await cache.put(key,fresh.clone());
   return fresh;
  }catch{
   if(request.mode==='navigate'){
    const backup=await cache.match('/index.html')||await cache.match('/');
    if(backup)return backup;
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
