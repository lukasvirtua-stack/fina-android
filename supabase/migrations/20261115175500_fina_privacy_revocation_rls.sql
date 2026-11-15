-- FINA | Financial sharing and revocation hardening (non-destructive)
-- Rules: owner always reads own bank data; partner only with mutual planning
-- consent, active two-member pair and no explicit historical sharing revocation.
-- Does not expand access to pre-relationship transaction history.
create or replace function private.fina_financial_sharing_allowed(target_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
 select (select auth.uid()) is not null and (
   target_user = (select auth.uid())
   or exists(
    select 1
    from public.fina_couple_members me
    join public.fina_couple_members partner on partner.couple_id=me.couple_id
    where me.user_id=(select auth.uid())
      and partner.user_id=target_user
      and me.sharing_level in ('planning','partial','total')
      and partner.sharing_level in ('planning','partial','total')
      and (select count(*) from public.fina_couple_members members
           where members.couple_id=me.couple_id)=2
      and not exists(
        select 1 from public.fina_history_sharing deny
        where deny.couple_id=me.couple_id and deny.revoked_at is not null
          and ((deny.user_id=me.user_id and deny.member_joined_at=me.joined_at)
            or (deny.user_id=partner.user_id and deny.member_joined_at=partner.joined_at))
      )
   )
 );
$function$;
revoke all on function private.fina_financial_sharing_allowed(uuid)
 from public,anon,authenticated;

create or replace function private.fina_can_read_couple_balance(target_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
 select private.fina_financial_sharing_allowed(target_user);
$function$;

create or replace function private.fina_can_read_couple_transaction(
 target_user uuid, tx_at timestamp with time zone
) returns boolean language sql stable security definer set search_path = ''
as $function$
 select (select auth.uid()) is not null and (
  target_user=(select auth.uid())
  or (
   private.fina_financial_sharing_allowed(target_user)
   and exists(select 1 from public.fina_bank_items i
      where i.user_id=(select auth.uid()) and i.last_sync_at is not null)
   and exists(select 1 from public.fina_bank_items i
      where i.user_id=target_user and i.last_sync_at is not null)
  )
 );
$function$;

drop policy if exists fina_financings_select_couple on public.fina_financings;
create policy fina_financings_select_couple on public.fina_financings
for select to authenticated
using (private.fina_can_read_couple_balance(owner_user_id));

drop policy if exists fina_financing_installments_select_couple
 on public.fina_financing_installments;
create policy fina_financing_installments_select_couple
 on public.fina_financing_installments
for select to authenticated
using (
 exists(
  select 1 from public.fina_financings fin
  where fin.id=fina_financing_installments.financing_id
    and private.fina_can_read_couple_balance(fin.owner_user_id)
 )
);
-- Hardened: fina_change_shared_manual_bill
CREATE OR REPLACE FUNCTION public.fina_change_shared_manual_bill(p_owner_id uuid, p_bill_id text, p_operation text, p_edit_name text DEFAULT NULL::text, p_edit_value bigint DEFAULT NULL::bigint, p_edit_day integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=auth.uid();
 cid uuid;
 original jsonb;
 updated jsonb;
 current_state jsonb;
 new_bills jsonb;
 current_status text;
 operation text:=lower(trim(coalesce(p_operation,'')));
 matches integer;
begin
 if actor is null then raise exception 'Autenticação necessária' using errcode='28000';end if;
 if p_owner_id is null or p_owner_id=actor or p_bill_id is null
    or length(p_bill_id)>90 or p_bill_id !~ '^[0-9]+$'
    or operation not in ('reserve','unreserve','report','unreport','edit','delete')
 then raise exception 'Operação inválida' using errcode='22023'; end if;
 select mine.couple_id into cid
 from public.fina_couple_members mine
 join public.fina_couple_members other
   on other.couple_id=mine.couple_id and other.user_id=p_owner_id
 where mine.user_id=actor
   and private.fina_financial_sharing_allowed(p_owner_id)
   and mine.sharing_level in ('planning','partial','total')
   and other.sharing_level in ('planning','partial','total')
   and (select count(*) from public.fina_couple_members c where c.couple_id=mine.couple_id)=2
 limit 1;
 if cid is null then raise exception 'Sem acesso à conta compartilhada' using errcode='42501';end if;
 select st.state into current_state from public.fina_user_state st
 where st.user_id=p_owner_id for update;
 if current_state is null or jsonb_typeof(current_state->'manualBills') is distinct from 'array'
 then raise exception 'Contas manuais não encontradas' using errcode='P0002';end if;
 select count(*),(array_agg(x.bill))[1] into matches,original
 from jsonb_array_elements(current_state->'manualBills') x(bill)
 where x.bill->>'id'=p_bill_id
   and x.bill->>'type'='manual';
 if matches<>1 then raise exception 'Conta manual não encontrada ou duplicada' using errcode='P0002';end if;
 current_status:=original->>'state';
 if current_status not in ('open','reserved','reported') then
   raise exception 'Conta já confirmada ou removida' using errcode='22023';
 end if;
 updated:=original;
 if operation='reserve' and current_status='open' then
   updated:=jsonb_set(updated,'{state}','"reserved"'::jsonb);
 elsif operation='unreserve' and current_status='reserved' then
   updated:=jsonb_set(updated,'{state}','"open"'::jsonb);
 elsif operation='report' and current_status in ('open','reserved') then
   updated:=jsonb_set(updated,'{state}','"reported"'::jsonb);
 elsif operation='unreport' and current_status='reported' then
   updated:=jsonb_set(updated,'{state}','"open"'::jsonb);
 elsif operation='edit' then
   if p_edit_name is null or length(trim(p_edit_name))<2 or length(trim(p_edit_name))>100
     or p_edit_value is null or p_edit_value<=0 or p_edit_value>1000000000000
     or p_edit_day is null or p_edit_day not between 1 and 31
   then raise exception 'Descrição, valor ou vencimento inválido' using errcode='22023';end if;
   updated:=jsonb_set(jsonb_set(jsonb_set(updated,'{name}',to_jsonb(trim(p_edit_name))),'{value}',to_jsonb(p_edit_value)),'{day}',to_jsonb(p_edit_day));
 elsif operation='delete' then
   updated:=jsonb_set(jsonb_set(updated,'{state}','"removed"'::jsonb),'{recurring}','false'::jsonb);
 else
   raise exception 'A conta foi atualizada; recarregue antes de alterar' using errcode='40001';
 end if;
 select jsonb_agg(case when x.bill->>'id'=p_bill_id and x.bill->>'type'='manual' then updated else x.bill end order by x.ord)
 into new_bills
 from jsonb_array_elements(current_state->'manualBills') with ordinality x(bill,ord);
 update public.fina_user_state
 set state=jsonb_set(current_state,'{manualBills}',new_bills,true),updated_at=now()
 where user_id=p_owner_id;
 insert into public.fina_manual_bill_change_audit(couple_id,actor_user_id,bill_user_id,bill_id,operation,old_value,new_value)
 values(cid,actor,p_owner_id,p_bill_id,operation,original,updated);
 return jsonb_build_object('ok',true,'billId',p_bill_id,'state',updated->>'state');
end;
$function$

-- Hardened: fina_couple_card_bills
CREATE OR REPLACE FUNCTION public.fina_couple_card_bills()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,
    'user_id',b.user_id,
    'bank_account_id',b.bank_account_id,
    'external_bill_id',b.external_bill_id,
    'due_date',b.due_date,
    'closing_date',b.closing_date,
    'total_amount',b.total_amount,
    'paid_amount',b.paid_amount,
    'currency_code',b.currency_code,
    'synced_at',b.synced_at
 ) order by b.due_date,b.bank_account_id), '[]'::jsonb)
 from public.fina_card_bills b
 where b.user_id=auth.uid()
 or exists (
   select 1 from public.fina_couple_members mine
   join public.fina_couple_members partner on partner.couple_id=mine.couple_id
   where mine.user_id=auth.uid()
     and partner.user_id=b.user_id
      and private.fina_financial_sharing_allowed(partner.user_id)
     and mine.sharing_level in ('planning','partial','total')
     and partner.sharing_level in ('planning','partial','total')
 );
$function$

-- Hardened: fina_delete_shared_future_income
CREATE OR REPLACE FUNCTION public.fina_delete_shared_future_income(p_owner_id uuid, p_future_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=(select auth.uid());
 cid uuid;
 current_state jsonb;
 next_future jsonb;
 matches integer;
begin
 if actor is null then
   raise exception 'Autenticacao necessaria' using errcode='28000';
 end if;
 if p_owner_id is null or p_owner_id=actor
   or p_future_id is null or p_future_id !~ '^[0-9]{1,25}$' then
   raise exception 'Identificador invalido' using errcode='22023';
 end if;
 select mine.couple_id into cid
 from public.fina_couple_members mine
 join public.fina_couple_members other
  on other.couple_id=mine.couple_id and other.user_id=p_owner_id
 where mine.user_id=actor
   and private.fina_financial_sharing_allowed(p_owner_id)
   and mine.sharing_level in ('planning','partial','total')
   and other.sharing_level in ('planning','partial','total')
   and (select count(*) from public.fina_couple_members m
        where m.couple_id=mine.couple_id)=2
 limit 1;
 if cid is null then
   raise exception 'Sem acesso ao planejamento compartilhado' using errcode='42501';
 end if;
 select st.state into current_state
 from public.fina_user_state st where st.user_id=p_owner_id for update;
 if current_state is null or jsonb_typeof(current_state->'future') is distinct from 'array' then
   raise exception 'Previsoes nao encontradas' using errcode='P0002';
 end if;
 select count(*) into matches from jsonb_array_elements(current_state->'future') f(item)
 where f.item->>'id'=p_future_id;
 if matches<>1 then
   raise exception 'Previsao alterada ou nao encontrada; atualize a tela' using errcode='P0002';
 end if;
 select coalesce(jsonb_agg(f.item order by f.ordinality),'[]'::jsonb)
 into next_future
 from jsonb_array_elements(current_state->'future') with ordinality f(item,ordinality)
 where f.item->>'id' is distinct from p_future_id;
 update public.fina_user_state
 set state=jsonb_set(current_state,'{future}',next_future,true),updated_at=now()
 where user_id=p_owner_id;
 return jsonb_build_object('ok',true,'id',p_future_id,'ownerId',p_owner_id);
end;
$function$

-- Hardened: fina_delete_shared_refund
CREATE OR REPLACE FUNCTION public.fina_delete_shared_refund(p_owner_id uuid, p_refund_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=(select auth.uid());
 cid uuid;
 current_state jsonb;
 next_refunds jsonb;
 matches int;
begin
 if actor is null then raise exception 'Autenticacao necessaria' using errcode='28000';end if;
 if p_owner_id is null or p_owner_id=actor or p_refund_id is null or p_refund_id !~ '^[0-9]{1,25}$'
 then raise exception 'Identificador invalido' using errcode='22023';end if;
 select mine.couple_id into cid
 from public.fina_couple_members mine
 join public.fina_couple_members them
  on them.couple_id=mine.couple_id and them.user_id=p_owner_id
 where mine.user_id=actor
   and private.fina_financial_sharing_allowed(p_owner_id)
  and mine.sharing_level in ('planning','partial','total')
  and them.sharing_level in ('planning','partial','total')
  and (select count(*) from public.fina_couple_members c where c.couple_id=mine.couple_id)=2
 limit 1;
 if cid is null then raise exception 'Sem autorizacao de compartilhamento' using errcode='42501';end if;
 select st.state into current_state
 from public.fina_user_state st where st.user_id=p_owner_id for update;
 if current_state is null or jsonb_typeof(current_state->'refunds') is distinct from 'array'
 then raise exception 'Estornos nao encontrados' using errcode='P0002';end if;
 select count(*) into matches from jsonb_array_elements(current_state->'refunds') r(item)
 where r.item->>'id'=p_refund_id and r.item->>'state'='pending';
 if matches<>1 then raise exception 'Estorno alterado ou inexistente' using errcode='P0002';end if;
 select coalesce(jsonb_agg(r.item order by r.ordinality),'[]'::jsonb) into next_refunds
 from jsonb_array_elements(current_state->'refunds') with ordinality r(item,ordinality)
 where r.item->>'id' is distinct from p_refund_id;
 update public.fina_user_state
 set state=jsonb_set(current_state,'{refunds}',next_refunds,true),updated_at=now()
 where user_id=p_owner_id;
 return jsonb_build_object('ok',true,'refundId',p_refund_id);
end;
$function$

-- Hardened: fina_shared_future_income
CREATE OR REPLACE FUNCTION public.fina_shared_future_income()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id','shared-income-'||theirs.user_id::text||'-'||coalesce(b.row->>'id',b.ordinality::text),
   'sourceUserId',theirs.user_id::text,
   'owner',case when b.row->>'owner' in ('lucas','naara') then b.row->>'owner' else 'lucas' end,
   'name',left(coalesce(b.row->>'name','Recebimento previsto'),120),
   'value',case when (b.row->>'value') ~ '^[0-9]+$' then (b.row->>'value')::numeric else 0 end,
   'day',case when (b.row->>'day') ~ '^[0-9]+$' then (b.row->>'day')::int else 1 end,
   'month',case when (b.row->>'month') ~ '^[0-9]+$' then (b.row->>'month')::int else 0 end,
   'year',case when (b.row->>'year') ~ '^[0-9]+$' then (b.row->>'year')::int else 2026 end,
   'type','shared'
 ) order by theirs.user_id,b.ordinality),'[]'::jsonb)
 from public.fina_couple_members mine
 join public.fina_couple_members theirs
   on theirs.couple_id=mine.couple_id and theirs.user_id<>mine.user_id
 join public.fina_user_state st on st.user_id=theirs.user_id
 cross join lateral jsonb_array_elements(
   case when jsonb_typeof(st.state->'future')='array'
     then st.state->'future' else '[]'::jsonb end
 ) with ordinality b(row,ordinality)
 where mine.user_id=(select auth.uid())
   and private.fina_financial_sharing_allowed(theirs.user_id)
   and mine.sharing_level in ('planning','partial','total')
   and theirs.sharing_level in ('planning','partial','total')
   and (select count(*) from public.fina_couple_members m where m.couple_id=mine.couple_id)=2;
$function$

-- Hardened: fina_shared_pending_bills
CREATE OR REPLACE FUNCTION public.fina_shared_pending_bills()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(
  jsonb_agg(jsonb_build_object(
    'id','shared-'||theirs.user_id::text||'-'||coalesce(b.bill->>'id',b.ordinality::text),
    'sourceUserId',theirs.user_id::text,
    'owner',case when b.bill->>'owner' in ('lucas','naara') then b.bill->>'owner' else 'lucas' end,
    'name',left(coalesce(b.bill->>'name','Conta compartilhada'),120),
    'value',case when (b.bill->>'value') ~ '^[0-9]+$' then (b.bill->>'value')::numeric else 0 end,
    'day',case when (b.bill->>'day') ~ '^[0-9]+$' then (b.bill->>'day')::int else 1 end,
    'state',b.bill->>'state',
    'month',case when (b.bill->>'month') ~ '^[0-9]+$' then (b.bill->>'month')::int else 0 end,
    'year',case when (b.bill->>'year') ~ '^[0-9]+$' then (b.bill->>'year')::int else 2026 end,
    'estimated',coalesce((b.bill->>'estimated')::boolean,false),
    'recurring',coalesce((b.bill->>'recurring')::boolean,false),
    'detail',case when b.bill->>'state'='posted'
     then left(coalesce(b.bill->>'detail','Pagamento confirmado no banco'),350)
     else 'Conta compartilhada · cadastrada manualmente' end,
    'paidDate',b.bill->>'paidDate',
    'reconciliationMethod',b.bill->>'reconciliationMethod',
    'reconciliationConfidence',b.bill->>'reconciliationConfidence',
    'bankAlreadyReflectedInBalance',b.bill->'bankAlreadyReflectedInBalance',
    'type','shared'
  ) order by theirs.user_id,b.ordinality),
  '[]'::jsonb)
 from public.fina_couple_members mine
 join public.fina_couple_members theirs on theirs.couple_id=mine.couple_id and theirs.user_id <> mine.user_id
 join public.fina_user_state st on st.user_id=theirs.user_id
 cross join lateral jsonb_array_elements(
   case when jsonb_typeof(st.state->'manualBills')='array' then st.state->'manualBills' else '[]'::jsonb end
 ) with ordinality b(bill,ordinality)
 where mine.user_id=auth.uid()
   and private.fina_financial_sharing_allowed(theirs.user_id)
   and mine.sharing_level in ('planning','partial','total')
   and theirs.sharing_level in ('planning','partial','total')
   and b.bill->>'type'='manual'
   and b.bill->>'state' in ('open','reserved','reported','posted');
$function$

-- Hardened: fina_shared_pending_refunds
CREATE OR REPLACE FUNCTION public.fina_shared_pending_refunds()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id','shared-refund-'||them.user_id::text||'-'||(r.item->>'id'),
  'sourceUserId',them.user_id::text,
  'owner',case when r.item->>'owner' in ('lucas','naara') then r.item->>'owner' else 'lucas' end,
  'card',left(coalesce(r.item->>'card',''),120),
  'name',left(coalesce(r.item->>'name','Estorno pendente'),100),
  'value',case when r.item->>'value' ~ '^[0-9]{1,12}$'
     then (r.item->>'value')::bigint else 0 end,
  'month',case when r.item->>'month' ~ '^(?:[0-9]|1[01])$'
     then (r.item->>'month')::int else 0 end,
  'year',case when r.item->>'year' ~ '^[0-9]{4}$'
     then (r.item->>'year')::int else 2026 end,
  'state','pending','type','shared'
 ) order by them.user_id,r.ordinality),'[]'::jsonb)
 from public.fina_couple_members mine
 join public.fina_couple_members them
  on them.couple_id=mine.couple_id and them.user_id<>mine.user_id
 join public.fina_user_state st on st.user_id=them.user_id
 cross join lateral jsonb_array_elements(
  case when jsonb_typeof(st.state->'refunds')='array'
  then st.state->'refunds' else '[]'::jsonb end
 ) with ordinality r(item,ordinality)
 where mine.user_id=(select auth.uid())
  and private.fina_financial_sharing_allowed(them.user_id)
  and mine.sharing_level in ('planning','partial','total')
  and them.sharing_level in ('planning','partial','total')
  and (select count(*) from public.fina_couple_members c where c.couple_id=mine.couple_id)=2
  and r.item->>'state'='pending'
  and r.item->>'id' ~ '^[0-9]{1,25}$'
  and r.item->>'value' ~ '^[0-9]{1,12}$'
  and (case when (r.item->>'value') ~ '^[0-9]{1,12}$' then (r.item->>'value')::bigint else 0 end) > 0;
$function$
-- The exposed card RPC is never available to unauthenticated callers.
revoke all on function public.fina_couple_card_bills() from public,anon;
grant execute on function public.fina_couple_card_bills() to authenticated;
