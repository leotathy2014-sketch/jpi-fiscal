alter table public.integracoes_comunicacao
  add column if not exists agenda_edu_provider text not null default 'agenda_edu'
    check (agenda_edu_provider = 'agenda_edu'),
  add column if not exists agenda_edu_school_identifier text,
  add column if not exists agenda_edu_channel_id text,
  add column if not exists agenda_edu_environment text not null default 'homologacao'
    check (agenda_edu_environment = 'homologacao'),
  add column if not exists agenda_edu_documentacao_confirmada boolean not null default true,
  add column if not exists agenda_edu_credencial_configurada boolean not null default false,
  add column if not exists agenda_edu_configurada_em timestamptz,
  add column if not exists agenda_edu_testada_em timestamptz,
  add column if not exists agenda_edu_ultimo_status text not null default 'aguardando_documentacao'
    check (agenda_edu_ultimo_status in ('aguardando_documentacao','pendente','conectado','erro'));

update public.integracoes_comunicacao
set agenda_edu_documentacao_confirmada = true,
    agenda_edu_ultimo_status = case
      when agenda_edu_credencial_configurada then 'pendente'
      else 'aguardando_documentacao'
    end
where id = true;

alter table private.comunicacao_secrets
  drop constraint if exists comunicacao_secrets_canal_check;

alter table private.comunicacao_secrets
  add constraint comunicacao_secrets_canal_check
  check (canal in ('email','whatsapp','agenda_edu'));

alter table public.nfse_entregas
  drop constraint if exists nfse_entregas_canal_check;

alter table public.nfse_entregas
  add constraint nfse_entregas_canal_check
  check (canal in ('email','whatsapp','agenda_edu'));

alter table public.alunos
  add column if not exists agenda_edu_student_id text,
  add column if not exists agenda_edu_use_external_id boolean not null default false;

alter table public.nfse_entregas
  add column if not exists provider_message_ids jsonb;

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
    select config.whatsapp_test_recipient into configured_test_recipient
    from public.integracoes_comunicacao as config where config.id = true;
    return p_recipient is not null
      and p_recipient ~ '^55[1-9][0-9]{9,10}$'
      and p_recipient = configured_test_recipient;
  end if;

  if p_channel = 'agenda_edu' then
    return p_recipient is not null
      and p_recipient ~ '^sandbox:student:[A-Za-z0-9._-]{1,120}$';
  end if;

  return false;
end;
$$;

drop policy if exists "Perfis fiscais registram entregas" on public.nfse_entregas;
create policy "Perfis fiscais registram entregas"
on public.nfse_entregas for insert to authenticated
with check (
  (select private.current_jpi_role()) = any (array['admin'::text,'financeiro'::text])
  and created_by = (select auth.uid())
  and ambiente = 'homologacao'
  and (select private.is_allowed_delivery_recipient(canal, destinatario_utilizado))
);

drop policy if exists "Perfis fiscais atualizam entregas" on public.nfse_entregas;
create policy "Perfis fiscais atualizam entregas"
on public.nfse_entregas for update to authenticated
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

create or replace function private.get_agenda_edu_delivery_config_internal(p_backend_secret text)
returns table (
  agenda_edu_channel_id text,
  agenda_edu_environment text,
  agenda_edu_credencial_configurada boolean,
  agenda_edu_ultimo_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.current_jpi_role() not in ('admin','financeiro') then
    raise exception 'Usuário sem permissão para enviar documentos.' using errcode = '42501';
  end if;
  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;
  return query select config.agenda_edu_channel_id, config.agenda_edu_environment,
    config.agenda_edu_credencial_configurada, config.agenda_edu_ultimo_status
  from public.integracoes_comunicacao as config where config.id = true;
end;
$$;

revoke all on function private.get_agenda_edu_delivery_config_internal(text) from public, anon;
grant execute on function private.get_agenda_edu_delivery_config_internal(text) to authenticated;

create or replace function public.get_agenda_edu_delivery_config(p_backend_secret text)
returns table (
  agenda_edu_channel_id text,
  agenda_edu_environment text,
  agenda_edu_credencial_configurada boolean,
  agenda_edu_ultimo_status text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_agenda_edu_delivery_config_internal(p_backend_secret);
$$;

revoke all on function public.get_agenda_edu_delivery_config(text) from public, anon;
grant execute on function public.get_agenda_edu_delivery_config(text) to authenticated;

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

  if p_channel not in ('email','whatsapp','agenda_edu') then
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
  elsif p_channel = 'whatsapp' then
    update public.integracoes_comunicacao
    set whatsapp_token_configurado = true,
        whatsapp_configurada_em = now(),
        whatsapp_ultimo_status = 'pendente',
        updated_at = now(),
        updated_by = auth.uid()
    where id = true;
  else
    update public.integracoes_comunicacao
    set agenda_edu_credencial_configurada = true,
        agenda_edu_configurada_em = now(),
        agenda_edu_ultimo_status = 'pendente',
        updated_at = now(),
        updated_by = auth.uid()
    where id = true;
  end if;

  return true;
end;
$$;

revoke all on function private.store_communication_secret_internal(text, text, text) from public, anon;
grant execute on function private.store_communication_secret_internal(text, text, text) to authenticated;

-- A documentação oficial v2 foi validada em 28/08/2026.
-- A entrega fiscal utilizará Mensagens com os responsáveis em canal somente de leitura.
-- Cada NFS-e usa duas mensagens consecutivas no mesmo chat: PDF e XML, pois a API aceita um anexo por mensagem.
-- A API pública de Mensagens não documenta confirmação de leitura; o sistema não inventará esse estado.
