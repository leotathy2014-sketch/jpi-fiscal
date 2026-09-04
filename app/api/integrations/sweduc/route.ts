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
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)throw new Error("O cofre seguro não está configurado na Vercel. Configure a variável JPI_BACKEND_SECRET para salvar e usar a conexão definitiva da SWeduc.");
  const [secretResult,configResult]=await Promise.all([supabase.rpc("get_sweduc_secret",{p_backend_secret:backendSecret}),supabase.from("sweduc_config").select("host").eq("id",true).single()]);
  if(secretResult.error||!secretResult.data)throw new Error("Cadastre primeiro as credenciais da SWeduc.");
  const parsed=parseSweducCredentials(String(secretResult.data));
  return {...parsed,host:normalizeSweducHost(String(configResult.data?.host||parsed.host))};
}

function mapSummaryToGrid(summary:SweducStudentSummary){
  return {matricula_id:Number(summary.matricula_id),aluno_id:Number(summary.aluno_id||0)||null,nome:String(summary.nome||"Aluno sem nome"),data_nascimento:String(summary.data_nascimento||"")||null,numero_aluno:String(summary.num_aluno||"")||null,numero_matricula:String(summary.num_matricula||"")||null,status:String(summary.status||"")||null,unidade:String(summary.unidade||"")||null,curso:String(summary.curso||"")||null,serie:String(summary.serie||"")||null,turma:String(summary.turma||"")||null,ano_letivo:String(summary.ano_letivo||"")||null,responsaveis:[],financeiro:[],dados_origem:{resumo:summary},sincronizado_em:new Date().toISOString()};
}

async function upsertSweducMirror(supabase:SupabaseClient,rows:Array<Record<string,unknown>>){
  if(!rows.length)return;
  const result=await supabase.from("sweduc_alunos").upsert(rows,{onConflict:"matricula_id"});
  if(result.error)throw new Error("Não foi possível atualizar o espelho SWeduc no banco.");
}

function sanitizeSyncYears(value:unknown,fallback:number[]=[]){
  const years=(Array.isArray(value)?value:fallback).map(year=>Number(year)).filter(year=>Number.isSafeInteger(year)&&year>=2020&&year<=2100);
  return Array.from(new Set(years)).sort((a,b)=>a-b);
}

function defaultRecentYears(academicYears:{year:number}[],currentYear:number){
  const available=academicYears.map(item=>Number(item.year)).filter(year=>Number.isSafeInteger(year));
  const recent=available.filter(year=>year>=currentYear-1);
  return sanitizeSyncYears(recent.length?recent:[currentYear-1,currentYear]);
}

function normalizeSearchText(value:unknown){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim().toLocaleLowerCase("pt-BR")}
function matchesSearch(row:Record<string,unknown>,term:string){const normalized=normalizeSearchText(term);if(!normalized)return true;return [row.nome,row.numero_matricula,row.matricula_id,row.turma,row.serie,row.curso].some(value=>normalizeSearchText(value).includes(normalized))}
function financialText(item:Record<string,unknown>,keys:string[]){for(const key of keys){const value=item[key];if(value!==undefined&&value!==null&&String(value).trim())return String(value)}return ""}
function financialAmount(item:Record<string,unknown>){return financialText(item,["valor","Valor","VALOR","valor_titulo","valor_mensalidade","valor_original","vl_titulo","vlr_titulo","total"])}
function formatSuggestedMoney(value:string){
  const clean=value.replace(/[^\d.,-]/g,"").trim();
  if(!clean)return "";
  const number=clean.includes(",")?Number(clean.replace(/\./g,"").replace(",",".")):Number(clean);
  if(!Number.isFinite(number)||number<0)return "";
  return number.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function suggestedFinancialAmount(financeiro:Array<Record<string,unknown>>){
  const opened=financeiro.find(item=>normalizeSearchText(financialText(item,["situacao","status","Situacao","STATUS"])).includes("aberto")&&financialAmount(item));
  const fallback=financeiro.find(item=>financialAmount(item));
  return formatSuggestedMoney(financialAmount(opened||fallback||{}));
}

export async function GET(request:NextRequest){
  const auth=await authorize(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"settings.integrations.view")&&!await hasServerPermission(auth.supabase,"settings.integrations.edit")&&!await hasServerPermission(auth.supabase,"students.view")&&!await hasServerPermission(auth.supabase,"students.create")&&!await hasServerPermission(auth.supabase,"students.edit")&&!await hasServerPermission(auth.supabase,"payments.create")&&!await hasServerPermission(auth.supabase,"nfse.prepare"))return json({error:"Seu usuário não possui permissão para consultar esta integração."},403);
  const {data:config,error}=await auth.supabase.from("sweduc_config").select("host,credencial_configurada,ultimo_status,testada_em,sincronizada_em,ultimo_erro,total_sincronizado,anos_sincronizacao").eq("id",true).maybeSingle();
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
  const suggestedSyncYears=defaultRecentYears(academicYears,defaultAcademicYear);
  const syncYears=sanitizeSyncYears(config.anos_sincronizacao,suggestedSyncYears);
  return json({ok:true,config:{...config,anos_sincronizacao:syncYears,auth_method:authMethod,usuario_configurado:usuarioConfigurado,ano_letivo_ativo:defaultAcademicYear,cofre_configurado:Boolean(process.env.JPI_BACKEND_SECRET)},academicYears,syncYears,suggestedSyncYears,selectedAcademicYear:activeAcademicYear,students:[],total:0});
}

export async function POST(request:NextRequest){
  const auth=await authorize(request);if(!auth.ok)return auth.response;
  let body:Record<string,unknown>;try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const action=String(body.action||"");
  if(["save","test","save_years"].includes(action)&&!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para configurar a SWeduc."},403);
  if(["lookup","sync","details"].includes(action)&&!await hasServerPermission(auth.supabase,"settings.integrations.view")&&!await hasServerPermission(auth.supabase,"settings.integrations.edit")&&!await hasServerPermission(auth.supabase,"students.view")&&!await hasServerPermission(auth.supabase,"students.create")&&!await hasServerPermission(auth.supabase,"students.edit")&&!await hasServerPermission(auth.supabase,"payments.create")&&!await hasServerPermission(auth.supabase,"nfse.prepare"))return json({error:"Seu usuário não possui permissão para consultar alunos da SWeduc."},403);
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
    const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre seguro não está configurado na Vercel. Configure a variável JPI_BACKEND_SECRET para salvar a conexão definitiva da SWeduc."},503);
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
  if(action==="save_years"){
    const syncYears=sanitizeSyncYears(body.syncYears);
    if(!syncYears.length)return json({error:"Escolha pelo menos um ano letivo para o espelho SWeduc."},400);
    const at=new Date().toISOString();
    const {error:updateError}=await auth.supabase.from("sweduc_config").update({anos_sincronizacao:syncYears,updated_at:at,updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:"Não foi possível salvar os anos do espelho SWeduc."},500);
    return json({ok:true,syncYears,message:`Anos do espelho SWeduc salvos: ${syncYears.join(", ")}.`});
  }
  if(action==="lookup"){
    const rawYear=Number(body.academicYear||0);const search=String(body.search||"").trim();const course=String(body.course||"").trim();const serie=String(body.serie||"").trim();const turma=String(body.turma||"").trim();const page=Math.max(1,Math.min(Number(body.page||1),100));const pageSize=80;const from=(page-1)*pageSize;const to=from+pageSize-1;
    let query=auth.supabase.from("sweduc_alunos").select("matricula_id,aluno_id,nome,data_nascimento,numero_aluno,numero_matricula,status,unidade,curso,serie,turma,ano_letivo,responsaveis,financeiro,dados_origem,sincronizado_em",{count:"exact"});
    if(Number.isSafeInteger(rawYear)&&rawYear>1900)query=query.eq("ano_letivo",String(rawYear));
    if(search)query=query.ilike("nome",`%${search}%`);
    if(course)query=query.eq("curso",course);
    if(serie)query=query.eq("serie",serie);
    if(turma)query=query.eq("turma",turma);
    const [result,mirrorCount]=await Promise.all([query.order("nome",{ascending:true}).range(from,to),auth.supabase.from("sweduc_alunos").select("matricula_id",{count:"exact",head:true})]);
    if(result.error)return json({error:"Não foi possível consultar o espelho SWeduc no banco."},500);
    let rows=(result.data||[]) as Array<Record<string,unknown>>;
    const totalLocal=Number(result.count||0);const mirrorTotal=Number(mirrorCount.count||0);
    if(search&&!rows.length&&mirrorTotal>0){
      let broad=auth.supabase.from("sweduc_alunos").select("matricula_id,aluno_id,nome,data_nascimento,numero_aluno,numero_matricula,status,unidade,curso,serie,turma,ano_letivo,responsaveis,financeiro,dados_origem,sincronizado_em");
      if(Number.isSafeInteger(rawYear)&&rawYear>1900)broad=broad.eq("ano_letivo",String(rawYear));
      if(course)broad=broad.eq("curso",course);
      if(serie)broad=broad.eq("serie",serie);
      if(turma)broad=broad.eq("turma",turma);
      const broadResult=await broad.order("nome",{ascending:true}).limit(1000);
      if(broadResult.error)return json({error:"Não foi possível consultar o espelho SWeduc no banco."},500);
      rows=((broadResult.data||[]) as Array<Record<string,unknown>>).filter(row=>matchesSearch(row,search)).slice(from,to+1);
      if(rows.length)return json({ok:true,students:rows,page,lastPage:1,nextPage:null,totalAvailable:rows.length,message:`Consulta local encontrou ${rows.length} matrícula(s) ignorando acentos e caracteres especiais. Nada foi salvo no cadastro fiscal.`});
    }
    if(rows.length||(!search&&mirrorTotal>0)||course||serie||turma)return json({ok:true,students:rows,page,lastPage:Math.max(1,Math.ceil(totalLocal/pageSize)),nextPage:to+1<totalLocal?page+1:null,totalAvailable:totalLocal,message:rows.length?`Consulta local concluída com ${totalLocal} matrícula(s) encontrada(s). Nada foi salvo no cadastro fiscal.`:"Nenhum aluno encontrado no espelho SWeduc para estes filtros."});
    let activeCredentials:SweducCredentials|undefined;let activeAccessToken="";
    try{
      const creds=await credentials(auth.supabase);activeCredentials=creds;const resolved=await resolveSweducAcademicYear(creds.host,Number.isSafeInteger(rawYear)&&rawYear>1900?rawYear:undefined);const activeYear=resolved.selected;const token=await createSweducAccessToken(creds);activeAccessToken=token.accessToken;
      const listing=await listSweducStudentsWithToken(creds.host,token.accessToken,{page,ano_letivo_id:activeYear.id,search:search||undefined});
      const apiRows=(listing.data||[]).map(mapSummaryToGrid);
      await upsertSweducMirror(auth.supabase,apiRows);
      const lastPage=Math.min(Math.max(1,Number(listing.last_page||page)),MAX_SWEDUC_PAGES);
      return json({ok:true,students:apiRows,page,lastPage,nextPage:page<lastPage?page+1:null,academicYear:activeYear.year,totalAvailable:Number(listing.total||0),message:`Espelho SWeduc estava vazio e foi atualizado pela API para ${activeYear.year}. Nada foi salvo no cadastro fiscal.`});
    }catch(error){return json({error:safeSweducError(error,activeCredentials,[activeAccessToken])},400)}
  }
  if(action==="sync"){
    let synced=0;let totalAvailable=0;let activeCredentials:SweducCredentials|undefined;let activeAccessToken="";const rawPage=Number(body.page||1);const requestedPage=Number.isSafeInteger(rawPage)?Math.max(1,Math.min(rawPage,MAX_SWEDUC_PAGES)):1;const search=String(body.search||"").trim().toLocaleLowerCase("pt-BR");
    try{
      const creds=await credentials(auth.supabase);activeCredentials=creds;const rawYear=Number(body.academicYear||0);const resolved=await resolveSweducAcademicYear(creds.host,Number.isSafeInteger(rawYear)&&rawYear>1900?rawYear:undefined);const activeYear=resolved.selected;const token=await createSweducAccessToken(creds);activeAccessToken=token.accessToken;await auth.supabase.from("sweduc_config").update({ultimo_status:"conectado",ultimo_erro:null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
      const page=requestedPage;let lastPage=requestedPage;
      let rows:Array<Record<string,unknown>>=[];
      {
        const listing=await listSweducStudentsWithToken(creds.host,token.accessToken,{page,ano_letivo_id:activeYear.id,search:search||undefined});lastPage=Math.min(Math.max(1,Number(listing.last_page||page)),MAX_SWEDUC_PAGES);totalAvailable=Number(listing.total||0);
        const summaries=(listing.data||[]).filter((summary:SweducStudentSummary)=>!search||String(summary.nome||"").toLocaleLowerCase("pt-BR").includes(search));
        rows=summaries.map(mapSummaryToGrid);
        await upsertSweducMirror(auth.supabase,rows);
        synced+=rows.length;
      }
      const hasNext=page<lastPage;const at=new Date().toISOString();const statusUpdate:Record<string,unknown>={ultimo_status:"conectado",ultimo_erro:null,updated_at:at,updated_by:auth.user.id};if(!hasNext){statusUpdate.sincronizada_em=at;statusUpdate.total_sincronizado=totalAvailable}await auth.supabase.from("sweduc_config").update(statusUpdate).eq("id",true);
      return json({ok:true,synced,students:rows,page,lastPage,nextPage:hasNext?page+1:null,academicYear:activeYear.year,totalAvailable,message:hasNext?`Página ${page} de ${lastPage} do ano letivo ${activeYear.year} consultada na SWeduc.`:`Consulta do ano letivo ${activeYear.year} concluída. Nada foi salvo no banco.`});
    }catch(error){const message=safeSweducError(error,activeCredentials,[activeAccessToken]);await auth.supabase.from("sweduc_config").update({ultimo_status:"erro",ultimo_erro:message,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);return json({error:message,synced},400)}
  }
  if(action==="details"){
    const matriculaId=Number(body.matriculaId||0);
    if(!Number.isSafeInteger(matriculaId)||matriculaId<=0)return json({error:"Selecione uma matrícula SWeduc válida."},400);
    const student=body.student&&typeof body.student==="object"?body.student as Record<string,unknown>:null;
    if(!student||Number(student.matricula_id)!==matriculaId)return json({error:"Consulte a matrícula na SWeduc antes de carregar os responsáveis."},400);
    let activeCredentials:SweducCredentials|undefined;let activeAccessToken="";
    try{
      activeCredentials=await credentials(auth.supabase);const token=await createSweducAccessToken(activeCredentials);activeAccessToken=token.accessToken;
      const detail=await getSweducStudentDetailsWithToken(activeCredentials.host,token.accessToken,matriculaId);
      return json({ok:true,student:{...student,responsaveis:detail.responsaveis,financeiro:detail.financeiro,dados_origem:{...((student.dados_origem as Record<string,unknown>|undefined)||{}),detalhes:detail.detalhes}},responsaveis:detail.responsaveis,financeiro:detail.financeiro,message:"Responsáveis carregados para conferência. Nada foi salvo ainda."});
    }catch(error){return json({error:safeSweducError(error,activeCredentials,[activeAccessToken])},400)}
  }
  if(action==="import"){
    const matriculaId=Number(body.matriculaId||0);const responsibleIndex=Number(body.responsibleIndex||0);
    if(!Number.isSafeInteger(matriculaId)||matriculaId<=0)return json({error:"Selecione uma matrícula SWeduc válida."},400);
    const student=body.student&&typeof body.student==="object"?body.student as Record<string,unknown>:null;
    if(!student||Number(student.matricula_id)!==matriculaId)return json({error:"Consulte a matrícula na SWeduc antes de carregar para a nota."},400);
    let detail:{detalhes:Record<string,unknown>;responsaveis:Array<Record<string,unknown>>;financeiro:Array<Record<string,unknown>>};
    let activeCredentials:SweducCredentials|undefined;let activeAccessToken="";
    try{activeCredentials=await credentials(auth.supabase);const token=await createSweducAccessToken(activeCredentials);activeAccessToken=token.accessToken;detail=await getSweducStudentDetailsWithToken(activeCredentials.host,token.accessToken,matriculaId)}catch(error){return json({error:safeSweducError(error,activeCredentials,[activeAccessToken])},400)}
    student.responsaveis=detail.responsaveis;student.financeiro=detail.financeiro;student.dados_origem={...((student.dados_origem as Record<string,unknown>|undefined)||{}),detalhes:detail.detalhes};
    const responsaveis=detail.responsaveis;
    const selectedResponsible=responsaveis[Math.max(0,Math.min(responsibleIndex,responsaveis.length-1))]||null;
    const details=((student.dados_origem as {detalhes?:Record<string,unknown>}|null)?.detalhes)||{};
    const fiscalStudent=mapSweducToFiscalStudent({student:student as unknown as SweducStudentSummary&Record<string,unknown>,responsible:selectedResponsible,details});
    if(!fiscalStudent.nome)return json({error:"A matrícula selecionada não trouxe nome do aluno."},400);
    if(!fiscalStudent.responsavel||fiscalStudent.responsavel==="RESPONSÁVEL NÃO INFORMADO")return json({error:"Selecione um responsável válido para carregar os dados da nota."},400);
    const valorMensalidadeSugerido=suggestedFinancialAmount(detail.financeiro);
    return json({ok:true,student:{id:-matriculaId,...fiscalStudent,sweduc_matricula_id:matriculaId,sweduc_aluno_id:Number(student.aluno_id||0)||null,sweduc_ano_letivo:String(student.ano_letivo||"")||null,valor_mensalidade_sugerido:valorMensalidadeSugerido||null},message:valorMensalidadeSugerido?`${fiscalStudent.nome} foi preparado para a nota com valor sugerido pela SWeduc. Confira os dados; nada foi gravado ainda.`:`${fiscalStudent.nome} foi preparado para a nota. Confira os dados; nada foi gravado ainda.`});
  }
  return json({error:"Ação SWeduc inválida."},400);
}
