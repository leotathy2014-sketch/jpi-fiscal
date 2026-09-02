import assert from "node:assert/strict";
import test from "node:test";
import {createSweducAccessToken,getSweducStudentDetailsWithToken,listSweducStudentsWithToken,normalizeSweducHost,parseSweducCredentials,serializeSweducCredentials} from "../lib/sweduc.ts";

const credentials={host:"https://joaopauloi.escolarsw.com.br",clientId:"cliente",clientSecret:"segredo"};

test("normaliza somente hosts HTTPS oficiais da SWeduc",()=>{
  assert.equal(normalizeSweducHost("https://joaopauloi.escolarsw.com.br/"),"https://joaopauloi.escolarsw.com.br");
  assert.equal(normalizeSweducHost("https://escola.sweduc.com.br/"),"https://escola.sweduc.com.br");
  assert.throws(()=>normalizeSweducHost("http://escola.sweduc.com.br"),/HTTPS/);
  assert.throws(()=>normalizeSweducHost("https://localhost"),/HOST oficial/);
  assert.throws(()=>normalizeSweducHost("https://example.com"),/HOST oficial/);
  assert.throws(()=>normalizeSweducHost("https://falsoescolarsw.com.br"),/HOST oficial/);
});

test("mantém as três credenciais juntas no segredo protegido",()=>{
  assert.deepEqual(parseSweducCredentials(serializeSweducCredentials(credentials)),credentials);
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

test("usa os endpoints oficiais de listagem e detalhes",async()=>{
  const urls:string[]=[];const fakeFetch:typeof fetch=async(input)=>{const url=String(input);urls.push(url);return new Response(JSON.stringify(url.includes("detalhes")?{detalhes:{matricula_id:101},responsaveis:[{nome:"Maria"}],financeiro:[{titulo_id:7}]}:{current_page:1,data:[{nome:"João",matricula_id:101}],last_page:1,total:1}),{status:200,headers:{"Content-Type":"application/json"}})};
  const listing=await listSweducStudentsWithToken(credentials.host,"token",{page:1,search:"João"},fakeFetch);
  const detail=await getSweducStudentDetailsWithToken(credentials.host,"token",101,fakeFetch);
  assert.equal(listing.total,1);assert.equal(detail.responsaveis.length,1);assert.equal(detail.financeiro.length,1);
  assert.match(urls[0],/\/api\/v2\/alunos\/listar\?page=1&search=Jo%C3%A3o/);
  assert.match(urls[1],/\/api\/v2\/alunos\/detalhes\?matricula_id=101/);
});
