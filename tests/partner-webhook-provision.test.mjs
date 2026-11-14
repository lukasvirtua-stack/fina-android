import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../supabase/functions/fina-safe-auto-sync/index.ts",import.meta.url),"utf8");

test("authenticated five-minute cron provisions missing partner webhooks server-side",()=>{
 assert.match(src,/let cronAuthenticated=false/);
 assert.match(src,/if\(tokenError\|\|authenticated!==true\)return json\(\{error:"forbidden"\},403\);\s*cronAuthenticated=true/);
 assert.match(src,/if\(cronAuthenticated&&items\?\.length\)/);
 assert.match(src,/finaAutoProvisionWebhook\(admin,items,sec,supabaseUrl\)/);
 assert.match(src,/for\(const item of items\)/);
 assert.match(src,/const \{clientId,clientSecret\}=await _pluggyCreds\(admin,item\.user_id,sec\)/);
});
test("does not register duplicate webhooks or leak security tokens",()=>{
 assert.match(src,/if\(existing\?\.status==="active"\)continue/);
 assert.match(src,/const cooldown=existing\?\.status==="failed"\?21600000:1800000/);
 assert.match(src,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
 assert.match(src,/token_sha256:hash/);
 assert.match(src,/\.eq\("client_id",clientId\)\.eq\("token_sha256",hash\)/);
 assert.match(src,/event:"all"/);
 assert.match(src,/headers:\{"X-FINA-PLUGGY-SECRET":secret\}/);
 assert.doesNotMatch(src,/console\.log\(.*(?:clientSecret|secret|apiKey)/);
});
test("webhook provisioning cannot force bank refresh or break existing sync",()=>{
 assert.match(src,/\/functions\/v1\/fina-pluggy-webhook/);
 assert.match(src,/return "already_registered"/);
 assert.match(src,/catch\{return await fail\("provider_request_failed"\);\}/);
 assert.match(src,/let accountsSaved=0,txSaved=0,itemsSynced=0/);
 assert.match(src,/webhookProvision,items:itemsSynced/);
 assert.doesNotMatch(src,/fetch\("https:\/\/api\.pluggy\.ai\/items\/".*method:"PATCH"/);
});
