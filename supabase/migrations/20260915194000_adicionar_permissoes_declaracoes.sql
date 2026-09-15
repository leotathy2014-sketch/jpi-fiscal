insert into public.jpi_permissions(permission_key,module_key,module_label,action_key,action_label,description,sort_order)
values
  ('declarations.view','declarations','Declarações','view','Visualizar','Acessar o módulo de declarações e carregar dados necessários para gerar declarações.',35),
  ('declarations.manage','declarations','Declarações','manage','Configurar','Configurar modelos, textos, logos e assinantes das declarações.',36),
  ('system.status.view','system_status','Status do Sistema','view','Visualizar status','Visualizar disponibilidade da SEFIN e validade do certificado no topo do sistema.',5)
on conflict(permission_key) do update set
  module_key=excluded.module_key,
  module_label=excluded.module_label,
  action_key=excluded.action_key,
  action_label=excluded.action_label,
  description=excluded.description,
  sort_order=excluded.sort_order;

insert into public.jpi_role_permissions(role,permission_key,allowed)
values
  ('admin','declarations.view',true),
  ('financeiro','declarations.view',true),
  ('secretaria','declarations.view',true),
  ('consulta','declarations.view',true),
  ('admin','declarations.manage',false),
  ('financeiro','declarations.manage',false),
  ('secretaria','declarations.manage',false),
  ('consulta','declarations.manage',false),
  ('admin','system.status.view',true),
  ('financeiro','system.status.view',true),
  ('secretaria','system.status.view',true),
  ('consulta','system.status.view',true)
on conflict(role,permission_key) do nothing;

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
  (select public.has_jpi_permission('nfse.prepare')) or
  (select public.has_jpi_permission('declarations.view'))
);

drop policy if exists certificado_a1_alerta_select_authorized on public.certificado_a1_alerta;
create policy certificado_a1_alerta_select_authorized on public.certificado_a1_alerta
for select to authenticated
using (
  private.has_jpi_permission('settings.certificate.view') or
  private.has_jpi_permission('settings.certificate.manage') or
  private.has_jpi_permission('system.status.view')
);
