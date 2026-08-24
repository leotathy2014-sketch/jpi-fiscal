import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDpsDraft, isValidCpfCnpj, NFSE_OWN_APP_SERIES, NFSE_RESTRICTED_ENDPOINT } from "../lib/nfse-dps.ts";

const input = {
  municipalityCode: "3304557",
  series: NFSE_OWN_APP_SERIES,
  number: "1",
  competence: "08/2026",
  provider: {
    cnpj: "30.041.545/0001-07",
    municipalRegistration: null,
    name: "JARDIM ESCOLA JOÃO PAULO I LTDA",
  },
  taker: {
    taxId: "529.982.247-25",
    name: "RESPONSÁVEL DE TESTE",
    email: "teste@example.com",
  },
  service: {
    nationalTaxCode: "08.01.01",
    municipalTaxCode: "002",
    nbs: "122012000",
    description: "MENSALIDADE ESCOLAR - COMPETÊNCIA 08/2026",
    amount: 350,
    issRate: 5,
    federalTaxes: { cst: "01", pisRate: 0.65, cofinsRate: 3, withholdingType: 0 },
    ibsCbs: { operationIndicator: "030101", taxStatus: "200", taxClassification: "200028" },
  },
};

test("gera DPS 1.01 exclusivamente para homologação com IBS/CBS", () => {
  const draft = buildDpsDraft(input);
  assert.equal(draft.id, "DPS330455723004154500010700001000000000000001");
  assert.match(draft.xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(draft.xml, /<cTribNac>080101<\/cTribNac>/);
  assert.match(draft.xml, /<cTribMun>002<\/cTribMun>/);
  assert.match(draft.xml, /<cNBS>122012000<\/cNBS>/);
  assert.match(draft.xml, /<IBSCBS>[\s\S]*<cIndOp>030101<\/cIndOp>/);
  assert.match(draft.xml, /<finNFSe>0<\/finNFSe>[\s\S]*<indFinal>1<\/indFinal>/);
  assert.match(draft.xml, /<CST>200<\/CST>[\s\S]*<cClassTrib>200028<\/cClassTrib>/);
  assert.match(draft.xml, /<tribFed>[\s\S]*<piscofins>[\s\S]*<CST>01<\/CST>/);
  assert.match(draft.xml, /<vBCPisCofins>350\.00<\/vBCPisCofins>/);
  assert.match(draft.xml, /<pAliqPis>0\.65<\/pAliqPis>[\s\S]*<pAliqCofins>3\.00<\/pAliqCofins>/);
  assert.match(draft.xml, /<vPis>2\.28<\/vPis>[\s\S]*<vCofins>10\.50<\/vCofins>/);
  assert.match(draft.xml, /<tpRetPisCofins>0<\/tpRetPisCofins>/);
  assert.match(draft.xml, /<vTotTribFed>350\.00<\/vTotTribFed>[\s\S]*<vTotTribEst>0\.00<\/vTotTribEst>[\s\S]*<vTotTribMun>0\.00<\/vTotTribMun>/);
  assert.doesNotMatch(draft.xml, /<IM>/);
  assert.doesNotMatch(draft.xml, /<indTotTrib>/);
  assert.doesNotMatch(draft.xml, /<pAliq>/);
  assert.doesNotMatch(draft.xml, /<tpAmb>1<\/tpAmb>/);
});

test("rejeita documento de tomador inválido antes de gerar XML", () => {
  assert.throws(() => buildDpsDraft({ ...input, taker: { ...input.taker, taxId: "111.111.111-11" } }), /CPF\/CNPJ/);
  assert.equal(isValidCpfCnpj("123.456.789-00"), false);
  assert.equal(isValidCpfCnpj("529.982.247-25"), true);
});

test("usa o endereço operacional publicado na especificação da produção restrita", () => {
  assert.equal(NFSE_RESTRICTED_ENDPOINT, "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  assert.match(edgeSource, /https:\/\/sefin\.producaorestrita\.nfse\.gov\.br\/API\/SefinNacional\/nfse/);
  assert.doesNotMatch(edgeSource, /gov\.br\/SefinNacional\/nfse/);
});

test("rejeita código municipal reservado antes de gerar XML", () => {
  assert.throws(
    () => buildDpsDraft({ ...input, service: { ...input.service, municipalTaxCode: "000" } }),
    /tributação municipal/,
  );
});

test("usa série de aplicativo próprio e não a faixa reservada ao Emissor Web", () => {
  assert.equal(NFSE_OWN_APP_SERIES, "1");
  const draft = buildDpsDraft(input);
  const nodeSource = readFileSync(new URL("../app/api/nfse/homologation/issue/route.ts", import.meta.url), "utf8");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  assert.match(draft.xml, /<serie>1<\/serie>/);
  assert.equal(draft.id, "DPS330455723004154500010700001000000000000001");
  assert.doesNotMatch(nodeSource, /const series = "70000"/);
  assert.doesNotMatch(edgeSource, /const series = "70000"/);
  assert.match(nodeSource, /series\.padStart\(5, "0"\)/);
  assert.match(edgeSource, /series\.padStart\(5, "0"\)/);
  assert.match(nodeSource, /<cTribMun>\$\{municipalTaxCode\}<\/cTribMun>/);
  assert.match(edgeSource, /<cTribMun>\$\{municipalTaxCode\}<\/cTribMun>/);
  assert.match(nodeSource, /record\.Codigo/);
  assert.match(edgeSource, /record\.Codigo/);
  assert.match(nodeSource, /record\.Descricao/);
  assert.match(edgeSource, /record\.Descricao/);
  assert.match(nodeSource, /error\.complemento/);
  assert.match(edgeSource, /error\.complemento/);
});

test("não informa alíquota para prestador não optante do Simples", () => {
  const draft = buildDpsDraft(input);
  const nodeSource = readFileSync(new URL("../app/api/nfse/homologation/issue/route.ts", import.meta.url), "utf8");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(draft.xml, /<pAliq>/);
  assert.doesNotMatch(nodeSource, /<pAliq>/);
  assert.doesNotMatch(edgeSource, /<pAliq>/);
});

test("rejeita configuração federal inválida antes de gerar o XML", () => {
  assert.throws(
    () => buildDpsDraft({ ...input, service: { ...input.service, federalTaxes: { ...input.service.federalTaxes, cst: "1" } } }),
    /CST do PIS\/COFINS/,
  );
  assert.throws(
    () => buildDpsDraft({ ...input, service: { ...input.service, federalTaxes: { ...input.service.federalTaxes, pisRate: 101 } } }),
    /Alíquota do PIS/,
  );
});

test("backends carregam o Lucro Presumido e geram o grupo federal", () => {
  const nodeSource = readFileSync(new URL("../app/api/nfse/homologation/issue/route.ts", import.meta.url), "utf8");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  for (const source of [nodeSource, edgeSource]) {
    assert.match(source, /regime_tributario,pis_aliquota,cofins_aliquota,pis_cofins_cst,pis_cofins_retencao/);
    assert.match(source, /company\.regime_tributario !== "LUCRO PRESUMIDO"/);
    assert.match(source, /<tribFed><piscofins><CST>/);
    assert.match(source, /<vBCPisCofins>/);
    assert.match(source, /<tpRetPisCofins>/);
  }
});

test("escapa conteúdo textual inserido no XML", () => {
  const draft = buildDpsDraft({ ...input, service: { ...input.service, description: "MENSALIDADE & MATERIAL <TESTE>" } });
  assert.match(draft.xml, /MENSALIDADE &amp; MATERIAL &lt;TESTE&gt;/);
});

test("omite razão social do prestador quando ele próprio emite a DPS", () => {
  const draft = buildDpsDraft(input);
  const providerGroup = draft.xml.match(/<prest>[\s\S]*?<\/prest>/)?.[0];
  assert.ok(providerGroup);
  assert.match(providerGroup, /<CNPJ>30041545000107<\/CNPJ>/);
  assert.doesNotMatch(providerGroup, /<xNome>/);
  assert.match(draft.xml, /<toma>[\s\S]*?<xNome>RESPONSÁVEL DE TESTE<\/xNome>/);

  const nodeSource = readFileSync(new URL("../app/api/nfse/homologation/issue/route.ts", import.meta.url), "utf8");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(nodeSource, /<prest><CNPJ>\$\{providerCnpj\}<\/CNPJ><xNome>/);
  assert.doesNotMatch(edgeSource, /<prest><CNPJ>\$\{providerCnpj\}<\/CNPJ><xNome>/);
});

test("preserva as letras das mensagens oficiais de rejeição", () => {
  const nodeSource = readFileSync(new URL("../app/api/nfse/homologation/issue/route.ts", import.meta.url), "utf8");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  const brokenWhitespaceClass = String.raw`[\\r\\n\\t]`;
  const correctWhitespaceClass = String.raw`[\r\n\t]`;
  assert.equal(nodeSource.includes(brokenWhitespaceClass), false);
  assert.equal(edgeSource.includes(brokenWhitespaceClass), false);
  assert.equal(nodeSource.includes(correctWhitespaceClass), true);
  assert.equal(edgeSource.includes(correctWhitespaceClass), true);
});

test("preserva XMLs de cada tentativa e bloqueia competência futura nos backends", () => {
  const nodeSource = readFileSync(new URL("../app/api/nfse/homologation/issue/route.ts", import.meta.url), "utf8");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  for (const source of [nodeSource, edgeSource]) {
    assert.match(source, /const attemptBasePath = `dps\/\$\{payment\.id\}\/tentativas\/\$\{attemptId\}`/);
    assert.match(source, /DPS assinada \$\{signedPath\}/);
    assert.match(source, /não pode ser posterior ao mês atual/);
    assert.match(source, /evento: "nfse_homologacao_rejeitada"/);
  }
});

test("oferece correção obrigatória antes de reenviar uma rejeição", () => {
  const uiSource = readFileSync(new URL("../components/live-pages.tsx", import.meta.url), "utf8");
  assert.match(uiSource, /Corrigir para reenviar/);
  assert.match(uiSource, /evento:"dados_nfse_corrigidos"/);
  assert.match(uiSource, /status_nfse:"Revisada",dps_xml_path:null,dps_xml_id:null/);
  assert.match(uiSource, /Nova validação obrigatória antes do reenvio/);
  assert.match(uiSource, /max=\{currentCompetenceInput\(\)\}/);
  assert.match(uiSource, /p\.status_nfse==="Rejeitada em homologação"[\s\S]*?Corrigir para reenviar/);
});

test("guarda a senha do A1 no Vault e não a solicita durante a homologação", () => {
  const nodeSource = readFileSync(new URL("../app/api/nfse/homologation/issue/route.ts", import.meta.url), "utf8");
  const testSource = readFileSync(new URL("../app/api/nfse/homologation/test/route.ts", import.meta.url), "utf8");
  const edgeSource = readFileSync(new URL("../supabase/functions/nfse-homologacao/index.ts", import.meta.url), "utf8");
  const passwordRoute = readFileSync(new URL("../app/api/certificates/password/route.ts", import.meta.url), "utf8");
  const invoiceUi = readFileSync(new URL("../components/live-pages.tsx", import.meta.url), "utf8");
  const settingsUi = readFileSync(new URL("../components/pages.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260824213229_armazenar_senha_certificado_vault.sql", import.meta.url), "utf8");
  const securityMigration = readFileSync(new URL("../supabase/migrations/20260824214346_proteger_funcoes_senha_certificado.sql", import.meta.url), "utf8");

  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /revoke all on table private\.certificado_a1_secrets from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_certificate_password_service\(uuid\) to service_role/);
  assert.match(securityMigration, /private\.store_certificate_password_internal/);
  assert.match(securityMigration, /private\.get_certificate_password_internal/);
  assert.match(securityMigration, /security invoker/);
  assert.match(passwordRoute, /forge\.pkcs12\.pkcs12FromAsn1/);
  assert.match(passwordRoute, /rpc\("store_certificate_password"/);
  assert.match(nodeSource, /process\.env\.JPI_BACKEND_SECRET/);
  assert.match(nodeSource, /rpc\("get_certificate_password"/);
  assert.match(testSource, /rpc\("get_certificate_password"/);
  assert.match(edgeSource, /rpc\("get_certificate_password_service"/);
  assert.match(settingsUi, /savePasswordInVault/);
  assert.match(invoiceUi, /JSON\.stringify\(\{monthlyId:homologationPayment\.id\}\)/);
  assert.doesNotMatch(invoiceUi, /certificatePassword/);
  assert.doesNotMatch(invoiceUi, /Senha do certificado A1<input/);
});




