import assert from "node:assert/strict";
import test from "node:test";
import { buildDpsDraft } from "../lib/nfse-dps.ts";

const input = {
  municipalityCode: "3304557",
  series: "70000",
  number: "1",
  competence: "08/2026",
  provider: {
    cnpj: "30.041.545/0001-07",
    municipalRegistration: "934968",
    name: "JARDIM ESCOLA JOÃO PAULO I LTDA",
  },
  taker: {
    taxId: "529.982.247-25",
    name: "RESPONSÁVEL DE TESTE",
    email: "teste@example.com",
  },
  service: {
    nationalTaxCode: "08.01.01",
    nbs: "122012000",
    description: "MENSALIDADE ESCOLAR - COMPETÊNCIA 08/2026",
    amount: 350,
    issRate: 5,
    ibsCbs: { operationIndicator: "030101", taxStatus: "200", taxClassification: "200028" },
  },
};

test("gera DPS 1.01 exclusivamente para homologação com IBS/CBS", () => {
  const draft = buildDpsDraft(input);
  assert.equal(draft.id, "DPS330455723004154500010770000000000000000001");
  assert.match(draft.xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(draft.xml, /<cTribNac>080101<\/cTribNac>/);
  assert.match(draft.xml, /<cNBS>122012000<\/cNBS>/);
  assert.match(draft.xml, /<IBSCBS>[\s\S]*<cIndOp>030101<\/cIndOp>/);
  assert.match(draft.xml, /<finNFSe>0<\/finNFSe>[\s\S]*<indFinal>1<\/indFinal>/);
  assert.match(draft.xml, /<CST>200<\/CST>[\s\S]*<cClassTrib>200028<\/cClassTrib>/);
  assert.match(draft.xml, /<vTotTribFed>350\.00<\/vTotTribFed>[\s\S]*<vTotTribEst>0\.00<\/vTotTribEst>[\s\S]*<vTotTribMun>0\.00<\/vTotTribMun>/);
  assert.doesNotMatch(draft.xml, /<indTotTrib>/);
  assert.doesNotMatch(draft.xml, /<tpAmb>1<\/tpAmb>/);
});

test("rejeita documento de tomador inválido antes de gerar XML", () => {
  assert.throws(() => buildDpsDraft({ ...input, taker: { ...input.taker, taxId: "111.111.111-11" } }), /CPF\/CNPJ/);
});

test("escapa conteúdo textual inserido no XML", () => {
  const draft = buildDpsDraft({ ...input, service: { ...input.service, description: "MENSALIDADE & MATERIAL <TESTE>" } });
  assert.match(draft.xml, /MENSALIDADE &amp; MATERIAL &lt;TESTE&gt;/);
});
