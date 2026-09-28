alter table public.app_users
  add column if not exists cpf text;

comment on column public.app_users.cpf is
  'CPF do usuário/funcionário usado no cadastro interno e assinaturas de declarações.';
