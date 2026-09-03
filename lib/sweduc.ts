export type SweducTokenGrant="client_credentials"|"password";
export type SweducCredentials={host:string;clientId:string;clientSecret:string;grantType?:SweducTokenGrant;username?:string;password?:string};
export type SweducStudentSummary={
  nome:string;data_nascimento:string|null;num_aluno:string|null;ano_letivo:string|null;
  num_matricula:string|null;status:string|null;unidade:string|null;curso:string|null;
  serie:string|null;turma:string|null;matricula_id:number;aluno_id:number|null;
};
export type SweducStudentDetail={
  detalhes:Record<string,unknown>;responsaveis:Array<Record<string,unknown>>;financeiro:Array<Record<string,unknown>>;
};
export type SweducAcademicYear={id:number;year:number};
export type SweducFiscalStudent={
  nome:string;turma:string|null;segmento:string;responsavel:string;cpf_cnpj:string|null;email:string|null;whatsapp:string|null;
  cep:string|null;logradouro:string|null;numero:string|null;complemento:string|null;bairro:string|null;cidade:string|null;uf:string|null;endereco:string|null;
};
export type SweducTokenOptions={grantType?:SweducTokenGrant;username?:string;password?:string};
type FetchLike=typeof fetch;
const SWEDUC_TIMEOUT_MS=15000;
const SWEDUC_HOST_DOMAINS=["sweduc.com.br","escolarsw.com.br"] as const;

export function normalizeSweducHost(value:string){
  const raw=value.trim().replace(/\/+$/g,"");
  let parsed:URL;
  try{parsed=new URL(raw)}catch{throw new Error("Informe um HOST válido, começando com https://.")}
  if(parsed.protocol!=="https:")throw new Error("O HOST da SWeduc precisa usar HTTPS.");
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error("O HOST da SWeduc não pode conter credenciais ou parâmetros.");
  const hostname=parsed.hostname.toLowerCase();
  if(!SWEDUC_HOST_DOMAINS.some(domain=>hostname===domain||hostname.endsWith(`.${domain}`)))throw new Error("Informe o HOST oficial fornecido pela SWeduc.");
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/g,"")}`;
}

export function serializeSweducCredentials(credentials:SweducCredentials){
  const grantType=credentials.grantType||"client_credentials";
  const stored:SweducCredentials={host:normalizeSweducHost(credentials.host),clientId:String(credentials.clientId||"").trim(),clientSecret:String(credentials.clientSecret||"").trim(),grantType};
  if(!stored.clientId||!stored.clientSecret)throw new Error("Informe CLIENT_ID e CLIENT_SECRET da SWeduc.");
  if(grantType==="password"){
    stored.username=String(credentials.username||"").trim();stored.password=String(credentials.password||"");
    if(!stored.username||!stored.password)throw new Error("Informe USUÁRIO e SENHA da SWeduc.");
  }
  return JSON.stringify(stored);
}
export function parseSweducCredentials(value:string):SweducCredentials{
  let parsed:Partial<SweducCredentials>={};
  try{parsed=JSON.parse(value) as Partial<SweducCredentials>}catch{throw new Error("As credenciais protegidas da SWeduc precisam ser cadastradas novamente.")}
  const grantType:SweducTokenGrant=parsed.grantType==="password"?"password":"client_credentials";
  const result:SweducCredentials={host:normalizeSweducHost(String(parsed.host||"")),clientId:String(parsed.clientId||"").trim(),clientSecret:String(parsed.clientSecret||"").trim(),grantType};
  if(!result.clientId||!result.clientSecret)throw new Error("As credenciais protegidas da SWeduc estão incompletas.");
  if(grantType==="password"){
    result.username=String(parsed.username||"").trim();result.password=String(parsed.password||"");
    if(!result.username||!result.password)throw new Error("As credenciais protegidas da SWeduc estão incompletas.");
  }
  return result;
}

async function apiMessage(response:Response,fallback:string){
  const body=await response.json().catch(()=>({})) as {message?:string;error?:string;error_description?:string};
  return body.error_description||body.message||body.error||fallback;
}

export function currentSweducAcademicYear(referenceDate=new Date()){
  return Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric"}).format(referenceDate));
}

export async function listSweducAcademicYears(host:string,fetchImpl:FetchLike=fetch):Promise<SweducAcademicYear[]>{
  const response=await fetchImpl(`${normalizeSweducHost(host)}/api/public/v1/academico/anos-letivos`,{headers:{Accept:"application/json"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(SWEDUC_TIMEOUT_MS)});
  if(!response.ok)throw new Error(await apiMessage(response,"A SWeduc não permitiu consultar os anos letivos."));
  const payload=await response.json() as unknown;
  const source=Array.isArray(payload)?payload:Array.isArray((payload as {data?:unknown[]}|null)?.data)?(payload as {data:unknown[]}).data:[];
  return source.map(item=>{
    const record=item as Record<string,unknown>;return {id:Number(record.id),year:Number(record.anoletivo??record.ano_letivo??record.ano)};
  }).filter(item=>Number.isSafeInteger(item.id)&&item.id>0&&Number.isSafeInteger(item.year)&&item.year>1900).sort((a,b)=>b.year-a.year);
}

export async function getSweducActiveAcademicYear(host:string,fetchImpl:FetchLike=fetch,referenceDate=new Date()):Promise<SweducAcademicYear>{
  const years=await listSweducAcademicYears(host,fetchImpl);
  const currentYear=currentSweducAcademicYear(referenceDate);
  const active=years.find(item=>item.year===currentYear)||years.filter(item=>item.year<=currentYear).sort((a,b)=>b.year-a.year)[0];
  if(!active)throw new Error(`A SWeduc não retornou um ano letivo válido para ${currentYear}.`);
  return active;
}

export async function resolveSweducAcademicYear(host:string,year:number|undefined,fetchImpl:FetchLike=fetch,referenceDate=new Date()){
  const years=await listSweducAcademicYears(host,fetchImpl);
  const selected=year?years.find(item=>item.year===year):years.find(item=>item.year===currentSweducAcademicYear(referenceDate))||years.filter(item=>item.year<=currentSweducAcademicYear(referenceDate)).sort((a,b)=>b.year-a.year)[0];
  if(!selected)throw new Error(year?`A SWeduc não retornou o ano letivo ${year}.`:"A SWeduc não retornou o ano letivo ativo.");
  return {selected,years};
}

export async function createSweducAccessToken(credentials:SweducCredentials,fetchImpl:FetchLike=fetch,options:SweducTokenOptions={}){
  const grantType=options.grantType||credentials.grantType||"client_credentials";
  const username=options.username===undefined?String(credentials.username||"").trim():String(options.username||"").trim();
  const password=options.password===undefined?String(credentials.password||""):String(options.password||"");
  if(grantType==="password"&&(!username||!password))throw new Error("Informe USUÁRIO e SENHA da SWeduc.");
  const basic=Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`,"utf8").toString("base64");
  const body=grantType==="password"
    ?new URLSearchParams({grant_type:"password",username,password})
    :new URLSearchParams({grant_type:"client_credentials"});
  const headers:Record<string,string>={Accept:"application/json","Content-Type":"application/x-www-form-urlencoded",Authorization:`Basic ${basic}`};
  const response=await fetchImpl(`${normalizeSweducHost(credentials.host)}/oauth/v2/token`,{method:"POST",headers,body,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(SWEDUC_TIMEOUT_MS)});
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
  const response=await fetchImpl(`${normalizeSweducHost(host)}/api/v2/alunos/listar?${query}`,{headers:{Accept:"application/json",Authorization:`Bearer ${accessToken}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(SWEDUC_TIMEOUT_MS)});
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
  const response=await fetchImpl(`${normalizeSweducHost(host)}/api/v2/alunos/detalhes?matricula_id=${matriculaId}`,{headers:{Accept:"application/json",Authorization:`Bearer ${accessToken}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(SWEDUC_TIMEOUT_MS)});
  if(!response.ok)throw new Error(await apiMessage(response,"A SWeduc não permitiu consultar os detalhes da matrícula."));
  const result=await response.json() as Partial<SweducStudentDetail>;
  return {detalhes:result.detalhes||{},responsaveis:Array.isArray(result.responsaveis)?result.responsaveis:[],financeiro:Array.isArray(result.financeiro)?result.financeiro:[]};
}

const normalizeText=(value:unknown)=>String(value||"").trim();
const pickText=(source:Record<string,unknown>|null|undefined,keys:string[])=>{for(const key of keys){const value=normalizeText(source?.[key]);if(value)return value}return ""};
const digitsOnly=(value:string,max=20)=>value.replace(/\D/g,"").slice(0,max);
function firstNestedText(source:Record<string,unknown>,keys:string[],nestedKeys:string[]){
  for(const key of keys){
    const value=source[key];
    if(Array.isArray(value)){
      for(const entry of value){
        if(typeof entry==="string"&&entry.trim())return entry.trim();
        if(entry&&typeof entry==="object"){
          const picked=pickText(entry as Record<string,unknown>,nestedKeys);
          if(picked)return picked;
        }
      }
    }
    if(typeof value==="string"&&value.trim())return value.trim();
  }
  return "";
}
export function inferSweducSegment(curso?:string|null,serie?:string|null){
  const value=`${curso||""} ${serie||""}`.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
  if(value.includes("medio"))return "Ensino Médio";
  if(value.includes("9")||value.includes("8")||value.includes("7")||value.includes("6")||value.includes("fundamental ii"))return "6º ao 9º anos";
  if(value.includes("5")||value.includes("4")||value.includes("3")||value.includes("2")||value.includes("1")||value.includes("fundamental"))return "1º ao 5º anos";
  if(value.includes("pre")||value.includes("infantil")||value.includes("jardim"))return "Pré-escola";
  if(value.includes("maternal"))return "Maternal";
  return "Pré-escola";
}
export function mapSweducToFiscalStudent(input:{student:SweducStudentSummary&Record<string,unknown>;responsible?:Record<string,unknown>|null;details?:Record<string,unknown>|null}):SweducFiscalStudent{
  const student=input.student;const responsible=input.responsible||{};const details=input.details||{};
  const alunoNome=pickText(student,["nome"])||pickText(details,["nome","aluno"]);
  const responsavel=pickText(responsible,["nome","responsavel","nome_responsavel","pessoa_nome"])||"RESPONSÁVEL NÃO INFORMADO";
  const cpf=digitsOnly(pickText(responsible,["cpf_cnpj","cpf","cnpj","documento","documento_numero","numero_documento"]),14);
  const email=firstNestedText(responsible,["emails","email","email_responsavel"],["email","endereco","valor"]).toLocaleLowerCase("pt-BR")||null;
  const whatsapp=digitsOnly(firstNestedText(responsible,["telefones","telefone","celular","whatsapp"],["numero","telefone","celular","valor"]),15)||null;
  const logradouro=pickText(responsible,["logradouro","endereco","rua"])||pickText(details,["logradouro","endereco","rua"]);
  const numero=pickText(responsible,["numero","numero_endereco"])||pickText(details,["numero","numero_endereco"]);
  const complemento=pickText(responsible,["complemento"])||pickText(details,["complemento"]);
  const bairro=pickText(responsible,["bairro"])||pickText(details,["bairro"]);
  const cidade=pickText(responsible,["cidade","municipio"])||pickText(details,["cidade","municipio"]);
  const uf=(pickText(responsible,["uf","estado"])||pickText(details,["uf","estado"])).slice(0,2).toLocaleUpperCase("pt-BR");
  const cep=digitsOnly(pickText(responsible,["cep"])||pickText(details,["cep"]),8)||null;
  const endereco=[logradouro,numero,complemento,bairro,cidade,uf].filter(Boolean).join(", ")||null;
  return {
    nome:alunoNome.toLocaleUpperCase("pt-BR"),
    turma:pickText(student,["turma"])||pickText(details,["turma"])||null,
    segmento:inferSweducSegment(pickText(student,["curso"])||pickText(details,["curso"]),pickText(student,["serie"])||pickText(details,["serie"])),
    responsavel:responsavel.toLocaleUpperCase("pt-BR"),
    cpf_cnpj:cpf||null,email,whatsapp,cep,logradouro:logradouro.toLocaleUpperCase("pt-BR")||null,numero:numero.toLocaleUpperCase("pt-BR")||null,
    complemento:complemento.toLocaleUpperCase("pt-BR")||null,bairro:bairro.toLocaleUpperCase("pt-BR")||null,cidade:cidade.toLocaleUpperCase("pt-BR")||null,uf:uf||null,endereco
  };
}
