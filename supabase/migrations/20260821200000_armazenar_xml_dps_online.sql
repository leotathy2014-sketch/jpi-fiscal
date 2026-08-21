alter table public.mensalidades
  add column if not exists dps_xml_path text,
  add column if not exists dps_xml_id text,
  add column if not exists dps_xml_gerado_em timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos-nfse',
  'documentos-nfse',
  false,
  1048576,
  array['application/xml', 'text/xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documentos_nfse_select_roles on storage.objects;
create policy documentos_nfse_select_roles
on storage.objects for select to authenticated
using (
  bucket_id = 'documentos-nfse'
  and (select private.current_jpi_role()) = any (array['admin', 'financeiro', 'secretaria', 'consulta'])
);

drop policy if exists documentos_nfse_insert_financeiro on storage.objects;
create policy documentos_nfse_insert_financeiro
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documentos-nfse'
  and (storage.foldername(name))[1] = 'dps'
  and (select private.current_jpi_role()) = any (array['admin', 'financeiro'])
);

drop policy if exists documentos_nfse_update_financeiro on storage.objects;
create policy documentos_nfse_update_financeiro
on storage.objects for update to authenticated
using (
  bucket_id = 'documentos-nfse'
  and (storage.foldername(name))[1] = 'dps'
  and (select private.current_jpi_role()) = any (array['admin', 'financeiro'])
)
with check (
  bucket_id = 'documentos-nfse'
  and (storage.foldername(name))[1] = 'dps'
  and (select private.current_jpi_role()) = any (array['admin', 'financeiro'])
);

drop policy if exists documentos_nfse_delete_financeiro on storage.objects;
create policy documentos_nfse_delete_financeiro
on storage.objects for delete to authenticated
using (
  bucket_id = 'documentos-nfse'
  and (storage.foldername(name))[1] = 'dps'
  and (select private.current_jpi_role()) = any (array['admin', 'financeiro'])
);
