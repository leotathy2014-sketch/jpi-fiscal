alter table public.configuracoes_empresa
  add column if not exists nfse_producao_habilitada boolean not null default false,
  add column if not exists nfse_producao_habilitada_em timestamptz;

comment on column public.configuracoes_empresa.nfse_producao_habilitada is
  'Indica se o envio fiscal real de NFS-e foi oficialmente liberado no JPI Fiscal. Deve permanecer false durante homologação.';
comment on column public.configuracoes_empresa.nfse_producao_habilitada_em is
  'Data/hora da liberação da emissão fiscal real.';

create or replace function public.get_nfse_operational_status()
returns table(
  production_enabled boolean,
  production_enabled_at timestamptz
)
language sql
security definer
set search_path=''
as $$
  select
    c.nfse_producao_habilitada,
    c.nfse_producao_habilitada_em
  from public.configuracoes_empresa c
  where c.id=true;
$$;

revoke all on function public.get_nfse_operational_status() from public,anon;
grant execute on function public.get_nfse_operational_status() to authenticated;

comment on function public.get_nfse_operational_status() is
  'Retorna somente o estado operacional da emissão real de NFS-e para a interface autenticada.';
