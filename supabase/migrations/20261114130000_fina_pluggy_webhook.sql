-- FINA: registro de notificações Pluggy, sem armazenar chaves em claro.
-- Tabelas internas: só service_role; nenhuma política permite leitura pelo navegador.
create table if not exists public.fina_pluggy_webhook_subscriptions (
  client_id text primary key,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  token_sha256 text not null unique,
  provider_webhook_id text,
  status text not null default 'registering' check(status in ('registering','active','failed')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_event_at timestamptz
);
alter table public.fina_pluggy_webhook_subscriptions enable row level security;
revoke all on public.fina_pluggy_webhook_subscriptions from anon,authenticated;
grant all on public.fina_pluggy_webhook_subscriptions to service_role;

create table if not exists public.fina_pluggy_webhook_events (
  client_id text not null references public.fina_pluggy_webhook_subscriptions(client_id) on delete cascade,
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  event_type text not null check(event_type in ('item/updated','transactions/created','transactions/updated')),
  status text not null default 'pending' check(status in ('pending','processing','complete','failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  primary key(client_id,event_id)
);
alter table public.fina_pluggy_webhook_events enable row level security;
revoke all on public.fina_pluggy_webhook_events from anon,authenticated;
grant all on public.fina_pluggy_webhook_events to service_role;
create index if not exists fina_pluggy_webhook_events_pending_idx
  on public.fina_pluggy_webhook_events(status,created_at);
create index if not exists fina_pluggy_webhook_events_item_idx
  on public.fina_pluggy_webhook_events(item_id,created_at desc);
