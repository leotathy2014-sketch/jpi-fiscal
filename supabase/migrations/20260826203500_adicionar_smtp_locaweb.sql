alter table public.integracoes_comunicacao
  drop constraint if exists integracoes_comunicacao_email_provider_check;

alter table public.integracoes_comunicacao
  add constraint integracoes_comunicacao_email_provider_check
  check (email_provider in ('resend','locaweb_email','locaweb_smtp'));

alter table public.integracoes_comunicacao
  add column if not exists email_smtp_host text,
  add column if not exists email_smtp_port integer not null default 465 check (email_smtp_port = 465),
  add column if not exists email_smtp_username text,
  add column if not exists email_credencial_configurada boolean not null default false;

update public.integracoes_comunicacao
set email_credencial_configurada = email_api_key_configurada,
    email_provider = case when email_api_key_configurada then email_provider else 'locaweb_email' end,
    email_smtp_host = case when email_api_key_configurada then email_smtp_host else 'email-ssl.com.br' end,
    email_smtp_port = 465,
    email_smtp_username = case when email_api_key_configurada then email_smtp_username else email_from_address end
where id = true;

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
  if p_secret is null
     or length(p_secret) < (case when p_channel = 'email' then 6 else 20 end)
     or length(p_secret) > 4096 then
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
        email_credencial_configurada = true,
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
