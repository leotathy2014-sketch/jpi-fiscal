alter table public.certificados_a1
  add column if not exists senha_configurada boolean not null default false,
  add column if not exists senha_configurada_em timestamptz;

create table if not exists private.certificado_a1_secrets (
  certificado_id uuid primary key references public.certificados_a1(id) on delete cascade,
  vault_secret_id uuid not null unique,
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);

revoke all on table private.certificado_a1_secrets from public, anon, authenticated;

create or replace function private.valid_jpi_backend_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret), 0) >= 40
    and extensions.digest(p_secret, 'sha256') = decode('d72e5c7b18ca200282fb6188e45d654e6ad850e8cb58e421053e984aeaf540d6', 'hex');
$$;

revoke all on function private.valid_jpi_backend_secret(text) from public, anon, authenticated;

create or replace function public.store_certificate_password(
  p_certificate_id uuid,
  p_password text,
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
    raise exception 'Apenas o Administrador pode guardar a senha do certificado.' using errcode = '42501';
  end if;

  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;

  if p_password is null or length(p_password) = 0 or length(p_password) > 256 then
    raise exception 'A senha do certificado é inválida.' using errcode = '22023';
  end if;

  perform 1
  from public.certificados_a1
  where id = p_certificate_id and status = 'ATIVO';
  if not found then
    raise exception 'Certificado A1 ativo não encontrado.' using errcode = 'P0002';
  end if;

  select vault_secret_id into current_secret_id
  from private.certificado_a1_secrets
  where certificado_id = p_certificate_id;

  if current_secret_id is null then
    current_secret_id := vault.create_secret(
      p_password,
      'jpi_certificado_a1_' || p_certificate_id::text,
      'Senha privada do certificado A1 do JPI Fiscal',
      null
    );
    insert into private.certificado_a1_secrets (certificado_id, vault_secret_id, updated_by)
    values (p_certificate_id, current_secret_id, auth.uid());
  else
    perform vault.update_secret(
      current_secret_id,
      p_password,
      'jpi_certificado_a1_' || p_certificate_id::text,
      'Senha privada do certificado A1 do JPI Fiscal',
      null
    );
    update private.certificado_a1_secrets
    set updated_at = now(), updated_by = auth.uid()
    where certificado_id = p_certificate_id;
  end if;

  update public.certificados_a1
  set senha_configurada = true, senha_configurada_em = now()
  where id = p_certificate_id;

  return true;
end;
$$;

revoke all on function public.store_certificate_password(uuid, text, text) from public, anon;
grant execute on function public.store_certificate_password(uuid, text, text) to authenticated;

create or replace function public.get_certificate_password(
  p_certificate_id uuid,
  p_backend_secret text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_password text;
begin
  if auth.uid() is null or private.current_jpi_role() not in ('admin', 'financeiro') then
    raise exception 'Usuário sem permissão para utilizar o certificado.' using errcode = '42501';
  end if;

  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;

  select decrypted.decrypted_secret into stored_password
  from private.certificado_a1_secrets as mapped
  join vault.decrypted_secrets as decrypted on decrypted.id = mapped.vault_secret_id
  join public.certificados_a1 as certificate on certificate.id = mapped.certificado_id
  where mapped.certificado_id = p_certificate_id
    and certificate.status = 'ATIVO';

  if stored_password is null then
    raise exception 'Senha automática do certificado ainda não configurada.' using errcode = 'P0002';
  end if;

  return stored_password;
end;
$$;

revoke all on function public.get_certificate_password(uuid, text) from public, anon;
grant execute on function public.get_certificate_password(uuid, text) to authenticated;

create or replace function public.get_certificate_password_service(p_certificate_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_password text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Operação exclusiva do serviço fiscal.' using errcode = '42501';
  end if;

  select decrypted.decrypted_secret into stored_password
  from private.certificado_a1_secrets as mapped
  join vault.decrypted_secrets as decrypted on decrypted.id = mapped.vault_secret_id
  join public.certificados_a1 as certificate on certificate.id = mapped.certificado_id
  where mapped.certificado_id = p_certificate_id
    and certificate.status = 'ATIVO';

  if stored_password is null then
    raise exception 'Senha automática do certificado ainda não configurada.' using errcode = 'P0002';
  end if;

  return stored_password;
end;
$$;

revoke all on function public.get_certificate_password_service(uuid) from public, anon, authenticated;
grant execute on function public.get_certificate_password_service(uuid) to service_role;

create or replace function private.clear_certificate_password_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid;
begin
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;

  select vault_secret_id into secret_id
  from private.certificado_a1_secrets
  where certificado_id = old.id;

  if secret_id is not null then
    delete from vault.secrets where id = secret_id;
    delete from private.certificado_a1_secrets where certificado_id = old.id;
  end if;

  if tg_op = 'UPDATE' then
    new.senha_configurada := false;
    new.senha_configurada_em := null;
    return new;
  end if;

  return old;
end;
$$;

revoke all on function private.clear_certificate_password_secret() from public, anon, authenticated;

drop trigger if exists certificados_a1_limpar_senha_substituida on public.certificados_a1;
create trigger certificados_a1_limpar_senha_substituida
before update of status on public.certificados_a1
for each row
when (old.status is distinct from new.status and new.status <> 'ATIVO')
execute function private.clear_certificate_password_secret();

drop trigger if exists certificados_a1_limpar_senha_excluida on public.certificados_a1;
create trigger certificados_a1_limpar_senha_excluida
before delete on public.certificados_a1
for each row
execute function private.clear_certificate_password_secret();

