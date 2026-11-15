-- FINA: previsoes cadastradas por uma pessoa podem ser vistas e excluidas
-- por ambas, sem compartilhar preferencias privadas nem extratos sem consentimento.
-- Os IDs de cada previsao permanecem estaveis mesmo se a ordem mudar.
create or replace function public.fina_shared_future_income()
returns jsonb
language sql stable security definer set search_path = ''
as $function$
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
   and mine.sharing_level in ('planning','partial','total')
   and theirs.sharing_level in ('planning','partial','total')
   and (select count(*) from public.fina_couple_members m where m.couple_id=mine.couple_id)=2;
$function$;

-- A remocao de uma previsao do outro integrante altera SOMENTE o array
-- future daquele proprietario (sob bloqueio de linha); nao altera preferencias,
-- contas bancarias, saldos ou os demais compromissos.
create or replace function public.fina_delete_shared_future_income(
 p_owner_id uuid,p_future_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
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
$function$;

revoke all on function public.fina_shared_future_income() from public,anon;
grant execute on function public.fina_shared_future_income() to authenticated;
revoke all on function public.fina_delete_shared_future_income(uuid,text) from public,anon;
grant execute on function public.fina_delete_shared_future_income(uuid,text) to authenticated;
