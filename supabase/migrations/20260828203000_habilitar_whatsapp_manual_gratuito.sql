alter table public.nfse_entregas
  drop constraint if exists nfse_entregas_canal_check;

alter table public.nfse_entregas
  add constraint nfse_entregas_canal_check
  check (canal in ('email','whatsapp','whatsapp_manual','agenda_edu'));

alter table public.nfse_entregas
  drop constraint if exists nfse_entregas_status_check;

alter table public.nfse_entregas
  add constraint nfse_entregas_status_check
  check (status in ('enviando','aguardando_confirmacao','enviado','erro'));

alter table public.nfse_entregas
  add column if not exists aberto_por uuid,
  add column if not exists aberto_por_nome text,
  add column if not exists aberto_em timestamptz,
  add column if not exists confirmado_por uuid,
  add column if not exists confirmado_por_nome text,
  add column if not exists confirmado_em timestamptz;

alter table public.nfse_entregas
  drop constraint if exists nfse_entregas_aberto_por_nome_check,
  drop constraint if exists nfse_entregas_confirmado_por_nome_check;

alter table public.nfse_entregas
  add constraint nfse_entregas_aberto_por_nome_check
    check (aberto_por_nome is null or length(aberto_por_nome) between 1 and 180),
  add constraint nfse_entregas_confirmado_por_nome_check
    check (confirmado_por_nome is null or length(confirmado_por_nome) between 1 and 180);

drop index if exists public.nfse_entregas_envio_em_andamento_idx;

create unique index nfse_entregas_envio_em_andamento_idx
  on public.nfse_entregas (documento_homologacao_id, canal, ambiente)
  where status in ('enviando','aguardando_confirmacao');

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

  if p_channel in ('whatsapp','whatsapp_manual') then
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

create or replace function private.create_nfse_delivery_access_internal(
  p_delivery_id bigint,
  p_token_hash text,
  p_xml_base64 text,
  p_chave_acesso text,
  p_backend_secret text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  expiry timestamptz;
  decoded_xml bytea;
  delivery_channel text;
begin
  if auth.uid() is null or private.current_jpi_role() not in ('admin','financeiro') then
    raise exception 'Usuário sem permissão para criar acesso à nota.' using errcode = '42501';
  end if;
  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_xml_base64 is null or length(p_xml_base64) > 14000000
     or p_chave_acesso is null or length(p_chave_acesso) > 80 then
    raise exception 'Dados do acesso protegido inválidos.' using errcode = '22023';
  end if;
  select decode(p_xml_base64, 'base64') into decoded_xml;
  if octet_length(decoded_xml) not between 1 and 10485760 then
    raise exception 'Documento fora do limite permitido.' using errcode = '22023';
  end if;
  select e.canal into delivery_channel
  from public.nfse_entregas e
  where e.id = p_delivery_id
    and e.created_by = auth.uid()
    and e.canal in ('agenda_edu','whatsapp_manual')
    and e.ambiente = 'homologacao';
  if delivery_channel is null then
    raise exception 'Entrega protegida não encontrada.' using errcode = '42501';
  end if;
  expiry := now() + case
    when delivery_channel = 'whatsapp_manual' then interval '30 days'
    else interval '365 days'
  end;
  insert into private.nfse_entrega_links(entrega_id,token_hash,chave_acesso,xml_content,expires_at)
  values(p_delivery_id,p_token_hash,p_chave_acesso,decoded_xml,expiry)
  on conflict (entrega_id) do update set
    token_hash=excluded.token_hash,
    chave_acesso=excluded.chave_acesso,
    xml_content=excluded.xml_content,
    expires_at=excluded.expires_at;
  return expiry;
end;
$$;

revoke all on function private.create_nfse_delivery_access_internal(bigint,text,text,text,text) from public, anon;
grant execute on function private.create_nfse_delivery_access_internal(bigint,text,text,text,text) to authenticated;

create or replace function private.revoke_nfse_delivery_access_internal(
  p_delivery_id bigint,
  p_backend_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.current_jpi_role() not in ('admin','financeiro') then
    raise exception 'Usuário sem permissão para revogar o acesso à nota.' using errcode = '42501';
  end if;
  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.nfse_entregas e
    where e.id = p_delivery_id
      and e.created_by = auth.uid()
      and e.canal = 'whatsapp_manual'
      and e.ambiente = 'homologacao'
  ) then
    raise exception 'Entrega protegida não encontrada.' using errcode = '42501';
  end if;
  delete from private.nfse_entrega_links where entrega_id = p_delivery_id;
  return found;
end;
$$;

create or replace function public.revoke_nfse_delivery_access(
  p_delivery_id bigint,
  p_backend_secret text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.revoke_nfse_delivery_access_internal(p_delivery_id,p_backend_secret); $$;

revoke all on function private.revoke_nfse_delivery_access_internal(bigint,text) from public, anon;
grant execute on function private.revoke_nfse_delivery_access_internal(bigint,text) to authenticated;
revoke all on function public.revoke_nfse_delivery_access(bigint,text) from public, anon;
grant execute on function public.revoke_nfse_delivery_access(bigint,text) to authenticated;

comment on table private.nfse_entrega_links is
  'Links individuais da Agenda Edu e do WhatsApp manual; guarda somente o hash do token e uma cópia privada do XML para acesso protegido.';

comment on column public.nfse_entregas.aberto_por_nome is
  'Nome auditável do usuário que abriu o WhatsApp para o envio manual.';

comment on column public.nfse_entregas.confirmado_por_nome is
  'Nome auditável do usuário que confirmou o envio manual no JPI Fiscal.';
