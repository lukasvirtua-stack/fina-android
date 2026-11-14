-- Audit trail for one-year history replay. No legacy data is removed.
-- All existing products start with history_audit_verified_at NULL to request a
-- one-time verification on upcoming 5-minute sync cycles.
ALTER TABLE public.fina_bank_accounts
  ADD COLUMN IF NOT EXISTS history_audit_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS history_audit_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS history_audit_last_error text,
  ADD COLUMN IF NOT EXISTS history_audit_last_count integer;
COMMENT ON COLUMN public.fina_bank_accounts.history_audit_verified_at IS
  'Last successful complete 12-month GET /v2/transactions pagination. Does not guarantee the provider has released all bank movements.';
COMMENT ON COLUMN public.fina_bank_accounts.history_audit_last_count IS
  'Number of provider records returned during the most recent successful full historical audit; not number of new transactions.';
