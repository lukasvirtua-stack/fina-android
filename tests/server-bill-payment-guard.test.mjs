import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261114222500_fina_guard_auto_payment_cycle.sql",import.meta.url),"utf8");

test("conciliação automática mantém todos os três caminhos originais e evita trocar função",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.fina_reconcile_manual_bills\(\)/);
 assert.match(sql,/RETURNS integer/i);
 assert.match(sql,/return total_reconciled \+ public\.fina_apply_learned_bill_rules\(\)/i);
 assert.equal((sql.match(/and extract\(month from t\.occurred_at at time zone 'America\/Sao_Paulo'\) = coalesce\(\(b->>'month'\)::int,0\)\+1/g)||[]).length,3);
});
test("todos os três caminhos exigem vencimento próximo e não aceitam transferência do casal",()=>{
 assert.equal(sql.split("coalesce(b->>'day','') ~ '^[0-9]{1,2}$'").length-1,3);
 assert.equal(sql.split("and abs(extract(day from t.occurred_at at time zone 'America/Sao_Paulo')::int-(b->>'day')::int)<=7").length-1,3);
 assert.equal(sql.split("and lower(coalesce(t.category,'')) not in ('transfer-self','transfer-spouse')").length-1,3);
 assert.equal((sql.match(/upper\(coalesce\(t\.status,''\)\)='POSTED'/g)||[]).length,3);
 assert.equal((sql.match(/t\.direction='debit'/g)||[]).length,3);
 assert.equal((sql.match(/not exists \(\s*select 1 from public\.fina_couple_transfers/g)||[]).length,3);
});
test("não altera valores existentes e não solicita atualização bancária à Pluggy",()=>{
 assert.doesNotMatch(sql,/\b(?:DROP TABLE|TRUNCATE TABLE|UPDATE public\.fina_bank_transactions|DELETE FROM public\.fina_card_bills|INSERT INTO public\.fina_bank_transactions)\b/i);
 assert.doesNotMatch(sql,/api\.pluggy\.ai|items\/|X-API-KEY/);
});
