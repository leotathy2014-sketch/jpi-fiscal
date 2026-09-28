create table if not exists public.system_announcements (
  id bigserial primary key,
  subject text not null,
  message_text text not null,
  recipients_count integer not null default 0,
  success_count integer not null default 0,
  error_count integer not null default 0,
  status text not null default 'enviado',
  sent_by integer references public.app_users(id) on delete set null,
  sent_by_email text,
  details jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.system_announcements enable row level security;

drop policy if exists "Master e administradores visualizam comunicados" on public.system_announcements;
create policy "Master e administradores visualizam comunicados" on public.system_announcements
for select to authenticated
using (
  (select public.has_jpi_permission('settings.users.manage'))
);

insert into public.jpi_permissions(permission_key,module_key,module_label,action_key,action_label,description,sort_order)
values
  ('system.announcements.send','system_announcements','Comunicados','send','Enviar comunicados','Enviar avisos e atualizações do sistema para todos os usuários ou usuários selecionados.',42)
on conflict(permission_key) do update set
  module_key=excluded.module_key,
  module_label=excluded.module_label,
  action_key=excluded.action_key,
  action_label=excluded.action_label,
  description=excluded.description,
  sort_order=excluded.sort_order;

insert into public.jpi_role_permissions(role,permission_key,allowed)
values
  ('admin','system.announcements.send',true),
  ('financeiro','system.announcements.send',false),
  ('secretaria','system.announcements.send',false),
  ('consulta','system.announcements.send',false)
on conflict(role,permission_key) do nothing;
