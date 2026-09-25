-- O perfil Consulta/básico deve permanecer estritamente em modo de leitura.
update public.jpi_role_permissions
set
  allowed = false,
  updated_at = now()
where role = 'consulta'
  and permission_key in (
    'nfse.prepare',
    'nfse.issue',
    'deliveries.send_whatsapp',
    'deliveries.send_agenda'
  );

update public.jpi_role_permissions
set
  allowed = true,
  updated_at = now()
where role = 'consulta'
  and permission_key in (
    'nfse.view',
    'deliveries.view'
  );
