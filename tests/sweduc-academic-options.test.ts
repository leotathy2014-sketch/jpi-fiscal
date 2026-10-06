import assert from "node:assert/strict";
import test from "node:test";
import {isSweducClassCompatibleWithSeries,sameSweducClassOption,sweducClassOptionKey,uniqueSortedSweducClassOptions} from "../lib/sweduc-academic-options.ts";

test("unifica nomes equivalentes de turmas infantis sem misturar os turnos",()=>{
  assert.equal(sweducClassOptionKey("Mat I / Manhã"),sweducClassOptionKey("MAT-I/M"));
  assert.equal(sweducClassOptionKey("Mat I / Manhã"),sweducClassOptionKey("z MATERNAL/M"));
  assert.equal(sweducClassOptionKey("Pré-II / Tarde"),sweducClassOptionKey("PRÉ-II/T"));
  assert.notEqual(sweducClassOptionKey("MAT-I/M"),sweducClassOptionKey("MAT-I/T"));
  assert.equal(sameSweducClassOption("PRÉ-I/T ","Pré I / Tarde"),true);
});

test("mantém uma opção legível para cada turma e turno",()=>{
  const options=uniqueSortedSweducClassOptions([
    "Mat I / Manhã","MAT-I/M","z MATERNAL/M","Mat I / Tarde","MAT-I/T",
    "Mat II / Manhã","MAT-II/M","Mat II / Tarde","MAT-II/T",
    "Pré I / Manhã","PRÉ-I/M","Pré I / Tarde","PRÉ-I/T",
    "Pré-II / Manhã","PRÉ-II/M","Pré-II / Tarde","PRÉ-II/T",
  ]);
  assert.deepEqual(options,[
    "Mat I / Manhã","Mat I / Tarde","Mat II / Manhã","Mat II / Tarde",
    "Pré I / Manhã","Pré I / Tarde","Pré-II / Manhã","Pré-II / Tarde",
  ]);
});

test("não mistura o nível da turma com outra série infantil",()=>{
  assert.equal(isSweducClassCompatibleWithSeries("Mat II / Tarde","Maternal I"),false);
  assert.equal(isSweducClassCompatibleWithSeries("MAT-II/T","Maternal II"),true);
  assert.equal(isSweducClassCompatibleWithSeries("401","4º Ano"),true);
});
