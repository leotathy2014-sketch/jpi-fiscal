-- Alunos
drop policy if exists alunos_select on public.alunos;
drop policy if exists alunos_insert on public.alunos;
drop policy if exists alunos_update on public.alunos;
drop policy if exists alunos_delete on public.alunos;
create policy alunos_select on public.alunos for select to authenticated using(private.has_jpi_permission('students.view'));
create policy alunos_insert on public.alunos for insert to authenticated with check(private.has_jpi_permission('students.create'));
create policy alunos_update on public.alunos for update to authenticated using(private.has_jpi_permission('students.edit')) with check(private.has_jpi_permission('students.edit'));
create policy alunos_delete on public.alunos for delete to authenticated using(private.has_jpi_permission('students.delete'));

-- Mensalidades
drop policy if exists mensalidades_select on public.mensalidades;
drop policy if exists mensalidades_insert on public.mensalidades;
drop policy if exists mensalidades_update on public.mensalidades;
drop policy if exists mensalidades_delete on public.mensalidades;
create policy mensalidades_select on public.mensalidades for select to authenticated using(private.has_jpi_permission('payments.view'));
create policy mensalidades_insert on public.mensalidades for insert to authenticated with check(private.has_jpi_permission('payments.create'));
create policy mensalidades_update on public.mensalidades for update to authenticated using(private.has_jpi_permission('payments.edit')) with check(private.has_jpi_permission('payments.edit'));
create policy mensalidades_delete on public.mensalidades for delete to authenticated using(private.has_jpi_permission('payments.delete'));

-- Usuários
drop policy if exists app_users_select on public.app_users;
drop policy if exists app_users_insert on public.app_users;
drop policy if exists app_users_update on public.app_users;
drop policy if exists app_users_delete on public.app_users;
create policy app_users_select on public.app_users for select to authenticated
using(lower(email)=lower(auth.jwt()->>'email') or private.has_jpi_permission('settings.users.view') or private.has_jpi_permission('settings.users.manage'));
create policy app_users_insert on public.app_users for insert to authenticated with check(private.has_jpi_permission('settings.users.manage'));
create policy app_users_update on public.app_users for update to authenticated using(private.has_jpi_permission('settings.users.manage')) with check(private.has_jpi_permission('settings.users.manage'));
create policy app_users_delete on public.app_users for delete to authenticated using(private.has_jpi_permission('settings.users.manage'));

-- Empresa
drop policy if exists configuracoes_empresa_select on public.configuracoes_empresa;
drop policy if exists configuracoes_empresa_insert on public.configuracoes_empresa;
drop policy if exists configuracoes_empresa_update on public.configuracoes_empresa;
create policy configuracoes_empresa_select on public.configuracoes_empresa for select to authenticated
using(private.has_jpi_permission('settings.company.view') or private.has_jpi_permission('settings.company.edit'));
create policy configuracoes_empresa_insert on public.configuracoes_empresa for insert to authenticated
with check(private.has_jpi_permission('settings.company.edit'));
create policy configuracoes_empresa_update on public.configuracoes_empresa for update to authenticated
using(private.has_jpi_permission('settings.company.edit')) with check(private.has_jpi_permission('settings.company.edit'));

-- Certificado
drop policy if exists certificado_a1_alerta_select_authorized on public.certificado_a1_alerta;
drop policy if exists certificado_a1_alerta_insert_admin on public.certificado_a1_alerta;
drop policy if exists certificado_a1_alerta_update_admin on public.certificado_a1_alerta;
drop policy if exists certificado_a1_alerta_delete_admin on public.certificado_a1_alerta;
create policy certificado_a1_alerta_select_authorized on public.certificado_a1_alerta for select to authenticated
using(private.has_jpi_permission('settings.certificate.view') or private.has_jpi_permission('settings.certificate.manage'));
create policy certificado_a1_alerta_insert_admin on public.certificado_a1_alerta for insert to authenticated
with check(private.has_jpi_permission('settings.certificate.manage'));
create policy certificado_a1_alerta_update_admin on public.certificado_a1_alerta for update to authenticated
using(private.has_jpi_permission('settings.certificate.manage')) with check(private.has_jpi_permission('settings.certificate.manage'));
create policy certificado_a1_alerta_delete_admin on public.certificado_a1_alerta for delete to authenticated
using(private.has_jpi_permission('settings.certificate.manage'));

drop policy if exists certificados_a1_select_admin on public.certificados_a1;
drop policy if exists certificados_a1_insert_admin on public.certificados_a1;
drop policy if exists certificados_a1_update_admin on public.certificados_a1;
drop policy if exists certificados_a1_delete_admin on public.certificados_a1;
create policy certificados_a1_select_admin on public.certificados_a1 for select to authenticated
using(private.has_jpi_permission('settings.certificate.view') or private.has_jpi_permission('settings.certificate.manage') or private.has_jpi_permission('nfse.issue') or private.has_jpi_permission('nfse.test_connection'));
create policy certificados_a1_insert_admin on public.certificados_a1 for insert to authenticated
with check(private.has_jpi_permission('settings.certificate.manage') and enviado_por=auth.uid());
create policy certificados_a1_update_admin on public.certificados_a1 for update to authenticated
using(private.has_jpi_permission('settings.certificate.manage')) with check(private.has_jpi_permission('settings.certificate.manage'));
create policy certificados_a1_delete_admin on public.certificados_a1 for delete to authenticated
using(private.has_jpi_permission('settings.certificate.manage'));

-- Integrações
drop policy if exists "Administrador visualiza integrações" on public.integracoes_comunicacao;
drop policy if exists "Administrador atualiza integrações" on public.integracoes_comunicacao;
create policy "Perfis autorizados visualizam integrações" on public.integracoes_comunicacao for select to authenticated
using(private.has_jpi_permission('settings.integrations.view') or private.has_jpi_permission('settings.integrations.edit'));
create policy "Perfis autorizados atualizam integrações" on public.integracoes_comunicacao for update to authenticated
using(private.has_jpi_permission('settings.integrations.edit')) with check(private.has_jpi_permission('settings.integrations.edit'));

drop policy if exists integracoes_admin_all on public.integracoes;
create policy integracoes_permission_all on public.integracoes for all to authenticated
using(private.has_jpi_permission('settings.integrations.edit'))
with check(private.has_jpi_permission('settings.integrations.edit'));

drop policy if exists eventos_select on public.eventos_integracao;
drop policy if exists eventos_admin_write on public.eventos_integracao;
create policy eventos_permission_select on public.eventos_integracao for select to authenticated
using(private.has_jpi_permission('settings.integrations.view') or private.has_jpi_permission('audit.view'));
create policy eventos_permission_write on public.eventos_integracao for all to authenticated
using(private.has_jpi_permission('settings.integrations.edit'))
with check(private.has_jpi_permission('settings.integrations.edit'));

drop policy if exists admin_read_configuracoes_integracao on public.configuracoes_integracao;
drop policy if exists admin_manage_configuracoes_integracao on public.configuracoes_integracao;
create policy configuracoes_integracao_permission_read on public.configuracoes_integracao for select to authenticated
using(private.has_jpi_permission('settings.integrations.view') or private.has_jpi_permission('settings.integrations.edit'));
create policy configuracoes_integracao_permission_manage on public.configuracoes_integracao for all to authenticated
using(private.has_jpi_permission('settings.integrations.edit'))
with check(private.has_jpi_permission('settings.integrations.edit'));

-- NFS-e e histórico
drop policy if exists historico_select on public.historico_nfse;
drop policy if exists historico_write on public.historico_nfse;
create policy historico_permission_select on public.historico_nfse for select to authenticated
using(private.has_jpi_permission('nfse.view') or private.has_jpi_permission('audit.view'));
create policy historico_permission_write on public.historico_nfse for all to authenticated
using(private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue') or private.has_jpi_permission('nfse.cancel'))
with check(private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue') or private.has_jpi_permission('nfse.cancel'));

drop policy if exists nfse_documentos_hml_select on public.nfse_documentos_homologacao;
drop policy if exists nfse_documentos_hml_insert on public.nfse_documentos_homologacao;
drop policy if exists nfse_documentos_hml_update on public.nfse_documentos_homologacao;
drop policy if exists nfse_documentos_hml_delete on public.nfse_documentos_homologacao;
create policy nfse_documentos_hml_select on public.nfse_documentos_homologacao for select to authenticated
using(private.has_jpi_permission('nfse.view') or private.has_jpi_permission('deliveries.view'));
create policy nfse_documentos_hml_insert on public.nfse_documentos_homologacao for insert to authenticated
with check(private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue'));
create policy nfse_documentos_hml_update on public.nfse_documentos_homologacao for update to authenticated
using(private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue') or private.has_jpi_permission('nfse.cancel'))
with check(private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue') or private.has_jpi_permission('nfse.cancel'));
create policy nfse_documentos_hml_delete on public.nfse_documentos_homologacao for delete to authenticated
using(private.has_jpi_permission('nfse.delete'));

-- Central de envios
drop policy if exists "Perfis fiscais visualizam entregas" on public.nfse_entregas;
drop policy if exists "Perfis fiscais registram entregas" on public.nfse_entregas;
drop policy if exists "Perfis fiscais atualizam entregas" on public.nfse_entregas;
create policy "Permissões visualizam entregas" on public.nfse_entregas for select to authenticated
using(private.has_jpi_permission('deliveries.view'));
create policy "Permissões registram entregas" on public.nfse_entregas for insert to authenticated
with check(
 created_by=auth.uid() and ambiente='homologacao'
 and (
   (canal='email' and private.has_jpi_permission('deliveries.send_email'))
   or (canal in ('whatsapp','whatsapp_manual') and private.has_jpi_permission('deliveries.send_whatsapp'))
   or (canal='agenda_edu' and private.has_jpi_permission('deliveries.send_agenda'))
 )
 and private.is_allowed_delivery_recipient(canal,destinatario_utilizado)
);
create policy "Permissões atualizam entregas" on public.nfse_entregas for update to authenticated
using(
 created_by=auth.uid()
 and (
   (canal='email' and private.has_jpi_permission('deliveries.send_email'))
   or (canal in ('whatsapp','whatsapp_manual') and private.has_jpi_permission('deliveries.send_whatsapp'))
   or (canal='agenda_edu' and private.has_jpi_permission('deliveries.send_agenda'))
 )
)
with check(
 created_by=auth.uid() and ambiente='homologacao'
 and (
   (canal='email' and private.has_jpi_permission('deliveries.send_email'))
   or (canal in ('whatsapp','whatsapp_manual') and private.has_jpi_permission('deliveries.send_whatsapp'))
   or (canal='agenda_edu' and private.has_jpi_permission('deliveries.send_agenda'))
 )
 and private.is_allowed_delivery_recipient(canal,destinatario_utilizado)
);

-- WhatsApps da escola
drop policy if exists "Perfis fiscais visualizam remetentes WhatsApp" on public.whatsapp_manual_senders;
drop policy if exists "Administrador cadastra remetentes WhatsApp" on public.whatsapp_manual_senders;
drop policy if exists "Administrador atualiza remetentes WhatsApp" on public.whatsapp_manual_senders;
drop policy if exists "Administrador remove remetentes WhatsApp" on public.whatsapp_manual_senders;
create policy "Permissões visualizam remetentes WhatsApp" on public.whatsapp_manual_senders for select to authenticated
using(private.has_jpi_permission('deliveries.send_whatsapp') or private.has_jpi_permission('settings.integrations.view') or private.has_jpi_permission('settings.integrations.edit'));
create policy "Permissões cadastram remetentes WhatsApp" on public.whatsapp_manual_senders for insert to authenticated
with check(private.has_jpi_permission('settings.integrations.edit'));
create policy "Permissões atualizam remetentes WhatsApp" on public.whatsapp_manual_senders for update to authenticated
using(private.has_jpi_permission('settings.integrations.edit')) with check(private.has_jpi_permission('settings.integrations.edit'));
create policy "Permissões removem remetentes WhatsApp" on public.whatsapp_manual_senders for delete to authenticated
using(private.has_jpi_permission('settings.integrations.edit'));

-- Storage: logo
drop policy if exists logo_empresa_insert_admin on storage.objects;
drop policy if exists logo_empresa_select_admin on storage.objects;
drop policy if exists logo_empresa_update_admin on storage.objects;
create policy logo_empresa_select_permission on storage.objects for select to authenticated
using(bucket_id='logos-empresa' and name='empresa/logo' and (private.has_jpi_permission('settings.branding.view') or private.has_jpi_permission('settings.branding.edit')));
create policy logo_empresa_insert_permission on storage.objects for insert to authenticated
with check(bucket_id='logos-empresa' and name='empresa/logo' and private.has_jpi_permission('settings.branding.edit'));
create policy logo_empresa_update_permission on storage.objects for update to authenticated
using(bucket_id='logos-empresa' and name='empresa/logo' and private.has_jpi_permission('settings.branding.edit'))
with check(bucket_id='logos-empresa' and name='empresa/logo' and private.has_jpi_permission('settings.branding.edit'));

-- Storage: certificado
drop policy if exists certificados_a1_storage_select_admin on storage.objects;
drop policy if exists certificados_a1_storage_insert_admin on storage.objects;
drop policy if exists certificados_a1_storage_update_admin on storage.objects;
drop policy if exists certificados_a1_storage_delete_admin on storage.objects;
create policy certificados_a1_storage_select_permission on storage.objects for select to authenticated
using(bucket_id='certificados-a1' and (private.has_jpi_permission('settings.certificate.view') or private.has_jpi_permission('settings.certificate.manage') or private.has_jpi_permission('nfse.issue') or private.has_jpi_permission('nfse.test_connection')));
create policy certificados_a1_storage_insert_permission on storage.objects for insert to authenticated
with check(bucket_id='certificados-a1' and (storage.foldername(name))[1]='certificado-a1' and private.has_jpi_permission('settings.certificate.manage'));
create policy certificados_a1_storage_update_permission on storage.objects for update to authenticated
using(bucket_id='certificados-a1' and private.has_jpi_permission('settings.certificate.manage'))
with check(bucket_id='certificados-a1' and private.has_jpi_permission('settings.certificate.manage'));
create policy certificados_a1_storage_delete_permission on storage.objects for delete to authenticated
using(bucket_id='certificados-a1' and private.has_jpi_permission('settings.certificate.manage'));

-- Storage: documentos
drop policy if exists documentos_nfse_select_roles on storage.objects;
drop policy if exists documentos_nfse_insert_financeiro on storage.objects;
drop policy if exists documentos_nfse_update_financeiro on storage.objects;
drop policy if exists documentos_nfse_delete_financeiro on storage.objects;
create policy documentos_nfse_select_permission on storage.objects for select to authenticated
using(bucket_id='documentos-nfse' and (private.has_jpi_permission('nfse.view') or private.has_jpi_permission('deliveries.view')));
create policy documentos_nfse_insert_permission on storage.objects for insert to authenticated
with check(bucket_id='documentos-nfse' and (storage.foldername(name))[1]='dps' and (private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue')));
create policy documentos_nfse_update_permission on storage.objects for update to authenticated
using(bucket_id='documentos-nfse' and (storage.foldername(name))[1]='dps' and (private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue')))
with check(bucket_id='documentos-nfse' and (storage.foldername(name))[1]='dps' and (private.has_jpi_permission('nfse.prepare') or private.has_jpi_permission('nfse.issue')));
create policy documentos_nfse_delete_permission on storage.objects for delete to authenticated
using(bucket_id='documentos-nfse' and (storage.foldername(name))[1]='dps' and private.has_jpi_permission('nfse.delete'));