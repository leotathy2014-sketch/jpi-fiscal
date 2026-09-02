export type SweducCredentials={host:string;clientId:string;clientSecret:string};
export type SweducStudentSummary={
  nome:string;data_nascimento:string|null;num_aluno:string|null;ano_letivo:string|null;
  num_matricula:string|null;status:string|null;unidade:string|null;curso:string|null;
  serie:string|null;turma:string|null;matricula_id:number;aluno_id:number|null;
};
export type SweducStudentDetail={
  detalhes:Record<string,unknown>;responsaveis:Array<Record<string,unknown>>;financeiro:Array<Record<string,unknown>>;
};
type FetchLike=typeof fetch;

export function normalizeSweducHost(value:string){
  const raw=value.trim().replace(/\/+$/g,"");
  let parsed:URL;
  try{parsed=new URL(raw)}catch{throw new Error("Informe um HOST válido, começando com https://.")}
  if(parsed.protocol!=="https:")throw new Error("O HOST da SWeduc precisa usar HTTPS.");
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error("O HOST da SWeduc não pode conter credenciais ou parâmetros.");
  const hostname=parsed.hostname.toLowerCase();
  if(hostname!=="sweduc.com.br"&&!hostname.endsWith(".sweduc.com.br"))throw new Error("Informe o HOST oficial fornecido pela SWeduc.");
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/g,"")}`;
}

export function serializeSweducCredentials(credentials:SweducCredentials){return JSON.stringify({...credentials,host:normalizeSweducHost(credentials.host)})}
export function parseSweducCredentials(value:string):SweducCredentials{
  let parsed:Partial<SweducCredentials>={};
  try{parsed=JSON.parse(value) as Partial<SweducCredentials>}catch{throw new Error("As credenciais protegidas da SWeduc precisam ser cadastradas novamente.")}
  const result={host:normalizeSweducHost(String(parsed.host||"")),clientId:String(parsed.clientId||"").trim(),clientSecret:String(parsed.clientSecret||"").trim()};
  if(!result.clientId||!result.clientSecret)throw new Error("As credenciais protegidas da SWeduc estão incompletas.");
  return result;
}

async function apiMessage(response:Response,fallback:string){
  const body=await response.json().catch(()=>({})) as {message?:string;error?:string;error_description?:string};
  return body.error_description||body.message||body.error||fallback;
}

export async function createSweducAccessToken(credentials:SweducCredentials,fetchImpl:FetchLike=fetch){
  const basic=Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`,"utf8").toString("base64");
  const body=new URLSearchParams({grant_type:"client_credentials"});
  const response=await fetchImpl(`${normalizeSweducHost(credentials.host)}/oauth/v2/token`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded",Authorization:`Basic ${basic}`},body,cache:"no-store"});
  if(!response.ok)throw new Error(await apiMessage(response,"A SWeduc não aceitou as credenciais informadas."));
  const result=await response.json() as {access_token?:string;expires_in?:number;token_type?:string};
  if(!result.access_token)throw new Error("A SWeduc não retornou o token de acesso esperado.");
  return {accessToken:result.access_token,expiresIn:Number(result.expires_in||0)};
}

export async function listSweducStudents(credentials:SweducCredentials,input:Record<string,string|number|undefined>={},fetchImpl:FetchLike=fetch){
  const token=await createSweducAccessToken(credentials,fetchImpl);
  return listSweducStudentsWithToken(credentials.host,token.accessToken,input,fetchImpl);
}

export async function listSweducStudentsWithToken(host:string,accessToken:string,input:Record<string,string|number|undefined>={},fetchImpl:FetchLike=fetch){
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(input))if(value!==undefined&&String(value).trim())query.set(key,String(value));
  const response=await fetchImpl(`${normalizeSweducHost(host)}/api/v2/alunos/listar?${query}`,{headers:{Accept:"application/json",Authorization:`Bearer ${accessToken}`},cache:"no-store"});
  if(!response.ok)throw new Error(await apiMessage(response,"A SWeduc não permitiu consultar os alunos."));
  return await response.json() as {current_page?:number;data?:SweducStudentSummary[];total?:number;last_page?:number;per_page?:number;next_page_url?:string|null};
}

export async function getSweducStudentDetails(credentials:SweducCredentials,matriculaId:number,fetchImpl:FetchLike=fetch){
  if(!Number.isInteger(matriculaId)||matriculaId<=0)throw new Error("A matrícula informada é inválida.");
  const token=await createSweducAccessToken(credentials,fetchImpl);
  return getSweducStudentDetailsWithToken(credentials.host,token.accessToken,matriculaId,fetchImpl);
}

export async function getSweducStudentDetailsWithToken(host:string,accessToken:string,matriculaId:number,fetchImpl:FetchLike=fetch){
  if(!Number.isInteger(matriculaId)||matriculaId<=0)throw new Error("A matrícula informada é inválida.");
  const response=await fetchImpl(`${normalizeSweducHost(host)}/api/v2/alunos/detalhes?matricula_id=${matriculaId}`,{headers:{Accept:"application/json",Authorization:`Bearer ${accessToken}`},cache:"no-store"});
  if(!response.ok)throw new Error(await apiMessage(response,"A SWeduc não permitiu consultar os detalhes da matrícula."));
  const result=await response.json() as Partial<SweducStudentDetail>;
  return {detalhes:result.detalhes||{},responsaveis:Array.isArray(result.responsaveis)?result.responsaveis:[],financeiro:Array.isArray(result.financeiro)?result.financeiro:[]};
}
