import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource=readFileSync(new URL("../app/api/integrations/communications/route.ts",import.meta.url),"utf8");
const uiSource=readFileSync(new URL("../components/pages.tsx",import.meta.url),"utf8");
const migrationSource=readFileSync(new URL("../supabase/migrations/20260826185725_configurar_integracoes_comunicacao.sql",import.meta.url),"utf8");
const locawebMigrationSource=readFileSync(new URL("../supabase/migrations/20260826203500_adicionar_smtp_locaweb.sql",import.meta.url),"utf8");
const smtpSource=readFileSync(new URL("../lib/smtp.ts",import.meta.url),"utf8");

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

test("permite configurar o E-mail Locaweb com conexão SMTP segura",()=>{
  assert.match(locawebMigrationSource,/locaweb_email/);
  assert.match(locawebMigrationSource,/email_smtp_host/);
  assert.match(apiSource,/email-ssl\.com\.br/);
  assert.match(apiSource,/sendSmtpEmail/);
  assert.match(smtpSource,/port!==465/);
  assert.match(smtpSource,/rejectUnauthorized:true/);
  assert.match(uiSource,/E-mail Locaweb/);
  assert.match(uiSource,/Porta 465 · SSL\/TLS/);
});

test("valida a Meta Cloud API sem disparar mensagem de WhatsApp",()=>{
  assert.match(apiSource,/graph\.facebook\.com/);
  assert.match(apiSource,/fields=display_phone_number,verified_name/);
  assert.doesNotMatch(apiSource,/\/messages/);
  assert.match(uiSource,/Salvar configuração do WhatsApp/);
  assert.match(uiSource,/Testar conexão sem enviar mensagem/);
  assert.match(apiSource,/whatsapp_test_recipient:testRecipient/);
  assert.match(apiSource,/número brasileiro interno para os testes/);
  assert.match(uiSource,/Número interno para homologação/);
  assert.match(uiSource,/testRecipient:whatsappTestRecipient/);
});

test("informa ao administrador que segredos não voltam ao navegador",()=>{
  assert.match(uiSource,/nunca voltam a ser exibidos no navegador/);
  assert.match(uiSource,/Credencial protegida — deixe vazio para manter/);
  assert.match(uiSource,/Token protegido — deixe vazio para manter/);
  assert.match(uiSource,/onClick=\{\(\)=>setCommunicationsOpen\(true\)\}/);
});
