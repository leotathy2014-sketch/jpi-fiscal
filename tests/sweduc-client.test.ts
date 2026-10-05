import assert from "node:assert/strict";
import test from "node:test";
import {createSweducAccessToken,currentSweducAcademicYear,filterSweducActiveEnrollments,getSweducStudentDetailsWithToken,inferSweducSegment,isSweducActiveEnrollment,listSweducStudentsWithToken,mapSweducToFiscalStudent,normalizeSweducHost,parseSweducCredentials,resolveSweducEnabledAcademicYear,serializeSweducCredentials} from "../lib/sweduc.ts";

const credentials={host:"https://joaopauloi.escolarsw.com.br",clientId:"cliente",clientSecret:"segredo"};

test("normaliza somente hosts HTTPS oficiais da SWeduc",()=>{
  assert.equal(normalizeSweducHost("https://joaopauloi.escolarsw.com.br/"),"https://joaopauloi.escolarsw.com.br");
  assert.equal(normalizeSweducHost("https://escola.sweduc.com.br/"),"https://escola.sweduc.com.br");
  assert.throws(()=>normalizeSweducHost("http://escola.sweduc.com.br"),/HTTPS/);
  assert.throws(()=>normalizeSweducHost("https://localhost"),/HOST oficial/);
  assert.throws(()=>normalizeSweducHost("https://example.com"),/HOST oficial/);
  assert.throws(()=>normalizeSweducHost("https://falsoescolarsw.com.br"),/HOST oficial/);
});

test("mantém as credenciais e o método de autenticação no segredo protegido",()=>{
  assert.deepEqual(parseSweducCredentials(serializeSweducCredentials(credentials)),{...credentials,grantType:"client_credentials"});
  const passwordCredentials={...credentials,grantType:"password" as const,username:"usuario",password:"senha"};
  assert.deepEqual(parseSweducCredentials(serializeSweducCredentials(passwordCredentials)),passwordCredentials);
  assert.deepEqual(parseSweducCredentials(JSON.stringify(credentials)),{...credentials,grantType:"client_credentials"});
  assert.throws(()=>parseSweducCredentials("{}"),/HOST válido|incompletas/);
});

test("gera OAuth client_credentials com autenticação Basic sem credenciais na URL",async()=>{
  let capturedUrl="";let capturedInit:RequestInit|undefined;
  const fakeFetch:typeof fetch=async(input,init)=>{capturedUrl=String(input);capturedInit=init;return new Response(JSON.stringify({access_token:"token",expires_in:3600}),{status:200,headers:{"Content-Type":"application/json"}})};
  const result=await createSweducAccessToken(credentials,fakeFetch);
  assert.equal(result.accessToken,"token");
  assert.equal(capturedUrl,"https://joaopauloi.escolarsw.com.br/oauth/v2/token");
  assert.match(String(capturedInit?.body),/grant_type=client_credentials/);
  assert.doesNotMatch(String(capturedInit?.body),/username|password/);
  assert.doesNotMatch(capturedUrl,/cliente|segredo/);
  assert.match(String((capturedInit?.headers as Record<string,string>).Authorization),/^Basic /);
  assert.equal(capturedInit?.redirect,"error");
  assert.ok(capturedInit?.signal instanceof AbortSignal);
});

test("usa OAuth password com Basic e somente usuário e senha no formulário",async()=>{
  let capturedUrl="";let capturedInit:RequestInit|undefined;
  const fakeFetch:typeof fetch=async(input,init)=>{capturedUrl=String(input);capturedInit=init;return new Response(JSON.stringify({access_token:"token-password",expires_in:3600}),{status:200,headers:{"Content-Type":"application/json"}})};
  const result=await createSweducAccessToken(credentials,fakeFetch,{grantType:"password",username:"usuario-teste",password:"senha-teste"});
  assert.equal(result.accessToken,"token-password");
  assert.equal(capturedUrl,"https://joaopauloi.escolarsw.com.br/oauth/v2/token");
  assert.match(String(capturedInit?.body),/grant_type=password/);
  assert.doesNotMatch(String(capturedInit?.body),/client_id|client_secret|cliente|segredo/);
  assert.match(String(capturedInit?.body),/username=usuario-teste/);
  assert.match(String(capturedInit?.body),/password=senha-teste/);
  assert.doesNotMatch(capturedUrl,/usuario-teste|senha-teste|cliente|segredo/);
  assert.match(String((capturedInit?.headers as Record<string,string>).Authorization),/^Basic /);
});

test("usa automaticamente o fluxo password salvo no cofre",async()=>{
  let capturedInit:RequestInit|undefined;
  const fakeFetch:typeof fetch=async(_input,init)=>{capturedInit=init;return new Response(JSON.stringify({access_token:"token-salvo"}),{status:200,headers:{"Content-Type":"application/json"}})};
  const result=await createSweducAccessToken({...credentials,grantType:"password",username:"usuario-salvo",password:"senha-salva"},fakeFetch);
  assert.equal(result.accessToken,"token-salvo");
  assert.match(String(capturedInit?.body),/grant_type=password/);
  assert.match(String(capturedInit?.body),/username=usuario-salvo/);
  assert.match(String(capturedInit?.body),/password=senha-salva/);
  assert.match(String((capturedInit?.headers as Record<string,string>).Authorization),/^Basic /);
});

test("seleciona o ano letivo mais novo que possui matrículas ativas",async()=>{
  const urls:string[]=[];
  const fakeFetch:typeof fetch=async(input)=>{
    const url=String(input);urls.push(url);
    if(url.includes("anos-letivos"))return new Response(JSON.stringify([{id:40,anoletivo:2028},{id:39,anoletivo:2027},{id:38,anoletivo:2026}]),{status:200,headers:{"Content-Type":"application/json"}});
    if(url.includes("ano_letivo_id=40"))return new Response(JSON.stringify({data:[],total:0,last_page:1}),{status:200,headers:{"Content-Type":"application/json"}});
    if(url.includes("ano_letivo_id=39"))return new Response(JSON.stringify({data:[{nome:"Aluno novo",matricula_id:2027,status:"Matriculado"}],total:1,last_page:1}),{status:200,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify({data:[{nome:"Aluno antigo",matricula_id:2026,status:"Matriculado"}],total:1,last_page:1}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  assert.equal(currentSweducAcademicYear(new Date("2026-09-03T12:00:00Z")),2026);
  const resolved=await resolveSweducEnabledAcademicYear(credentials.host,"token",fakeFetch,new Date("2026-09-03T12:00:00Z"));
  assert.deepEqual(resolved.selected,{id:39,year:2027});
  assert.match(urls[0],/api\/public\/v1\/academico\/anos-letivos/);
  assert.ok(!urls.some(url=>url.includes("ano_letivo_id=40")),"anos além do próximo período não devem ser considerados habilitados");
  assert.ok(urls.some(url=>url.includes("ano_letivo_id=39")));
});

test("mantém somente matrículas ativas e rejeita canceladas ou encerradas",()=>{
  const rows=[
    {status:"Matriculado",matricula_id:1},
    {status:"Pré-matrícula ativa",matricula_id:2},
    {status:"Cancelado",matricula_id:3},
    {status:"Turma encerrada",matricula_id:4},
  ];
  assert.equal(isSweducActiveEnrollment(rows[0]),true);
  assert.equal(isSweducActiveEnrollment(rows[2]),false);
  assert.deepEqual(filterSweducActiveEnrollments(rows).map(row=>row.matricula_id),[1,2]);
});

test("usa os endpoints oficiais de listagem e detalhes",async()=>{
  const urls:string[]=[];const fakeFetch:typeof fetch=async(input)=>{const url=String(input);urls.push(url);const payload=url.includes("detalhes")?{detalhes:{matricula_id:101},responsaveis:[{nome:"Maria"}],financeiro:[{titulo_id:7}]}:url.includes("financeiro")||url.includes("titulos")?{}:{current_page:1,data:[{nome:"João",matricula_id:101}],last_page:1,total:1};return new Response(JSON.stringify(payload),{status:200,headers:{"Content-Type":"application/json"}})};
  const listing=await listSweducStudentsWithToken(credentials.host,"token",{page:1,search:"João"},fakeFetch);
  const detail=await getSweducStudentDetailsWithToken(credentials.host,"token",101,fakeFetch);
  assert.equal(listing.total,1);assert.equal(detail.responsaveis.length,1);assert.equal(detail.financeiro.length,1);
  assert.match(urls[0],/\/api\/v2\/alunos\/listar\?page=1&search=Jo%C3%A3o/);
  assert.match(urls[1],/\/api\/v2\/alunos\/detalhes\?matricula_id=101/);
});

test("classifica turma de pré-escola antes de fundamental",()=>{
  assert.equal(inferSweducSegment("1º ao 5º anos","", "PRÉ-I/M"),"Pré-escola");
  assert.equal(inferSweducSegment("Educação Infantil","Maternal 1","MATERNAL/M"),"Maternal");
  assert.equal(inferSweducSegment("Ensino Fundamental 2","6º Ano","601"),"6º ao 9º anos");
});

test("mantém o curso real da SWeduc como segmento fiscal",()=>{
  const student=mapSweducToFiscalStudent({
    student:{nome:"Alana de Souza Garcia",curso:"Educação Infantil",serie:"",turma:"PRÉ-I/M",matricula_id:1,aluno_id:1,data_nascimento:null,num_aluno:null,num_matricula:null,status:null,unidade:null,ano_letivo:"2026"},
    responsible:{nome:"Felipe Garcia de Barros",cpf:"12345678901"},
    details:{}
  });
  assert.equal(student.segmento,"Educação Infantil");
  assert.equal(student.turma,"PRÉ-I/M");
});
