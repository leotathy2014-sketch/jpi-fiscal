alter table public.integracoes_comunicacao
  drop constraint if exists integracoes_comunicacao_agenda_edu_environment_check;

alter table public.integracoes_comunicacao
  add constraint integracoes_comunicacao_agenda_edu_environment_check
  check (agenda_edu_environment in ('homologacao','producao'));

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

comment on column public.integracoes_comunicacao.agenda_edu_environment is
  'Ambiente da Agenda Edu: homologacao usa sandbox-api.agendaedu.dev; producao usa api.agendaedu.com.';
