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

test("organiza a listagem e os ajustes de NFS-e com os mesmos filtros", () => {
  assert.match(invoicesSource, /Organizar NFS-e/);
  assert.match(invoicesSource, /Todos os períodos/);
  assert.match(invoicesSource, /Todas as situações/);
  assert.match(invoicesSource, /Aluno, responsável ou chave/);
  assert.match(invoicesSource, /const items=filteredItems/);
  assert.match(invoicesSource, /filteredIssuedItems/);
  assert.match(invoicesSource, /Limpar filtros/);
});

test("emite notas selecionadas em fila individual e repete somente as pendentes", () => {
  assert.match(invoicesSource, /Emissão em lote · homologação/);
  assert.match(invoicesSource, /Emitir selecionadas/);
  assert.match(invoicesSource, /for\(const payment of payments\)/);
  assert.match(invoicesSource, /body:JSON\.stringify\(\{monthlyId:payment\.id\}\)/);
  assert.match(invoicesSource, /batchIssueInFlight/);
  assert.match(invoicesSource, /Uma falha não interromperá as demais emissões/);
  assert.match(invoicesSource, /Tentar novamente as pendentes/);
});
