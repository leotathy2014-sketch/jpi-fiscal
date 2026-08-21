alter table public.mensalidades
  add column if not exists dps_assinada_xml_path text,
  add column if not exists nfse_homologacao_xml_path text,
  add column if not exists chave_nfse_homologacao text,
  add column if not exists homologacao_emitida_em timestamptz;

comment on column public.mensalidades.dps_assinada_xml_path is
  'Caminho privado do XML da DPS assinado no bucket documentos-nfse.';
comment on column public.mensalidades.nfse_homologacao_xml_path is
  'Caminho privado do XML da NFS-e gerada na produção restrita.';
comment on column public.mensalidades.chave_nfse_homologacao is
  'Chave de acesso retornada exclusivamente pela produção restrita.';
comment on column public.mensalidades.homologacao_emitida_em is
  'Data e hora da emissão de teste na produção restrita.';
