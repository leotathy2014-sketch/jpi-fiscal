create table if not exists public.integracoes_comunicacao (
  id boolean primary key default true check (id),
  email_provider text not null default 'resend' check (email_provider in ('resend')),
  email_from_name text not null default 'Jardim Escola João Paulo I',
  email_from_address text,
  email_reply_to text,
  email_api_key_configurada boolean not null default false,
  email_configurada_em timestamptz,
  email_testada_em timestamptz,
  email_ultimo_status text not null default 'pendente' check (email_ultimo_status in ('pendente','conectado','erro')),
  whatsapp_provider text not null default 'meta_cloud' check (whatsapp_provider in ('meta_cloud')),
  whatsapp_phone_number_id text,
  whatsapp_business_account_id text,
  whatsapp_sender_number text,
  whatsapp_template_name text not null default 'envio_nfse',
  whatsapp_token_configurado boolean not null default false,
  whatsapp_configurada_em timestamptz,
  whatsapp_testada_em timestamptz,
  whatsapp_ultimo_status text not null default 'pendente' check (whatsapp_ultimo_status in ('pendente','conectado','erro')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.integracoes_comunicacao enable row level security;
revoke all on table public.integracoes_comunicacao from anon;
grant select, update on table public.integracoes_comunicacao to authenticated;

drop policy if exists "Administrador visualiza integrações" on public.integracoes_comunicacao;
create policy "Administrador visualiza integrações"
on public.integracoes_comunicacao for select
to authenticated
using ((select private.current_jpi_role()) = 'admin');

drop policy if exists "Administrador atualiza integrações" on public.integracoes_comunicacao;
create policy "Administrador atualiza integrações"
on public.integracoes_comunicacao for update
to authenticated
using ((select private.current_jpi_role()) = 'admin')
with check ((select private.current_jpi_role()) = 'admin');

insert into public.integracoes_comunicacao (id, email_from_address)
values (true, 'nfse@jejoaopaulo.com.br')
on conflict (id) do nothing;

create table if not exists private.comunicacao_secrets (
  canal text primary key check (canal in ('email','whatsapp')),
  vault_secret_id uuid not null unique,
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);

revoke all on table private.comunicacao_secrets from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.store_communication_secret_internal(
  p_channel text,
  p_secret text,
  p_backend_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
begin
  if auth.uid() is null or private.current_jpi_role() <> 'admin' then
    raise exception 'Apenas o Administrador pode guardar credenciais de comunicação.' using errcode = '42501';
  end if;

  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;

  if p_channel not in ('email','whatsapp') then
    raise exception 'Canal de comunicação inválido.' using errcode = '22023';
  end if;

  if p_secret is null or length(p_secret) < 20 or length(p_secret) > 4096 then
    raise exception 'Credencial do provedor inválida.' using errcode = '22023';
  end if;

  select vault_secret_id into current_secret_id
  from private.comunicacao_secrets
  where canal = p_channel;

  if current_secret_id is null then
    current_secret_id := vault.create_secret(
      p_secret,
      'jpi_comunicacao_' || p_channel,
      'Credencial privada da integração de ' || p_channel || ' do JPI Fiscal',
      null
    );
    insert into private.comunicacao_secrets (canal, vault_secret_id, updated_by)
    values (p_channel, current_secret_id, auth.uid());
  else
    perform vault.update_secret(
      current_secret_id,
      p_secret,
      'jpi_comunicacao_' || p_channel,
      'Credencial privada da integração de ' || p_channel || ' do JPI Fiscal',
      null
    );
    update private.comunicacao_secrets
    set updated_at = now(), updated_by = auth.uid()
    where canal = p_channel;
  end if;

  if p_channel = 'email' then
    update public.integracoes_comunicacao
    set email_api_key_configurada = true,
        email_configurada_em = now(),
        email_ultimo_status = 'pendente',
        updated_at = now(),
        updated_by = auth.uid()
    where id = true;
  else
    update public.integracoes_comunicacao
    set whatsapp_token_configurado = true,
        whatsapp_configurada_em = now(),
        whatsapp_ultimo_status = 'pendente',
        updated_at = now(),
        updated_by = auth.uid()
    where id = true;
  end if;

  return true;
end;
$$;

revoke all on function private.store_communication_secret_internal(text, text, text) from public, anon;
grant execute on function private.store_communication_secret_internal(text, text, text) to authenticated;

create or replace function private.get_communication_secret_internal(
  p_channel text,
  p_backend_secret text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_secret text;
begin
  if auth.uid() is null or private.current_jpi_role() not in ('admin','financeiro') then
    raise exception 'Usuário sem permissão para utilizar as comunicações.' using errcode = '42501';
  end if;

  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;

  select decrypted.decrypted_secret into stored_secret
  from private.comunicacao_secrets as mapped
  join vault.decrypted_secrets as decrypted on decrypted.id = mapped.vault_secret_id
  where mapped.canal = p_channel;

  if stored_secret is null then
    raise exception 'Credencial do canal ainda não configurada.' using errcode = 'P0002';
  end if;

  return stored_secret;
end;
$$;

revoke all on function private.get_communication_secret_internal(text, text) from public, anon;
grant execute on function private.get_communication_secret_internal(text, text) to authenticated;

create or replace function public.store_communication_secret(
  p_channel text,
  p_secret text,
  p_backend_secret text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.store_communication_secret_internal(p_channel, p_secret, p_backend_secret);
$$;

revoke all on function public.store_communication_secret(text, text, text) from public, anon;
grant execute on function public.store_communication_secret(text, text, text) to authenticated;

create or replace function public.get_communication_secret(
  p_channel text,
  p_backend_secret text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.get_communication_secret_internal(p_channel, p_backend_secret);
$$;

revoke all on function public.get_communication_secret(text, text) from public, anon;
grant execute on function public.get_communication_secret(text, text) to authenticated;
