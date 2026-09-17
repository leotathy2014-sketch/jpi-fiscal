create table if not exists public.domain_settings (
  id boolean primary key default true check (id = true),
  current_domain text not null default 'jpi-fiscal.vercel.app',
  base_domain text,
  subdomain text not null default 'fiscal',
  desired_domain text,
  dns_type text not null default 'CNAME' check (dns_type = 'CNAME'),
  dns_target text not null default 'cname.vercel-dns-0.com',
  status text not null default 'nao_configurado'
    check (status in ('nao_configurado','planejado','aguardando_dns','dns_confirmado','ativo','erro')),
  last_dns_value text,
  last_checked_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.domain_settings(id)
values (true)
on conflict (id) do nothing;

create table if not exists public.domain_change_history (
  id bigserial primary key,
  action text not null,
  previous_domain text,
  requested_domain text,
  dns_value text,
  status text not null,
  details text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_by_email text
);

alter table public.domain_settings enable row level security;
alter table public.domain_change_history enable row level security;

revoke all on public.domain_settings from anon;
revoke all on public.domain_change_history from anon;
grant select, insert, update on public.domain_settings to authenticated;
grant select, insert on public.domain_change_history to authenticated;
grant usage, select on sequence public.domain_change_history_id_seq to authenticated;

drop policy if exists domain_settings_master_select on public.domain_settings;
create policy domain_settings_master_select on public.domain_settings
for select to authenticated
using (private.current_jpi_raw_role() = 'master');

drop policy if exists domain_settings_master_insert on public.domain_settings;
create policy domain_settings_master_insert on public.domain_settings
for insert to authenticated
with check (private.current_jpi_raw_role() = 'master');

drop policy if exists domain_settings_master_update on public.domain_settings;
create policy domain_settings_master_update on public.domain_settings
for update to authenticated
using (private.current_jpi_raw_role() = 'master')
with check (private.current_jpi_raw_role() = 'master');

drop policy if exists domain_change_history_master_select on public.domain_change_history;
create policy domain_change_history_master_select on public.domain_change_history
for select to authenticated
using (private.current_jpi_raw_role() = 'master');

drop policy if exists domain_change_history_master_insert on public.domain_change_history;
create policy domain_change_history_master_insert on public.domain_change_history
for insert to authenticated
with check (private.current_jpi_raw_role() = 'master');

comment on table public.domain_settings is
  'Planejamento e acompanhamento do domínio personalizado do JPI Fiscal. Não guarda credenciais do provedor DNS.';
comment on table public.domain_change_history is
  'Auditoria das solicitações e verificações de domínio feitas pelo Master.';
