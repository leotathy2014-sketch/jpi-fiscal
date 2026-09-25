-- Libera as funções operacionais da NFS-e e seus canais de entrega
-- para todos os perfis cadastrados, mantendo protegidas as ações
-- administrativas, cancelamento, exclusão e teste de certificado.
update public.jpi_role_permissions
set
  allowed = true,
  updated_at = now()
where permission_key in (
  'nfse.view',
  'nfse.prepare',
  'nfse.issue',
  'deliveries.view',
  'deliveries.send_whatsapp',
  'deliveries.send_agenda'
);
