import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource=readFileSync(new URL("../app/api/deliveries/whatsapp-manual/route.ts",import.meta.url),"utf8");
const uiSource=readFileSync(new URL("../components/delivery-center.tsx",import.meta.url),"utf8");
const migrationSource=readFileSync(new URL("../supabase/migrations/20260828203000_habilitar_whatsapp_manual_gratuito.sql",import.meta.url),"utf8");

test("prepara o WhatsApp manual sem chamar a API paga da Meta",()=>{
  assert.match(apiSource,/new URL\(`https:\/\/wa\.me\/\$\{testRecipient\}`\)/);
  assert.match(apiSource,/manualMessage\(payment,protectedUrl\)/);
  assert.doesNotMatch(apiSource,/graph\.facebook\.com/);
  assert.doesNotMatch(apiSource,/WHATSAPP_ACCESS_TOKEN/);
  assert.match(uiSource,/Manual gratuito/);
  assert.match(uiSource,/Não há envio pela API da Meta nem cobrança por mensagem/);
});

test("envia somente um link privado e mantém a nota fora de URLs públicas",()=>{
  assert.match(apiSource,/randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(apiSource,/createHash\("sha256"\)/);
  assert.match(apiSource,/create_nfse_delivery_access/);
  assert.match(apiSource,/new URL\(`\/nota\/\$\{accessToken\}`/);
  assert.match(migrationSource,/when delivery_channel = 'whatsapp_manual' then interval '30 days'/);
  assert.match(migrationSource,/revoke_nfse_delivery_access/);
});

test("separa o responsável do número interno durante a homologação",()=>{
  assert.match(apiSource,/destinatario_pretendido:intendedRecipient/);
  assert.match(apiSource,/destinatario_utilizado:testRecipient/);
  assert.match(apiSource,/TESTE DE HOMOLOGAÇÃO — SEM VALIDADE FISCAL/);
  assert.match(migrationSource,/p_channel in \('whatsapp','whatsapp_manual'\)/);
  assert.match(migrationSource,/p_recipient = configured_test_recipient/);
});

test("coordena vários computadores e exige confirmação humana",()=>{
  assert.match(migrationSource,/status in \('enviando','aguardando_confirmacao'\)/);
  assert.match(migrationSource,/aberto_por_nome/);
  assert.match(migrationSource,/confirmado_por_nome/);
  assert.match(apiSource,/status:"aguardando_confirmacao"/);
  assert.match(apiSource,/action==="confirm"\|\|action==="cancel"/);
  assert.match(apiSource,/confirmado_por:auth\.user\.id/);
  assert.match(uiSource,/window\.setInterval\(\(\)=>void load\(true\),15_000\)/);
  assert.match(uiSource,/Aguardando confirmação/);
});

test("mantém a política RLS vinculada ao usuário que iniciou a tentativa",()=>{
  assert.match(migrationSource,/created_by = \(select auth\.uid\(\)\)/);
  assert.match(migrationSource,/current_jpi_role\(\)[\s\S]*array\['admin'::text,'financeiro'::text\]/);
  assert.match(apiSource,/\.eq\("canal","whatsapp_manual"\)\.eq\("status","aguardando_confirmacao"\)/);
  assert.match(uiSource,/Apenas o mesmo usuário pode confirmá-la ou cancelá-la/);
});
