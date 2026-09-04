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
const automaticSyncMigration=readFileSync(new URL("../supabase/migrations/20260903213000_habilitar_sincronizacao_automatica_sweduc.sql",import.meta.url),"utf8");
const cronRoute=readFileSync(new URL("../app/api/cron/sweduc-sync/route.ts",import.meta.url),"utf8");
const vercelConfig=readFileSync(new URL("../vercel.json",import.meta.url),"utf8");
const assistant=readFileSync(new URL("../components/issuance-assistant.tsx",import.meta.url),"utf8");
const agenda=readFileSync(new URL("../lib/agenda-edu.ts",import.meta.url),"utf8");
const livePages=readFileSync(new URL("../components/live-pages.tsx",import.meta.url),"utf8");
const operationalPicker=readFileSync(new URL("../components/sweduc-operational-picker.tsx",import.meta.url),"utf8");

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
  assert.match(route,/action==="test"/);assert.match(route,/action==="sync"/);assert.match(route,/from\("sweduc_alunos"\)\.upsert/);
  assert.match(temporaryTestRoute,/createSweducAccessToken/);assert.match(temporaryTestRoute,/listSweducStudentsWithToken/);assert.match(temporaryTestRoute,/getSweducStudentDetailsWithToken/);assert.match(temporaryTestRoute,/Nada foi salvo ou importado/);
  assert.match(route,/rows=summaries\.map\(mapSummaryToGrid\)/);assert.match(route,/search:search\|\|undefined/);assert.match(route,/getSweducStudentDetailsWithToken/);
  assert.match(route,/MAX_SWEDUC_PAGES=1000/);assert.match(ui,/while\(page<=1000\)/);
  assert.match(route,/grantType,username,password/);assert.match(route,/auth_method/);assert.match(route,/usuario_configurado/);
  assert.match(route,/resolveSweducAcademicYear/);assert.match(route,/ano_letivo_id:activeYear\.id/);assert.match(route,/Nada foi salvo no banco/);
  assert.match(temporaryTestRoute,/ano_letivo_id:activeYear\.id/);assert.match(ui,/Alunos por ano letivo/);assert.match(ui,/Ano letivo considerado/);
  for(const label of ["Ano letivo","Aluno","Matrícula","Turma / série","Responsável financeiro","Financeiro"])assert.match(ui,new RegExp(label));
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

test("mostra no painel e cadastro a atualização de alunos pela API",()=>{
  assert.match(livePages,/Atualização API alunos/);
  assert.match(livePages,/atualizado\(s\) pela SWeduc/);
  assert.match(livePages,/sweduc_atualizado_em/);
  assert.match(livePages,/Atualização API/);
  assert.match(livePages,/Manual \/ sem API/);
});

test("permite buscar aluno SWeduc no cadastro e no assistente sem abrir configurações",()=>{
  assert.match(livePages,/SweducOperationalPicker/);
  assert.match(assistant,/SweducOperationalPicker/);
  assert.match(operationalPicker,/Buscar aluno na SWeduc/);
  assert.match(operationalPicker,/Ano letivo/);
  assert.match(operationalPicker,/responsável financeiro/i);
  assert.match(operationalPicker,/Confirmar responsável financeiro/);
  assert.match(operationalPicker,/Selecionar aluno/);
  assert.match(operationalPicker,/Carregar para a nota/);
  assert.match(operationalPicker,/action:"lookup"/);
  assert.match(operationalPicker,/action:"details"/);
  assert.match(operationalPicker,/action:"import"/);
  assert.match(operationalPicker,/Segmento \/ curso/);
  assert.match(operationalPicker,/Série/);
  assert.match(operationalPicker,/Turma/);
  assert.match(operationalPicker,/sortStudents/);
  assert.match(route,/action==="lookup"/);
  assert.match(operationalPicker,/course:courseFilter/);
  assert.match(operationalPicker,/serie:serieFilter/);
  assert.match(operationalPicker,/turma:turmaFilter/);
  assert.match(route,/students\.view/);
  assert.match(route,/students\.create/);
  assert.match(route,/nfse\.prepare/);
});

test("sincroniza automaticamente o espelho SWeduc sem alterar Agenda Edu nem cadastro fiscal",()=>{
  assert.match(vercelConfig,/\/api\/cron\/sweduc-sync/);
  assert.match(vercelConfig,/"schedule": "0 9 \* \* \*"/);
  assert.match(cronRoute,/CRON_SECRET/);
  assert.match(cronRoute,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(cronRoute,/get_sweduc_secret_service/);
  assert.match(cronRoute,/getSweducActiveAcademicYear/);
  assert.match(cronRoute,/listSweducStudentsWithToken/);
  assert.match(cronRoute,/from\("sweduc_alunos"\)\.upsert/);
  assert.doesNotMatch(cronRoute,/from\("alunos"\)\.(insert|update|upsert|delete)/);
  assert.doesNotMatch(cronRoute,/agenda_edu/);
  assert.match(automaticSyncMigration,/get_sweduc_secret_service/);
  assert.match(automaticSyncMigration,/sweduc_alunos_ano_letivo_idx/);
  assert.match(automaticSyncMigration,/sweduc_alunos_sincronizado_em_idx/);
  assert.match(automaticSyncMigration,/students\.view/);
  assert.match(route,/from\("sweduc_alunos"\)\.select/);
  assert.match(route,/\.eq\("ano_letivo",String\(rawYear\)\)/);
  assert.match(route,/\.eq\("curso",course\)/);
  assert.match(route,/\.eq\("serie",serie\)/);
  assert.match(route,/\.eq\("turma",turma\)/);
});
