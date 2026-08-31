create table if not exists private.password_recovery_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  requested_at timestamptz not null default now()
);

create index if not exists password_recovery_attempts_email_idx
  on private.password_recovery_attempts(email_hash, requested_at desc);
create index if not exists password_recovery_attempts_ip_idx
  on private.password_recovery_attempts(ip_hash, requested_at desc);

revoke all on private.password_recovery_attempts from public, anon, authenticated;

create or replace function public.register_password_recovery_attempt(
  p_email_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  email_count integer;
  ip_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Operação não autorizada.' using errcode='42501';
  end if;

  if p_email_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Identificação de segurança inválida.' using errcode='22023';
  end if;

  delete from private.password_recovery_attempts
  where requested_at < now() - interval '7 days';

  select count(*) into email_count
  from private.password_recovery_attempts
  where email_hash=p_email_hash
    and requested_at >= now() - interval '90 seconds';

  select count(*) into ip_count
  from private.password_recovery_attempts
  where ip_hash=p_ip_hash
    and requested_at >= now() - interval '15 minutes';

  if email_count >= 1 or ip_count >= 8 then
    return false;
  end if;

  insert into private.password_recovery_attempts(email_hash,ip_hash)
  values(p_email_hash,p_ip_hash);
  return true;
end;
$$;

revoke all on function public.register_password_recovery_attempt(text,text) from public,anon,authenticated;
grant execute on function public.register_password_recovery_attempt(text,text) to service_role;

create or replace function public.get_password_recovery_email_config()
returns table(
  email_provider text,
  email_from_name text,
  email_from_address text,
  email_reply_to text,
  email_smtp_host text,
  email_smtp_port integer,
  email_smtp_username text,
  email_credencial_configurada boolean,
  email_ultimo_status text,
  email_secret text,
  primary_color text,
  sidebar_color text,
  success_color text,
  branding_updated_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Operação não autorizada.' using errcode='42501';
  end if;

  return query
  select
    c.email_provider,
    c.email_from_name,
    c.email_from_address,
    c.email_reply_to,
    c.email_smtp_host,
    c.email_smtp_port,
    c.email_smtp_username,
    c.email_credencial_configurada,
    c.email_ultimo_status,
    d.decrypted_secret,
    ce.tema_cor_primaria,
    ce.tema_cor_lateral,
    ce.tema_cor_sucesso,
    ce.branding_updated_at
  from public.integracoes_comunicacao c
  join public.configuracoes_empresa ce on ce.id=true
  left join private.comunicacao_secrets mapped on mapped.canal='email'
  left join vault.decrypted_secrets d on d.id=mapped.vault_secret_id
  where c.id=true;
end;
$$;

revoke all on function public.get_password_recovery_email_config() from public,anon,authenticated;
grant execute on function public.get_password_recovery_email_config() to service_role;