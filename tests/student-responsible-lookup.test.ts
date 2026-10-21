import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/live-pages.tsx", import.meta.url), "utf8");

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
  assert.match(source, /Ao salvar, os alunos com o mesmo CPF\/CNPJ do responsável serão sincronizados/);
  assert.match(source, /function useResponsibleMatch/);
  assert.match(source, /Dados de \$\{responsibleMatch\.responsavel\} preenchidos/);
  assert.match(source, /disabled=\{busy\|\|responsibleLookupBusy\}/);
});

test("salva o CEP no formato aceito pelo banco e confirma a alteração", () => {
  assert.match(source, /const normalizedCep=digits\(address\.cep,8\)/);
  assert.match(source, /cep:normalizedCep\|\|null/);
  assert.match(source, /normalizedCep\.length!==8/);
  assert.match(source, /\.update\(payload\)\.eq\("id",editingStudent\.id\)\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(source, /if\(!result\.data\)/);
  assert.match(source, /function studentSaveError/);
  assert.match(source, /alunos_cep_formato/);
  assert.match(source, /<ErrorBox message=\{error\}\/.*?<div className="form-actions">/);
});
