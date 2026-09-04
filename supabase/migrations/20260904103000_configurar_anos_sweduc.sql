alter table public.sweduc_config
  add column if not exists anos_sincronizacao integer[] not null default array[]::integer[];

update public.sweduc_config
   set anos_sincronizacao = array[
     extract(year from now())::integer - 1,
     extract(year from now())::integer
   ]
 where id = true
   and coalesce(array_length(anos_sincronizacao, 1), 0) = 0;
