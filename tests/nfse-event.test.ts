import assert from "node:assert/strict";
import test from "node:test";
import { buildCancellationRequest } from "../lib/nfse-event.ts";

const validKey = "33045572212345678000123000000000000123456789012345";

test("gera o pedido 101101 na ordem exigida pelo XSD 1.01", () => {
    const request = buildCancellationRequest({
      key: validKey,
      authorCnpj: "12.345.678/0001-23",
      reasonCode: "1",
      reason: "Correção necessária nos dados da nota.",
      occurredAt: "2026-08-26T10:30:00-03:00",
    });
    assert.equal(request.id, `PRE${validKey}101101`);
    assert.match(request.xml, new RegExp(`<infPedReg Id="PRE${validKey}101101">`));
    assert.ok(request.xml.indexOf("<tpAmb>") < request.xml.indexOf("<verAplic>"));
    assert.ok(request.xml.indexOf("<verAplic>") < request.xml.indexOf("<dhEvento>"));
    assert.ok(request.xml.indexOf("<CNPJAutor>") < request.xml.indexOf("<chNFSe>"));
    assert.match(request.xml, /<e101101>/);
});

test("escapa a descrição e exige texto auditável", () => {
    const request = buildCancellationRequest({
      key: validKey,
      authorCnpj: "12345678000123",
      reasonCode: "9",
      reason: "Ajuste solicitado por A & B.",
      occurredAt: "2026-08-26T10:30:00-03:00",
    });
    assert.match(request.xml, /A &amp; B/);
    assert.throws(() => buildCancellationRequest({
      key: validKey,
      authorCnpj: "12345678000123",
      reasonCode: "2",
      reason: "Muito curto",
      occurredAt: "2026-08-26T10:30:00-03:00",
    }), /15 e 255/);
});
