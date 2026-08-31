import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as protectedDelivery from "../lib/protected-delivery.ts";
import { buildDanfsePdf } from "../lib/danfse-pdf.ts";

const require=createRequire(import.meta.url);
const nextServer=require("next/server") as typeof import("next/server");
const token="A".repeat(43);
const secret="fixture-only-not-a-production-credential";
const key="3".repeat(50);
const xml=`<NFSe><infNFSe><chNFSe>${key}</chNFSe><nNFSe>1</nNFSe><emit><xNome>EMISSOR FICTICIO</xNome></emit></infNFSe></NFSe>`;
const record={chave_acesso:key,xml_base64:Buffer.from(xml).toString("base64")};
const context={params:Promise.resolve({token})};
type RpcResult={data:unknown;error:{code:string;message?:string}|null};
type Route=(request:InstanceType<typeof nextServer.NextRequest>,context:{params:Promise<{token:string}>})=>Promise<Response>;

function loadRoute(source:string,result:RpcResult){
  const calls:string[]=[];
  const errors:unknown[][]=[];
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const routeModule={exports:{} as {GET:Route;POST:Route}};
  const dependencies:Record<string,unknown>={
    "next/server":nextServer,
    "@/lib/danfse-pdf":{buildDanfsePdf},
    "@/lib/protected-delivery":{...protectedDelivery,backendSecret:()=>secret,publicSupabase:()=>({rpc:async(name:string)=>{calls.push(name);return result}})},
  };
  new Function("require","module","exports","console",compiled)((name:string)=>{
    if(!(name in dependencies))throw new Error(`Dependência de teste inesperada: ${name}`);
    return dependencies[name];
  },routeModule,routeModule.exports,{error:(...args:unknown[])=>errors.push(args)});
  return {route:routeModule.exports,calls,errors};
}

function request(path="",cookie?:string){
  return new nextServer.NextRequest(`https://example.test/api/public/nfse/${token}${path}`,{headers:cookie?{cookie}:{}});
}

const migrationSource=readFileSync(new URL("../supabase/migrations/20260831115246_corrigir_abertura_link_protegido_nfse.sql",import.meta.url),"utf8");
const inspectRouteSource=readFileSync(new URL("../app/api/public/nfse/[token]/route.ts",import.meta.url),"utf8");
const openRouteSource=readFileSync(new URL("../app/api/public/nfse/[token]/open/route.ts",import.meta.url),"utf8");
const documentRouteSource=readFileSync(new URL("../app/api/public/nfse/[token]/document/route.ts",import.meta.url),"utf8");

test("qualifica as colunas da abertura para evitar ambiguidade no PL/pgSQL",()=>{
  assert.match(migrationSource,/select l\.\* into selected/);
  assert.match(migrationSource,/l\.token_hash = p_token_hash/);
  assert.match(migrationSource,/l\.expires_at > opened_at/);
  assert.match(migrationSource,/for update of l/);
  assert.match(migrationSource,/coalesce\(l\.visualizado_em,opened_at\)/);
  assert.match(migrationSource,/coalesce\(e\.visualizado_em,opened_at\)/);
  assert.doesNotMatch(migrationSource,/where token_hash=p_token_hash and expires_at/);
});

test("distingue link vencido de uma falha interna do banco",()=>{
  for(const source of [inspectRouteSource,openRouteSource,documentRouteSource]){
    assert.match(source,/if\(error\).*503/);
    assert.match(source,/if\(!record/);
  }
  assert.match(openRouteSource,/Falha ao abrir link protegido/);
  assert.match(documentRouteSource,/Falha ao ler documento protegido/);
});

test("consulta a validade sem retornar documentos nem registrar abertura",async()=>{
  const fixture=loadRoute(inspectRouteSource,{data:[{valid:true,competencia:"08/2026",expires_at:"2026-09-30T00:00:00Z",visualizado_em:null}],error:null});
  const response=await fixture.route.GET(request(),context);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,competence:"08/2026",expiresAt:"2026-09-30T00:00:00Z",viewedAt:null});
  assert.deepEqual(fixture.calls,["inspect_nfse_delivery_access"]);
});

test("abre o link e libera PDF e XML apenas com o cookie assinado",async()=>{
  const opening=loadRoute(openRouteSource,{data:[record],error:null});
  const response=await opening.route.POST(request("/open"),context);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true});
  const cookie=response.headers.get("set-cookie")||"";
  assert.match(cookie,/HttpOnly/i);
  assert.match(cookie,/Secure/i);
  assert.match(cookie,/SameSite=strict/i);
  assert.match(cookie,/Max-Age=1800/i);
  assert.deepEqual(opening.calls,["open_nfse_delivery_access"]);
  const cookiePair=cookie.split(";")[0];

  const document=loadRoute(documentRouteSource,{data:[record],error:null});
  const pdf=await document.route.GET(request("/document?format=pdf&disposition=inline",cookiePair),context);
  assert.equal(pdf.status,200);
  assert.equal(pdf.headers.get("content-type"),"application/pdf");
  const pdfBytes=Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0,8).toString(),"%PDF-1.4");
  assert.match(pdfBytes.toString("latin1"),/%%EOF/);
  assert.equal(pdf.headers.get("cache-control"),"private, no-store, max-age=0");

  const xmlResponse=await document.route.GET(request("/document?format=xml&disposition=attachment",cookiePair),context);
  assert.equal(xmlResponse.status,200);
  assert.equal(await xmlResponse.text(),xml);
  assert.match(xmlResponse.headers.get("content-disposition")||"",/^attachment;/);
  assert.deepEqual(document.calls,["read_nfse_delivery_access","read_nfse_delivery_access"]);
});

test("não libera documentos com cookie ausente, adulterado ou de outro link",async()=>{
  const fixture=loadRoute(documentRouteSource,{data:[record],error:null});
  const otherLinkCookie=`${protectedDelivery.protectedViewCookie}=${protectedDelivery.createViewCookie("B".repeat(43),secret)}`;
  for(const cookie of [undefined,`${protectedDelivery.protectedViewCookie}=adulterado`,otherLinkCookie]){
    const response=await fixture.route.GET(request("/document?format=pdf&disposition=inline",cookie),context);
    assert.equal(response.status,403);
  }
  assert.deepEqual(fixture.calls,[]);
});

test("retorna 503 para erro do banco sem vazar token, XML ou detalhes internos",async()=>{
  const cookie=`${protectedDelivery.protectedViewCookie}=${protectedDelivery.createViewCookie(token,secret)}`;
  for(const [source,method,path] of [[inspectRouteSource,"GET",""],[openRouteSource,"POST","/open"],[documentRouteSource,"GET","/document?format=pdf&disposition=inline"]] as const){
    const fixture=loadRoute(source,{data:null,error:{code:"42702",message:"detalhe-interno-nao-publicar"}});
    const response=await fixture.route[method](request(path,cookie),context);
    assert.equal(response.status,503);
    const body=await response.text();
    assert.doesNotMatch(body,/expirou|42702|detalhe-interno/);
    assert.equal(response.headers.get("set-cookie"),null);
    assert.equal(fixture.errors.length,1);
    assert.deepEqual(fixture.errors[0][1],{code:"42702"});
  }
});

test("mantém 404 para links não encontrados ou vencidos",async()=>{
  const opening=loadRoute(openRouteSource,{data:[],error:null});
  const openResponse=await opening.route.POST(request("/open"),context);
  assert.equal(openResponse.status,404);
  assert.equal(openResponse.headers.get("set-cookie"),null);
  const inspecting=loadRoute(inspectRouteSource,{data:[{valid:false}],error:null});
  assert.equal((await inspecting.route.GET(request(),context)).status,404);
});
