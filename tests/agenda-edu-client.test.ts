import assert from "node:assert/strict";
import test from "node:test";
import { parseAgendaEduCredentials, resolveAgendaEduFamilyChat, searchAgendaEduStudents, sendAgendaEduAttachment, serializeAgendaEduCredentials, testAgendaEduConnection } from "../lib/agenda-edu.ts";

test("mantém as três credenciais juntas no segredo protegido",()=>{
  const credentials={clientId:"cliente-teste",clientSecret:"segredo-teste",schoolToken:"escola-teste"};
  assert.deepEqual(parseAgendaEduCredentials(serializeAgendaEduCredentials(credentials)),credentials);
  assert.throws(()=>parseAgendaEduCredentials("{}"),/incompleta/);
});

test("localiza o chat de família e envia um único anexo por mensagem",async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const fakeFetch:typeof fetch=async(input,init)=>{const url=String(input);calls.push({url,init});if(url.includes("/chats?"))return new Response(JSON.stringify({data:[{id:"chat-10"}]}),{status:200});return new Response(JSON.stringify({data:{id:"message-20"}}),{status:201});};
  const common={accessToken:"token",schoolToken:"school",channelId:"channel-1",studentId:"student-1",useExternalId:false};
  const chatId=await resolveAgendaEduFamilyChat(common,fakeFetch);
  const messageId=await sendAgendaEduAttachment({...common,chatId,content:"Documento fiscal",filename:"nota.pdf",contentType:"application/pdf",bytes:new Uint8Array([1,2,3])},fakeFetch);
  assert.equal(chatId,"chat-10");assert.equal(messageId,"message-20");assert.match(calls[0].url,/filter%5Bkind%5D=family/);assert.match(calls[1].url,/\/messages\/$/);
  const form=calls[1].init?.body as FormData;assert.equal(form.get("chatIds[]"),"chat-10");assert.equal((form.get("attachment") as File).name,"nota.pdf");
});

test("cria chat familiar apenas quando o aluno ainda não possui um",async()=>{
  let call=0;const fakeFetch:typeof fetch=async()=>{call++;if(call===1)return new Response(JSON.stringify({data:[]}),{status:200});return new Response(JSON.stringify({data:{id:"chat-new"}}),{status:201});};
  const chatId=await resolveAgendaEduFamilyChat({accessToken:"token",schoolToken:"school",channelId:"channel",studentId:"student",useExternalId:true},fakeFetch);
  assert.equal(chatId,"chat-new");assert.equal(call,2);
});

test("gera o OAuth e consulta canais no Sandbox sem criar mensagem",async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const fakeFetch:typeof fetch=async(input,init)=>{
    const url=String(input);calls.push({url,init});
    if(url.endsWith("/oauth/v2/token"))return new Response(JSON.stringify({access_token:"token-temporario",expires_in:7200}),{status:200,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify({data:[{id:"1000",attributes:{name:"Geral"}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const result=await testAgendaEduConnection({clientId:"cliente",clientSecret:"segredo",schoolToken:"escola"},fakeFetch);
  assert.equal(result.channelId,"1000");
  assert.equal(result.channelName,"Geral");
  assert.equal(calls.length,2);
  assert.match(String(calls[0].init?.body),/grant_type=client_credentials/);
  assert.equal((calls[1].init?.headers as Record<string,string>)["x-school-token"],"escola");
  assert.doesNotMatch(calls.map(call=>call.url).join(" "),/\/messages/);
});

test("na plataforma oficial tenta Basic Auth se o token no corpo falhar",async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const fakeFetch:typeof fetch=async(input,init)=>{
    const url=String(input);calls.push({url,init});
    if(url.endsWith("/oauth/v2/token")&&calls.length===1)return new Response(JSON.stringify({error_description:"cliente desconhecido"}),{status:401,headers:{"Content-Type":"application/json"}});
    if(url.endsWith("/oauth/v2/token"))return new Response(JSON.stringify({access_token:"token-oficial",expires_in:7200}),{status:200,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify({data:[{id:"2000",attributes:{name:"Famílias"}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const result=await testAgendaEduConnection({clientId:"cliente",clientSecret:"segredo",schoolToken:"escola"},fakeFetch,"producao");
  assert.equal(result.channelId,"2000");
  assert.match(calls[0].url,/api\.agendaedu\.com\/oauth\/v2\/token/);
  assert.equal(String((calls[0].init?.body as URLSearchParams).get("client_id")),"cliente");
  assert.match(String((calls[1].init?.headers as Record<string,string>).Authorization),/^Basic /);
  assert.match(calls[2].url,/api\.agendaedu\.com\/v2\/channels/);
});

test("localiza aluno na Agenda Edu por nome e turma antes de abrir chat familiar",async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const fakeFetch:typeof fetch=async(input,init)=>{
    const url=String(input);calls.push({url,init});
    return new Response(JSON.stringify({student_profiles:[{id:"stu-9193",nome:"ZION FERREIRA DA COSTA ANDRADE",nome_da_turma:"601",nome_da_serie:"Ensino Fundamental 2",external_ids:"9193"}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const result=await searchAgendaEduStudents({accessToken:"token",schoolToken:"school",name:"Zion Ferreira da Costa Andrade",className:"601",grade:"Ensino Fundamental 2",externalId:"9193"},fakeFetch);
  assert.equal(result.candidates[0].id,"stu-9193");
  assert.ok(result.candidates[0].score>=95);
  assert.match(calls[0].url,/\/student_profiles\?/);
  assert.match(calls[0].url,/external_ids/);
  assert.equal((calls[0].init?.headers as Record<string,string>)["x-school-token"],"school");
});

test("não aceita candidato de aluno com nome diferente quando a busca retorna lista ampla",async()=>{
  const fakeFetch:typeof fetch=async()=>new Response(JSON.stringify({student_profiles:[
    {id:"stu-errado",nome:"ANA CLARA ABREU DA SILVA",nome_da_turma:"701",external_ids:["1111"]},
    {id:"stu-certo",nome:"ANA LUIZA ABREU DA SILVA",nome_da_turma:"701",external_ids:["8945"]},
  ]}),{status:200,headers:{"Content-Type":"application/json"}});
  const result=await searchAgendaEduStudents({accessToken:"token",schoolToken:"school",name:"ANA LUIZA ABREU DA SILVA",className:"701",externalId:"8945",environment:"producao"},fakeFetch);
  assert.equal(result.candidates[0].id,"stu-certo");
  assert.equal(result.candidates.length,1);
});
