import assert from "node:assert/strict";
import test from "node:test";
import {missingSweducEnrollmentIds} from "../lib/sweduc-reconciliation.ts";
test("reconcilia por matrícula sem remover duas matrículas ainda presentes",()=>{
 assert.deepEqual(missingSweducEnrollmentIds([7632,7669,7635,7636],[7669,7636],true,2,2),[7632,7635]);
 assert.deepEqual(missingSweducEnrollmentIds([7632,7669],[7632,7669],true,2,2),[]);
});
test("preserva histórico em consultas parciais, divergentes e sem total confirmado",()=>{
 assert.deepEqual(missingSweducEnrollmentIds([1,2],[1],false,1,2),[]);
 assert.deepEqual(missingSweducEnrollmentIds([1,2],[1],true,1,2),[]);
 assert.deepEqual(missingSweducEnrollmentIds([1,2],[1],true,1,null),[]);
});
test("reconcilia consulta vazia somente com total zero confirmado",()=>{
 assert.deepEqual(missingSweducEnrollmentIds([1,2],[],true,0,0),[1,2]);
});
