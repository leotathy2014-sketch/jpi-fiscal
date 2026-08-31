alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users
  add constraint app_users_role_check
  check (role = any (array['master'::text,'admin'::text,'financeiro'::text,'secretaria'::text,'consulta'::text]));

create or replace function private.current_jpi_raw_role()
returns text
language sql
stable
security definer
set search_path='public'
as $$
  select role
  from public.app_users
  where lower(email)=lower(auth.jwt()->>'email')
    and active=true
  limit 1;
$$;

create or replace function private.current_jpi_role()
returns text
language sql
stable
security definer
set search_path='public'
as $$
  select case when private.current_jpi_raw_role()='master' then 'admin' else private.current_jpi_raw_role() end;
$$;

do $$
begin
  if not exists(select 1 from public.app_users where role='master' and active=true) then
    update public.app_users
    set role='master', updated_at=now()
    where id=(
      select id from public.app_users
      where role='admin' and active=true
      order by created_at,id
      limit 1
    );
  end if;
end $$;

create table if not exists public.jpi_permissions (
  permission_key text primary key,
  module_key text not null,
  module_label text not null,
  action_key text not null,
  action_label text not null,
  description text not null default '',
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.jpi_role_permissions (
  role text not null,
  permission_key text not null references public.jpi_permissions(permission_key) on delete cascade,
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key(role,permission_key),
  constraint jpi_role_permissions_role_check check(role in ('admin','financeiro','secretaria','consulta'))
);

alter table public.jpi_permissions enable row level security;
alter table public.jpi_role_permissions enable row level security;
revoke all on public.jpi_permissions from anon;
revoke all on public.jpi_role_permissions from anon;
grant select on public.jpi_permissions to authenticated;
grant select,insert,update,delete on public.jpi_role_permissions to authenticated;

insert into public.jpi_permissions(permission_key,module_key,module_label,action_key,action_label,description,sort_order) values
('dashboard.view','dashboard','Painel','view','Visualizar','Acessar o painel principal e indicadores.',10),
('students.view','students','Alunos e Responsáveis','view','Visualizar','Consultar alunos e responsáveis.',20),
('students.create','students','Alunos e Responsáveis','create','Cadastrar','Cadastrar novos alunos e responsáveis.',21),
('students.edit','students','Alunos e Responsáveis','edit','Editar','Alterar dados de alunos e responsáveis.',22),
('students.delete','students','Alunos e Responsáveis','delete','Excluir','Excluir cadastros de alunos.',23),
('payments.view','payments','Mensalidades','view','Visualizar','Consultar mensalidades e cobranças.',30),
('payments.create','payments','Mensalidades','create','Cadastrar','Registrar novas mensalidades.',31),
('payments.edit','payments','Mensalidades','edit','Editar','Alterar mensalidades e valores.',32),
('payments.delete','payments','Mensalidades','delete','Excluir','Excluir mensalidades.',33),
('nfse.view','nfse','NFS-e','view','Visualizar','Consultar NFS-e, DPS, XML e histórico fiscal.',40),
('nfse.prepare','nfse','NFS-e','prepare','Preparar/Editar','Validar dados, preparar e alterar DPS.',41),
('nfse.issue','nfse','NFS-e','issue','Emitir em homologação','Transmitir NFS-e no ambiente de homologação.',42),
('nfse.cancel','nfse','NFS-e','cancel','Cancelar','Cancelar NFS-e de homologação.',43),
('nfse.delete','nfse','NFS-e','delete','Excluir arquivos','Excluir documentos fiscais permitidos.',44),
('nfse.test_connection','nfse','NFS-e','test','Testar integração','Testar conexão fiscal e certificado.',45),
('deliveries.view','deliveries','Envio de notas','view','Visualizar','Consultar central e histórico de envios.',50),
('deliveries.send_email','deliveries','Envio de notas','send_email','Enviar por e-mail','Enviar ou reenviar nota por e-mail.',51),
('deliveries.send_whatsapp','deliveries','Envio de notas','send_whatsapp','Enviar por WhatsApp','Preparar e confirmar envio manual por WhatsApp.',52),
('deliveries.send_agenda','deliveries','Envio de notas','send_agenda','Enviar pela Agenda Edu','Enviar notas pelo canal Agenda Edu.',53),
('settings.company.view','settings_company','Dados da Empresa','view','Visualizar','Acessar dados cadastrais e fiscais da empresa.',60),
('settings.company.edit','settings_company','Dados da Empresa','edit','Editar','Alterar dados cadastrais e fiscais da empresa.',61),
('settings.branding.view','settings_branding','Identidade Visual','view','Visualizar','Acessar a identidade visual do sistema.',70),
('settings.branding.edit','settings_branding','Identidade Visual','edit','Editar','Alterar logo e cores globais.',71),
('settings.certificate.view','settings_certificate','Certificado A1','view','Visualizar','Consultar certificado A1 e validade.',80),
('settings.certificate.manage','settings_certificate','Certificado A1','manage','Gerenciar','Anexar, substituir, excluir e guardar senha do certificado.',81),
('settings.integrations.view','settings_integrations','Integrações','view','Visualizar','Consultar e testar integrações.',90),
('settings.integrations.edit','settings_integrations','Integrações','edit','Configurar','Alterar e salvar integrações, credenciais e WhatsApps da escola.',91),
('settings.users.view','settings_users','Usuários e Permissões','view','Visualizar usuários','Consultar usuários, perfis e status.',100),
('settings.users.manage','settings_users','Usuários e Permissões','manage','Gerenciar usuários','Convidar, alterar perfil, ativar ou bloquear usuários.',101),
('audit.view','audit','Auditoria e Histórico','view','Visualizar','Consultar histórico de operações e integrações.',110)
on conflict(permission_key) do update set
 module_key=excluded.module_key,module_label=excluded.module_label,action_key=excluded.action_key,
 action_label=excluded.action_label,description=excluded.description,sort_order=excluded.sort_order;

insert into public.jpi_role_permissions(role,permission_key,allowed)
select roles.role,p.permission_key,
case
 when roles.role='admin' then
   p.permission_key = any(array[
    'dashboard.view','students.view','students.create','students.edit','students.delete',
    'payments.view','payments.create','payments.edit','payments.delete',
    'nfse.view','nfse.prepare','nfse.issue','nfse.cancel','nfse.delete','nfse.test_connection',
    'deliveries.view','deliveries.send_email','deliveries.send_whatsapp','deliveries.send_agenda',
    'settings.company.view','audit.view'])
 when roles.role='financeiro' then
   p.permission_key = any(array[
    'dashboard.view','students.view',
    'payments.view','payments.create','payments.edit','payments.delete',
    'nfse.view','nfse.prepare','nfse.issue','nfse.cancel','nfse.test_connection',
    'deliveries.view','deliveries.send_email','deliveries.send_whatsapp','deliveries.send_agenda',
    'audit.view'])
 when roles.role='secretaria' then
   p.permission_key = any(array[
    'dashboard.view','students.view','students.create','students.edit',
    'payments.view','deliveries.view','deliveries.send_agenda'])
 when roles.role='consulta' then
   p.permission_key = any(array[
    'dashboard.view','students.view','payments.view','nfse.view','deliveries.view'])
 else false
end
from (values('admin'),('financeiro'),('secretaria'),('consulta')) roles(role)
cross join public.jpi_permissions p
on conflict(role,permission_key) do nothing;

create or replace function private.has_jpi_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select case
    when private.current_jpi_raw_role()='master' then true
    when private.current_jpi_raw_role() is null then false
    else coalesce((
      select rp.allowed
      from public.jpi_role_permissions rp
      where rp.role=private.current_jpi_raw_role()
        and rp.permission_key=p_permission_key
      limit 1
    ),false)
  end;
$$;

create or replace function public.has_jpi_permission(p_permission_key text)
returns boolean
language sql
stable
security invoker
set search_path=''
as $$
 select private.has_jpi_permission(p_permission_key);
$$;

revoke all on function public.has_jpi_permission(text) from public,anon;
grant execute on function public.has_jpi_permission(text) to authenticated;

create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'role', private.current_jpi_raw_role(),
    'permissions',
      case when private.current_jpi_raw_role()='master'
        then coalesce((select jsonb_agg(p.permission_key order by p.sort_order,p.permission_key) from public.jpi_permissions p),'[]'::jsonb)
        else coalesce((
          select jsonb_agg(rp.permission_key order by p.sort_order,p.permission_key)
          from public.jpi_role_permissions rp
          join public.jpi_permissions p on p.permission_key=rp.permission_key
          where rp.role=private.current_jpi_raw_role() and rp.allowed=true
        ),'[]'::jsonb)
      end
  );
$$;

revoke all on function public.get_my_access() from public,anon;
grant execute on function public.get_my_access() to authenticated;

create or replace function public.set_role_permission(p_role text,p_permission_key text,p_allowed boolean)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null or private.current_jpi_raw_role()<>'master' then
    raise exception 'Apenas o Master pode alterar permissões dos perfis.' using errcode='42501';
  end if;
  if p_role not in ('admin','financeiro','secretaria','consulta') then
    raise exception 'Perfil inválido.' using errcode='22023';
  end if;
  if not exists(select 1 from public.jpi_permissions where permission_key=p_permission_key) then
    raise exception 'Permissão inválida.' using errcode='22023';
  end if;
  insert into public.jpi_role_permissions(role,permission_key,allowed,updated_at,updated_by)
  values(p_role,p_permission_key,p_allowed,now(),auth.uid())
  on conflict(role,permission_key) do update
    set allowed=excluded.allowed,updated_at=now(),updated_by=auth.uid();
  return true;
end;
$$;

revoke all on function public.set_role_permission(text,text,boolean) from public,anon;
grant execute on function public.set_role_permission(text,text,boolean) to authenticated;

create or replace function public.update_branding_settings(
 p_primary text,p_sidebar text,p_success text
) returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
 if auth.uid() is null or not private.has_jpi_permission('settings.branding.edit') then
   raise exception 'Usuário sem permissão para alterar a identidade visual.' using errcode='42501';
 end if;
 if p_primary !~ '^#[0-9A-Fa-f]{6}$' or p_sidebar !~ '^#[0-9A-Fa-f]{6}$' or p_success !~ '^#[0-9A-Fa-f]{6}$' then
   raise exception 'Cores inválidas.' using errcode='22023';
 end if;
 update public.configuracoes_empresa
 set tema_cor_primaria=upper(p_primary),
     tema_cor_lateral=upper(p_sidebar),
     tema_cor_sucesso=upper(p_success),
     branding_updated_at=now()
 where id=true;
 return found;
end;
$$;

revoke all on function public.update_branding_settings(text,text,text) from public,anon;
grant execute on function public.update_branding_settings(text,text,text) to authenticated;

drop policy if exists jpi_permissions_master_select on public.jpi_permissions;
create policy jpi_permissions_master_select on public.jpi_permissions
for select to authenticated using(private.current_jpi_raw_role()='master');

drop policy if exists jpi_role_permissions_master_select on public.jpi_role_permissions;
create policy jpi_role_permissions_master_select on public.jpi_role_permissions
for select to authenticated using(private.current_jpi_raw_role()='master');

drop policy if exists jpi_role_permissions_master_write on public.jpi_role_permissions;
create policy jpi_role_permissions_master_write on public.jpi_role_permissions
for all to authenticated
using(private.current_jpi_raw_role()='master')
with check(private.current_jpi_raw_role()='master');
