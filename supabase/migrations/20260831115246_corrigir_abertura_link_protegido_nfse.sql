-- Corrige a abertura do link protegido qualificando todas as colunas da tabela.
-- Em funções RETURNS TABLE, os nomes das colunas de saída também são variáveis
-- PL/pgSQL; por isso, referências sem alias podem gerar erro de ambiguidade.
create or replace function private.open_nfse_delivery_access_internal(p_token_hash text,p_backend_secret text)
returns table(chave_acesso text,xml_base64 text,expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected private.nfse_entrega_links%rowtype;
  opened_at timestamptz := now();
begin
  if not private.valid_jpi_backend_secret(p_backend_secret) then
    raise exception 'Credencial interna do servidor inválida.' using errcode = '42501';
  end if;

  select l.* into selected
  from private.nfse_entrega_links as l
  where l.token_hash = p_token_hash
    and l.expires_at > opened_at
  for update of l;

  if not found then return; end if;

  update private.nfse_entrega_links as l set
    visualizado_em=coalesce(l.visualizado_em,opened_at),
    ultimo_acesso_em=opened_at,
    visualizacoes=l.visualizacoes+1
  where l.id=selected.id;

  update public.nfse_entregas as e set
    visualizado_em=coalesce(e.visualizado_em,opened_at),
    visualizacoes=e.visualizacoes+1,
    updated_at=opened_at
  where e.id=selected.entrega_id;

  return query
  select selected.chave_acesso,encode(selected.xml_content,'base64'),selected.expires_at;
end;
$$;

revoke all on function private.open_nfse_delivery_access_internal(text,text) from public, authenticated;
grant execute on function private.open_nfse_delivery_access_internal(text,text) to anon;
