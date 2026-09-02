create index if not exists sweduc_config_updated_by_idx
  on public.sweduc_config(updated_by);

create index if not exists sweduc_secrets_updated_by_idx
  on private.sweduc_secrets(updated_by);

drop policy if exists "Usuários autorizados sincronizam alunos SWeduc"
  on public.sweduc_alunos;

create policy "Usuários autorizados inserem alunos SWeduc"
  on public.sweduc_alunos
  for insert
  to authenticated
  with check ((select public.has_jpi_permission('settings.integrations.edit')));

create policy "Usuários autorizados atualizam alunos SWeduc"
  on public.sweduc_alunos
  for update
  to authenticated
  using ((select public.has_jpi_permission('settings.integrations.edit')))
  with check ((select public.has_jpi_permission('settings.integrations.edit')));

create policy "Usuários autorizados removem alunos SWeduc"
  on public.sweduc_alunos
  for delete
  to authenticated
  using ((select public.has_jpi_permission('settings.integrations.edit')));
