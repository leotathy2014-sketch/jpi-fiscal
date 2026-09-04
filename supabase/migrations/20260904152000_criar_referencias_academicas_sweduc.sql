create extension if not exists unaccent with schema extensions;

create table if not exists public.sweduc_referencias_academicas (
  id bigserial primary key,
  ano_letivo integer not null check (ano_letivo between 2020 and 2100),
  curso_id text,
  curso text not null,
  curso_normalizado text not null,
  serie_id text,
  serie text,
  serie_normalizada text not null default '',
  turma_id text,
  turma text,
  turma_normalizada text not null default '',
  ativo boolean not null default true,
  ultima_sincronizacao_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sweduc_referencias_academicas_curso_check check (length(trim(curso)) between 2 and 120),
  constraint sweduc_referencias_academicas_unique unique (ano_letivo,curso_normalizado,serie_normalizada,turma_normalizada)
);

create index if not exists sweduc_referencias_academicas_ano_idx
  on public.sweduc_referencias_academicas(ano_letivo);

create index if not exists sweduc_referencias_academicas_filtros_idx
  on public.sweduc_referencias_academicas(ano_letivo,curso_normalizado,serie_normalizada,turma_normalizada)
  where ativo;

alter table public.sweduc_referencias_academicas enable row level security;

drop policy if exists "Usuários autorizados consultam referências acadêmicas SWeduc" on public.sweduc_referencias_academicas;
create policy "Usuários autorizados consultam referências acadêmicas SWeduc"
  on public.sweduc_referencias_academicas
  for select
  to authenticated
  using (
    (select public.has_jpi_permission('settings.integrations.view')) or
    (select public.has_jpi_permission('settings.integrations.edit')) or
    (select public.has_jpi_permission('students.view')) or
    (select public.has_jpi_permission('students.create')) or
    (select public.has_jpi_permission('students.edit')) or
    (select public.has_jpi_permission('payments.create')) or
    (select public.has_jpi_permission('nfse.prepare'))
  );

drop policy if exists "Usuários autorizados sincronizam referências acadêmicas SWeduc" on public.sweduc_referencias_academicas;
create policy "Usuários autorizados sincronizam referências acadêmicas SWeduc"
  on public.sweduc_referencias_academicas
  for all
  to authenticated
  using ((select public.has_jpi_permission('settings.integrations.edit')))
  with check ((select public.has_jpi_permission('settings.integrations.edit')));

grant select on public.sweduc_referencias_academicas to authenticated;
grant insert,update,delete on public.sweduc_referencias_academicas to authenticated;
grant usage,select on sequence public.sweduc_referencias_academicas_id_seq to authenticated;

insert into public.sweduc_referencias_academicas (
  ano_letivo,
  curso,
  curso_normalizado,
  serie,
  serie_normalizada,
  turma,
  turma_normalizada,
  ativo,
  ultima_sincronizacao_em,
  updated_at
)
select distinct
  ano_letivo::integer,
  trim(curso),
  lower(regexp_replace(extensions.unaccent(trim(curso)),'[^a-zA-Z0-9]+',' ','g')),
  nullif(trim(coalesce(serie,'')),''),
  lower(regexp_replace(extensions.unaccent(trim(coalesce(serie,''))),'[^a-zA-Z0-9]+',' ','g')),
  nullif(trim(coalesce(turma,'')),''),
  lower(regexp_replace(extensions.unaccent(trim(coalesce(turma,''))),'[^a-zA-Z0-9]+',' ','g')),
  true,
  now(),
  now()
from public.sweduc_alunos
where ano_letivo ~ '^[0-9]{4}$'
  and nullif(trim(coalesce(curso,'')),'') is not null
on conflict (ano_letivo,curso_normalizado,serie_normalizada,turma_normalizada)
do update set
  curso=excluded.curso,
  serie=excluded.serie,
  turma=excluded.turma,
  ativo=true,
  ultima_sincronizacao_em=now(),
  updated_at=now();
