import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const route=readFileSync(new URL("../app/api/integrations/sweduc/route.ts",import.meta.url),"utf8");
const secretRoute=readFileSync(new URL("../app/api/integrations/sweduc/master-secrets/route.ts",import.meta.url),"utf8");
const temporaryTestRoute=readFileSync(new URL("../app/api/integrations/sweduc/test-credentials/route.ts",import.meta.url),"utf8");
const ui=readFileSync(new URL("../components/sweduc-settings.tsx",import.meta.url),"utf8");
const settings=readFileSync(new URL("../components/pages.tsx",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20260901120000_criar_integracao_sweduc.sql",import.meta.url),"utf8");
const fiscalLinkMigration=readFileSync(new URL("../supabase/migrations/20260903120000_vincular_sweduc_ao_cadastro_fiscal.sql",import.meta.url),"utf8");
const assistant=readFileSync(new URL("../components/issuance-assistant.tsx",import.meta.url),"utf8");
const agenda=readFileSync(new URL("../lib/agenda-edu.ts",import.meta.url),"utf8");

test("cria uma integração SWeduc separada da Agenda Edu",()=>{
  assert.match(settings,/section==="sweduc"/);assert.match(settings,/Agenda Edu/);
  assert.match(route,/get_sweduc_secret/);assert.doesNotMatch(route,/agenda_edu/);
  assert.match(migration,/private\.sweduc_secrets/);assert.doesNotMatch(migration,/alter table public\.integracoes_comunicacao/);
  assert.match(agenda,/AGENDA_EDU_ENDPOINTS/);
});

test("protege credenciais e exige permissão de integração",()=>{
  assert.match(route,/JPI_BACKEND_SECRET/);assert.match(route,/store_sweduc_secret/);assert.match(route,/settings\.integrations\.edit/);
  assert.match(route,/cofre_configurado:Boolean\(process\.env\.JPI_BACKEND_SECRET\)/);
  assert.match(secretRoute,/get_my_access/);assert.match(secretRoute,/role\|\|""\)\.toLowerCase\(\)!=="master"/);assert.match(secretRoute,/get_sweduc_secret/);
  assert.match(secretRoute,/expiresIn:60/);assert.match(secretRoute,/username/);assert.match(secretRoute,/password/);assert.doesNotMatch(secretRoute,/console\.(log|error)/);
  assert.match(temporaryTestRoute,/get_my_access/);assert.match(temporaryTestRoute,/role\|\|""\)\.toLowerCase\(\)!=="master"/);
  assert.doesNotMatch(temporaryTestRoute,/store_sweduc_secret|get_sweduc_secret|\.from\("sweduc_config"\)/);assert.doesNotMatch(temporaryTestRoute,/console\.(log|error)/);
  assert.match(migration,/vault\.create_secret/);assert.match(migration,/vault\.update_secret/);assert.match(migration,/enable row level security/);
  assert.doesNotMatch(ui,/console\.(log|error)/);assert.doesNotMatch(route,/console\.(log|error)/);
});

test("oferece configuração, teste e consulta sem salvar lista de alunos",()=>{
  for(const label of ["HOST","CLIENT_ID","CLIENT_SECRET","Informações API e credenciais SWeduc","Revelar credenciais","Teste antes de gravar","Testar sem salvar","Testar conexão com API","Consultar SWeduc","Buscar rápido nos alunos carregados","USUÁRIO","SENHA","Cofre seguro do servidor","JPI_BACKEND_SECRET","Environment Variables"])assert.match(ui,new RegExp(label));
  assert.doesNotMatch(ui,/Método de autenticação/);assert.match(ui,/grantType:"password"/);
  assert.match(ui,/copyBackendSecretName/);assert.match(ui,/Por segurança, o valor dessa chave mestra não é exibido/);
  assert.match(ui,/isMaster&&apiInfoOpen/);assert.match(ui,/\/api\/integrations\/sweduc\/master-secrets/);
  assert.match(ui,/\/api\/integrations\/sweduc\/test-credentials/);assert.match(ui,/Nenhuma credencial ou aluno será salvo/);
  assert.match(route,/supplied===1/);assert.match(route,/currentCredentials\.clientId/);assert.doesNotMatch(route,/supabase\.from\("sweduc_secrets"\)/);
  assert.match(temporaryTestRoute,/useUsernamePassword/);assert.match(temporaryTestRoute,/username/);assert.match(temporaryTestRoute,/password/);assert.match(temporaryTestRoute,/grantType/);
  assert.match(route,/action==="test"/);assert.match(route,/action==="sync"/);assert.doesNotMatch(route,/from\("sweduc_alunos"\)\.upsert/);
  assert.match(temporaryTestRoute,/createSweducAccessToken/);assert.match(temporaryTestRoute,/listSweducStudentsWithToken/);assert.match(temporaryTestRoute,/getSweducStudentDetailsWithToken/);assert.match(temporaryTestRoute,/Nada foi salvo ou importado/);
  assert.match(route,/MAX_SWEDUC_PAGES=1000/);assert.match(ui,/while\(page<=1000\)/);assert.doesNotMatch(route,/Math\.min\(Number\(body\.page\|\|1\),100\)/);
  assert.match(route,/grantType,username,password/);assert.match(route,/auth_method/);assert.match(route,/usuario_configurado/);
  assert.match(route,/resolveSweducAcademicYear/);assert.match(route,/ano_letivo_id:activeYear\.id/);assert.match(route,/Nada foi salvo no banco/);
  assert.match(temporaryTestRoute,/ano_letivo_id:activeYear\.id/);assert.match(ui,/Alunos por ano letivo/);assert.match(ui,/Ano letivo considerado/);
  assert.match(ui,/visibleStudents=useMemo/);assert.match(ui,/visibleStudents\.map/);assert.doesNotMatch(ui,/run\("sync",\{page,academicYear:year\|\|"",search\}\)/);
  assert.match(ui,/canEdit&&<>\s*<label>USUÁRIO/);assert.doesNotMatch(ui,/sweduc-test-credentials/);
});

test("importa dados acadêmicos, responsáveis, contatos e financeiro",()=>{
  for(const field of ["matricula_id","aluno_id","unidade","curso","serie","turma","ano_letivo","responsaveis","financeiro"])assert.match(migration,new RegExp(field));
  assert.match(ui,/telefones/);assert.match(ui,/emails/);assert.match(ui,/título\(s\)/);
  assert.match(ui,/Responsável para a nota/);assert.match(ui,/Carregar para a nota/);assert.match(ui,/selectedYear/);
  assert.match(route,/action==="import"/);assert.match(route,/mapSweducToFiscalStudent/);assert.match(route,/sweduc_matricula_id/);
  assert.match(fiscalLinkMigration,/sweduc_matricula_id/);assert.match(fiscalLinkMigration,/unique index/);
  assert.match(assistant,/jpi-assistant-student-focus/);assert.match(assistant,/Aluno importado da SWeduc selecionado/);
});
