-- Permite que o perfil Secretaria execute os canais operacionais
-- sem liberar a edição das integrações ou das configurações administrativas.
update public.jpi_role_permissions
set allowed = true,
    updated_at = now()
where role = 'secretaria'
  and permission_key in (
    'settings.company.view',
    'deliveries.send_whatsapp',
    'deliveries.send_agenda'
  );

create or replace function private.is_allowed_delivery_recipient(
  p_channel text,
  p_recipient text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  configured_test_recipient text;
begin
  if auth.uid() is null then
    return false;
  end if;

  if p_channel = 'email' then
    return private.has_jpi_permission('deliveries.send_email')
      and p_recipient is not null
      and p_recipient ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  end if;

  if p_channel = 'whatsapp' or p_channel = 'whatsapp_manual' then
    if not private.has_jpi_permission('deliveries.send_whatsapp') then
      return false;
    end if;

    select config.whatsapp_test_recipient
      into configured_test_recipient
    from public.integracoes_comunicacao as config
    where config.id = true;

    return p_recipient is not null
      and p_recipient ~ '^55[1-9][0-9]{9,10}$'
      and p_recipient = configured_test_recipient;
  end if;

  if p_channel = 'agenda_edu' then
    return private.has_jpi_permission('deliveries.send_agenda')
      and p_recipient is not null
      and p_recipient ~ '^agenda:(homologacao|producao):student:[A-Za-z0-9._-]{1,120}$';
  end if;

  return false;
end;
$$;

revoke all on function private.is_allowed_delivery_recipient(text, text) from public, anon;
grant execute on function private.is_allowed_delivery_recipient(text, text) to authenticated;

create or replace function private.is_allowed_whatsapp_recipient_for_payment(
  p_recipient text,
  p_mensalidade_id bigint
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  stored_phone text;
  normalized_phone text;
begin
  if auth.uid() is null
     or not private.has_jpi_permission('deliveries.send_whatsapp') then
    return false;
  end if;

  select regexp_replace(coalesce(a.whatsapp, ''), '\D', '', 'g')
    into stored_phone
  from public.mensalidades m
  join public.alunos a on a.id = m.aluno_id
  where m.id = p_mensalidade_id;

  normalized_phone := case
    when length(stored_phone) in (10, 11) then '55' || stored_phone
    else stored_phone
  end;

  return p_recipient is not null
    and p_recipient ~ '^55[1-9][0-9]{9,10}$'
    and p_recipient = normalized_phone;
end;
$$;

revoke all on function private.is_allowed_whatsapp_recipient_for_payment(text, bigint) from public, anon;
grant execute on function private.is_allowed_whatsapp_recipient_for_payment(text, bigint) to authenticated;
