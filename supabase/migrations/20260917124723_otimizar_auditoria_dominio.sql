create index if not exists domain_settings_updated_by_idx
  on public.domain_settings(updated_by);

create index if not exists domain_change_history_created_by_idx
  on public.domain_change_history(created_by);

create index if not exists domain_change_history_created_at_idx
  on public.domain_change_history(created_at desc);
