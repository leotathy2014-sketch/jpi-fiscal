alter table public.nfse_entregas
  drop constraint if exists nfse_entregas_canal_check;

alter table public.nfse_entregas
  add constraint nfse_entregas_canal_check
  check (canal in ('email','whatsapp'));

alter table public.integracoes_comunicacao
  add column if not exists whatsapp_test_recipient text;

create or replace function private.is_allowed_delivery_recipient(
  p_channel text,
  p_recipient text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_test_recipient text;
begin
  if auth.uid() is null
     or private.current_jpi_role() not in ('admin','financeiro') then
    return false;
  end if;

  if p_channel = 'email' then
    return p_recipient = 'administracao@jejoaopaulo.com.br';
  end if;

  if p_channel = 'whatsapp' then
    select config.whatsapp_test_recipient
      into configured_test_recipient
    from public.integracoes_comunicacao as config
    where config.id = true;

    return p_recipient is not null
      and p_recipient ~ '^55[1-9][0-9]{9,10}$'
      and p_recipient = configured_test_recipient;
  end if;

  return false;
end;
$$;

revoke all on function private.is_allowed_delivery_recipient(text, text) from public, anon;
grant execute on function private.is_allowed_delivery_recipient(text, text) to authenticated;

drop policy if exists "Perfis fiscais registram entregas" on public.nfse_entregas;
create policy "Perfis fiscais registram entregas"
on public.nfse_entregas for insert
to authenticated
with check (
  (select private.current_jpi_role()) = any (array['admin'::text,'financeiro'::text])
  and created_by = (select auth.uid())
  and ambiente = 'homologacao'
  and (select private.is_allowed_delivery_recipient(canal, destinatario_utilizado))
);

drop policy if exists "Perfis fiscais atualizam entregas" on public.nfse_entregas;
create policy "Perfis fiscais atualizam entregas"
on public.nfse_entregas for update
to authenticated
using (
  (select private.current_jpi_role()) = any (array['admin'::text,'financeiro'::text])
  and created_by = (select auth.uid())
)
with check (
  (select private.current_jpi_role()) = any (array['admin'::text,'financeiro'::text])
  and created_by = (select auth.uid())
  and ambiente = 'homologacao'
  and (select private.is_allowed_delivery_recipient(canal, destinatario_utilizado))
);

create or replace function private.get_whatsapp_delivery_config_internal(p_backend_secret text)
returns table (
  whatsapp_phone_number_id text,
  whatsapp_business_account_id text,
  whatsapp_sender_number text,
  whatsapp_template_name text,
  whatsapp_test_recipient text,
  whatsapp_token_configurado boolean,
  whatsapp_ultimo_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or private.current_jpi_role() not in ('admin','financeiro') then
    raise exception 'Usuário sem permissão para enviar documentos.' using errcode = '42501';
  end if;

  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;

  return query
  select
    config.whatsapp_phone_number_id,
    config.whatsapp_business_account_id,
    config.whatsapp_sender_number,
    config.whatsapp_template_name,
    config.whatsapp_test_recipient,
    config.whatsapp_token_configurado,
    config.whatsapp_ultimo_status
  from public.integracoes_comunicacao as config
  where config.id = true;
end;
$$;

revoke all on function private.get_whatsapp_delivery_config_internal(text) from public, anon;
grant execute on function private.get_whatsapp_delivery_config_internal(text) to authenticated;

create or replace function public.get_whatsapp_delivery_config(p_backend_secret text)
returns table (
  whatsapp_phone_number_id text,
  whatsapp_business_account_id text,
  whatsapp_sender_number text,
  whatsapp_template_name text,
  whatsapp_test_recipient text,
  whatsapp_token_configurado boolean,
  whatsapp_ultimo_status text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_whatsapp_delivery_config_internal(p_backend_secret);
$$;

revoke all on function public.get_whatsapp_delivery_config(text) from public, anon;
grant execute on function public.get_whatsapp_delivery_config(text) to authenticated;
