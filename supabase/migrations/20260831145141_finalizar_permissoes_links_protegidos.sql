create or replace function private.create_nfse_delivery_access_internal(
 p_delivery_id bigint,p_token_hash text,p_xml_base64 text,p_chave_acesso text,p_backend_secret text
)
returns timestamptz
language plpgsql
security definer
set search_path=''
as $$
declare
 expiry timestamptz;
 decoded_xml bytea;
 delivery_channel text;
begin
 if auth.uid() is null then
  raise exception 'Usuário sem permissão para criar acesso à nota.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then
  raise exception 'Credencial interna do servidor inválida.' using errcode='42501';
 end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_xml_base64 is null or length(p_xml_base64)>14000000
    or p_chave_acesso is null or length(p_chave_acesso)>80 then
  raise exception 'Dados do acesso protegido inválidos.' using errcode='22023';
 end if;
 select decode(p_xml_base64,'base64') into decoded_xml;
 if octet_length(decoded_xml) not between 1 and 10485760 then
  raise exception 'Documento fora do limite permitido.' using errcode='22023';
 end if;
 select e.canal into delivery_channel
 from public.nfse_entregas e
 where e.id=p_delivery_id
   and e.created_by=auth.uid()
   and e.canal in('agenda_edu','whatsapp_manual')
   and e.ambiente='homologacao';
 if delivery_channel is null then
  raise exception 'Entrega protegida não encontrada.' using errcode='42501';
 end if;
 if delivery_channel='whatsapp_manual' and not private.has_jpi_permission('deliveries.send_whatsapp') then
  raise exception 'Usuário sem permissão para criar acesso de WhatsApp.' using errcode='42501';
 end if;
 if delivery_channel='agenda_edu' and not private.has_jpi_permission('deliveries.send_agenda') then
  raise exception 'Usuário sem permissão para criar acesso da Agenda Edu.' using errcode='42501';
 end if;
 expiry:=now()+case when delivery_channel='whatsapp_manual' then interval '30 days' else interval '365 days' end;
 insert into private.nfse_entrega_links(entrega_id,token_hash,chave_acesso,xml_content,expires_at)
 values(p_delivery_id,p_token_hash,p_chave_acesso,decoded_xml,expiry)
 on conflict(entrega_id) do update set
  token_hash=excluded.token_hash,chave_acesso=excluded.chave_acesso,xml_content=excluded.xml_content,expires_at=excluded.expires_at;
 return expiry;
end;
$$;

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
  where e.id=p_delivery_id and e.created_by=auth.uid() and e.canal='whatsapp_manual' and e.ambiente='homologacao'
 ) then
  raise exception 'Entrega protegida não encontrada.' using errcode='42501';
 end if;
 delete from private.nfse_entrega_links where entrega_id=p_delivery_id;
 return found;
end;
$$;