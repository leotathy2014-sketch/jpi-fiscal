import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deliveryApiSource=readFileSync(new URL("../app/api/deliveries/agenda-edu/route.ts",import.meta.url),"utf8");
const communicationsApiSource=readFileSync(new URL("../app/api/integrations/communications/route.ts",import.meta.url),"utf8");
const deliveryUiSource=readFileSync(new URL("../components/delivery-center.tsx",import.meta.url),"utf8");
const settingsUiSource=readFileSync(new URL("../components/pages.tsx",import.meta.url),"utf8");
const studentLinksSource=readFileSync(new URL("../components/agenda-edu-student-links.tsx",import.meta.url),"utf8");
const migrationSource=readFileSync(new URL("../supabase/migrations/20260827171000_preparar_integracao_agenda_edu.sql",import.meta.url),"utf8");
const agendaClientSource=readFileSync(new URL("../lib/agenda-edu.ts",import.meta.url),"utf8");

test("envia pelo módulo Mensagens com os responsáveis somente no Sandbox",()=>{
  assert.match(deliveryApiSource,/agenda_edu_environment!=="homologacao"/);
  assert.match(deliveryApiSource,/resolveAgendaEduFamilyChat/);
  assert.match(deliveryApiSource,/sendAgendaEduAttachment/);
  assert.match(deliveryApiSource,/providerIds\.pdf/);
  assert.match(deliveryApiSource,/providerIds\.xml/);
  assert.match(deliveryApiSource,/duas mensagens/);
});

test("protege a rota e separa credenciais, documentos e destinatário",()=>{
  assert.match(deliveryApiSource,/supabase\.auth\.getUser\(token\)/);
  assert.match(deliveryApiSource,/get_communication_secret/);
  assert.match(deliveryApiSource,/documentos-nfse/);
  assert.match(deliveryApiSource,/sandbox:student:/);
  assert.doesNotMatch(deliveryUiSource,/clientSecret/);
});

test("prepara vínculo por aluno, histórico duplo e políticas RLS",()=>{
  assert.match(migrationSource,/agenda_edu_student_id text/);
  assert.match(migrationSource,/agenda_edu_use_external_id boolean/);
  assert.match(migrationSource,/provider_message_ids jsonb/);
  assert.match(migrationSource,/p_channel = 'agenda_edu'/);
  assert.match(migrationSource,/\^sandbox:student:/);
  assert.match(migrationSource,/get_agenda_edu_delivery_config/);
});

test("oferece configuração e vínculo administrativo sem expor segredos",()=>{
  assert.match(settingsUiSource,/Mensagens com os responsáveis/);
  assert.match(settingsUiSource,/Salvar configuração da Agenda Edu/);
  assert.match(settingsUiSource,/Client ID/);
  assert.match(settingsUiSource,/Client Secret/);
  assert.match(settingsUiSource,/X-School-Token/);
  assert.match(communicationsApiSource,/store_communication_secret/);
  assert.match(studentLinksSource,/Vincular alunos à Agenda Edu/);
  assert.match(studentLinksSource,/agenda_edu_student_id/);
});

test("oferece lote, histórico e reenvio no canal Agenda Edu",()=>{
  assert.match(deliveryUiSource,/\/api\/deliveries\/agenda-edu/);
  assert.match(deliveryUiSource,/Mensagens com os responsáveis/);
  assert.match(deliveryUiSource,/Enviar selecionadas/);
  assert.match(deliveryUiSource,/Reenviar pelo/);
  assert.match(deliveryUiSource,/sentAttemptsByDocument/);
});

test("usa os endpoints e o contrato oficial da Agenda Edu v2",()=>{
  assert.match(agendaClientSource,/https:\/\/sandbox-api\.agendaedu\.dev\/v2/);
  assert.match(agendaClientSource,/grant_type:"client_credentials"/);
  assert.match(agendaClientSource,/"x-school-token"/);
  assert.match(agendaClientSource,/kind:"family"/);
  assert.match(agendaClientSource,/chatIds\[\]/);
  assert.match(agendaClientSource,/form\.append\("attachment"/);
});

test("não promete leitura inexistente na API pública de Mensagens",()=>{
  assert.match(migrationSource,/não documenta confirmação de leitura/);
  assert.doesNotMatch(deliveryApiSource,/status:"lido"/);
  assert.doesNotMatch(deliveryApiSource,/seenAt|confirmedAt/);
});
