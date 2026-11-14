#!/usr/bin/env node
// Publica apenas a identificação pública do certificado verificado do APK.
// Chaves de assinatura privadas NÃO são publicadas.
import fs from 'node:fs';
import path from 'node:path';
const input=process.argv[2]||'';
const clean=input.replaceAll(':','').trim().toUpperCase();
if(!/^[A-F0-9]{64}$/.test(clean)){
 console.error('FINA TWA: certificado SHA-256 inválido.');
 process.exit(1);
}
const cert=clean.match(/.{2}/g).join(':');
const filename=path.join('web','.well-known','assetlinks.json');
let entries=[];
if(fs.existsSync(filename)){
 try{
  entries=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!Array.isArray(entries))throw Error('DAL deve ser um array');
 }catch(e){console.error('DAL existente inválido:',e.message);process.exit(1)}
}
const packageName='app.fina.casal.debug';
const relation='delegate_permission/common.handle_all_urls';
for(const x of entries){
 if(x?.target?.namespace!=='android_app'||x?.target?.package_name!==packageName||
    !Array.isArray(x.relation)||!x.relation.includes(relation)||
    !Array.isArray(x.target.sha256_cert_fingerprints)){
  console.error('DAL existente contém entidade inesperada: revisão necessária.');
  process.exit(1);
 }
}
const existing=entries.flatMap(x=>x.target.sha256_cert_fingerprints);
if(existing.some(x=>!/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(x))){
 console.error('DAL contém SHA-256 malformado');process.exit(1);
}
const fingerprints=[...new Set([...existing,cert])];
if(fingerprints.length>100)throw Error('Mais de 100 assinaturas de depuração: configurar chave de produção estável');
const payload=[{relation:[relation],target:{namespace:'android_app',package_name:packageName,
 sha256_cert_fingerprints:fingerprints}}];
fs.mkdirSync(path.dirname(filename),{recursive:true});
fs.writeFileSync(filename,JSON.stringify(payload,null,2)+'\n');
console.log('FINA TWA: '+fingerprints.length+' certificado(s) autorizados. Último SHA-256: '+cert);
