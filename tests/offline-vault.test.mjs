import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const vaultSource=readFileSync(new URL('../web/offline-vault.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../web/service-worker.js',import.meta.url),'utf8');

function fakeDatabase(){
 const stores=new Map();
 const queue=fn=>queueMicrotask(fn);
 const req=fn=>{
  const request={result:undefined,error:null,onsuccess:null,onerror:null};
  queue(()=>{try{request.result=fn();request.onsuccess?.()}catch(e){request.error=e;request.onerror?.()}});
  return request;
 };
 const database={
  objectStoreNames:{contains:name=>stores.has(name)},
  createObjectStore:name=>stores.set(name,new Map()),
  transaction:name=>({objectStore:()=>({
   get:key=>req(()=>stores.get(name).get(key)),
   put:(val,key)=>req(()=>{stores.get(name).set(key,val);return key}),
   delete:key=>req(()=>stores.get(name).delete(key))
  })})
 };
 return {stores,indexedDB:{open:(name,version)=>{
  assert.equal(name,'fina-vault-v1');
  assert.equal(version,1);
  const request={result:database,onsuccess:null,onerror:null,onupgradeneeded:null};
  queue(()=>{request.onupgradeneeded?.();request.onsuccess?.()});
  return request;
 }}};
}
function harness(){
 const db=fakeDatabase();
 const context={window:{},indexedDB:db.indexedDB,crypto:webcrypto,TextEncoder,TextDecoder,console,
    Date,Promise,Uint8Array,JSON,queueMicrotask};
 vm.createContext(context);
 vm.runInContext(vaultSource,context,{timeout:2000});
 return {...db,context,vault:context.window.FinaOfflineVault};
}
const user='ef59b619-e385-42d7-91ad-0599e9b6ed59';
test('O histórico completo é cifrado por usuário e restaura 2.500 lançamentos',async()=>{
 const {vault,stores}=harness();
 const transactions=Array.from({length:2500},(_,i)=>({id:'real-'+i,owner:i%2?'naara':'lucas',value:100+i,month:i%12,year:2026,real:true}));
 assert.equal(await vault.save(user,'lucas',{transactions,accounts:[{owner:'lucas',balance:69000}]}),true);
 const restored=await vault.load(user,'lucas');
 assert.equal(restored.transactions.length,2500);
 assert.equal(restored.transactions[2400].value,2500);
 const stored=stores.get('records').get(user);
 assert.equal(stored.owner,'lucas');
 assert.ok(!JSON.stringify(stored).includes('real-500'),'Lançamentos devem estar criptografados');
 assert.equal(await vault.load(user,'naara'),null,'Outra sessão não pode ler histórico de Lucas');
 assert.equal(restored.userId,user);
});
test('O cofre rejeita conteúdo adulterado e permite apagar tudo no logout',async()=>{
 const {vault,stores}=harness();
 await vault.save(user,'lucas',{transactions:[{description:'TED BANCO ORIGINAL',value:211724}]});
 const record=stores.get('records').get(user);
 record.cipher[5]=(record.cipher[5]+1)%256;
 assert.equal(await vault.load(user,'lucas'),null,'AES-GCM deve rejeitar adulteração');
 await vault.clear(user);
 assert.equal(stores.get('records').has(user),false);
 assert.equal(stores.get('keys').has(user),false);
});
test('O Service Worker só guarda código público; os extratos são somente IndexedDB',()=>{
 assert.ok(sw.includes("'/offline-vault.js'"));
 assert.ok(html.includes('<script src="/offline-vault.js"></script>'));
 assert.ok(html.includes('finaRestoreEncryptedBankHistory'));
 assert.ok(html.includes('FinaOfflineVault?.save'));
 assert.ok(html.includes("FinaOfflineVault?.clear"));
 assert.ok(!sw.includes('fina_bank_transactions'),'Não interceptar APIs privadas');
});
test('A UI consulta alertas próprios e não mostra TED esperado como crédito confirmado',()=>{
 assert.ok(html.includes("from('fina_sync_alerts')"));
 assert.ok(html.includes("table:'fina_sync_alerts'"));
 assert.ok(html.includes("window.FinaSyncAlerts"));
 assert.ok(html.includes("window.FinaCashDataError"));
 assert.ok(html.includes("const finaCashCountable"));
});
