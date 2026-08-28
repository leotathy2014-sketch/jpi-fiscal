import assert from "node:assert/strict";
import test from "node:test";
import { parseAgendaEduCredentials, resolveAgendaEduFamilyChat, sendAgendaEduAttachment, serializeAgendaEduCredentials, testAgendaEduConnection } from "../lib/agenda-edu.ts";

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
