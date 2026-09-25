import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deliveryApiSource=readFileSync(new URL("../app/api/deliveries/agenda-edu/route.ts",import.meta.url),"utf8");
const deliveryUiSource=readFileSync(new URL("../components/delivery-center.tsx",import.meta.url),"utf8");
const accessMigrationSource=readFileSync(new URL("../supabase/migrations/20260828184500_registrar_visualizacao_nfse_agenda_edu.sql",import.meta.url),"utf8");
const permissionMigrationSource=readFileSync(new URL("../supabase/migrations/20260925103410_liberar_envios_secretaria_sem_vinculo_agenda.sql",import.meta.url),"utf8");
const protectedPageSource=readFileSync(new URL("../app/nota/[token]/protected-note.tsx",import.meta.url),"utf8");
const protectedAccessSource=readFileSync(new URL("../lib/protected-delivery.ts",import.meta.url),"utf8");

test("gera link manual da Agenda Edu sem exigir vínculo do aluno",()=>{
  assert.match(deliveryApiSource,/hasServerPermission\(supabase,"deliveries\.send_agenda"\)/);
  assert.match(deliveryApiSource,/const usedRecipient=.*agenda:producao:student:manual-/);
  assert.match(deliveryApiSource,/create_nfse_delivery_access/);
  assert.match(deliveryApiSource,/manualAgendaMessage/);
  assert.match(deliveryApiSource,/status:"aguardando_confirmacao"/);
  assert.doesNotMatch(deliveryApiSource,/agenda_edu_student_id|sweduc_matricula_id|resolveAgendaEduFamilyChat|sendAgendaEduAttachment/);
});

test("oferece mensagem pronta para copiar e confirmar manualmente",()=>{
  assert.match(deliveryUiSource,/Gerar link para colar/);
  assert.match(deliveryUiSource,/Sem API da Agenda Edu: copie e cole no canal correto/);
  assert.match(deliveryUiSource,/copyAgendaMessage/);
  assert.match(deliveryUiSource,/Gerar link e mensagem/);
  assert.match(deliveryApiSource,/action==="confirm"/);
  assert.match(deliveryApiSource,/Mensagem marcada como enviada manualmente na Agenda Edu/);
});

test("usa o mesmo identificador do canal ao gravar e consultar o histórico",()=>{
  assert.match(deliveryApiSource,/canal:"agenda_edu"/);
  assert.match(deliveryUiSource,/channel==="agenda-edu"\?"agenda_edu":channel/);
});

test("autoriza cada canal por permissão e mantém as configurações protegidas",()=>{
  assert.match(permissionMigrationSource,/role = 'secretaria'/);
  assert.match(permissionMigrationSource,/'deliveries\.send_whatsapp'/);
  assert.match(permissionMigrationSource,/'deliveries\.send_agenda'/);
  assert.match(permissionMigrationSource,/private\.has_jpi_permission\('deliveries\.send_whatsapp'\)/);
  assert.match(permissionMigrationSource,/private\.has_jpi_permission\('deliveries\.send_agenda'\)/);
  assert.doesNotMatch(permissionMigrationSource,/current_jpi_role\(\) not in/);
  assert.doesNotMatch(permissionMigrationSource,/settings\.integrations\.edit/);
});

test("mantém o link protegido e registra visualização somente após ação explícita",()=>{
  assert.match(deliveryApiSource,/randomBytes\(32\)/);
  assert.match(deliveryApiSource,/create_nfse_delivery_access/);
  assert.match(protectedPageSource,/Visualizar NFS-e/);
  assert.match(protectedPageSource,/method:"POST"/);
  assert.match(protectedAccessSource,/createHmac/);
  assert.match(protectedAccessSource,/timingSafeEqual/);
  assert.match(accessMigrationSource,/token_hash text not null unique/);
  assert.match(accessMigrationSource,/visualizado_em=coalesce/);
  assert.match(accessMigrationSource,/visualizacoes=visualizacoes\+1/);
  assert.doesNotMatch(accessMigrationSource,/grant (select|insert|update).*nfse_entrega_links to anon/i);
});
