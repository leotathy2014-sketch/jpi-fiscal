import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource=readFileSync(new URL("../app/api/deliveries/email/route.ts",import.meta.url),"utf8");
const uiSource=readFileSync(new URL("../components/delivery-center.tsx",import.meta.url),"utf8");
const shellSource=readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
const migrationSource=readFileSync(new URL("../supabase/migrations/20260827024500_criar_central_entregas_email.sql",import.meta.url),"utf8");
const recipientMigrationSource=readFileSync(new URL("../supabase/migrations/20260827034251_atualizar_destinatario_homologacao_email.sql",import.meta.url),"utf8");

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
  assert.match(apiSource,/const AUTHORIZED_FROM="nfse@jejoaopaulo\.com\.br"/);
  assert.match(apiSource,/const TEST_RECIPIENT="administracao@jejoaopaulo\.com\.br"/);
  assert.match(apiSource,/to:\[TEST_RECIPIENT\]/);
  assert.match(apiSource,/destinatario_pretendido:intendedRecipient/);
  assert.match(apiSource,/destinatario_utilizado:TEST_RECIPIENT/);
  assert.match(uiSource,/As famílias não receberão documentos sem validade fiscal/);
  assert.match(recipientMigrationSource,/destinatario_utilizado = 'administracao@jejoaopaulo\.com\.br'/);
});

test("protege contra duplicidade e registra cada tentativa",()=>{
  assert.match(migrationSource,/request_id uuid not null unique/);
  assert.match(migrationSource,/where status = 'enviando'/);
  assert.match(apiSource,/eq\("request_id",requestId\)/);
  assert.match(apiSource,/status:"enviando"/);
  assert.match(apiSource,/status:"enviado"/);
  assert.match(apiSource,/status:"erro"/);
});

test("mostra somente pendentes e arquiva os sucessos em Enviadas",()=>{
  assert.match(uiSource,/useState\("pendente"\)/);
  assert.match(uiSource,/setStatusFilter\(batchMode==="resend"\?"enviado":"pendente"\)/);
  assert.match(uiSource,/<option value="enviado">Enviadas<\/option>/);
  assert.match(uiSource,/deliveryState\(row\)==="enviado"/);
});

test("permite reenvio individual com confirmação e histórico acumulado",()=>{
  assert.match(uiSource,/sentAttemptsByDocument/);
  assert.match(uiSource,/delivery\.status!=="enviado"/);
  assert.match(uiSource,/Reenviar por e-mail/);
  assert.match(uiSource,/Confirme o reenvio/);
  assert.match(uiSource,/sem apagar o histórico anterior/);
  assert.match(uiSource,/Enviada \{sentAttempts\.length\}/);
  assert.match(uiSource,/crypto\.randomUUID\(\)/);
});

test("mantém notas enviadas fora da seleção em lote",()=>{
  assert.match(uiSource,/deliveryState\(row\)!=="enviado"/);
  assert.match(uiSource,/state!=="enviado"/);
  assert.match(uiSource,/openResend\(row\)/);
});

test("mantém credenciais e XML exclusivamente no servidor",()=>{
  assert.match(apiSource,/get_communication_secret/);
  assert.match(apiSource,/storage\.from\(XML_BUCKET\)\.download/);
  assert.match(apiSource,/attachments:/);
  assert.match(apiSource,/contentType:"application\/pdf"/);
  assert.match(apiSource,/buildDanfsePdf/);
  assert.doesNotMatch(uiSource,/get_communication_secret/);
  assert.match(migrationSource,/enable row level security/);
  assert.match(migrationSource,/current_jpi_role/);
});
