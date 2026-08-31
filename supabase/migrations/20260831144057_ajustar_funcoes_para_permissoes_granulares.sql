create or replace function private.get_communication_secret_internal(p_channel text,p_backend_secret text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  stored_secret text;
  allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Usuário sem permissão para utilizar as comunicações.' using errcode='42501';
  end if;

  allowed := case p_channel
    when 'email' then private.has_jpi_permission('deliveries.send_email') or private.has_jpi_permission('settings.integrations.edit')
    when 'whatsapp' then private.has_jpi_permission('deliveries.send_whatsapp') or private.has_jpi_permission('settings.integrations.edit')
    when 'agenda_edu' then private.has_jpi_permission('deliveries.send_agenda') or private.has_jpi_permission('settings.integrations.edit')
    else false
  end;
  if not allowed then
    raise exception 'Usuário sem permissão para utilizar este canal.' using errcode='42501';
  end if;
  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode='42501';
  end if;
  select decrypted.decrypted_secret into stored_secret
  from private.comunicacao_secrets mapped
  join vault.decrypted_secrets decrypted on decrypted.id=mapped.vault_secret_id
  where mapped.canal=p_channel;
  if stored_secret is null then
    raise exception 'Credencial do canal ainda não configurada.' using errcode='P0002';
  end if;
  return stored_secret;
end;
$$;

create or replace function private.get_email_delivery_config_internal(p_backend_secret text)
returns table(email_provider text,email_from_name text,email_from_address text,email_reply_to text,email_smtp_host text,email_smtp_port integer,email_smtp_username text,email_credencial_configurada boolean,email_ultimo_status text)
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not private.has_jpi_permission('deliveries.send_email') then
  raise exception 'Usuário sem permissão para enviar documentos por e-mail.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna do servidor inválida.' using errcode='42501'; end if;
 return query select c.email_provider,c.email_from_name,c.email_from_address,c.email_reply_to,c.email_smtp_host,c.email_smtp_port,c.email_smtp_username,c.email_credencial_configurada,c.email_ultimo_status
 from public.integracoes_comunicacao c where c.id=true;
end;
$$;

create or replace function private.get_whatsapp_delivery_config_internal(p_backend_secret text)
returns table(whatsapp_phone_number_id text,whatsapp_business_account_id text,whatsapp_sender_number text,whatsapp_template_name text,whatsapp_test_recipient text,whatsapp_token_configurado boolean,whatsapp_ultimo_status text,whatsapp_manual_message_template text)
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not private.has_jpi_permission('deliveries.send_whatsapp') then
  raise exception 'Usuário sem permissão para enviar documentos por WhatsApp.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna do servidor inválida.' using errcode='42501'; end if;
 return query select c.whatsapp_phone_number_id,c.whatsapp_business_account_id,c.whatsapp_sender_number,c.whatsapp_template_name,c.whatsapp_test_recipient,c.whatsapp_token_configurado,c.whatsapp_ultimo_status,c.whatsapp_manual_message_template
 from public.integracoes_comunicacao c where c.id=true;
end;
$$;

create or replace function private.get_agenda_edu_delivery_config_internal(p_backend_secret text)
returns table(agenda_edu_channel_id text,agenda_edu_environment text,agenda_edu_credencial_configurada boolean,agenda_edu_ultimo_status text)
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not private.has_jpi_permission('deliveries.send_agenda') then
  raise exception 'Usuário sem permissão para enviar documentos pela Agenda Edu.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna do servidor inválida.' using errcode='42501'; end if;
 return query select c.agenda_edu_channel_id,c.agenda_edu_environment,c.agenda_edu_credencial_configurada,c.agenda_edu_ultimo_status
 from public.integracoes_comunicacao c where c.id=true;
end;
$$;

create or replace function private.get_certificate_password_internal(p_certificate_id uuid,p_backend_secret text)
returns text
language plpgsql security definer set search_path=''
as $$
declare stored_password text;
begin
 if auth.uid() is null or not (private.has_jpi_permission('nfse.issue') or private.has_jpi_permission('nfse.test_connection')) then
  raise exception 'Usuário sem permissão para utilizar o certificado.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna do servidor inválida.' using errcode='42501'; end if;
 select d.decrypted_secret into stored_password
 from private.certificado_a1_secrets m
 join vault.decrypted_secrets d on d.id=m.vault_secret_id
 join public.certificados_a1 c on c.id=m.certificado_id
 where m.certificado_id=p_certificate_id and c.status='ATIVO';
 if stored_password is null then raise exception 'Senha automática do certificado ainda não configurada.' using errcode='P0002'; end if;
 return stored_password;
end;
$$;

create or replace function private.store_certificate_password_internal(p_certificate_id uuid,p_password text,p_backend_secret text)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare current_secret_id uuid;
begin
 if auth.uid() is null or not private.has_jpi_permission('settings.certificate.manage') then
  raise exception 'Usuário sem permissão para guardar a senha do certificado.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna do servidor inválida.' using errcode='42501'; end if;
 if p_password is null or length(p_password)=0 or length(p_password)>256 then raise exception 'A senha do certificado é inválida.' using errcode='22023'; end if;
 perform 1 from public.certificados_a1 where id=p_certificate_id and status='ATIVO';
 if not found then raise exception 'Certificado A1 ativo não encontrado.' using errcode='P0002'; end if;
 select vault_secret_id into current_secret_id from private.certificado_a1_secrets where certificado_id=p_certificate_id;
 if current_secret_id is null then
  current_secret_id:=vault.create_secret(p_password,'jpi_certificado_a1_'||p_certificate_id::text,'Senha privada do certificado A1 do JPI Fiscal',null);
  insert into private.certificado_a1_secrets(certificado_id,vault_secret_id,updated_by) values(p_certificate_id,current_secret_id,auth.uid());
 else
  perform vault.update_secret(current_secret_id,p_password,'jpi_certificado_a1_'||p_certificate_id::text,'Senha privada do certificado A1 do JPI Fiscal',null);
  update private.certificado_a1_secrets set updated_at=now(),updated_by=auth.uid() where certificado_id=p_certificate_id;
 end if;
 update public.certificados_a1 set senha_configurada=true,senha_configurada_em=now() where id=p_certificate_id;
 return true;
end;
$$;

create or replace function private.store_communication_secret_internal(p_channel text,p_secret text,p_backend_secret text)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare current_secret_id uuid;
begin
 if auth.uid() is null or not private.has_jpi_permission('settings.integrations.edit') then
  raise exception 'Usuário sem permissão para guardar credenciais de comunicação.' using errcode='42501';
 end if;
 if not private.valid_jpi_backend_secret(p_backend_secret) then raise exception 'Credencial interna do servidor inválida.' using errcode='42501'; end if;
 if p_channel not in ('email','whatsapp','agenda_edu') then raise exception 'Canal de comunicação inválido.' using errcode='22023'; end if;
 if p_secret is null or length(p_secret)<(case when p_channel='email' then 6 else 20 end) or length(p_secret)>4096 then raise exception 'Credencial do provedor inválida.' using errcode='22023'; end if;
 select vault_secret_id into current_secret_id from private.comunicacao_secrets where canal=p_channel;
 if current_secret_id is null then
  current_secret_id:=vault.create_secret(p_secret,'jpi_comunicacao_'||p_channel,'Credencial privada da integração de '||p_channel||' do JPI Fiscal',null);
  insert into private.comunicacao_secrets(canal,vault_secret_id,updated_by) values(p_channel,current_secret_id,auth.uid());
 else
  perform vault.update_secret(current_secret_id,p_secret,'jpi_comunicacao_'||p_channel,'Credencial privada da integração de '||p_channel||' do JPI Fiscal',null);
  update private.comunicacao_secrets set updated_at=now(),updated_by=auth.uid() where canal=p_channel;
 end if;
 if p_channel='email' then
  update public.integracoes_comunicacao set email_api_key_configurada=true,email_credencial_configurada=true,email_configurada_em=now(),email_ultimo_status='pendente',updated_at=now(),updated_by=auth.uid() where id=true;
 elsif p_channel='whatsapp' then
  update public.integracoes_comunicacao set whatsapp_token_configurado=true,whatsapp_configurada_em=now(),whatsapp_ultimo_status='pendente',updated_at=now(),updated_by=auth.uid() where id=true;
 else
  update public.integracoes_comunicacao set agenda_edu_credencial_configurada=true,agenda_edu_configurada_em=now(),agenda_edu_ultimo_status='pendente',updated_at=now(),updated_by=auth.uid() where id=true;
 end if;
 return true;
end;
$$;

create or replace function private.get_delivery_dashboard_internal(p_start timestamptz default null,p_end timestamptz default null)
returns table(canal text,enviados bigint,erros bigint,aguardando bigint,ultima_atividade timestamptz)
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not private.has_jpi_permission('dashboard.view') then raise exception 'Usuário sem permissão para visualizar o painel.' using errcode='42501'; end if;
 return query
 select case when e.canal in('whatsapp','whatsapp_manual') then 'whatsapp' when e.canal='agenda_edu' then 'agenda_edu' else 'email' end,
 count(*) filter(where e.status='enviado'),count(*) filter(where e.status='erro'),count(*) filter(where e.status in('enviando','aguardando_confirmacao')),
 max(coalesce(e.enviado_em,e.updated_at,e.created_at))
 from public.nfse_entregas e
 where (p_start is null or e.created_at>=p_start) and (p_end is null or e.created_at<p_end)
 group by 1 order by 1;
end;
$$;

create or replace function private.is_allowed_delivery_recipient(p_channel text,p_recipient text)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare configured_test_recipient text;
begin
 if auth.uid() is null then return false; end if;
 if p_channel='email' then
  if not private.has_jpi_permission('deliveries.send_email') then return false; end if;
  return p_recipient='administracao@jejoaopaulo.com.br';
 end if;
 if p_channel in('whatsapp','whatsapp_manual') then
  if not private.has_jpi_permission('deliveries.send_whatsapp') then return false; end if;
  select c.whatsapp_test_recipient into configured_test_recipient from public.integracoes_comunicacao c where c.id=true;
  return p_recipient is not null and p_recipient ~ '^55[1-9][0-9]{9,10}$' and p_recipient=configured_test_recipient;
 end if;
 if p_channel='agenda_edu' then
  if not private.has_jpi_permission('deliveries.send_agenda') then return false; end if;
  return p_recipient is not null and p_recipient ~ '^sandbox:student:[A-Za-z0-9._-]{1,120}$';
 end if;
 return false;
end;
$$;

create or replace function public.replace_whatsapp_manual_senders(p_senders jsonb)
returns integer
language plpgsql set search_path=''
as $$
declare item jsonb;normalized text;sender_name text;sender_active boolean;sender_order integer;inserted_count integer:=0;
begin
 if auth.uid() is null or not private.has_jpi_permission('settings.integrations.edit') then raise exception 'Usuário sem permissão para configurar os números do WhatsApp.' using errcode='42501'; end if;
 if p_senders is null or jsonb_typeof(p_senders)<>'array' or jsonb_array_length(p_senders)>4 then raise exception 'Cadastre no máximo 4 números de WhatsApp.' using errcode='22023'; end if;
 delete from public.whatsapp_manual_senders where id is not null;
 for item in select value from jsonb_array_elements(p_senders) loop
  sender_name:=trim(coalesce(item->>'nome',''));normalized:=regexp_replace(coalesce(item->>'numero',''),'[^0-9]','','g');
  if length(normalized) in(10,11) then normalized:='55'||normalized; end if;
  sender_active:=coalesce((item->>'ativo')::boolean,true);sender_order:=coalesce((item->>'ordem')::integer,inserted_count+1);
  if length(sender_name)<1 or length(sender_name)>60 then raise exception 'Informe um nome válido para cada WhatsApp.' using errcode='22023'; end if;
  if normalized !~ '^55[1-9][0-9]{9,10}$' then raise exception 'Informe números brasileiros válidos com DDD.' using errcode='22023'; end if;
  if sender_order<1 or sender_order>4 then raise exception 'A ordem dos números do WhatsApp é inválida.' using errcode='22023'; end if;
  insert into public.whatsapp_manual_senders(nome,numero,ativo,ordem,updated_by) values(sender_name,normalized,sender_active,sender_order,auth.uid());
  inserted_count:=inserted_count+1;
 end loop;
 return inserted_count;
end;
$$;