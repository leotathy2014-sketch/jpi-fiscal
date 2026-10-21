alter table public.sweduc_alunos
  add column if not exists ativo boolean not null default true,
  add column if not exists ultima_presenca_em timestamptz,
  add column if not exists inativado_em timestamptz;

update public.sweduc_alunos
set
  ativo = case
    when (
      (lower(extensions.unaccent(coalesce(status,''))) like '%matric%' or lower(extensions.unaccent(coalesce(status,''))) like '%ativ%')
      and lower(extensions.unaccent(coalesce(status,''))) not like '%inativ%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%cancel%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%encerr%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%transfer%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%desist%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%exclu%'
    ) then true
    else false
  end,
  ultima_presenca_em = case
    when (
      (lower(extensions.unaccent(coalesce(status,''))) like '%matric%' or lower(extensions.unaccent(coalesce(status,''))) like '%ativ%')
      and lower(extensions.unaccent(coalesce(status,''))) not like '%inativ%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%cancel%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%encerr%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%transfer%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%desist%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%exclu%'
    ) then coalesce(ultima_presenca_em,sincronizado_em)
    else ultima_presenca_em
  end,
  inativado_em = case
    when (
      (lower(extensions.unaccent(coalesce(status,''))) like '%matric%' or lower(extensions.unaccent(coalesce(status,''))) like '%ativ%')
      and lower(extensions.unaccent(coalesce(status,''))) not like '%inativ%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%cancel%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%encerr%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%transfer%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%desist%'
      and lower(extensions.unaccent(coalesce(status,''))) not like '%exclu%'
    ) then null
    else coalesce(inativado_em,sincronizado_em,now())
  end;

create index if not exists sweduc_alunos_ativos_busca_idx
  on public.sweduc_alunos(ano_letivo,unidade,nome)
  where ativo;

comment on column public.sweduc_alunos.ativo is
  'Indica se a matrícula continua presente entre as matrículas ativas retornadas pela SWeduc.';
comment on column public.sweduc_alunos.ultima_presenca_em is
  'Última sincronização completa em que a matrícula foi confirmada como ativa na SWeduc.';
comment on column public.sweduc_alunos.inativado_em is
  'Momento em que a matrícula deixou de aparecer como ativa na SWeduc, preservando o histórico fiscal.';
