import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const progressSource = readFileSync(new URL("../components/transmission-progress.tsx", import.meta.url), "utf8");
const invoicesSource = readFileSync(new URL("../components/live-pages.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../components/pages.tsx", import.meta.url), "utf8");
const appShellSource = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");

test("mostra andamento estimado em todas as operações remotas da NFS-e", () => {
  assert.match(progressSource, /Andamento estimado da transmissão/);
  assert.match(progressSource, /Aguardando a confirmação da SEFIN/);
  assert.match(invoicesSource, /kind="issue"/);
  assert.match(invoicesSource, /kind="substitute"/);
  assert.match(invoicesSource, /kind="cancel"/);
  assert.match(settingsSource, /kind="connection"/);
});

test("destaca a versão ativa e mantém o histórico visível", () => {
  assert.match(invoicesSource, /nfse_documentos_homologacao/);
  assert.match(invoicesSource, /NFS-e ativa em homologação · versão/);
  assert.match(invoicesSource, /Ver histórico de/);
  assert.match(invoicesSource, /Substituída e preservada/);
});

test("usa uma única verificação de disponibilidade da SEFIN", () => {
  assert.match(settingsSource, /fetch\("\/api\/nfse\/homologation\/test"/);
  assert.doesNotMatch(settingsSource, /nfse-teste-conexao-segura/);
  assert.match(settingsSource, /jpi-sefin-status-updated/);
  assert.match(appShellSource, /jpi-sefin-status-updated/);
});
