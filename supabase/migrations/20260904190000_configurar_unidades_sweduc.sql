alter table public.sweduc_config
  add column if not exists unidades_sincronizacao text[] not null default array['JPI - Matriz']::text[];

update public.sweduc_config
   set unidades_sincronizacao = array['JPI - Matriz']::text[]
 where id = true
   and coalesce(array_length(unidades_sincronizacao, 1), 0) = 0;
