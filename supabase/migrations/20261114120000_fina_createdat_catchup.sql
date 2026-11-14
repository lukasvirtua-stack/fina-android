-- Catch-up by provider ingestion timestamp, independent of bank posting date.
-- Existing transaction IDs stay unique; no balance or amount is created here.
alter table public.fina_bank_accounts
  add column if not exists created_at_catchup_checked_at timestamptz,
  add column if not exists created_at_catchup_count integer,
  add column if not exists created_at_catchup_error text;
comment on column public.fina_bank_accounts.created_at_catchup_count is
  'Records returned by the Pluggy GET /v2/transactions createdAtFrom query; count does not mean new transactions.';
