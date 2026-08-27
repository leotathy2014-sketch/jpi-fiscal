drop policy if exists "Perfis fiscais registram entregas" on public.nfse_entregas;
create policy "Perfis fiscais registram entregas"
on public.nfse_entregas for insert
to authenticated
with check (
  (select private.current_jpi_role()) = any (array['admin'::text,'financeiro'::text])
  and created_by = (select auth.uid())
  and ambiente = 'homologacao'
  and destinatario_utilizado = 'administracao@jejoaopaulo.com.br'
);

drop policy if exists "Perfis fiscais atualizam entregas" on public.nfse_entregas;
create policy "Perfis fiscais atualizam entregas"
on public.nfse_entregas for update
to authenticated
using (
  (select private.current_jpi_role()) = any (array['admin'::text,'financeiro'::text])
  and created_by = (select auth.uid())
)
with check (
  (select private.current_jpi_role()) = any (array['admin'::text,'financeiro'::text])
  and created_by = (select auth.uid())
  and ambiente = 'homologacao'
  and destinatario_utilizado = 'administracao@jejoaopaulo.com.br'
);
