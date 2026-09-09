export const AGENDA_EDU_ENDPOINTS={
  sandboxBaseUrl:"https://sandbox-api.agendaedu.dev/v2",
  sandboxTokenUrl:"https://sandbox-api.agendaedu.dev/oauth/v2/token",
  productionBaseUrl:"https://api.agendaedu.com/v2",
  productionTokenUrl:"https://api.agendaedu.com/oauth/v2/token",
} as const;

export type AgendaEduCredentials={clientId:string;clientSecret:string;schoolToken:string};
export type AgendaEduEnvironment="homologacao"|"producao";
type FetchLike=typeof fetch;
type AgendaResource={id?:string|number;type?:string;attributes?:Record<string,unknown>;relationships?:Record<string,{data?:unknown}>};
export type AgendaEduStudentCandidate={id:string;name:string;className:string|null;grade:string|null;externalId:string|null;externalIds:string[];raw:Record<string,unknown>};
export type AgendaEduStudentListItem={
  id:string;
  name:string;
  externalId:string|null;
  legacyId:string|null;
  mainClassroomId:string|null;
  period:string|null;
  status:string|null;
  linkedStatus:string|null;
  dateOfBirth:string|null;
};
export type AgendaEduResponsibleItem={id:string;name:string;externalId:string|null;legacyId:string|null;email:string|null;phone:string|null;documentNumber:string|null;kinship:string|null;financial:boolean;status:string|null;linkedStatus:string|null};
export type AgendaEduClassroomItem={id:string;name:string;externalId:string|null;legacyId:string|null;status:string|null};
export type AgendaEduStudentListPage={students:AgendaEduStudentListItem[];page:number;nextPage:number|null;totalPages:number|null;totalCount:number|null;attempted:string};
export type AgendaEduStudentDetails={student:AgendaEduStudentListItem|null;responsibles:AgendaEduResponsibleItem[];classrooms:AgendaEduClassroomItem[];primaryResponsible:AgendaEduResponsibleItem|null;included:AgendaResource[];raw:unknown;attempted:string};

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

async function agendaTokenResponse(credentials:AgendaEduCredentials,fetchImpl:FetchLike,environment:AgendaEduEnvironment,mode:"body"|"basic"){
  const body=mode==="body"
    ?new URLSearchParams({grant_type:"client_credentials",client_id:credentials.clientId,client_secret:credentials.clientSecret})
    :new URLSearchParams({grant_type:"client_credentials"});
  const headers:Record<string,string>={Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"};
  if(mode==="basic")headers.Authorization=`Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`,"utf8").toString("base64")}`;
  return fetchImpl(agendaTokenUrl(environment),{method:"POST",headers,body,cache:"no-store"});
}

function agendaBaseUrl(environment:AgendaEduEnvironment="homologacao"){
  return environment==="producao"?AGENDA_EDU_ENDPOINTS.productionBaseUrl:AGENDA_EDU_ENDPOINTS.sandboxBaseUrl;
}

function agendaTokenUrl(environment:AgendaEduEnvironment="homologacao"){
  return environment==="producao"?AGENDA_EDU_ENDPOINTS.productionTokenUrl:AGENDA_EDU_ENDPOINTS.sandboxTokenUrl;
}

export async function createAgendaEduAccessToken(credentials:AgendaEduCredentials,fetchImpl:FetchLike=fetch,environment:AgendaEduEnvironment="homologacao"){
  let response=await agendaTokenResponse(credentials,fetchImpl,environment,"body");
  if(!response.ok&&environment==="producao"){
    const firstError=await responseMessage(response,"A Agenda Edu não aceitou as credenciais no corpo da requisição.");
    response=await agendaTokenResponse(credentials,fetchImpl,environment,"basic");
    if(!response.ok){
      const secondError=await responseMessage(response,"A Agenda Edu não aceitou as credenciais em Basic Auth.");
      throw new Error(`A Agenda Edu não aceitou o Client ID/Secret da plataforma oficial. Corpo: ${firstError} Basic Auth: ${secondError}`);
    }
  }
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
const normalizeDigits=(value:string|null|undefined)=>String(value||"").replace(/\D/g,"");

function agendaValue(resource:AgendaResource,key:string){
  const attributes=resource.attributes||{};
  return attributes[key]??(resource as unknown as Record<string,unknown>)[key];
}

function agendaAttr(resource:AgendaResource,key:string){
  return String(agendaValue(resource,key)??"").trim();
}

function collectExternalIds(...values:unknown[]){
  const ids:string[]=[];
  const visit=(value:unknown)=>{
    if(value==null)return;
    if(Array.isArray(value)){value.forEach(visit);return}
    if(typeof value==="object"){
      const record=value as Record<string,unknown>;
      const likely=record.id??record.value??record.external_id??record.externalId??record.matricula??record.registration??record.numero_matricula??record.num_matricula;
      if(likely!=null)visit(likely);
      return;
    }
    const text=String(value).trim();
    if(text)ids.push(text);
  };
  values.forEach(visit);
  return Array.from(new Set(ids));
}

function relationshipId(resource:AgendaResource,key:string){
  const data=resource.relationships?.[key]?.data;
  if(Array.isArray(data)){
    const first=data[0] as {id?:string|number}|undefined;
    return String(first?.id??"").trim()||null;
  }
  if(data&&typeof data==="object")return String((data as {id?:string|number}).id??"").trim()||null;
  return null;
}

function includedMap(value:unknown){
  const map=new Map<string,AgendaResource>();
  if(!value||typeof value!=="object")return map;
  const included=(value as {included?:unknown}).included;
  if(!Array.isArray(included))return map;
  for(const item of included){
    if(!item||typeof item!=="object")continue;
    const resource=item as AgendaResource;
    const id=String(resource.id??"").trim();
    if(id)map.set(`${resource.type||""}:${id}`,resource);
  }
  return map;
}

function findIncluded(map:Map<string,AgendaResource>,type:string,id:string|null){
  if(!id)return null;
  return map.get(`${type}:${id}`)||map.get(`:${id}`)||null;
}

function agendaStudentsFromPayload(value:unknown){
  const included=includedMap(value);
  return agendaList(value).map(resource=>{
    const classroom=findIncluded(included,"classroom",relationshipId(resource,"classrooms"));
    const grade=findIncluded(included,"grade",relationshipId(classroom||{},"grade"));
    const stage=findIncluded(included,"educational_stage",relationshipId(classroom||{},"educational_stage"));
    const attributes={...(resource.attributes||{})};
    if(classroom){
      attributes.classroom_name=attributes.classroom_name||agendaAttr(classroom,"name");
      attributes.classroom_external_id=attributes.classroom_external_id||agendaAttr(classroom,"external_id");
    }
    if(grade)attributes.grade_name=attributes.grade_name||agendaAttr(grade,"name");
    if(stage)attributes.stage_name=attributes.stage_name||agendaAttr(stage,"name");
    return {...resource,attributes};
  });
}

function mapAgendaStudent(resource:AgendaResource):AgendaEduStudentCandidate|null{
  const id=String(resource.id??"").trim();
  const name=agendaAttr(resource,"name")||agendaAttr(resource,"nome")||agendaAttr(resource,"studentName")||agendaAttr(resource,"nome_aluno");
  if(!id||!name)return null;
  const className=agendaAttr(resource,"className")||agendaAttr(resource,"classroom")||agendaAttr(resource,"turma")||agendaAttr(resource,"class")||agendaAttr(resource,"nome_da_turma")||agendaAttr(resource,"classroom_name")||null;
  const grade=agendaAttr(resource,"grade")||agendaAttr(resource,"serie")||agendaAttr(resource,"segment")||agendaAttr(resource,"nome_da_serie")||agendaAttr(resource,"grade_name")||agendaAttr(resource,"stage_name")||null;
  const externalIds=collectExternalIds(
    agendaValue(resource,"external_ids"),
    agendaValue(resource,"externalId"),
    agendaValue(resource,"external_id"),
    agendaValue(resource,"custom_ids"),
    agendaValue(resource,"legacy_id"),
    agendaValue(resource,"registration"),
    agendaValue(resource,"matricula"),
    agendaValue(resource,"numero_matricula"),
    agendaValue(resource,"num_matricula"),
  );
  return {id,name,className,grade,externalId:externalIds[0]||null,externalIds,raw:{id,type:resource.type,attributes:resource.attributes||{},relationships:resource.relationships||{}}};
}

function agendaList(value:unknown):AgendaResource[]{
  if(Array.isArray(value))return value as AgendaResource[];
  if(!value||typeof value!=="object")return [];
  const record=value as Record<string,unknown>;
  if(Array.isArray(record.data))return record.data as AgendaResource[];
  if(Array.isArray(record.student_profiles))return record.student_profiles as AgendaResource[];
  if(Array.isArray(record.alunos))return record.alunos as AgendaResource[];
  if(Array.isArray(record.results))return record.results as AgendaResource[];
  return [];
}

function numberOrNull(value:unknown){
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
}

function mapAgendaStudentListItem(resource:AgendaResource):AgendaEduStudentListItem|null{
  const id=String(resource.id??"").trim();
  const name=agendaAttr(resource,"name")||agendaAttr(resource,"nome")||agendaAttr(resource,"nome_aluno");
  if(!id||!name)return null;
  return {
    id,
    name,
    externalId:agendaAttr(resource,"external_id")||agendaAttr(resource,"externalId")||null,
    legacyId:agendaAttr(resource,"legacy_id")||null,
    mainClassroomId:agendaAttr(resource,"main_classroom_id")||null,
    period:agendaAttr(resource,"period")||null,
    status:agendaAttr(resource,"status")||null,
    linkedStatus:agendaAttr(resource,"linked_status")||null,
    dateOfBirth:agendaAttr(resource,"date_of_birth")||null,
  };
}

function mapAgendaResponsibleItem(resource:AgendaResource):AgendaEduResponsibleItem|null{
  const id=String(resource.id??"").trim();
  const name=agendaAttr(resource,"name")||agendaAttr(resource,"nome");
  if(!id||!name)return null;
  return {
    id,
    name,
    externalId:agendaAttr(resource,"external_id")||agendaAttr(resource,"externalId")||null,
    legacyId:agendaAttr(resource,"legacy_id")||null,
    email:agendaAttr(resource,"email")||null,
    phone:agendaAttr(resource,"phone")||null,
    documentNumber:agendaAttr(resource,"document_number")||null,
    kinship:agendaAttr(resource,"kinship")||null,
    financial:agendaValue(resource,"financial")===true||String(agendaValue(resource,"financial")).toLowerCase()==="true",
    status:agendaAttr(resource,"status")||null,
    linkedStatus:agendaAttr(resource,"linked_status")||null,
  };
}

function mapAgendaClassroomItem(resource:AgendaResource):AgendaEduClassroomItem|null{
  const id=String(resource.id??"").trim();
  const name=agendaAttr(resource,"name")||agendaAttr(resource,"nome");
  if(!id||!name)return null;
  return {id,name,externalId:agendaAttr(resource,"external_id")||null,legacyId:agendaAttr(resource,"legacy_id")||null,status:agendaAttr(resource,"status")||null};
}

export async function listAgendaEduStudents(input:{accessToken:string;schoolToken:string;page?:number;perPage?:number;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch):Promise<AgendaEduStudentListPage>{
  const page=Math.max(1,Math.trunc(Number(input.page)||1));
  const perPage=Math.min(100,Math.max(1,Math.trunc(Number(input.perPage)||50)));
  const query=new URLSearchParams({pagina:String(page),por_pagina:String(perPage)});
  const url=`${agendaBaseUrl(input.environment)}/student_profiles?${query}`;
  const response=await fetchImpl(url,{headers:agendaHeaders(input.accessToken,input.schoolToken),cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não permitiu listar alunos."));
  const result=await response.json().catch(()=>({})) as {meta?:Record<string,unknown>};
  const meta=result.meta||{};
  return {
    students:agendaStudentsFromPayload(result).map(mapAgendaStudentListItem).filter(Boolean) as AgendaEduStudentListItem[],
    page:numberOrNull(meta.page)??page,
    nextPage:numberOrNull(meta.next),
    totalPages:numberOrNull(meta.pages),
    totalCount:numberOrNull(meta.count),
    attempted:url,
  };
}

export async function getAgendaEduStudentDetails(input:{accessToken:string;schoolToken:string;studentId:string;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch):Promise<AgendaEduStudentDetails>{
  const studentId=String(input.studentId||"").trim();
  if(!/^[A-Za-z0-9._-]{1,120}$/.test(studentId))throw new Error("Informe um ID válido do aluno na Agenda Edu.");
  const url=`${agendaBaseUrl(input.environment)}/student_profiles/${encodeURIComponent(studentId)}`;
  const response=await fetchImpl(url,{headers:agendaHeaders(input.accessToken,input.schoolToken),cache:"no-store"});
  if(!response.ok)throw new Error(await responseMessage(response,"A Agenda Edu não permitiu consultar os detalhes do aluno."));
  const result=await response.json().catch(()=>({}));
  const resources=agendaStudentsFromPayload(result);
  const studentResource=resources[0]||null;
  const included=Array.isArray((result as {included?:unknown}).included)?(result as {included:AgendaResource[]}).included:[];
  const responsibles=(included.filter(item=>item.type==="responsible_profile").map(mapAgendaResponsibleItem).filter(Boolean) as AgendaEduResponsibleItem[]).sort((a,b)=>Number(b.financial)-Number(a.financial)||a.name.localeCompare(b.name,"pt-BR"));
  return {
    student:studentResource?mapAgendaStudentListItem(studentResource):null,
    responsibles,
    classrooms:included.filter(item=>item.type==="classroom").map(mapAgendaClassroomItem).filter(Boolean) as AgendaEduClassroomItem[],
    primaryResponsible:responsibles.find(responsible=>responsible.financial)||responsibles[0]||null,
    included,
    raw:result,
    attempted:url,
  };
}

function scoreAgendaStudent(candidate:AgendaEduStudentCandidate,input:{name:string;className?:string|null;grade?:string|null;externalId?:string|null}){
  let score=0;
  const candidateName=normalize(candidate.name);const inputName=normalize(input.name);
  const candidateExternalDigits=candidate.externalIds.map(normalizeDigits).filter(Boolean);const inputExternalDigits=normalizeDigits(input.externalId);
  if(inputExternalDigits){
    if(candidateExternalDigits.length){
      if(candidateExternalDigits.includes(inputExternalDigits))score+=140;
      else return 0;
    }else{
      return 0;
    }
  }
  if(candidateName===inputName)score+=80;else if(!inputExternalDigits&&(candidateName.includes(inputName)||inputName.includes(candidateName)))score+=35;else return inputExternalDigits&&score>=140?score:0;
  const candidateClass=normalize(candidate.className||"");const inputClass=normalize(input.className||"");
  if(candidateClass&&inputClass&&(candidateClass===inputClass||candidateClass.includes(inputClass)||inputClass.includes(candidateClass)))score+=15;
  const candidateGrade=normalize(candidate.grade||"");const inputGrade=normalize(input.grade||"");
  if(candidateGrade&&inputGrade&&(candidateGrade===inputGrade||candidateGrade.includes(inputGrade)||inputGrade.includes(candidateGrade)))score+=10;
  if(input.externalId&&candidate.externalId&&normalize(candidate.externalId)===normalize(input.externalId))score+=20;
  return score;
}

export async function searchAgendaEduStudents(input:{accessToken:string;schoolToken:string;name:string;className?:string|null;grade?:string|null;externalId?:string|null;environment?:AgendaEduEnvironment},fetchImpl:FetchLike=fetch){
  const terms=input.externalId?[
    {endpoint:"/student_profiles",params:{"external_ids[]":input.externalId,"pagina":"1","por_pagina":"20"}},
  ]:[
    {endpoint:"/student_profiles",params:{"nome":input.name,"pagina":"1","por_pagina":"20"}},
  ];
  const attempted:string[]=[];let lastError="";
  for(const term of terms){
    const query=new URLSearchParams();for(const [key,value] of Object.entries(term.params))if(value)query.append(key,value);
    if(!String(query))continue;
    const url=`${agendaBaseUrl(input.environment)}${term.endpoint}?${query}`;
    attempted.push(url.replace(input.name,encodeURIComponent(input.name)));
    const response=await fetchImpl(url,{headers:agendaHeaders(input.accessToken,input.schoolToken),cache:"no-store"});
    if(!response.ok){lastError=await responseMessage(response,"A Agenda Edu não permitiu consultar alunos.");continue}
    const result=await response.json().catch(()=>({}));
    const candidates=agendaStudentsFromPayload(result).map(mapAgendaStudent).filter(Boolean) as AgendaEduStudentCandidate[];
    const scored=candidates.map(candidate=>({...candidate,score:scoreAgendaStudent(candidate,input)})).filter(candidate=>candidate.score>=80).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,"pt-BR")).slice(0,8);
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
