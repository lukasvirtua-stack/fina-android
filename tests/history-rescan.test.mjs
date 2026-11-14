import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../supabase/functions/fina-safe-auto-sync/index.ts',import.meta.url),'utf8');
const ddl=readFileSync(new URL('../supabase/migrations/20261114133000_fina_history_rescan.sql',import.meta.url),'utf8');
const oneYear=readFileSync(new URL('../tests/sync-coverage.test.mjs',import.meta.url),'utf8');

test('one-year historical audit runs again after the first backfill',()=>{
 assert.match(src,/historyAuditCutoff=new Date\(Date\.now\(\)-30\*86400000\)/);
 assert.match(src,/historyRetryCutoff=new Date\(Date\.now\(\)-30\*60000\)/);
 assert.match(src,/historyStartedThisRun<3/);
 assert.match(src,/!stored\.history_audit_verified_at/);
 assert.match(src,/stored\.history_audit_verified_at<historyAuditCutoff/);
 assert.match(src,/stored\.history_audit_last_attempt_at<historyRetryCutoff/);
 assert.match(src,/const firstDate=historical\?historyFrom:dateFrom/);
 assert.match(src,/historyFrom,dateFrom,dateTo/);
 assert.doesNotMatch(src,/const historical=!historyStartedThisRun&&!stored\.history_backfilled_at/);
});

test('a complete audit checkpoint only advances on complete cursor pagination',()=>{
 assert.match(src,/if\(next\)\{fullHistoryOk=false/);
 assert.match(src,/const auditUpdate=fullHistoryOk\?/);
 assert.match(src,/history_audit_verified_at:new Date\(\)\.toISOString\(\)/);
 assert.match(src,/history_audit_last_error:itemImportErr\|\|"history_import_incomplete"/);
 assert.match(src,/history_audit_last_count:accountTransactionRows/);
 assert.match(src,/history_audit_last_attempt_at:new Date\(\)\.toISOString\(\)/);
 assert.match(src,/accountTransactionRows\+=txs\.length/);
 assert.match(src,/if\(!markError&&fullHistoryOk\)historyCompletedThisRun\+\+/);
});

test('database migration preserves transactions and initial checkpoints',()=>{
 assert.match(ddl,/ALTER TABLE public\.fina_bank_accounts/);
 assert.match(ddl,/ADD COLUMN IF NOT EXISTS history_audit_verified_at timestamptz/);
 assert.match(ddl,/ADD COLUMN IF NOT EXISTS history_audit_last_attempt_at timestamptz/);
 assert.match(ddl,/ADD COLUMN IF NOT EXISTS history_audit_last_error text/);
 assert.match(ddl,/ADD COLUMN IF NOT EXISTS history_audit_last_count integer/);
 assert.doesNotMatch(ddl,/DELETE FROM|TRUNCATE|UPDATE public\.fina_bank_transactions/);
 assert.match(oneYear,/2026-10-31/);
});

test('an audit only reads all available provider records; never forces refresh or creates synthetic deposits',()=>{
 assert.match(src,/https:\/\/api\.pluggy\.ai\/v2\/transactions/);
 assert.match(src,/upsert\(rows,\{onConflict:"user_id,external_transaction_id"\}\)/);
 assert.doesNotMatch(src,/method:"PATCH".*api\.pluggy\.ai\/items/);
 assert.doesNotMatch(src,/INSERT INTO fina_bank_transactions/);
});
