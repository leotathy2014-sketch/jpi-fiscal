grant usage on schema private to authenticated, service_role;

create or replace function private.store_certificate_password_internal(
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

revoke all on function private.store_certificate_password_internal(uuid, text, text) from public, anon;
grant execute on function private.store_certificate_password_internal(uuid, text, text) to authenticated;

create or replace function private.get_certificate_password_internal(
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

revoke all on function private.get_certificate_password_internal(uuid, text) from public, anon;
grant execute on function private.get_certificate_password_internal(uuid, text) to authenticated;

create or replace function public.store_certificate_password(
  p_certificate_id uuid,
  p_password text,
  p_backend_secret text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.store_certificate_password_internal(p_certificate_id, p_password, p_backend_secret);
$$;

revoke all on function public.store_certificate_password(uuid, text, text) from public, anon;
grant execute on function public.store_certificate_password(uuid, text, text) to authenticated;

create or replace function public.get_certificate_password(
  p_certificate_id uuid,
  p_backend_secret text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.get_certificate_password_internal(p_certificate_id, p_backend_secret);
$$;

revoke all on function public.get_certificate_password(uuid, text) from public, anon;
grant execute on function public.get_certificate_password(uuid, text) to authenticated;

