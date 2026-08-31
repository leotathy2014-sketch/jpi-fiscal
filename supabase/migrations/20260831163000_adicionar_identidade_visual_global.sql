alter table public.configuracoes_empresa
  add column if not exists tema_cor_primaria text not null default '#1466DF',
  add column if not exists tema_cor_lateral text not null default '#14263D',
  add column if not exists tema_cor_sucesso text not null default '#16875F',
  add column if not exists branding_updated_at timestamptz not null default now();

alter table public.configuracoes_empresa
  drop constraint if exists configuracoes_empresa_tema_cor_primaria_check,
  drop constraint if exists configuracoes_empresa_tema_cor_lateral_check,
  drop constraint if exists configuracoes_empresa_tema_cor_sucesso_check;

alter table public.configuracoes_empresa
  add constraint configuracoes_empresa_tema_cor_primaria_check check (tema_cor_primaria ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint configuracoes_empresa_tema_cor_lateral_check check (tema_cor_lateral ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint configuracoes_empresa_tema_cor_sucesso_check check (tema_cor_sucesso ~ '^#[0-9A-Fa-f]{6}$');

create or replace function public.get_public_branding()
returns table(
  primary_color text,
  sidebar_color text,
  success_color text,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    c.tema_cor_primaria,
    c.tema_cor_lateral,
    c.tema_cor_sucesso,
    c.branding_updated_at
  from public.configuracoes_empresa c
  where c.id = true;
$$;

revoke all on function public.get_public_branding() from public;
grant execute on function public.get_public_branding() to anon, authenticated, service_role;

comment on function public.get_public_branding() is
  'Retorna somente dados públicos de identidade visual usados inclusive na tela de login.';
comment on column public.configuracoes_empresa.tema_cor_primaria is
  'Cor principal global do JPI Fiscal em hexadecimal.';
comment on column public.configuracoes_empresa.tema_cor_lateral is
  'Cor do menu lateral e áreas escuras da identidade visual.';
comment on column public.configuracoes_empresa.tema_cor_sucesso is
  'Cor de destaque positivo e WhatsApp do tema.';
