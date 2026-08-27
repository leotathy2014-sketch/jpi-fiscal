import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource=readFileSync(new URL("../app/api/deliveries/whatsapp/route.ts",import.meta.url),"utf8");
const uiSource=readFileSync(new URL("../components/delivery-center.tsx",import.meta.url),"utf8");
const migrationSource=readFileSync(new URL("../supabase/migrations/20260827112236_habilitar_entregas_whatsapp.sql",import.meta.url),"utf8");

test("habilita o canal WhatsApp com destinatário interno protegido por RLS",()=>{
  assert.match(migrationSource,/check \(canal in \('email','whatsapp'\)\)/);
  assert.match(migrationSource,/add column if not exists whatsapp_test_recipient text/);
  assert.match(migrationSource,/private\.is_allowed_delivery_recipient/);
  assert.match(migrationSource,/p_recipient = configured_test_recipient/);
  assert.match(migrationSource,/created_by = \(select auth\.uid\(\)\)/);
  assert.match(migrationSource,/ambiente = 'homologacao'/);
});

test("mantém token e configuração sensível exclusivamente no servidor",()=>{
  assert.match(apiSource,/supabase\.auth\.getUser\(token\)/);
  assert.match(apiSource,/get_whatsapp_delivery_config/);
  assert.match(apiSource,/get_communication_secret/);
  assert.doesNotMatch(uiSource,/get_communication_secret/);
  assert.match(apiSource,/return json\(\{ok:true,ready,testRecipient:/);
  assert.doesNotMatch(apiSource,/return json\(\{[^}]*accessToken/);
});

test("separa destinatário real do número interno de homologação",()=>{
  assert.match(apiSource,/alunos\(nome,responsavel,whatsapp\)/);
  assert.match(apiSource,/intendedRecipient=normalizeBrazilPhone\(payment\.alunos\?\.whatsapp/);
  assert.match(apiSource,/testRecipient=normalizeBrazilPhone\(config\.whatsapp_test_recipient/);
  assert.match(apiSource,/destinatario_pretendido:intendedRecipient/);
  assert.match(apiSource,/destinatario_utilizado:testRecipient/);
  assert.match(uiSource,/As famílias não receberão documentos sem validade fiscal/);
});

test("envia PDF pela Meta e preserva XML em link privado temporário",()=>{
  assert.match(apiSource,/createSignedUrl\(document\.nfse_xml_path,XML_LINK_SECONDS/);
  assert.match(apiSource,/const XML_LINK_SECONDS=7\*24\*60\*60/);
  assert.match(apiSource,/mediaForm\.set\("type","application\/pdf"\)/);
  assert.match(apiSource,/\/media`/);
  assert.match(apiSource,/type:"document",document:\{id:mediaResult\.id/);
  assert.match(apiSource,/\/messages`/);
  assert.match(apiSource,/text:signedXml\.signedUrl/);
  assert.doesNotMatch(apiSource,/mediaForm\.set\("type","application\/xml"\)/);
});

test("usa modelo aprovado e registra tentativas independentes",()=>{
  assert.match(apiSource,/name:config\.whatsapp_template_name\|\|"envio_nfse"/);
  assert.match(apiSource,/language:\{code:"pt_BR"\}/);
  assert.match(apiSource,/eq\("request_id",requestId\)/);
  assert.match(apiSource,/canal:"whatsapp"/);
  assert.match(apiSource,/status:"enviando"/);
  assert.match(apiSource,/status:"enviado"/);
  assert.match(apiSource,/status:"erro"/);
});

test("oferece lote, histórico e reenvio específicos do WhatsApp",()=>{
  assert.match(uiSource,/eq\("canal",channel==="whatsapp"\?"whatsapp":"email"\)/);
  assert.match(uiSource,/row\.payment\.alunos\?\.whatsapp/);
  assert.match(uiSource,/WhatsApp interno/);
  assert.match(uiSource,/PDF anexado · XML em link privado de 7 dias/);
  assert.match(uiSource,/Repetir pendentes/);
  assert.match(uiSource,/Reenviar pelo \{channelLabel\}/);
});
