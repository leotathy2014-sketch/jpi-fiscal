create index if not exists sweduc_alunos_busca_operacional_idx
  on public.sweduc_alunos(ano_letivo, unidade, curso, serie, turma, nome);

create index if not exists sweduc_alunos_matricula_numero_idx
  on public.sweduc_alunos(numero_matricula);
