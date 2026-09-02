alter table public.app_users
  add column if not exists invite_resent_at timestamptz;

comment on column public.app_users.invite_resent_at is
  'Data e hora do último reenvio bem-sucedido do convite de acesso.';
