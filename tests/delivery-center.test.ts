import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource=readFileSync(new URL("../app/api/deliveries/email/route.ts",import.meta.url),"utf8");
const uiSource=readFileSync(new URL("../components/delivery-center.tsx",import.meta.url),"utf8");
const shellSource=readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
const migrationSource=readFileSync(new URL("../supabase/migrations/20260827024500_criar_central_entregas_email.sql",import.meta.url),"utf8");

test("cria Enviar notas no menu fiscal",()=>{
  assert.match(shellSource,/\|"Enviar notas"/);
  assert.match(shellSource,/<DeliveryCenter role=\{role\} accessToken=\{accessToken\} onNavigate=\{onPageChange\}/);
  assert.match(uiSource,/<h1>Enviar notas<\/h1>/);
  assert.match(uiSource,/Enviar selecionadas/);
  assert.match(uiSource,/Repetir pendentes/);
});

test("organiza os envios por e-mail, WhatsApp e Agenda Edu",()=>{
  assert.match(uiSource,/Enviar por e-mail/);
  assert.match(uiSource,/WhatsApp/);
  assert.match(uiSource,/Agenda Edu/);
  assert.match(uiSource,/Meta Cloud API/);
  assert.match(uiSource,/acesso oficial à integração/);
});

test("impede que homologações sejam enviadas aos responsáveis",()=>{
  assert.match(apiSource,/const TEST_RECIPIENT="nfse@jejoaopaulo\.com\.br"/);
  assert.match(apiSource,/to:\[TEST_RECIPIENT\]/);
  assert.match(apiSource,/destinatario_pretendido:intendedRecipient/);
  assert.match(apiSource,/destinatario_utilizado:TEST_RECIPIENT/);
  assert.match(uiSource,/As famílias não receberão documentos sem validade fiscal/);
});

test("protege contra duplicidade e registra cada tentativa",()=>{
  assert.match(migrationSource,/request_id uuid not null unique/);
  assert.match(migrationSource,/where status = 'enviando'/);
  assert.match(apiSource,/eq\("request_id",requestId\)/);
  assert.match(apiSource,/status:"enviando"/);
  assert.match(apiSource,/status:"enviado"/);
  assert.match(apiSource,/status:"erro"/);
});

test("mantém credenciais e XML exclusivamente no servidor",()=>{
  assert.match(apiSource,/get_communication_secret/);
  assert.match(apiSource,/storage\.from\(XML_BUCKET\)\.download/);
  assert.match(apiSource,/attachments:/);
  assert.doesNotMatch(uiSource,/get_communication_secret/);
  assert.match(migrationSource,/enable row level security/);
  assert.match(migrationSource,/current_jpi_role/);
});
