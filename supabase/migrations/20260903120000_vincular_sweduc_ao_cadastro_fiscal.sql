alter table public.alunos
  add column if not exists sweduc_matricula_id bigint,
  add column if not exists sweduc_aluno_id bigint,
  add column if not exists sweduc_ano_letivo text,
  add column if not exists sweduc_atualizado_em timestamptz;

create unique index if not exists alunos_sweduc_matricula_id_unique
  on public.alunos(sweduc_matricula_id)
  where sweduc_matricula_id is not null;

create index if not exists alunos_sweduc_ano_letivo_idx
  on public.alunos(sweduc_ano_letivo)
  where sweduc_ano_letivo is not null;
