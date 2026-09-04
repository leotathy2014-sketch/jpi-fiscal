alter table public.alunos
  drop constraint if exists alunos_segmento_check;

alter table public.alunos
  add constraint alunos_segmento_check
  check (
    segmento is not null
    and length(trim(segmento)) between 2 and 80
  );
