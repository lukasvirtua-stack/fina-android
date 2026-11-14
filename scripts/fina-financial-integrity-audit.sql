-- FINA — auditoria NÃO DESTRUTIVA (contagens e agregados; sem nomes, IDs ou extratos).
-- Só para sessão técnica autorizada. Nenhuma transação/obrigação é modificada.
WITH
 tx_duplicates AS (
  SELECT user_id,external_transaction_id
  FROM public.fina_bank_transactions
  GROUP BY user_id,external_transaction_id HAVING COUNT(*)>1
 ),
 bill_duplicates AS (
  SELECT user_id,external_bill_id
  FROM public.fina_card_bills
  GROUP BY user_id,external_bill_id HAVING COUNT(*)>1
 ),
 bank_month AS (
  SELECT t.id,t.amount,t.direction,t.status,t.category,
    (t.category='transfer-self' OR LOWER(COALESCE(t.category,'')) LIKE '%same person transfer%') AS same_person,
    (t.category='transfer-spouse' OR EXISTS (
      SELECT 1 FROM public.fina_couple_transfers c
      WHERE c.sender_transaction_id=t.id OR c.receiver_transaction_id=t.id
    )) AS between_couple
  FROM public.fina_bank_transactions t
  JOIN public.fina_bank_accounts a ON a.id=t.bank_account_id
  WHERE UPPER(a.type)='BANK'
    AND (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date >=
        DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')::date
    AND (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date <=
        (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
 ),
 posted AS (SELECT * FROM bank_month WHERE status='POSTED'),
 fatura AS (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE total_amount=0) AS zero_oficiais,
    COUNT(*) FILTER (WHERE total_amount IS NULL OR total_amount<0 OR paid_amount<0
      OR paid_amount>total_amount) AS inconsistentes
  FROM public.fina_card_bills
 )
SELECT
 (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS audit_day_br,
 (SELECT COUNT(*) FROM public.fina_bank_transactions) AS tx_importadas,
 (SELECT COUNT(*) FROM tx_duplicates) AS tx_ids_duplicados,
 (SELECT COUNT(*) FROM bill_duplicates) AS fatura_ids_duplicados,
 (SELECT COUNT(*) FROM public.fina_bank_transactions
   WHERE amount IS NULL OR amount<0 OR direction NOT IN ('credit','debit')) AS tx_inconsistentes,
 (SELECT COUNT(*) FROM bank_month WHERE status='PENDING') AS bancos_pendentes_excluidos,
 (SELECT COUNT(*) FROM posted WHERE same_person) AS transferencias_proprias_excluidas,
 (SELECT COUNT(*) FROM posted WHERE between_couple) AS transferencias_casal_excluidas_do_consolidado,
 COALESCE((SELECT ROUND(SUM(amount),2) FROM posted
   WHERE direction='credit' AND NOT same_person AND NOT between_couple),0) AS entrou_casal_br,
 COALESCE((SELECT ROUND(SUM(amount),2) FROM posted
   WHERE direction='debit' AND NOT same_person AND NOT between_couple),0) AS saiu_casal_br,
 (SELECT total FROM fatura) AS faturas_importadas,
 (SELECT zero_oficiais FROM fatura) AS faturas_zero_oficial,
 (SELECT inconsistentes FROM fatura) AS faturas_inconsistentes,
 (SELECT COUNT(*) FROM public.fina_couple_transfers
   WHERE status='matched' AND (sender_transaction_id IS NULL OR receiver_transaction_id IS NULL))
     AS pares_casal_completos_com_ponta_ausente;
