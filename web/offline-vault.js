// Cache financeiro privado: IndexedDB por Google ID, AES-GCM por aparelho.
// O Service Worker NUNCA armazena estas informacoes.
(()=>{
'use strict';
const NAME='fina-vault-v1',MAX_AGE=30*86400000;
const encoder=new TextEncoder(),decoder=new TextDecoder();
function canUse(){return typeof indexedDB!=='undefined'&&!!globalThis.crypto?.subtle}
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('IDB request failed'));})}
let opening;
function database(){
 if(!canUse())return Promise.reject(Error('Private vault unavailable'));
 if(!opening)opening=new Promise((resolve,reject)=>{
  const r=indexedDB.open(NAME,1);
  r.onupgradeneeded=()=>{
   if(!r.result.objectStoreNames.contains('records'))r.result.createObjectStore('records');
   if(!r.result.objectStoreNames.contains('keys'))r.result.createObjectStore('keys');
  };
  r.onsuccess=()=>resolve(r.result);
  r.onerror=()=>reject(r.error);
 }).catch(e=>{opening=null;throw e});
 return opening;
}
async function read(store,id){const db=await database();return request(db.transaction(store,'readonly').objectStore(store).get(id))}
async function write(store,id,value){const db=await database();return request(db.transaction(store,'readwrite').objectStore(store).put(value,id))}
async function remove(store,id){const db=await database();return request(db.transaction(store,'readwrite').objectStore(store).delete(id))}
async function cryptoKey(id){
 let key=await read('keys',id);
 if(key)return key;
 key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 await write('keys',id,key);
 return key;
}
const validId=id=>typeof id==='string'&&id.length>7&&id.length<150;
const validOwner=o=>o==='lucas'||o==='naara';
async function save(id,owner,data,type='bank'){
 if(!validId(id)||!validOwner(owner)||!canUse()||!data)return false;
 try{
  const key=await cryptoKey(id),iv=crypto.getRandomValues(new Uint8Array(12));
  const body=JSON.stringify({schema:1,id,owner,type,savedAt:Date.now(),data});
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id+'|'+owner+(type==='state'?'|state':''))},key,encoder.encode(body));
  await write('records',type==='state'?'state:'+id:id,{owner,iv:Array.from(iv),cipher:Array.from(new Uint8Array(cipher)),savedAt:Date.now()});
  return true;
 }catch(e){console.warn('FINA: cache offline indisponivel:',e?.name||'error');return false}
}
async function load(id,owner,type='bank'){
 if(!validId(id)||!validOwner(owner)||!canUse())return null;
 try{
  const record=await read('records',type==='state'?'state:'+id:id);
  if(!record||record.owner!==owner||Date.now()-record.savedAt>MAX_AGE)return null;
  const key=await read('keys',id);
  if(!key)return null;
  const plain=await crypto.subtle.decrypt({
   name:'AES-GCM',iv:new Uint8Array(record.iv),additionalData:encoder.encode(id+'|'+owner+(type==='state'?'|state':''))
  },key,new Uint8Array(record.cipher));
  const object=JSON.parse(decoder.decode(plain));
  if(object.schema!==1||object.id!==id||object.owner!==owner||((object.type||'bank')!==type))return null;
  return type==='state'?object.data:{...object.data,userId:id,ownerKey:owner,savedAt:object.savedAt};
 }catch{return null}
}
async function clear(id){
 if(!validId(id)||!canUse())return;
 try{await Promise.all([remove('records',id),remove('records','state:'+id),remove('keys',id)])}catch{}
}
// Contas manuais e recebimentos de outra pessoa nunca são salvos offline.
function sanitizeState(state,owner){
 if(!state||typeof state!=='object')return null;
 return {
  schemaVersion:2,
  preferences:state.preferences&&typeof state.preferences==='object'?state.preferences:{},
  profile:state.profile&&typeof state.profile==='object'?state.profile:{},
  weddingDate:typeof state.weddingDate==='string'?state.weddingDate:'',
  manualBills:Array.isArray(state.manualBills)?state.manualBills.filter(b=>b?.owner===owner).slice(0,1000):[],
  future:Array.isArray(state.future)?state.future.filter(b=>b?.owner===owner).slice(0,1000):[]
 };
}
async function saveState(id,owner,state){const safe=sanitizeState(state,owner);return safe?save(id,owner,safe,'state'):false}
async function loadState(id,owner){return load(id,owner,'state')}
window.FinaOfflineVault={save,load,saveState,loadState,clear,available:canUse};
})();