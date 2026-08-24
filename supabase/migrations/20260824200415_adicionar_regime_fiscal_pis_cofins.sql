alter table public.configuracoes_empresa
  add column if not exists regime_tributario text not null default 'LUCRO PRESUMIDO',
  add column if not exists pis_aliquota numeric(5, 2) not null default 0.65,
  add column if not exists cofins_aliquota numeric(5, 2) not null default 3.00,
  add column if not exists pis_cofins_cst text not null default '01',
  add column if not exists pis_cofins_retencao smallint not null default 0;

do $$
begin
  alter table public.configuracoes_empresa
    add constraint configuracoes_empresa_regime_tributario_check
      check (regime_tributario = 'LUCRO PRESUMIDO');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.configuracoes_empresa
    add constraint configuracoes_empresa_pis_aliquota_check
      check (pis_aliquota between 0 and 100);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.configuracoes_empresa
    add constraint configuracoes_empresa_cofins_aliquota_check
      check (cofins_aliquota between 0 and 100);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.configuracoes_empresa
    add constraint configuracoes_empresa_pis_cofins_cst_check
      check (pis_cofins_cst ~ '^[0-9]{2}$');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.configuracoes_empresa
    add constraint configuracoes_empresa_pis_cofins_retencao_check
      check (pis_cofins_retencao between 0 and 9);
exception when duplicate_object then null;
end $$;

update public.configuracoes_empresa
set regime_tributario = 'LUCRO PRESUMIDO',
    pis_aliquota = 0.65,
    cofins_aliquota = 3.00,
    pis_cofins_cst = '01',
    pis_cofins_retencao = 0,
    updated_at = now()
where id = true;

comment on column public.configuracoes_empresa.regime_tributario is
  'Regime tributário confirmado pela empresa para emissão fiscal.';
comment on column public.configuracoes_empresa.pis_aliquota is
  'Alíquota percentual de PIS para débito de apuração própria.';
comment on column public.configuracoes_empresa.cofins_aliquota is
  'Alíquota percentual de COFINS para débito de apuração própria.';
comment on column public.configuracoes_empresa.pis_cofins_cst is
  'CST do PIS/COFINS informado na DPS.';
comment on column public.configuracoes_empresa.pis_cofins_retencao is
  'Tipo de retenção de PIS/COFINS conforme domínio da DPS.';

