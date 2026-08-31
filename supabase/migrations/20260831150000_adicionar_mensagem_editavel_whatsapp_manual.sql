alter table public.integracoes_comunicacao
  add column if not exists whatsapp_manual_message_template text
  not null
  default E'Olá, {responsavel}.\n\nSegue a NFS-e referente ao aluno(a) {aluno}, competência {competencia}.\n\nAcesse a nota pelo link seguro:\n{link}\n\nEste link é individual e válido por 30 dias.\n\nJardim Escola João Paulo I';

alter table public.integracoes_comunicacao
  drop constraint if exists integracoes_comunicacao_whatsapp_manual_message_template_check;
alter table public.integracoes_comunicacao
  add constraint integracoes_comunicacao_whatsapp_manual_message_template_check
  check (
    length(whatsapp_manual_message_template) between 20 and 2000
    and position('{link}' in whatsapp_manual_message_template) > 0
  );

drop function if exists public.get_whatsapp_delivery_config(text);
drop function if exists private.get_whatsapp_delivery_config_internal(text);

create function private.get_whatsapp_delivery_config_internal(p_backend_secret text)
returns table(
  whatsapp_phone_number_id text,
  whatsapp_business_account_id text,
  whatsapp_sender_number text,
  whatsapp_template_name text,
  whatsapp_test_recipient text,
  whatsapp_token_configurado boolean,
  whatsapp_ultimo_status text,
  whatsapp_manual_message_template text
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
    config.whatsapp_ultimo_status,
    config.whatsapp_manual_message_template
  from public.integracoes_comunicacao as config
  where config.id = true;
end;
$$;

create function public.get_whatsapp_delivery_config(p_backend_secret text)
returns table(
  whatsapp_phone_number_id text,
  whatsapp_business_account_id text,
  whatsapp_sender_number text,
  whatsapp_template_name text,
  whatsapp_test_recipient text,
  whatsapp_token_configurado boolean,
  whatsapp_ultimo_status text,
  whatsapp_manual_message_template text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_whatsapp_delivery_config_internal(p_backend_secret);
$$;

revoke all on function private.get_whatsapp_delivery_config_internal(text) from public, anon;
grant execute on function private.get_whatsapp_delivery_config_internal(text) to authenticated;

revoke all on function public.get_whatsapp_delivery_config(text) from public, anon;
grant execute on function public.get_whatsapp_delivery_config(text) to authenticated, service_role;

comment on column public.integracoes_comunicacao.whatsapp_manual_message_template is
  'Mensagem padrão editável do envio manual por WhatsApp. Variáveis suportadas: {responsavel}, {aluno}, {competencia}, {valor}, {link}. O link é obrigatório.';
