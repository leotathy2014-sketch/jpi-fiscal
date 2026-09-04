import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/live-pages.tsx", import.meta.url), "utf8");
const duplicateReview = readFileSync(new URL("../components/sweduc-duplicate-review.tsx", import.meta.url), "utf8");

test("procura o responsável por CPF/CNPJ antes de cadastrar o aluno", () => {
  const responsibleStep = source.indexOf("1. Localizar responsável");
  const studentStep = source.indexOf("2. Dados do aluno");

  assert.ok(responsibleStep >= 0);
  assert.ok(studentStep > responsibleStep);
  assert.match(source, /\.in\("cpf_cnpj",candidates\)/);
  assert.match(source, /\.limit\(1\)\.maybeSingle\(\)/);
});

test("pede confirmação antes de reaproveitar os dados encontrados", () => {
  assert.match(source, /Responsável já cadastrado/);
  assert.match(source, /Usar dados cadastrados/);
  assert.match(source, /Nenhum cadastro anterior será alterado/);
  assert.match(source, /function useResponsibleMatch/);
  assert.match(source, /Dados de \$\{responsibleMatch\.responsavel\} preenchidos/);
  assert.match(source, /disabled=\{busy\|\|responsibleLookupBusy\|\|Boolean\(responsibleMatch\)\}/);
});

test("confere cadastros manuais da SWeduc antes de qualquer limpeza", () => {
  assert.match(source, /SweducDuplicateReview/);
  assert.match(duplicateReview, /Conferência de cadastros manuais/);
  assert.match(duplicateReview, /sweduc_alunos/);
  assert.match(duplicateReview, /mensalidades/);
  assert.match(duplicateReview, /sweduc_matricula_id/);
  assert.match(duplicateReview, /Vincular/);
  assert.match(duplicateReview, /Não excluir agora/);
  assert.doesNotMatch(duplicateReview, /\.delete\(\)/);
});
