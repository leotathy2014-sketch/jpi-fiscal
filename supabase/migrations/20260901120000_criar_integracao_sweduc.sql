create table if not exists public.sweduc_config (
  id boolean primary key default true check (id),
  host text,
  credencial_configurada boolean not null default false,
  ultimo_status text not null default 'nao_configurado' check (ultimo_status in ('nao_configurado','pendente','conectado','sincronizando','erro')),
  testada_em timestamptz,
  sincronizada_em timestamptz,
  ultimo_erro text,
  total_sincronizado integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.sweduc_config(id) values(true) on conflict(id) do nothing;
alter table public.sweduc_config enable row level security;
create policy "Usuários autorizados consultam SWeduc" on public.sweduc_config for select to authenticated using ((select public.has_jpi_permission('settings.integrations.view')) or (select public.has_jpi_permission('settings.integrations.edit')));
create policy "Usuários autorizados configuram SWeduc" on public.sweduc_config for update to authenticated using ((select public.has_jpi_permission('settings.integrations.edit'))) with check ((select public.has_jpi_permission('settings.integrations.edit')));

create table if not exists private.sweduc_secrets (
  id boolean primary key default true check(id),
  vault_secret_id uuid not null unique,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.sweduc_alunos (
  matricula_id bigint primary key,
  aluno_id bigint,
  nome text not null,
  data_nascimento date,
  numero_aluno text,
  numero_matricula text,
  status text,
  unidade text,
  curso text,
  serie text,
  turma text,
  ano_letivo text,
  endereco text,
  responsaveis jsonb not null default '[]'::jsonb,
  financeiro jsonb not null default '[]'::jsonb,
  dados_origem jsonb not null default '{}'::jsonb,
  sincronizado_em timestamptz not null default now()
);
create index if not exists sweduc_alunos_nome_idx on public.sweduc_alunos using gin (to_tsvector('portuguese',nome));
alter table public.sweduc_alunos enable row level security;
create policy "Usuários autorizados consultam alunos SWeduc" on public.sweduc_alunos for select to authenticated using ((select public.has_jpi_permission('settings.integrations.view')) or (select public.has_jpi_permission('settings.integrations.edit')));
create policy "Usuários autorizados sincronizam alunos SWeduc" on public.sweduc_alunos for all to authenticated using ((select public.has_jpi_permission('settings.integrations.edit'))) with check ((select public.has_jpi_permission('settings.integrations.edit')));

create or replace function private.store_sweduc_secret_internal(p_secret text,p_backend_secret text)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_id uuid;
begin
  if auth.uid() is null or not public.has_jpi_permission('settings.integrations.edit') then raise exception 'Usuário sem permissão.' using errcode='42501'; end if;
  if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna inválida.' using errcode='42501'; end if;
  if p_secret is null or length(p_secret)<20 or length(p_secret)>8192 then raise exception 'Credencial SWeduc inválida.' using errcode='22023'; end if;
  select vault_secret_id into current_id from private.sweduc_secrets where id=true;
  if current_id is null then
    current_id:=vault.create_secret(p_secret,'jpi_sweduc','Credenciais privadas da integração SWeduc',null);
    insert into private.sweduc_secrets(id,vault_secret_id,updated_by) values(true,current_id,auth.uid());
  else
    perform vault.update_secret(current_id,p_secret,'jpi_sweduc','Credenciais privadas da integração SWeduc',null);
    update private.sweduc_secrets set updated_at=now(),updated_by=auth.uid() where id=true;
  end if;
  update public.sweduc_config set credencial_configurada=true,ultimo_status='pendente',ultimo_erro=null,updated_at=now(),updated_by=auth.uid() where id=true;
  return true;
end $$;
revoke all on function private.store_sweduc_secret_internal(text,text) from public,anon;
grant execute on function private.store_sweduc_secret_internal(text,text) to authenticated;
create or replace function public.store_sweduc_secret(p_secret text,p_backend_secret text) returns boolean language sql security invoker set search_path='' as $$select private.store_sweduc_secret_internal(p_secret,p_backend_secret)$$;
revoke all on function public.store_sweduc_secret(text,text) from public,anon;
grant execute on function public.store_sweduc_secret(text,text) to authenticated;

create or replace function private.get_sweduc_secret_internal(p_backend_secret text)
returns text language plpgsql security definer set search_path='' as $$
declare result text;
begin
  if auth.uid() is null or not (public.has_jpi_permission('settings.integrations.view') or public.has_jpi_permission('settings.integrations.edit')) then raise exception 'Usuário sem permissão.' using errcode='42501'; end if;
  if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna inválida.' using errcode='42501'; end if;
  select decrypted_secret into result from vault.decrypted_secrets where id=(select vault_secret_id from private.sweduc_secrets where id=true);
  return result;
end $$;
revoke all on function private.get_sweduc_secret_internal(text) from public,anon;
grant execute on function private.get_sweduc_secret_internal(text) to authenticated;
create or replace function public.get_sweduc_secret(p_backend_secret text) returns text language sql security invoker set search_path='' as $$select private.get_sweduc_secret_internal(p_backend_secret)$$;
revoke all on function public.get_sweduc_secret(text) from public,anon;
grant execute on function public.get_sweduc_secret(text) to authenticated;

grant select on public.sweduc_config,public.sweduc_alunos to authenticated;
grant update on public.sweduc_config to authenticated;
grant insert,update,delete on public.sweduc_alunos to authenticated;
