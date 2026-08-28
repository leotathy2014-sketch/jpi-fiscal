export const AGENDA_EDU_ENDPOINTS={
  sandboxBaseUrl:"https://sandbox-api.agendaedu.dev/v2",
  sandboxTokenUrl:"https://sandbox-api.agendaedu.dev/oauth/v2/token",
  productionBaseUrl:"https://api.agendaedu.com/v2",
  productionTokenUrl:"https://api.agendaedu.com/oauth/v2/token",
} as const;

export type AgendaEduCredentials={clientId:string;clientSecret:string;schoolToken:string};
type FetchLike=typeof fetch;
type AgendaResource={id?:string|number;attributes?:Record<string,unknown>};

export function serializeAgendaEduCredentials(credentials:AgendaEduCredentials){
  return JSON.stringify(credentials);
}

export function parseAgendaEduCredentials(value:string):AgendaEduCredentials{
  let parsed:Partial<AgendaEduCredentials>={};
  try{parsed=JSON.parse(value) as Partial<AgendaEduCredentials>}catch{throw new Error("A credencial protegida da Agenda Edu precisa ser cadastrada novamente.")}
  const clientId=String(parsed.clientId||"").trim();
  const clientSecret=String(parsed.clientSecret||"").trim();
  const schoolToken=String(parsed.schoolToken||"").trim();
  if(!clientId||!clientSecret||!schoolToken)throw new Error("A credencial protegida da Agenda Edu está incompleta.");
  return {clientId,clientSecret,schoolToken};
}

async function responseMessage(response:Response,fallback:string){
  const data=await response.json().catch(()=>({})) as {error?:string;error_description?:string;message?:string};
  return data.error_description||data.message||data.error||fallback;
}

export async function createAgendaEduAccessToken(credentials:AgendaEduCredentials,fetchImpl:FetchLike=fetch){
  const body=new URLSearchParams({grant_type:"client_credentials",client_id:credentials.clientId,client_secret:credentials.clientSecret});
  const response=await fetchImpl(AGENDA_EDU_ENDPOINTS.sandboxTokenUrl,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body,cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não aceitou as credenciais de homologação."));
  const result=await response.json() as {access_token?:string;expires_in?:number};
  if(!result.access_token)throw new Error("A Agenda Edu não retornou o token de acesso esperado.");
  return {accessToken:result.access_token,expiresIn:Number(result.expires_in||7200)};
}

export async function testAgendaEduConnection(credentials:AgendaEduCredentials,fetchImpl:FetchLike=fetch){
  const token=await createAgendaEduAccessToken(credentials,fetchImpl);
  const response=await fetchImpl(`${AGENDA_EDU_ENDPOINTS.sandboxBaseUrl}/channels?page%5Bsize%5D=1`,{headers:{Accept:"application/json",Authorization:`Bearer ${token.accessToken}`,"x-school-token":credentials.schoolToken},cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não confirmou o acesso à escola no Sandbox."));
  const result=await response.json() as {data?:Array<{id?:string;attributes?:{name?:string}}>};
  const firstChannel=result.data?.[0];
  return {expiresIn:token.expiresIn,channelId:firstChannel?.id||null,channelName:firstChannel?.attributes?.name||null};
}

function agendaHeaders(accessToken:string,schoolToken:string){
  return {Accept:"application/json",Authorization:`Bearer ${accessToken}`,"x-school-token":schoolToken};
}

function resourceId(value:unknown){
  if(!value||typeof value!=="object")return null;
  const record=value as {id?:string|number;data?:AgendaResource};
  return String(record.data?.id??record.id??"").trim()||null;
}

export async function findAgendaEduFamilyChat(input:{accessToken:string;schoolToken:string;channelId:string;studentId:string;useExternalId:boolean},fetchImpl:FetchLike=fetch){
  const query=new URLSearchParams({"filter[kind]":"family","filter[studentId]":input.studentId,"filter[useExternalId]":String(input.useExternalId),"page[size]":"1"});
  const response=await fetchImpl(`${AGENDA_EDU_ENDPOINTS.sandboxBaseUrl}/channels/${encodeURIComponent(input.channelId)}/chats?${query}`,{headers:agendaHeaders(input.accessToken,input.schoolToken),cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não permitiu localizar a mensagem do aluno."));
  const result=await response.json() as {data?:AgendaResource[]};
  return String(result.data?.[0]?.id??"").trim()||null;
}

export async function createAgendaEduFamilyChat(input:{accessToken:string;schoolToken:string;channelId:string;studentId:string;useExternalId:boolean},fetchImpl:FetchLike=fetch){
  const response=await fetchImpl(`${AGENDA_EDU_ENDPOINTS.sandboxBaseUrl}/channels/${encodeURIComponent(input.channelId)}/chats`,{method:"POST",headers:{...agendaHeaders(input.accessToken,input.schoolToken),"Content-Type":"application/json"},body:JSON.stringify({studentId:input.studentId,kind:"family",useExternalId:input.useExternalId}),cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não permitiu preparar a mensagem para os responsáveis deste aluno."));
  const id=resourceId(await response.json());
  if(!id)throw new Error("A Agenda Edu não retornou a identificação da mensagem preparada para o aluno.");
  return id;
}

export async function resolveAgendaEduFamilyChat(input:{accessToken:string;schoolToken:string;channelId:string;studentId:string;useExternalId:boolean},fetchImpl:FetchLike=fetch){
  return await findAgendaEduFamilyChat(input,fetchImpl)||await createAgendaEduFamilyChat(input,fetchImpl);
}

export async function sendAgendaEduAttachment(input:{accessToken:string;schoolToken:string;channelId:string;chatId:string;content:string;filename:string;contentType:string;bytes:Uint8Array},fetchImpl:FetchLike=fetch){
  const form=new FormData();
  const attachmentBytes=new Uint8Array(input.bytes.byteLength);attachmentBytes.set(input.bytes);
  form.append("content",input.content);
  form.append("chatIds[]",input.chatId);
  form.append("attachment",new Blob([attachmentBytes.buffer],{type:input.contentType}),input.filename);
  const response=await fetchImpl(`${AGENDA_EDU_ENDPOINTS.sandboxBaseUrl}/channels/${encodeURIComponent(input.channelId)}/messages/`,{method:"POST",headers:agendaHeaders(input.accessToken,input.schoolToken),body:form,cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não aceitou um dos documentos da NFS-e."));
  const id=resourceId(await response.json());
  if(!id)throw new Error("A Agenda Edu aceitou a solicitação sem retornar a identificação da mensagem.");
  return id;
}
