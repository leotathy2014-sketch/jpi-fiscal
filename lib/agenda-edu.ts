export const AGENDA_EDU_ENDPOINTS={
  sandboxBaseUrl:"https://sandbox-api.agendaedu.dev/v2",
  sandboxTokenUrl:"https://sandbox-api.agendaedu.dev/oauth/v2/token",
  productionBaseUrl:"https://api.agendaedu.com/v2",
  productionTokenUrl:"https://api.agendaedu.com/oauth/v2/token",
} as const;

export type AgendaEduCredentials={clientId:string;clientSecret:string;schoolToken:string};
export type AgendaEduEnvironment="homologacao"|"producao";
type FetchLike=typeof fetch;
type AgendaResource={id?:string|number;attributes?:Record<string,unknown>};
export type AgendaEduStudentCandidate={id:string;name:string;className:string|null;grade:string|null;externalId:string|null;raw:Record<string,unknown>};

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

function agendaBaseUrl(environment:AgendaEduEnvironment="homologacao"){
  return environment==="producao"?AGENDA_EDU_ENDPOINTS.productionBaseUrl:AGENDA_EDU_ENDPOINTS.sandboxBaseUrl;
}

function agendaTokenUrl(environment:AgendaEduEnvironment="homologacao"){
  return environment==="producao"?AGENDA_EDU_ENDPOINTS.productionTokenUrl:AGENDA_EDU_ENDPOINTS.sandboxTokenUrl;
}

export async function createAgendaEduAccessToken(credentials:AgendaEduCredentials,fetchImpl:FetchLike=fetch,environment:AgendaEduEnvironment="homologacao"){
  const body=new URLSearchParams({grant_type:"client_credentials",client_id:credentials.clientId,client_secret:credentials.clientSecret});
  const response=await fetchImpl(agendaTokenUrl(environment),{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body,cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,environment==="producao"?"A Agenda Edu não aceitou as credenciais da plataforma oficial.":"A Agenda Edu não aceitou as credenciais de homologação."));
  const result=await response.json() as {access_token?:string;expires_in?:number};
  if(!result.access_token)throw new Error("A Agenda Edu não retornou o token de acesso esperado.");
  return {accessToken:result.access_token,expiresIn:Number(result.expires_in||7200)};
}

export async function testAgendaEduConnection(credentials:AgendaEduCredentials,fetchImpl:FetchLike=fetch,environment:AgendaEduEnvironment="homologacao"){
  const token=await createAgendaEduAccessToken(credentials,fetchImpl,environment);
  const response=await fetchImpl(`${agendaBaseUrl(environment)}/channels?page%5Bsize%5D=1`,{headers:{Accept:"application/json",Authorization:`Bearer ${token.accessToken}`,"x-school-token":credentials.schoolToken},cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,environment==="producao"?"A Agenda Edu não confirmou o acesso à escola na plataforma oficial.":"A Agenda Edu não confirmou o acesso à escola no Sandbox."));
  const result=await response.json() as {data?:Array<{id?:string;attributes?:{name?:string}}>};
  const firstChannel=result.data?.[0];
  return {expiresIn:token.expiresIn,channelId:firstChannel?.id||null,channelName:firstChannel?.attributes?.name||null};
}

function agendaHeaders(accessToken:string,schoolToken:string){
  return {Accept:"application/json",Authorization:`Bearer ${accessToken}`,"x-school-token":schoolToken};
}

function normalize(value:string){
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi," ").trim().toLocaleLowerCase("pt-BR");
}

function agendaAttr(resource:AgendaResource,key:string){
  const attributes=resource.attributes||{};
  return String(attributes[key]??(resource as unknown as Record<string,unknown>)[key]??"").trim();
}

function mapAgendaStudent(resource:AgendaResource):AgendaEduStudentCandidate|null{
  const id=String(resource.id??"").trim();
  const name=agendaAttr(resource,"name")||agendaAttr(resource,"nome")||agendaAttr(resource,"studentName");
  if(!id||!name)return null;
  const className=agendaAttr(resource,"className")||agendaAttr(resource,"classroom")||agendaAttr(resource,"turma")||agendaAttr(resource,"class")||null;
  const grade=agendaAttr(resource,"grade")||agendaAttr(resource,"serie")||agendaAttr(resource,"segment")||null;
  const externalId=agendaAttr(resource,"externalId")||agendaAttr(resource,"external_id")||agendaAttr(resource,"registration")||agendaAttr(resource,"matricula")||null;
  return {id,name,className,grade,externalId,raw:{id,attributes:resource.attributes||{}}};
}

function scoreAgendaStudent(candidate:AgendaEduStudentCandidate,input:{name:string;className?:string|null;grade?:string|null;externalId?:string|null}){
  let score=0;
  const candidateName=normalize(candidate.name);const inputName=normalize(input.name);
  if(candidateName===inputName)score+=80;else if(candidateName.includes(inputName)||inputName.includes(candidateName))score+=55;
  const candidateClass=normalize(candidate.className||"");const inputClass=normalize(input.className||"");
  if(candidateClass&&inputClass&&(candidateClass===inputClass||candidateClass.includes(inputClass)||inputClass.includes(candidateClass)))score+=15;
  const candidateGrade=normalize(candidate.grade||"");const inputGrade=normalize(input.grade||"");
  if(candidateGrade&&inputGrade&&(candidateGrade===inputGrade||candidateGrade.includes(inputGrade)||inputGrade.includes(candidateGrade)))score+=10;
  if(input.externalId&&candidate.externalId&&normalize(candidate.externalId)===normalize(input.externalId))score+=20;
  return score;
}

export async function searchAgendaEduStudents(input:{accessToken:string;schoolToken:string;name:string;className?:string|null;grade?:string|null;externalId?:string|null;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch){
  const terms=[
    {"filter[name]":input.name,"filter[className]":input.className||"","page[size]":"10"},
    {"filter[search]":input.name,"filter[classroom]":input.className||"","page[size]":"10"},
    {"filter[q]":input.name,"page[size]":"10"},
  ];
  const attempted:string[]=[];let lastError="";
  for(const term of terms){
    const query=new URLSearchParams();for(const [key,value] of Object.entries(term))if(value)query.set(key,value);
    const url=`${agendaBaseUrl(input.environment)}/students?${query}`;
    attempted.push(url.replace(input.name,encodeURIComponent(input.name)));
    const response=await fetchImpl(url,{headers:agendaHeaders(input.accessToken,input.schoolToken),cache:"no-store"});
    if(!response.ok){lastError=await responseMessage(response,"A Agenda Edu não permitiu consultar alunos.");continue}
    const result=await response.json().catch(()=>({})) as {data?:AgendaResource[]};
    const candidates=(result.data||[]).map(mapAgendaStudent).filter(Boolean) as AgendaEduStudentCandidate[];
    const scored=candidates.map(candidate=>({...candidate,score:scoreAgendaStudent(candidate,input)})).filter(candidate=>candidate.score>=55).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,"pt-BR")).slice(0,8);
    if(scored.length)return {candidates:scored,attempted};
  }
  if(lastError)throw new Error(lastError);
  return {candidates:[],attempted};
}

function resourceId(value:unknown){
  if(!value||typeof value!=="object")return null;
  const record=value as {id?:string|number;data?:AgendaResource};
  return String(record.data?.id??record.id??"").trim()||null;
}

export async function findAgendaEduFamilyChat(input:{accessToken:string;schoolToken:string;channelId:string;studentId:string;useExternalId:boolean;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch){
  const query=new URLSearchParams({"filter[kind]":"family","filter[studentId]":input.studentId,"filter[useExternalId]":String(input.useExternalId),"page[size]":"1"});
  const response=await fetchImpl(`${agendaBaseUrl(input.environment)}/channels/${encodeURIComponent(input.channelId)}/chats?${query}`,{headers:agendaHeaders(input.accessToken,input.schoolToken),cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não permitiu localizar a mensagem do aluno."));
  const result=await response.json() as {data?:AgendaResource[]};
  return String(result.data?.[0]?.id??"").trim()||null;
}

export async function createAgendaEduFamilyChat(input:{accessToken:string;schoolToken:string;channelId:string;studentId:string;useExternalId:boolean;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch){
  const response=await fetchImpl(`${agendaBaseUrl(input.environment)}/channels/${encodeURIComponent(input.channelId)}/chats`,{method:"POST",headers:{...agendaHeaders(input.accessToken,input.schoolToken),"Content-Type":"application/json"},body:JSON.stringify({studentId:input.studentId,kind:"family",useExternalId:input.useExternalId}),cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não permitiu preparar a mensagem para os responsáveis deste aluno."));
  const id=resourceId(await response.json());
  if(!id)throw new Error("A Agenda Edu não retornou a identificação da mensagem preparada para o aluno.");
  return id;
}

export async function resolveAgendaEduFamilyChat(input:{accessToken:string;schoolToken:string;channelId:string;studentId:string;useExternalId:boolean;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch){
  return await findAgendaEduFamilyChat(input,fetchImpl)||await createAgendaEduFamilyChat(input,fetchImpl);
}

export async function sendAgendaEduAttachment(input:{accessToken:string;schoolToken:string;channelId:string;chatId:string;content:string;filename:string;contentType:string;bytes:Uint8Array;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch){
  const form=new FormData();
  const attachmentBytes=new Uint8Array(input.bytes.byteLength);attachmentBytes.set(input.bytes);
  form.append("content",input.content);
  form.append("chatIds[]",input.chatId);
  form.append("attachment",new Blob([attachmentBytes.buffer],{type:input.contentType}),input.filename);
  const response=await fetchImpl(`${agendaBaseUrl(input.environment)}/channels/${encodeURIComponent(input.channelId)}/messages/`,{method:"POST",headers:agendaHeaders(input.accessToken,input.schoolToken),body:form,cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não aceitou um dos documentos da NFS-e."));
  const id=resourceId(await response.json());
  if(!id)throw new Error("A Agenda Edu aceitou a solicitação sem retornar a identificação da mensagem.");
  return id;
}
