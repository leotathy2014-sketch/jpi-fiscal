-- Permite que o link público invoque somente as funções protegidas da NFS-e.
-- Nenhuma tabela, sequência ou permissão de criação do schema privado é exposta.
grant usage on schema private to anon;
revoke create on schema private from anon;

revoke all on all tables in schema private from anon;
revoke all on all sequences in schema private from anon;
revoke execute on all functions in schema private from anon;

grant execute on function private.inspect_nfse_delivery_access_internal(text,text) to anon;
grant execute on function private.open_nfse_delivery_access_internal(text,text) to anon;
grant execute on function private.read_nfse_delivery_access_internal(text,text) to anon;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon;

comment on schema private is
  'Dados internos do JPI Fiscal; anon possui apenas USAGE para invocar as três funções protegidas de entrega da NFS-e.';
