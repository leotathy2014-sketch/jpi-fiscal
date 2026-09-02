import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const route=readFileSync(new URL("../app/api/integrations/sweduc/route.ts",import.meta.url),"utf8");
const ui=readFileSync(new URL("../components/sweduc-settings.tsx",import.meta.url),"utf8");
const settings=readFileSync(new URL("../components/pages.tsx",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20260901120000_criar_integracao_sweduc.sql",import.meta.url),"utf8");
const agenda=readFileSync(new URL("../lib/agenda-edu.ts",import.meta.url),"utf8");

test("cria uma integração SWeduc separada da Agenda Edu",()=>{
  assert.match(settings,/section==="sweduc"/);assert.match(settings,/Agenda Edu/);
  assert.match(route,/get_sweduc_secret/);assert.doesNotMatch(route,/agenda_edu/);
  assert.match(migration,/private\.sweduc_secrets/);assert.doesNotMatch(migration,/alter table public\.integracoes_comunicacao/);
  assert.match(agenda,/AGENDA_EDU_ENDPOINTS/);
});

test("protege credenciais e exige permissão de integração",()=>{
  assert.match(route,/JPI_BACKEND_SECRET/);assert.match(route,/store_sweduc_secret/);assert.match(route,/settings\.integrations\.edit/);
  assert.match(migration,/vault\.create_secret/);assert.match(migration,/vault\.update_secret/);assert.match(migration,/enable row level security/);
  assert.doesNotMatch(ui,/console\.(log|error)/);assert.doesNotMatch(route,/console\.(log|error)/);
});

test("oferece configuração, teste, sincronização e consulta",()=>{
  for(const label of ["HOST","CLIENT_ID","CLIENT_SECRET","Testar conexão","Sincronizar alunos","Buscar aluno por nome"])assert.match(ui,new RegExp(label));
  assert.doesNotMatch(ui,/<label>Usuário|<label>Senha/);
  assert.match(route,/supplied===2/);assert.doesNotMatch(route,/body\.username|body\.password/);
  assert.match(route,/action==="test"/);assert.match(route,/action==="sync"/);assert.match(route,/sweduc_alunos/);
});

test("importa dados acadêmicos, responsáveis, contatos e financeiro",()=>{
  for(const field of ["matricula_id","aluno_id","unidade","curso","serie","turma","ano_letivo","responsaveis","financeiro"])assert.match(migration,new RegExp(field));
  assert.match(ui,/telefones/);assert.match(ui,/emails/);assert.match(ui,/título\(s\)/);
});
