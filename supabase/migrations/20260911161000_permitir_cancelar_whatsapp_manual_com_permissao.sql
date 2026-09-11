create or replace function private.revoke_nfse_delivery_access_internal(p_delivery_id bigint,p_backend_secret text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
 if auth.uid() is null or not private.has_jpi_permission('deliveries.send_whatsapp') then
  raise exception 'Usuário sem permissão para revogar o acesso à nota.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then
  raise exception 'Credencial interna do servidor inválida.' using errcode='42501';
 end if;
 if not exists(
  select 1 from public.nfse_entregas e
  where e.id=p_delivery_id and e.canal='whatsapp_manual' and e.ambiente='homologacao'
 ) then
  raise exception 'Entrega protegida não encontrada.' using errcode='42501';
 end if;
 delete from private.nfse_entrega_links where entrega_id=p_delivery_id;
 return true;
end;
$$;

revoke all on function private.revoke_nfse_delivery_access_internal(bigint,text) from public, anon;
grant execute on function private.revoke_nfse_delivery_access_internal(bigint,text) to authenticated;
