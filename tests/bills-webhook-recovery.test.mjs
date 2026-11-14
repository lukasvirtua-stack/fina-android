import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sync=readFileSync(new URL("../supabase/functions/fina-safe-auto-sync/index.ts",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20261114172000_fina_bills_webhook_recovery.sql",import.meta.url),"utf8");
const bills=sync.slice(sync.indexOf("async function finaImportOfficialBills"),sync.indexOf("const finaRollingStart"));
test("salva faturas válidas e não confunde payload incompleto com extrato bancário perdido",()=>{
 assert.match(bills,/const validBills=bills\.filter/);
 assert.match(bills,/amount!==null&&amount!==undefined&&amount!==""/);
 assert.match(bills,/Number\.isFinite\(Number\(amount\)\)&&Number\(amount\)>=0/);
 assert.match(bills,/rows=validBills\.map/);
 assert.match(bills,/if\(rows\.length\)/);
 assert.match(bills,/invalidBills>0\?\{saved,warning:"bills_record_incomplete",invalidCount:invalidBills\}/);
 assert.doesNotMatch(bills,/invalidBills>0\?\{saved,error:/);
});
test("aviso de fatura não gera erro nem falha de conta, mantendo erros de rede e salvamento",()=>{
 assert.match(sync,/if\(billResult\.warning\)\{itemBillsWarning=billResult\.warning;/);
 assert.match(sync,/if\(billResult\.error\)\{itemImportOk=false;/);
 assert.match(sync,/last_bills_warning:itemBillsWarning/);
 assert.match(sync,/last_bills_invalid_count:itemBillsInvalidCount/);
 assert.match(bills,/bills_unavailable_/);
 assert.match(bills,/bills_save_failed/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS last_bills_warning text/);
 assert.match(migration,/last_bills_invalid_count integer NOT NULL DEFAULT 0/);
});
test("cron recupera webhooks falhos apenas depois da importação de extratos",()=>{
 assert.match(sync,/if\(!hook&&itemImportOk\)/);
 assert.match(sync,/\.eq\("item_id",String\(item\.external_item_id\)\)\.eq\("user_id",item\.user_id\)/);
 assert.match(sync,/\.eq\("status","failed"\)\s*\.in\("error_code",\["bank_import_incomplete","cron_import_incomplete"\]\)/);
 assert.match(sync,/\.eq\("status","processing"\)\s*\.lt\("created_at",new Date\(Date\.now\(\)-600000\)/);
 assert.match(sync,/if\(hook\)\{\s*const complete=itemsImported===1/);
 assert.doesNotMatch(sync,/fetch\("https:\/\/api\.pluggy\.ai\/items\/".*method:"PATCH"/);
});
