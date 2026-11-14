-- FINA: distinguir o extrato importado com sucesso de avisos de fatura
-- incompleta fornecida pela Pluggy. Sem alterar valores/lançamentos reais.
ALTER TABLE public.fina_bank_items
  ADD COLUMN IF NOT EXISTS last_bills_warning text,
  ADD COLUMN IF NOT EXISTS last_bills_invalid_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.fina_bank_items.last_bills_warning IS
  'Aviso não bloqueante de qualidade das faturas da Pluggy; não é erro no extrato de transações.';
COMMENT ON COLUMN public.fina_bank_items.last_bills_invalid_count IS
  'Quantidade de faturas descartadas por ausência de ID, vencimento ou total válido na última consulta.';
