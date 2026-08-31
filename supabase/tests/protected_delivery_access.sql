-- Executa as definições instaladas em tabelas temporárias com dados fictícios.
-- Não consulta documentos, não usa credenciais reais e não registra visualizações reais.
-- Execute pelo SQL Editor/MCP depois de aplicar as migrações.
begin;
set local statement_timeout = '10s';

create temporary table nfse_entrega_links (
  id bigint primary key,
  entrega_id bigint not null,
  token_hash text not null,
  chave_acesso text not null,
  xml_content bytea not null,
  expires_at timestamptz not null,
  visualizado_em timestamptz,
  ultimo_acesso_em timestamptz,
  visualizacoes integer not null default 0
);
create temporary table nfse_entregas (
  id bigint primary key,
  mensalidade_id bigint not null,
  visualizado_em timestamptz,
  visualizacoes integer not null default 0,
  updated_at timestamptz
);
create temporary table mensalidades (id bigint primary key, competencia text);

create function pg_temp.valid_jpi_backend_secret(p_secret text)
returns boolean language sql as $$ select p_secret is not distinct from 'fixture-only'; $$;

do $$
declare
  function_name text;
  fixture_definition text;
begin
  foreach function_name in array array[
    'inspect_nfse_delivery_access_internal',
    'open_nfse_delivery_access_internal',
    'read_nfse_delivery_access_internal'
  ] loop
    fixture_definition := pg_get_functiondef(('private.' || function_name || '(text,text)')::regprocedure);
    fixture_definition := replace(fixture_definition,'private.' || function_name,'pg_temp.' || function_name);
    fixture_definition := replace(fixture_definition,'private.valid_jpi_backend_secret','pg_temp.valid_jpi_backend_secret');
    fixture_definition := replace(fixture_definition,'private.nfse_entrega_links','pg_temp.nfse_entrega_links');
    fixture_definition := replace(fixture_definition,'public.nfse_entregas','pg_temp.nfse_entregas');
    fixture_definition := replace(fixture_definition,'public.mensalidades','pg_temp.mensalidades');
    if position('private.' in fixture_definition)>0 or position('public.' in fixture_definition)>0 then
      raise exception 'O teste não pode acessar tabelas ou funções de produção.';
    end if;
    execute fixture_definition;
  end loop;
end;
$$;

insert into pg_temp.mensalidades values (1,'08/2026');
insert into pg_temp.nfse_entregas(id,mensalidade_id) values (1,1),(2,1);
insert into pg_temp.nfse_entrega_links(id,entrega_id,token_hash,chave_acesso,xml_content,expires_at)
values
  (1,1,repeat('a',64),repeat('3',50),convert_to('<NFSe>fixture-only</NFSe>','UTF8'),now()+interval '30 days'),
  (2,2,repeat('b',64),repeat('4',50),convert_to('<NFSe>expired-fixture</NFSe>','UTF8'),now()-interval '1 day');

do $$
declare
  opened record;
  row_count integer;
  first_view timestamptz;
  function_name text;
begin
  if not (select i.valid from pg_temp.inspect_nfse_delivery_access_internal(repeat('a',64),'fixture-only') i) then
    raise exception 'Um link vigente deve passar na consulta inicial.';
  end if;
  select count(*) into row_count from pg_temp.read_nfse_delivery_access_internal(repeat('a',64),'fixture-only');
  if row_count<>0 then raise exception 'O XML não pode ser lido antes da abertura.'; end if;

  select * into opened from pg_temp.open_nfse_delivery_access_internal(repeat('a',64),'fixture-only');
  if not found then raise exception 'A abertura de um link vigente deve retornar o documento.'; end if;
  if opened.chave_acesso<>repeat('3',50)
    or convert_from(decode(opened.xml_base64,'base64'),'UTF8')<>'<NFSe>fixture-only</NFSe>'
    or opened.expires_at<=now() then
    raise exception 'A abertura deve retornar a chave, o XML e a validade corretos.';
  end if;
  if (select l.visualizacoes from pg_temp.nfse_entrega_links l where l.id=1)<>1
    or (select e.visualizacoes from pg_temp.nfse_entregas e where e.id=1)<>1 then
    raise exception 'A abertura deve incrementar uma única visualização em cada histórico.';
  end if;
  select count(*) into row_count from pg_temp.read_nfse_delivery_access_internal(repeat('a',64),'fixture-only');
  if row_count<>1 then raise exception 'O documento deve ficar disponível após a abertura.'; end if;

  first_view := now()-interval '5 minutes';
  update pg_temp.nfse_entrega_links set visualizado_em=first_view where id=1;
  update pg_temp.nfse_entregas set visualizado_em=first_view where id=1;
  perform * from pg_temp.open_nfse_delivery_access_internal(repeat('a',64),'fixture-only');
  if (select l.visualizado_em from pg_temp.nfse_entrega_links l where l.id=1)<>first_view
    or (select e.visualizado_em from pg_temp.nfse_entregas e where e.id=1)<>first_view
    or (select l.visualizacoes from pg_temp.nfse_entrega_links l where l.id=1)<>2 then
    raise exception 'A reabertura deve preservar a primeira visualização e contar o novo acesso.';
  end if;

  if (select i.valid from pg_temp.inspect_nfse_delivery_access_internal(repeat('b',64),'fixture-only') i) then
    raise exception 'Um link vencido não pode ser considerado vigente.';
  end if;
  select count(*) into row_count from pg_temp.open_nfse_delivery_access_internal(repeat('b',64),'fixture-only');
  if row_count<>0 then raise exception 'Um link vencido não pode ser aberto.'; end if;
  select count(*) into row_count from pg_temp.open_nfse_delivery_access_internal(repeat('c',64),'fixture-only');
  if row_count<>0 then raise exception 'Um link inexistente não pode ser aberto.'; end if;
  if (select l.visualizacoes from pg_temp.nfse_entrega_links l where l.id=2)<>0 then
    raise exception 'A tentativa com link vencido não deve contabilizar visualização.';
  end if;

  delete from pg_temp.nfse_entrega_links where id=1;
  select count(*) into row_count from pg_temp.open_nfse_delivery_access_internal(repeat('a',64),'fixture-only');
  if row_count<>0 then raise exception 'Um link revogado não pode ser aberto.'; end if;
  select count(*) into row_count from pg_temp.read_nfse_delivery_access_internal(repeat('a',64),'fixture-only');
  if row_count<>0 then raise exception 'Um link revogado não pode liberar o documento.'; end if;

  foreach function_name in array array[
    'inspect_nfse_delivery_access_internal',
    'open_nfse_delivery_access_internal',
    'read_nfse_delivery_access_internal'
  ] loop
    begin
      execute format('select * from pg_temp.%I($1,$2)',function_name) using repeat('a',64),'invalid-fixture';
      raise exception 'Uma credencial inválida não pode liberar o documento.';
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end;
$$;
rollback;
select true as tests_passed, 'Somente dados fictícios; transação descartada.' as isolation;
