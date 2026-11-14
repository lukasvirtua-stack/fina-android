-- FINA: somente AUTO-conciliar comprovantes no mesmo ciclo e próximos do vencimento.
-- A RPC de confirmação manual já exige +-7 dias e recusa transferências do casal.
-- Bloqueia falsos positivos no servidor sem tocar em lançamentos existentes.
-- Função obtida do schema de produção e alterada apenas em três filtros de candidatos.
CREATE OR REPLACE FUNCTION public.fina_reconcile_manual_bills()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  s record;
  bills jsonb;
  b jsonb;
  new_bills jsonb := '[]'::jsonb;
  target_cents bigint;
  cand record;
  exact_ids uuid[];
  sim_ids uuid[];
  sim_amounts bigint[];
  sim_desc text[];
  sim_dates timestamptz[];
  sim_banks text[];
  i int;
  mask int;
  maxmask int;
  sum_cents bigint;
  match_count int;
  chosen_mask int;
  chosen_ids text[];
  chosen_parts jsonb;
  last_date timestamptz;
  changed boolean;
  total_reconciled int := 0;
  bill_name text;
  used_text text;
  self_owner_key text;
  target_user_id uuid;
  approx_ids uuid[];
begin
  for s in
    select us.user_id, us.state,
           coalesce(
             (
               select case when m.role='owner' then 'lucas' else 'naara' end
               from public.fina_couple_members m
               where m.user_id=us.user_id
               limit 1
             ),
             'lucas'
           ) as owner_key
    from public.fina_user_state us
  loop
    self_owner_key := s.owner_key;
    bills := coalesce(s.state->'manualBills','[]'::jsonb);
    new_bills := '[]'::jsonb;
    changed := false;
    select coalesce(string_agg(state::text,' '),'') into used_text from public.fina_user_state;

    for b in select * from jsonb_array_elements(bills)
    loop
      if coalesce(b->>'type','') <> 'manual'
         or coalesce(b->>'state','') not in ('open','reserved','reported')
      then
        new_bills := new_bills || jsonb_build_array(b);
        continue;
      end if;

      target_cents := coalesce((b->>'value')::bigint,0);
      bill_name := coalesce(b->>'name','');
      if target_cents <= 0 then
        new_bills := new_bills || jsonb_build_array(b);
        continue;
      end if;
      -- Resolve o titular real da conta mesmo quando o parceiro a cadastrou.
      target_user_id := null;
      if coalesce(b->>'owner','') = self_owner_key then
        target_user_id := s.user_id;
      elsif coalesce(b->>'owner','') in ('lucas','naara') then
        select them.user_id into target_user_id
        from public.fina_couple_members me
        join public.fina_couple_members them on them.couple_id=me.couple_id
        where me.user_id=s.user_id and them.role=case when b->>'owner'='lucas' then 'owner' else 'member' end
        limit 1;
      end if;
      if target_user_id is null then
        new_bills := new_bills || jsonb_build_array(b);
        continue;
      end if;

      exact_ids := array[]::uuid[];
      for cand in
        select t.id
        from public.fina_bank_transactions t
        where t.user_id=target_user_id
          and t.direction='debit'
          and lower(coalesce(t.category,'')) not like '%same person transfer%'
          and not exists (
            select 1 from public.fina_couple_transfers ct
            where ct.sender_transaction_id=t.id
               or ct.receiver_transaction_id=t.id
          )
          and exists (select 1 from public.fina_bank_accounts a_cash where a_cash.id=t.bank_account_id and a_cash.type='BANK')
          and upper(coalesce(t.status,''))='POSTED'
          and round(t.amount*100)::bigint=target_cents
          and extract(year from t.occurred_at at time zone 'America/Sao_Paulo') = coalesce((b->>'year')::int,2026)
          and extract(month from t.occurred_at at time zone 'America/Sao_Paulo') = coalesce((b->>'month')::int,0)+1
          and coalesce(b->>'day','') ~ '^[0-9]{1,2}$'
          and abs(extract(day from t.occurred_at at time zone 'America/Sao_Paulo')::int-(b->>'day')::int)<=7
          and lower(coalesce(t.category,'')) not in ('transfer-self','transfer-spouse')

          and position(t.id::text in used_text)=0
          and public.fina_bill_merchant_match(bill_name,t.description)
      loop
        exact_ids := array_append(exact_ids,cand.id);
      end loop;

      if coalesce(array_length(exact_ids,1),0)=1 then
        select jsonb_build_object(
          'id','real-'||t.id::text,
          'date',to_char(t.occurred_at at time zone 'America/Sao_Paulo','DD/MM/YYYY'),
          'bank',case when target_user_id=s.user_id then coalesce(a.institution_name,a.name,'Banco') else 'Banco do parceiro' end,
          'description',case when target_user_id=s.user_id then coalesce(t.description,'Movimentação') else 'Pagamento confirmado' end,
          'value',round(t.amount*100)::bigint
        ), t.occurred_at
        into chosen_parts,last_date
        from public.fina_bank_transactions t
        left join public.fina_bank_accounts a on a.id=t.bank_account_id
        where t.id=exact_ids[1];

        b := b || jsonb_build_object(
          'state','posted',
          'paidDate',to_char(last_date at time zone 'America/Sao_Paulo','DD/MM/YYYY'),
          'paidTransactionId','real-'||exact_ids[1]::text,
          'paidTransactionIds',jsonb_build_array('real-'||exact_ids[1]::text),
          'paymentParts',jsonb_build_array(chosen_parts),
          'detail','Pago no banco em '||to_char(last_date at time zone 'America/Sao_Paulo','DD/MM/YYYY')||
                   ' · '||(chosen_parts->>'bank')||' · '||(chosen_parts->>'description')||
                   ' · R$ '||replace(to_char(target_cents/100.0,'FM999999990D00'),'.',','),
          'reconciliationCandidates',1,
          'bankAlreadyReflectedInBalance',true,
          'historicalBankPayment',(last_date < coalesce((select joined_at from public.fina_couple_members where user_id=target_user_id limit 1),now())),
          'bankPaidValueCents',target_cents
        );
        used_text := used_text || ' ' || exact_ids[1]::text;
        total_reconciled := total_reconciled+1;
        changed := true;
        new_bills := new_bills || jsonb_build_array(b);
        continue;
      end if;



      -- Pagamentos com identificação ambígua exigem confirmação no aplicativo;
      -- a FINA só reutiliza regras que o casal ensinou explicitamente.

      -- O valor informado é estimado: aceitar diferença pequena apenas
      -- se houver um único débito POSTED com identificação forte do credor.
      approx_ids := array[]::uuid[];
      select coalesce(array_agg(t.id order by t.occurred_at,t.id),array[]::uuid[])
        into approx_ids
      from public.fina_bank_transactions t
      where t.user_id=target_user_id
        and t.direction='debit'
          and lower(coalesce(t.category,'')) not like '%same person transfer%'
          and not exists (
            select 1 from public.fina_couple_transfers ct
            where ct.sender_transaction_id=t.id
               or ct.receiver_transaction_id=t.id
          )
        and exists (select 1 from public.fina_bank_accounts ba
                    where ba.id=t.bank_account_id and ba.type='BANK')
        and upper(coalesce(t.status,''))='POSTED'
        and t.amount>0
        and extract(year from t.occurred_at at time zone 'America/Sao_Paulo') = coalesce((b->>'year')::int,2026)
        and extract(month from t.occurred_at at time zone 'America/Sao_Paulo') = coalesce((b->>'month')::int,0)+1
          and coalesce(b->>'day','') ~ '^[0-9]{1,2}$'
          and abs(extract(day from t.occurred_at at time zone 'America/Sao_Paulo')::int-(b->>'day')::int)<=7
          and lower(coalesce(t.category,'')) not in ('transfer-self','transfer-spouse')

        and position(t.id::text in used_text)=0
        and abs(round(t.amount*100)::bigint-target_cents) <=
            least(3000::numeric,greatest(500::numeric,target_cents*0.05))
        and public.fina_bill_merchant_match(bill_name,t.description);

      if coalesce(array_length(approx_ids,1),0)=1 then
        select jsonb_build_object(
          'id','real-'||t.id::text,
          'date',to_char(t.occurred_at at time zone 'America/Sao_Paulo','DD/MM/YYYY'),
          'bank',case when target_user_id=s.user_id then coalesce(a.institution_name,a.name,'Banco') else 'Banco do parceiro' end,
          'description',case when target_user_id=s.user_id then coalesce(t.description,'Movimentação') else 'Pagamento confirmado' end,
          'value',round(t.amount*100)::bigint
        ),t.occurred_at into chosen_parts,last_date
        from public.fina_bank_transactions t
        left join public.fina_bank_accounts a on a.id=t.bank_account_id
        where t.id=approx_ids[1];

        b := b || jsonb_build_object(
          'state','posted',
          'paidDate',to_char(last_date at time zone 'America/Sao_Paulo','DD/MM/YYYY'),
          'paidTransactionId','real-'||approx_ids[1]::text,
          'paidTransactionIds',jsonb_build_array('real-'||approx_ids[1]::text),
          'paymentParts',jsonb_build_array(chosen_parts),
          'detail','Pagamento confirmado no banco em '||
              to_char(last_date at time zone 'America/Sao_Paulo','DD/MM/YYYY')||
              ' · Valor efetivo R$ '||
              replace(to_char(((chosen_parts->>'value')::bigint)/100.0,'FM999999990D00'),'.',',')||
              ' (valor informado era estimado; sem novo desconto do saldo)',
          'reconciliationCandidates',1,
          'bankAlreadyReflectedInBalance',true,
          'historicalBankPayment',(last_date < coalesce((select joined_at from public.fina_couple_members where user_id=target_user_id limit 1),now())),
          'bankPaidValueCents',(chosen_parts->>'value')::bigint
        );
        used_text := used_text || ' ' || approx_ids[1]::text;
        total_reconciled:=total_reconciled+1;
        changed:=true;
        new_bills:=new_bills||jsonb_build_array(b);
        continue;
      end if;

      sim_ids := array[]::uuid[];
      sim_amounts := array[]::bigint[];
      sim_desc := array[]::text[];
      sim_dates := array[]::timestamptz[];
      sim_banks := array[]::text[];

      for cand in
        select t.id,t.amount,t.description,t.occurred_at,
               coalesce(a.institution_name,a.name,'Banco') as bank
        from public.fina_bank_transactions t
        left join public.fina_bank_accounts a on a.id=t.bank_account_id
        where t.user_id=target_user_id
          and t.direction='debit'
          and lower(coalesce(t.category,'')) not like '%same person transfer%'
          and not exists (
            select 1 from public.fina_couple_transfers ct
            where ct.sender_transaction_id=t.id
               or ct.receiver_transaction_id=t.id
          )
          and exists (select 1 from public.fina_bank_accounts a_cash where a_cash.id=t.bank_account_id and a_cash.type='BANK')
          and upper(coalesce(t.status,''))='POSTED'
          and round(t.amount*100)::bigint > 0
          and round(t.amount*100)::bigint <= target_cents
          and extract(year from t.occurred_at at time zone 'America/Sao_Paulo') = coalesce((b->>'year')::int,2026)
          and extract(month from t.occurred_at at time zone 'America/Sao_Paulo') = coalesce((b->>'month')::int,0)+1
          and coalesce(b->>'day','') ~ '^[0-9]{1,2}$'
          and abs(extract(day from t.occurred_at at time zone 'America/Sao_Paulo')::int-(b->>'day')::int)<=7
          and lower(coalesce(t.category,'')) not in ('transfer-self','transfer-spouse')

          and position(t.id::text in used_text)=0
          and public.fina_bill_merchant_match(bill_name,t.description)
        order by t.occurred_at asc,t.id
        limit 12
      loop
        sim_ids := array_append(sim_ids,cand.id);
        sim_amounts := array_append(sim_amounts,round(cand.amount*100)::bigint);
        sim_desc := array_append(sim_desc,case when target_user_id=s.user_id then coalesce(cand.description,'Movimentação') else 'Pagamento confirmado' end);
        sim_dates := array_append(sim_dates,cand.occurred_at);
        sim_banks := array_append(sim_banks,case when target_user_id=s.user_id then cand.bank else 'Banco do parceiro' end);
      end loop;

      if coalesce(array_length(sim_ids,1),0) >= 2 then
        maxmask := (1 << array_length(sim_ids,1)) - 1;
        match_count := 0;
        chosen_mask := 0;

        for mask in 1..maxmask loop
          sum_cents := 0;
          for i in 1..array_length(sim_ids,1) loop
            if (mask & (1 << (i-1))) <> 0 then
              sum_cents := sum_cents + sim_amounts[i];
            end if;
          end loop;
          if sum_cents = target_cents then
            match_count := match_count + 1;
            chosen_mask := mask;
            exit when match_count > 1;
          end if;
        end loop;

        -- Lançamentos iguais do mesmo credor podem representar parcelas de
        -- um pagamento único; escolhe deterministicamente a quantidade paga.
        if match_count>1 and sim_amounts[1]>0
           and target_cents % sim_amounts[1]=0
           and (select bool_and(x=sim_amounts[1]) from unnest(sim_amounts) x)
           and target_cents/sim_amounts[1] <= array_length(sim_ids,1)
        then
          chosen_mask := (1 << (target_cents/sim_amounts[1])::int) - 1;
          match_count := 1;
        end if;

        if match_count=1 then
          chosen_ids := array[]::text[];
          chosen_parts := '[]'::jsonb;
          last_date := null;
          for i in 1..array_length(sim_ids,1) loop
            if (chosen_mask & (1 << (i-1))) <> 0 then
              chosen_ids := array_append(chosen_ids,'real-'||sim_ids[i]::text);
              chosen_parts := chosen_parts || jsonb_build_array(
                jsonb_build_object(
                  'id','real-'||sim_ids[i]::text,
                  'date',to_char(sim_dates[i] at time zone 'America/Sao_Paulo','DD/MM/YYYY'),
                  'bank',sim_banks[i],
                  'description',sim_desc[i],
                  'value',sim_amounts[i]
                )
              );
              if last_date is null or sim_dates[i] > last_date then last_date := sim_dates[i]; end if;
              used_text := used_text || ' ' || sim_ids[i]::text;
            end if;
          end loop;

          b := b || jsonb_build_object(
            'state','posted',
            'paidDate',to_char(last_date at time zone 'America/Sao_Paulo','DD/MM/YYYY'),
            'paidTransactionId',chosen_ids[1],
            'paidTransactionIds',to_jsonb(chosen_ids),
            'paymentParts',chosen_parts,
            'detail','Pago em '||array_length(chosen_ids,1)||' lançamentos do banco que somam R$ '||
                     replace(to_char(target_cents/100.0,'FM999999990D00'),'.',','),
            'reconciliationCandidates',array_length(chosen_ids,1),
            'bankAlreadyReflectedInBalance',true,
            'historicalBankPayment',(last_date < coalesce((select joined_at from public.fina_couple_members where user_id=target_user_id limit 1),now())),
            'bankPaidValueCents',target_cents
          );
          total_reconciled := total_reconciled+1;
          changed := true;
        else
          b := b || jsonb_build_object(
            'reconciliationCandidates',coalesce(array_length(sim_ids,1),0),
            'detail',case
              when coalesce(array_length(sim_ids,1),0)>0
              then 'A FINA encontrou lançamentos com nome parecido, mas a soma ainda não fecha de forma única o valor informado.'
              else coalesce(b->>'detail','Cadastro no app')
            end
          );
        end if;
      end if;

      new_bills := new_bills || jsonb_build_array(b);
    end loop;

    if changed then
      update public.fina_user_state
      set state=jsonb_set(state,'{manualBills}',new_bills,true),
          updated_at=now()
      where user_id=s.user_id;
    end if;
  end loop;

  return total_reconciled + public.fina_apply_learned_bill_rules();
end;
$function$

