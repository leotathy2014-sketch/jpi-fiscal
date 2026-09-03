import {NextRequest,NextResponse} from "next/server";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import {createSweducAccessToken,currentSweducAcademicYear,getSweducActiveAcademicYear,getSweducStudentDetailsWithToken,listSweducStudents,listSweducStudentsWithToken,mapSweducToFiscalStudent,normalizeSweducHost,parseSweducCredentials,resolveSweducAcademicYear,serializeSweducCredentials,type SweducCredentials,type SweducStudentSummary,type SweducTokenGrant} from "@/lib/sweduc";
import {hasServerPermission} from "@/lib/server-permissions";

export const runtime="nodejs";export const maxDuration=60;
const MAX_SWEDUC_PAGES=1000;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer"}});

function safeSweducError(error:unknown,current?:SweducCredentials,sensitiveValues:string[]=[]){
  let message=error instanceof Error?error.message:"A SWeduc não confirmou a operação.";
  const basic=current?Buffer.from(`${current.clientId}:${current.clientSecret}`,"utf8").toString("base64"):"";
  for(const secret of [current?.clientId,current?.clientSecret,current?.username,current?.password,basic,...sensitiveValues]){
    if(!secret)continue;
    message=message.split(secret).join("[protegido]").split(encodeURIComponent(secret)).join("[protegido]");
  }
  return message.slice(0,500);
}

async function authorize(request:NextRequest){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!url||!key)return {ok:false as const,response:json({error:"A conexão com o banco não está configurada."},503)};
  if(!authorization||!token)return {ok:false as const,response:json({error:"Sessão inválida."},401)};
  const supabase=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user)return {ok:false as const,response:json({error:"Sessão expirada. Entre novamente."},401)};
  return {ok:true as const,supabase,user};
}

async function credentials(supabase:SupabaseClient){
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)throw new Error("O cofre seguro não está disponível no servidor.");
  const [secretResult,configResult]=await Promise.all([supabase.rpc("get_sweduc_secret",{p_backend_secret:backendSecret}),supabase.from("sweduc_config").select("host").eq("id",true).single()]);
  if(secretResult.error||!secretResult.data)throw new Error("Cadastre primeiro as credenciais da SWeduc.");
  const parsed=parseSweducCredentials(String(secretResult.data));
  return {...parsed,host:normalizeSweducHost(String(configResult.data?.host||parsed.host))};
}

async function mapInBatches<T,R>(items:T[],size:number,mapper:(item:T)=>Promise<R>){
  const result:R[]=[];
  for(let index=0;index<items.length;index+=size)result.push(...await Promise.all(items.slice(index,index+size).map(mapper)));
  return result;
}

export async function GET(request:NextRequest){
  const auth=await authorize(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"settings.integrations.view")&&!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para consultar esta integração."},403);
  const search=request.nextUrl.searchParams.get("search")?.trim()||"";
  const {data:config,error}=await auth.supabase.from("sweduc_config").select("host,credencial_configurada,ultimo_status,testada_em,sincronizada_em,ultimo_erro,total_sincronizado").eq("id",true).maybeSingle();
  if(error||!config)return json({error:"A estrutura da integração SWeduc ainda não foi aplicada ao banco."},503);
  let authMethod:SweducTokenGrant="client_credentials";let usuarioConfigurado=false;
  if(config.credencial_configurada){
    try{const saved=await credentials(auth.supabase);authMethod=saved.grantType||"client_credentials";usuarioConfigurado=authMethod==="password"&&Boolean(saved.username&&saved.password)}catch{}
  }
  const requestedYear=Number(request.nextUrl.searchParams.get("year")||"");
  const defaultAcademicYear=currentSweducAcademicYear();
  let academicYears:{id:number;year:number}[]=[];let activeAcademicYear=Number.isSafeInteger(requestedYear)&&requestedYear>1900?requestedYear:defaultAcademicYear;
  if(config.credencial_configurada){
    try{const saved=await credentials(auth.supabase);const resolved=await resolveSweducAcademicYear(saved.host,activeAcademicYear);academicYears=resolved.years;activeAcademicYear=resolved.selected.year}catch{}
  }
  if(!academicYears.length)academicYears=[{id:0,year:activeAcademicYear}];
  let query=auth.supabase.from("sweduc_alunos").select("matricula_id,aluno_id,nome,data_nascimento,numero_aluno,numero_matricula,status,unidade,curso,serie,turma,ano_letivo,responsaveis,financeiro,sincronizado_em",{count:"exact"}).eq("ano_letivo",String(activeAcademicYear)).order("nome").limit(100);
  if(search)query=query.ilike("nome",`%${search.replace(/[%_]/g,"")}%`);
  const students=await query;
  return json({ok:true,config:{...config,auth_method:authMethod,usuario_configurado:usuarioConfigurado,ano_letivo_ativo:defaultAcademicYear},academicYears,selectedAcademicYear:activeAcademicYear,students:students.data||[],total:students.count||0});
}

export async function POST(request:NextRequest){
  const auth=await authorize(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para configurar a SWeduc."},403);
  let body:Record<string,unknown>;try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const action=String(body.action||"");
  if(action==="save"){
    let host:string;try{host=normalizeSweducHost(String(body.host||""))}catch(error){return json({error:error instanceof Error?error.message:"Informe um HOST válido."},400)}
    const clientIdInput=String(body.clientId||"").trim();const clientSecretInput=String(body.clientSecret||"").trim();const usernameInput=String(body.username||"").trim();const passwordInput=String(body.password||"");
    const grantTypeInput=String(body.grantType||"client_credentials");
    if(grantTypeInput!=="client_credentials"&&grantTypeInput!=="password")return json({error:"Selecione um método de autenticação válido."},400);
    const grantType:SweducTokenGrant=grantTypeInput;
    let clientId=clientIdInput;let clientSecret=clientSecretInput;let username=usernameInput;let password=passwordInput;let currentCredentials:SweducCredentials|undefined;
    const supplied=[clientId,clientSecret].filter(Boolean).length;
    const {data:current}=await auth.supabase.from("sweduc_config").select("credencial_configurada").eq("id",true).single();
    if(supplied===1)return json({error:"Informe CLIENT_ID e CLIENT_SECRET juntos."},400);
    if(current?.credencial_configurada){try{currentCredentials=await credentials(auth.supabase)}catch{if(supplied!==2)return json({error:"As credenciais protegidas precisam ser cadastradas novamente."},400)}}
    if(supplied===0&&currentCredentials){clientId=currentCredentials.clientId;clientSecret=currentCredentials.clientSecret}
    if(!clientId||!clientSecret)return json({error:"Informe CLIENT_ID e CLIENT_SECRET da SWeduc."},400);
    if(grantType==="password"){
      if(!username&&currentCredentials?.grantType==="password")username=currentCredentials.username||"";
      if(!password&&currentCredentials?.grantType==="password")password=currentCredentials.password||"";
      if(!username||!password)return json({error:"Informe USUÁRIO e SENHA para usar o fluxo confirmado pela SWeduc."},400);
    }else{username="";password=""}
    if([clientId,clientSecret,username,password].some(value=>value.length>2000))return json({error:"Uma credencial ultrapassa o tamanho permitido."},400);
    const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre seguro não está disponível."},503);
    const protectedValue=serializeSweducCredentials({host,clientId,clientSecret,grantType,username,password});
    const saved=await auth.supabase.rpc("store_sweduc_secret",{p_secret:protectedValue,p_backend_secret:backendSecret});
    if(saved.error)return json({error:"Não foi possível guardar as credenciais no cofre seguro."},500);
    const {error:updateError}=await auth.supabase.from("sweduc_config").update({host,ultimo_status:"pendente",ultimo_erro:null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:"As credenciais foram protegidas, mas não foi possível atualizar a configuração da SWeduc."},500);
    return json({ok:true,message:"Configuração da SWeduc salva com segurança. Faça o teste de conexão antes de sincronizar."});
  }
  if(action==="test"){
    let activeCredentials:SweducCredentials|undefined;
    try{activeCredentials=await credentials(auth.supabase);const activeYear=await getSweducActiveAcademicYear(activeCredentials.host);const sample=await listSweducStudents(activeCredentials,{page:1,ano_letivo_id:activeYear.id});const at=new Date().toISOString();await auth.supabase.from("sweduc_config").update({host:activeCredentials.host,ultimo_status:"conectado",testada_em:at,ultimo_erro:null,updated_at:at,updated_by:auth.user.id}).eq("id",true);return json({ok:true,academicYear:activeYear.year,message:`Conexão confirmada para o ano letivo ${activeYear.year}. A SWeduc retornou ${Number(sample.total||sample.data?.length||0)} matrícula(s). Nenhum dado foi importado neste teste.`});}catch(error){const message=safeSweducError(error,activeCredentials);await auth.supabase.from("sweduc_config").update({ultimo_status:"erro",ultimo_erro:message,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);return json({error:message},400)}
  }
  if(action==="sync"){
    let synced=0;let totalAvailable=0;let activeCredentials:SweducCredentials|undefined;let activeAccessToken="";const rawPage=Number(body.page||1);const requestedPage=Number.isSafeInteger(rawPage)?Math.max(1,Math.min(rawPage,MAX_SWEDUC_PAGES)):1;
    try{
      const creds=await credentials(auth.supabase);activeCredentials=creds;const rawYear=Number(body.academicYear||0);const resolved=await resolveSweducAcademicYear(creds.host,Number.isSafeInteger(rawYear)&&rawYear>1900?rawYear:undefined);const activeYear=resolved.selected;const token=await createSweducAccessToken(creds);activeAccessToken=token.accessToken;await auth.supabase.from("sweduc_config").update({ultimo_status:"sincronizando",ultimo_erro:null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
      const page=requestedPage;let lastPage=requestedPage;
      {
        const listing=await listSweducStudentsWithToken(creds.host,token.accessToken,{page,ano_letivo_id:activeYear.id});lastPage=Math.min(Math.max(1,Number(listing.last_page||page)),MAX_SWEDUC_PAGES);totalAvailable=Number(listing.total||0);
        const rows=await mapInBatches(listing.data||[],5,async(summary:SweducStudentSummary)=>{
          let detail:{detalhes:Record<string,unknown>;responsaveis:Array<Record<string,unknown>>;financeiro:Array<Record<string,unknown>>}={detalhes:{},responsaveis:[],financeiro:[]};let detailError="";
          try{detail=await getSweducStudentDetailsWithToken(creds.host,token.accessToken,Number(summary.matricula_id))}catch(error){detailError=safeSweducError(error,creds,[token.accessToken])}
          const d=detail.detalhes;
          return {matricula_id:Number(summary.matricula_id),aluno_id:Number(summary.aluno_id||d.aluno_id)||null,nome:String(summary.nome||d.nome||"Aluno sem nome"),data_nascimento:String(summary.data_nascimento||d.data_nascimento||"")||null,numero_aluno:String(summary.num_aluno||d.numeroaluno||"")||null,numero_matricula:String(summary.num_matricula||"")||null,status:String(summary.status||d.status||"")||null,unidade:String(summary.unidade||d.unidade||"")||null,curso:String(summary.curso||d.curso||"")||null,serie:String(summary.serie||d.serie||"")||null,turma:String(summary.turma||d.turma||"")||null,ano_letivo:String(summary.ano_letivo||d.ano_letivo||"")||null,endereco:String(d.endereco||"")||null,responsaveis:detail.responsaveis,financeiro:detail.financeiro,dados_origem:{resumo:summary,detalhes:d,detalhes_erro:detailError||undefined},sincronizado_em:new Date().toISOString()};
        });
        if(rows.length){const result=await auth.supabase.from("sweduc_alunos").upsert(rows,{onConflict:"matricula_id"});if(result.error)throw new Error("Não foi possível atualizar os alunos no JPI Fiscal.");synced+=rows.length}
      }
      const hasNext=page<lastPage;const at=new Date().toISOString();const statusUpdate:Record<string,unknown>={ultimo_status:hasNext?"sincronizando":"conectado",ultimo_erro:null,updated_at:at,updated_by:auth.user.id};if(!hasNext){statusUpdate.sincronizada_em=at;statusUpdate.total_sincronizado=totalAvailable||synced}await auth.supabase.from("sweduc_config").update(statusUpdate).eq("id",true);
      return json({ok:true,synced,page,lastPage,nextPage:hasNext?page+1:null,academicYear:activeYear.year,message:hasNext?`Página ${page} de ${lastPage} do ano letivo ${activeYear.year} sincronizada.`:`Sincronização do ano letivo ${activeYear.year} concluída.`});
    }catch(error){const message=safeSweducError(error,activeCredentials,[activeAccessToken]);await auth.supabase.from("sweduc_config").update({ultimo_status:"erro",ultimo_erro:message,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);return json({error:message,synced},400)}
  }
  if(action==="import"){
    const canCreate=await hasServerPermission(auth.supabase,"students.create");const canEdit=await hasServerPermission(auth.supabase,"students.edit");
    if(!canCreate&&!canEdit)return json({error:"Seu usuário não possui permissão para importar alunos para a emissão."},403);
    const matriculaId=Number(body.matriculaId||0);const responsibleIndex=Number(body.responsibleIndex||0);
    if(!Number.isSafeInteger(matriculaId)||matriculaId<=0)return json({error:"Selecione uma matrícula SWeduc válida."},400);
    const {data:student,error:studentError}=await auth.supabase.from("sweduc_alunos").select("matricula_id,aluno_id,nome,data_nascimento,numero_aluno,numero_matricula,status,unidade,curso,serie,turma,ano_letivo,responsaveis,financeiro,dados_origem").eq("matricula_id",matriculaId).maybeSingle();
    if(studentError||!student)return json({error:"Matrícula SWeduc não encontrada. Sincronize o ano letivo antes de importar."},404);
    const responsaveis=Array.isArray(student.responsaveis)?student.responsaveis as Array<Record<string,unknown>>:[];
    const selectedResponsible=responsaveis[Math.max(0,Math.min(responsibleIndex,responsaveis.length-1))]||null;
    const details=((student.dados_origem as {detalhes?:Record<string,unknown>}|null)?.detalhes)||{};
    const fiscalStudent=mapSweducToFiscalStudent({student:student as unknown as SweducStudentSummary&Record<string,unknown>,responsible:selectedResponsible,details});
    if(!fiscalStudent.nome)return json({error:"A matrícula selecionada não trouxe nome do aluno."},400);
    if(!fiscalStudent.responsavel||fiscalStudent.responsavel==="RESPONSÁVEL NÃO INFORMADO")return json({error:"Selecione um responsável válido para carregar os dados da nota."},400);
    const existing=await auth.supabase.from("alunos").select("id").eq("sweduc_matricula_id",matriculaId).maybeSingle();
    if(existing.error)return json({error:"Não foi possível verificar se esta matrícula já existe no cadastro fiscal."},500);
    let result;
    const payload={...fiscalStudent,sweduc_matricula_id:matriculaId,sweduc_aluno_id:Number(student.aluno_id||0)||null,sweduc_ano_letivo:String(student.ano_letivo||"")||null,sweduc_atualizado_em:new Date().toISOString()};
    if(existing.data?.id){
      if(!canEdit)return json({error:"Esta matrícula já existe. Seu usuário precisa de permissão para atualizar alunos."},403);
      result=await auth.supabase.from("alunos").update(payload).eq("id",existing.data.id).select("id,nome").single();
    }else{
      if(!canCreate)return json({error:"Seu usuário precisa de permissão para cadastrar alunos."},403);
      result=await auth.supabase.from("alunos").insert(payload).select("id,nome").single();
    }
    if(result.error||!result.data)return json({error:"Não foi possível carregar este aluno para a nota."},500);
    return json({ok:true,student:result.data,message:`${result.data.nome} foi carregado no cadastro fiscal e já pode ser usado na emissão.`});
  }
  return json({error:"Ação SWeduc inválida."},400);
}
