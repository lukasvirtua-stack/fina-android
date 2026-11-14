import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const path=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const receiver=path('supabase/functions/fina-pluggy-webhook/index.ts');
const setup=path('supabase/functions/fina-pluggy-webhook-setup/index.ts');
const importFn=path('supabase/functions/fina-safe-auto-sync/index.ts');
const sql=path('supabase/migrations/20261114130000_fina_pluggy_webhook.sql');
const html=path('web/index.html');

test('evento nunca é aceito sem segredo, clientId e item bancário cadastrado',()=>{
 assert.match(receiver,/x-fina-pluggy-secret/);
 assert.match(receiver,/token_sha256/);
 assert.match(receiver,/\.eq\("client_id",clientId\)/);
 assert.match(receiver,/\.eq\("external_item_id",itemId\)/);
 assert.match(receiver,/\.eq\("status","active"\)/);
 assert.match(receiver,/if\(!subscription\)return json\(\{error:"unauthorized"\},401\)/);
 assert.match(receiver,/const accepted=new Set\(\["item\/updated","transactions\/created","transactions\/updated"\]\)/);
 assert.match(receiver,/EdgeRuntime\.waitUntil\(process\)/);
 assert.match(receiver,/if\(insertErr\?\.code==="23505"\)/);
 assert.doesNotMatch(receiver,/from\("fina_bank_transactions"\)/);
 assert.doesNotMatch(receiver,/from\("fina_bank_accounts"\)/);
});

test('importação por webhook só processa o Item do usuário autenticado',()=>{
 assert.match(importFn,/req\.headers\.has\("x-fina-sync-cron"\)/);
 assert.match(importFn,/fina_verify_auto_sync_cron/);
 assert.match(importFn,/x-fina-pluggy-webhook-secret/);
 assert.match(importFn,/\.eq\("token_sha256",tokenHash\)/);
 assert.match(importFn,/\.eq\("status","pending"\)\.select\("event_id"\)/);
 assert.match(importFn,/\.eq\("user_id",hook\.userId\)\.eq\("external_item_id",hook\.itemId\)/);
 assert.match(importFn,/status:complete\?"complete":"failed"/);
 assert.match(importFn,/if\(!hook\)\{/);
});

test('registro exige JWT real, gera segredo aleatório e mantém credenciais no servidor',()=>{
 assert.match(setup,/admin\.auth\.getUser\(token\)/);
 assert.match(setup,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
 assert.match(setup,/https:\/\/api\.pluggy\.ai\/webhooks/);
 assert.match(setup,/X-FINA-PLUGGY-SECRET/);
 assert.match(setup,/const hashed=await hex\(secret\)/);
 assert.match(setup,/\.eq\("user_id",uid\)\.eq\("provider","pluggy"\)/);
 assert.match(setup,/signal:AbortSignal\.timeout\(10000\)/);
 assert.doesNotMatch(setup,/return json\(\{.*clientSecret/);
});

test('eventos e tokens não são públicos nem duplicados',()=>{
 assert.match(sql,/primary key\(client_id,event_id\)/);
 assert.match(sql,/token_sha256 text not null unique/);
 assert.match(sql,/enable row level security/g);
 assert.match(sql,/revoke all on public\.fina_pluggy_webhook_events from anon,authenticated/);
 assert.match(sql,/revoke all on public\.fina_pluggy_webhook_subscriptions from anon,authenticated/);
});

test('aplicativo registra eventos em segundo plano, sem bloquear tela',()=>{
 assert.match(html,/async function finaSetupPluggyEvents\(\)/);
 assert.match(html,/fina-pluggy-webhook-setup/);
 assert.match(html,/window\.addEventListener\('fina:auth-ready'/);
 assert.match(html,/setTimeout\(\(\)=>void finaSetupPluggyEvents\(\),5000\)/);
 assert.match(html,/finaAutoRefreshTimer=setInterval\(\(\)=>void finaRefreshVisibleData\(\),60000\)/);
});
