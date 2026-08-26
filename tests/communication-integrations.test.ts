import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource=readFileSync(new URL("../app/api/integrations/communications/route.ts",import.meta.url),"utf8");
const uiSource=readFileSync(new URL("../components/pages.tsx",import.meta.url),"utf8");
const migrationSource=readFileSync(new URL("../supabase/migrations/20260826185725_configurar_integracoes_comunicacao.sql",import.meta.url),"utf8");

test("protege as credenciais de comunicação no Vault e restringe a configuração ao administrador",()=>{
  assert.match(migrationSource,/vault\.create_secret/);
  assert.match(migrationSource,/vault\.decrypted_secrets/);
  assert.match(migrationSource,/current_jpi_role\(\) <> 'admin'/);
  assert.match(migrationSource,/revoke all on table private\.comunicacao_secrets from public, anon, authenticated/);
  assert.match(apiSource,/access\.role!=="admin"/);
  assert.doesNotMatch(apiSource,/service_role/);
});

test("permite salvar e testar Resend sem enviar documento fiscal",()=>{
  assert.match(apiSource,/https:\/\/api\.resend\.com\/emails/);
  assert.match(apiSource,/Nenhuma NFS-e foi anexada ou enviada neste teste/);
  assert.match(apiSource,/store_communication_secret/);
  assert.match(uiSource,/Salvar configuração de e-mail/);
  assert.match(uiSource,/Enviar e-mail de teste/);
  assert.match(uiSource,/nfse@jejoaopaulo\.com\.br/);
});

test("valida a Meta Cloud API sem disparar mensagem de WhatsApp",()=>{
  assert.match(apiSource,/graph\.facebook\.com/);
  assert.match(apiSource,/fields=display_phone_number,verified_name/);
  assert.doesNotMatch(apiSource,/\/messages/);
  assert.match(uiSource,/Salvar configuração do WhatsApp/);
  assert.match(uiSource,/Testar conexão sem enviar mensagem/);
});

test("informa ao administrador que segredos não voltam ao navegador",()=>{
  assert.match(uiSource,/nunca voltam a ser exibidos no navegador/);
  assert.match(uiSource,/Chave protegida — deixe vazio para manter/);
  assert.match(uiSource,/Token protegido — deixe vazio para manter/);
  assert.match(uiSource,/onClick=\{\(\)=>setCommunicationsOpen\(true\)\}/);
});
