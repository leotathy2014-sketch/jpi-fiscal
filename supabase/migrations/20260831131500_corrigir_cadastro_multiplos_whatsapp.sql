create or replace function public.replace_whatsapp_manual_senders(p_senders jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  normalized text;
  sender_name text;
  sender_active boolean;
  sender_order integer;
  inserted_count integer := 0;
begin
  if auth.uid() is null or private.current_jpi_role() <> 'admin' then
    raise exception 'Apenas o Administrador pode configurar os números do WhatsApp.' using errcode = '42501';
  end if;

  if p_senders is null or jsonb_typeof(p_senders) <> 'array' or jsonb_array_length(p_senders) > 4 then
    raise exception 'Cadastre no máximo 4 números de WhatsApp.' using errcode = '22023';
  end if;

  delete from public.whatsapp_manual_senders
  where id is not null;

  for item in select value from jsonb_array_elements(p_senders)
  loop
    sender_name := trim(coalesce(item->>'nome',''));
    normalized := regexp_replace(coalesce(item->>'numero',''), '[^0-9]', '', 'g');
    if length(normalized) in (10,11) then
      normalized := '55' || normalized;
    end if;
    sender_active := coalesce((item->>'ativo')::boolean, true);
    sender_order := coalesce((item->>'ordem')::integer, inserted_count + 1);

    if length(sender_name) < 1 or length(sender_name) > 60 then
      raise exception 'Informe um nome válido para cada WhatsApp.' using errcode = '22023';
    end if;
    if normalized !~ '^55[1-9][0-9]{9,10}$' then
      raise exception 'Informe números brasileiros válidos com DDD.' using errcode = '22023';
    end if;
    if sender_order < 1 or sender_order > 4 then
      raise exception 'A ordem dos números do WhatsApp é inválida.' using errcode = '22023';
    end if;

    insert into public.whatsapp_manual_senders (nome, numero, ativo, ordem, updated_by)
    values (sender_name, normalized, sender_active, sender_order, auth.uid());
    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$$;
