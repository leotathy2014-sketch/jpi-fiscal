create or replace function private.is_allowed_delivery_recipient(p_channel text, p_recipient text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  configured_test_recipient text;
begin
  if auth.uid() is null
     or private.current_jpi_role() not in ('admin','financeiro') then
    return false;
  end if;

  if p_channel = 'email' then
    return p_recipient is not null
      and p_recipient ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  end if;

  if p_channel = 'whatsapp' or p_channel = 'whatsapp_manual' then
    select config.whatsapp_test_recipient into configured_test_recipient
    from public.integracoes_comunicacao as config where config.id = true;
    return p_recipient is not null
      and p_recipient ~ '^55[1-9][0-9]{9,10}$'
      and p_recipient = configured_test_recipient;
  end if;

  if p_channel = 'agenda_edu' then
    return p_recipient is not null
      and p_recipient ~ '^agenda:(homologacao|producao):student:[A-Za-z0-9._-]{1,120}$';
  end if;

  return false;
end;
$$;
