grant usage on schema private to service_role;

create or replace function private.get_sweduc_secret_service_internal(p_backend_secret text)
returns text language plpgsql security definer set search_path='' as $$
declare result text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Acesso restrito ao servidor.' using errcode='42501';
  end if;
  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna inválida.' using errcode='42501';
  end if;
  select decrypted_secret into result
    from vault.decrypted_secrets
   where id=(select vault_secret_id from private.sweduc_secrets where id=true);
  return result;
end $$;

revoke all on function private.get_sweduc_secret_service_internal(text) from public,anon,authenticated;
grant execute on function private.get_sweduc_secret_service_internal(text) to service_role;

create or replace function public.get_sweduc_secret_service(p_backend_secret text)
returns text language sql security invoker set search_path='' as $$
  select private.get_sweduc_secret_service_internal(p_backend_secret)
$$;

revoke all on function public.get_sweduc_secret_service(text) from public,anon,authenticated;
grant execute on function public.get_sweduc_secret_service(text) to service_role;

create index if not exists sweduc_alunos_ano_letivo_idx
  on public.sweduc_alunos(ano_letivo);

create index if not exists sweduc_alunos_sincronizado_em_idx
  on public.sweduc_alunos(sincronizado_em desc);

drop policy if exists "Usuários autorizados consultam alunos SWeduc" on public.sweduc_alunos;
create policy "Usuários autorizados consultam alunos SWeduc" on public.sweduc_alunos
  for select to authenticated
  using (
    (select public.has_jpi_permission('settings.integrations.view')) or
    (select public.has_jpi_permission('settings.integrations.edit')) or
    (select public.has_jpi_permission('students.view')) or
    (select public.has_jpi_permission('students.create')) or
    (select public.has_jpi_permission('students.edit')) or
    (select public.has_jpi_permission('payments.create')) or
    (select public.has_jpi_permission('nfse.prepare'))
  );
