-- Estornos cadastrados manualmente: somente acompanhamento de estornos
-- pendentes, nunca confirmação financeira nem alteração de saldo/fatura.
create or replace function public.fina_shared_pending_refunds()
returns jsonb
language sql stable security definer set search_path = ''
as $function$
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
  and mine.sharing_level in ('planning','partial','total')
  and them.sharing_level in ('planning','partial','total')
  and (select count(*) from public.fina_couple_members c where c.couple_id=mine.couple_id)=2
  and r.item->>'state'='pending'
  and r.item->>'id' ~ '^[0-9]{1,25}$'
  and r.item->>'value' ~ '^[0-9]{1,12}$'
  and (case when (r.item->>'value') ~ '^[0-9]{1,12}$' then (r.item->>'value')::bigint else 0 end) > 0;
$function$;

-- Permite a qualquer integrante retirar um estorno pendente que o outro cadastrou.
-- O proprio dono exclui pelo caminho usual de gravação com controle de versão.
create or replace function public.fina_delete_shared_refund(
 p_owner_id uuid, p_refund_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
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
$function$;

revoke all on function public.fina_shared_pending_refunds() from public,anon;
grant execute on function public.fina_shared_pending_refunds() to authenticated;
revoke all on function public.fina_delete_shared_refund(uuid,text) from public,anon;
grant execute on function public.fina_delete_shared_refund(uuid,text) to authenticated;
