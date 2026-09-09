alter table public.integracoes_comunicacao
  add column if not exists agenda_edu_sincronizada_em timestamptz,
  add column if not exists agenda_edu_total_alunos integer not null default 0,
  add column if not exists agenda_edu_total_turmas integer not null default 0,
  add column if not exists agenda_edu_total_responsaveis integer not null default 0;

create table if not exists public.agenda_edu_turmas (
  id text primary key,
  nome text not null,
  external_id text,
  legacy_id text,
  status text,
  dados_origem jsonb not null default '{}'::jsonb,
  sincronizado_em timestamptz not null default now()
);

create table if not exists public.agenda_edu_alunos (
  id text primary key,
  nome text not null,
  external_id text,
  legacy_id text,
  turma_principal_id text,
  periodo text,
  status text,
  status_vinculo text,
  data_nascimento date,
  dados_origem jsonb not null default '{}'::jsonb,
  sincronizado_em timestamptz not null default now()
);

create table if not exists public.agenda_edu_responsaveis (
  id text primary key,
  nome text not null,
  external_id text,
  legacy_id text,
  email text,
  telefone text,
  documento text,
  parentesco text,
  financeiro boolean not null default false,
  status text,
  status_vinculo text,
  dados_origem jsonb not null default '{}'::jsonb,
  sincronizado_em timestamptz not null default now()
);

create table if not exists public.agenda_edu_aluno_responsaveis (
  aluno_id text not null references public.agenda_edu_alunos(id) on delete cascade,
  responsavel_id text not null references public.agenda_edu_responsaveis(id) on delete cascade,
  financeiro boolean not null default false,
  parentesco text,
  dados_origem jsonb not null default '{}'::jsonb,
  sincronizado_em timestamptz not null default now(),
  primary key (aluno_id,responsavel_id)
);

create index if not exists agenda_edu_turmas_nome_idx on public.agenda_edu_turmas using gin (to_tsvector('portuguese',nome));
create index if not exists agenda_edu_alunos_nome_idx on public.agenda_edu_alunos using gin (to_tsvector('portuguese',nome));
create index if not exists agenda_edu_alunos_turma_idx on public.agenda_edu_alunos(turma_principal_id);
create index if not exists agenda_edu_alunos_external_idx on public.agenda_edu_alunos(external_id);
create index if not exists agenda_edu_responsaveis_nome_idx on public.agenda_edu_responsaveis using gin (to_tsvector('portuguese',nome));

alter table public.agenda_edu_turmas enable row level security;
alter table public.agenda_edu_alunos enable row level security;
alter table public.agenda_edu_responsaveis enable row level security;
alter table public.agenda_edu_aluno_responsaveis enable row level security;

drop policy if exists "Usuários autorizados consultam turmas Agenda Edu" on public.agenda_edu_turmas;
create policy "Usuários autorizados consultam turmas Agenda Edu" on public.agenda_edu_turmas
  for select to authenticated
  using (
    (select public.has_jpi_permission('settings.integrations.view')) or
    (select public.has_jpi_permission('settings.integrations.edit')) or
    (select public.has_jpi_permission('deliveries.send_agenda'))
  );

drop policy if exists "Usuários autorizados sincronizam turmas Agenda Edu" on public.agenda_edu_turmas;
create policy "Usuários autorizados sincronizam turmas Agenda Edu" on public.agenda_edu_turmas
  for all to authenticated
  using ((select public.has_jpi_permission('settings.integrations.edit')))
  with check ((select public.has_jpi_permission('settings.integrations.edit')));

drop policy if exists "Usuários autorizados consultam alunos Agenda Edu" on public.agenda_edu_alunos;
create policy "Usuários autorizados consultam alunos Agenda Edu" on public.agenda_edu_alunos
  for select to authenticated
  using (
    (select public.has_jpi_permission('settings.integrations.view')) or
    (select public.has_jpi_permission('settings.integrations.edit')) or
    (select public.has_jpi_permission('deliveries.send_agenda'))
  );

drop policy if exists "Usuários autorizados sincronizam alunos Agenda Edu" on public.agenda_edu_alunos;
create policy "Usuários autorizados sincronizam alunos Agenda Edu" on public.agenda_edu_alunos
  for all to authenticated
  using ((select public.has_jpi_permission('settings.integrations.edit')))
  with check ((select public.has_jpi_permission('settings.integrations.edit')));

drop policy if exists "Usuários autorizados consultam responsáveis Agenda Edu" on public.agenda_edu_responsaveis;
create policy "Usuários autorizados consultam responsáveis Agenda Edu" on public.agenda_edu_responsaveis
  for select to authenticated
  using (
    (select public.has_jpi_permission('settings.integrations.view')) or
    (select public.has_jpi_permission('settings.integrations.edit')) or
    (select public.has_jpi_permission('deliveries.send_agenda'))
  );

drop policy if exists "Usuários autorizados sincronizam responsáveis Agenda Edu" on public.agenda_edu_responsaveis;
create policy "Usuários autorizados sincronizam responsáveis Agenda Edu" on public.agenda_edu_responsaveis
  for all to authenticated
  using ((select public.has_jpi_permission('settings.integrations.edit')))
  with check ((select public.has_jpi_permission('settings.integrations.edit')));

drop policy if exists "Usuários autorizados consultam vínculos Agenda Edu" on public.agenda_edu_aluno_responsaveis;
create policy "Usuários autorizados consultam vínculos Agenda Edu" on public.agenda_edu_aluno_responsaveis
  for select to authenticated
  using (
    (select public.has_jpi_permission('settings.integrations.view')) or
    (select public.has_jpi_permission('settings.integrations.edit')) or
    (select public.has_jpi_permission('deliveries.send_agenda'))
  );

drop policy if exists "Usuários autorizados sincronizam vínculos Agenda Edu" on public.agenda_edu_aluno_responsaveis;
create policy "Usuários autorizados sincronizam vínculos Agenda Edu" on public.agenda_edu_aluno_responsaveis
  for all to authenticated
  using ((select public.has_jpi_permission('settings.integrations.edit')))
  with check ((select public.has_jpi_permission('settings.integrations.edit')));

grant select on public.agenda_edu_turmas,public.agenda_edu_alunos,public.agenda_edu_responsaveis,public.agenda_edu_aluno_responsaveis to authenticated;
grant insert,update,delete on public.agenda_edu_turmas,public.agenda_edu_alunos,public.agenda_edu_responsaveis,public.agenda_edu_aluno_responsaveis to authenticated;
