const VERSION='fina-sw-v27-push-20261112';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.method==='GET')event.respondWith(fetch(event.request));
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
