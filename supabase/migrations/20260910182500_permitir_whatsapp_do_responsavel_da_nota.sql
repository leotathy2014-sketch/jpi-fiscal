create or replace function private.is_allowed_whatsapp_recipient_for_payment(
  p_recipient text,
  p_mensalidade_id bigint
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  stored_phone text;
  normalized_phone text;
begin
  if auth.uid() is null
     or private.current_jpi_role() not in ('admin','financeiro') then
    return false;
  end if;

  select regexp_replace(coalesce(a.whatsapp, ''), '\D', '', 'g')
    into stored_phone
  from public.mensalidades m
  join public.alunos a on a.id = m.aluno_id
  where m.id = p_mensalidade_id;

  normalized_phone := case
    when length(stored_phone) in (10, 11) then '55' || stored_phone
    else stored_phone
  end;

  return p_recipient is not null
    and p_recipient ~ '^55[1-9][0-9]{9,10}$'
    and p_recipient = normalized_phone;
end;
$$;

revoke all on function private.is_allowed_whatsapp_recipient_for_payment(text, bigint) from public, anon;
grant execute on function private.is_allowed_whatsapp_recipient_for_payment(text, bigint) to authenticated;

drop policy if exists "Permissões registram entregas" on public.nfse_entregas;
create policy "Permissões registram entregas" on public.nfse_entregas for insert to authenticated
with check(
 created_by = auth.uid() and ambiente = 'homologacao'
 and (
   (canal = 'email' and private.has_jpi_permission('deliveries.send_email'))
   or (canal in ('whatsapp','whatsapp_manual') and private.has_jpi_permission('deliveries.send_whatsapp'))
   or (canal = 'agenda_edu' and private.has_jpi_permission('deliveries.send_agenda'))
 )
 and (
   private.is_allowed_delivery_recipient(canal, destinatario_utilizado)
   or (
     canal in ('whatsapp','whatsapp_manual')
     and private.is_allowed_whatsapp_recipient_for_payment(destinatario_utilizado, mensalidade_id)
   )
 )
);

drop policy if exists "Permissões atualizam entregas" on public.nfse_entregas;
create policy "Permissões atualizam entregas" on public.nfse_entregas for update to authenticated
using(
 created_by = auth.uid()
 and (
   (canal = 'email' and private.has_jpi_permission('deliveries.send_email'))
   or (canal in ('whatsapp','whatsapp_manual') and private.has_jpi_permission('deliveries.send_whatsapp'))
   or (canal = 'agenda_edu' and private.has_jpi_permission('deliveries.send_agenda'))
 )
)
with check(
 created_by = auth.uid() and ambiente = 'homologacao'
 and (
   (canal = 'email' and private.has_jpi_permission('deliveries.send_email'))
   or (canal in ('whatsapp','whatsapp_manual') and private.has_jpi_permission('deliveries.send_whatsapp'))
   or (canal = 'agenda_edu' and private.has_jpi_permission('deliveries.send_agenda'))
 )
 and (
   private.is_allowed_delivery_recipient(canal, destinatario_utilizado)
   or (
     canal in ('whatsapp','whatsapp_manual')
     and private.is_allowed_whatsapp_recipient_for_payment(destinatario_utilizado, mensalidade_id)
   )
 )
);
