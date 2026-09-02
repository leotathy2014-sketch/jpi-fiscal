import {NextRequest,NextResponse} from "next/server";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import {createSweducAccessToken,getSweducStudentDetailsWithToken,listSweducStudents,listSweducStudentsWithToken,normalizeSweducHost,parseSweducCredentials,serializeSweducCredentials,type SweducStudentSummary} from "@/lib/sweduc";
import {hasServerPermission} from "@/lib/server-permissions";

export const runtime="nodejs";export const maxDuration=60;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer"}});

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
  let query=auth.supabase.from("sweduc_alunos").select("matricula_id,aluno_id,nome,data_nascimento,numero_aluno,numero_matricula,status,unidade,curso,serie,turma,ano_letivo,responsaveis,financeiro,sincronizado_em",{count:"exact"}).order("nome").limit(100);
  if(search)query=query.ilike("nome",`%${search.replace(/[%_]/g,"")}%`);
  const students=await query;
  return json({ok:true,config,students:students.data||[],total:students.count||0});
}

export async function POST(request:NextRequest){
  const auth=await authorize(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para configurar a SWeduc."},403);
  let body:Record<string,unknown>;try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const action=String(body.action||"");
  if(action==="save"){
    const host=normalizeSweducHost(String(body.host||""));let clientId=String(body.clientId||"").trim();let clientSecret=String(body.clientSecret||"").trim();let username=String(body.username||"").trim();let password=String(body.password||"");
    const supplied=[clientId,clientSecret,username,password].filter(Boolean).length;
    const {data:current}=await auth.supabase.from("sweduc_config").select("credencial_configurada").eq("id",true).single();
    if(supplied>0&&supplied<4)return json({error:"Informe CLIENT_ID, CLIENT_SECRET, usuário e senha juntos."},400);
    if(!current?.credencial_configurada&&supplied!==4)return json({error:"Informe todas as credenciais da SWeduc."},400);
    if([clientId,clientSecret,username,password].some(value=>value.length>2000))return json({error:"Uma credencial ultrapassa o tamanho permitido."},400);
    const {error:updateError}=await auth.supabase.from("sweduc_config").update({host,ultimo_status:"pendente",ultimo_erro:null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:"Não foi possível salvar a configuração da SWeduc."},500);
    if(supplied===4){const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre seguro não está disponível."},503);const protectedValue=serializeSweducCredentials({host,clientId,clientSecret,username,password});const saved=await auth.supabase.rpc("store_sweduc_secret",{p_secret:protectedValue,p_backend_secret:backendSecret});clientId="";clientSecret="";username="";password="";if(saved.error)return json({error:"Não foi possível guardar as credenciais no cofre seguro."},500)}
    return json({ok:true,message:"Configuração da SWeduc salva com segurança. Faça o teste de conexão antes de sincronizar."});
  }
  if(action==="test"){
    try{const creds=await credentials(auth.supabase);const sample=await listSweducStudents(creds,{page:1});const at=new Date().toISOString();await auth.supabase.from("sweduc_config").update({host:creds.host,ultimo_status:"conectado",testada_em:at,ultimo_erro:null,updated_at:at,updated_by:auth.user.id}).eq("id",true);return json({ok:true,message:`Conexão confirmada. A SWeduc retornou ${Number(sample.total||sample.data?.length||0)} matrícula(s). Nenhum dado foi importado neste teste.`});}catch(error){const message=error instanceof Error?error.message:"A SWeduc não confirmou a conexão.";await auth.supabase.from("sweduc_config").update({ultimo_status:"erro",ultimo_erro:message.slice(0,500),updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);return json({error:message},400)}
  }
  if(action==="sync"){
    let synced=0;let totalAvailable=0;const requestedPage=Math.max(1,Math.min(Number(body.page||1),100));
    try{
      const creds=await credentials(auth.supabase);const token=await createSweducAccessToken(creds);await auth.supabase.from("sweduc_config").update({ultimo_status:"sincronizando",ultimo_erro:null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
      const page=requestedPage;let lastPage=requestedPage;
      {
        const listing=await listSweducStudentsWithToken(creds.host,token.accessToken,{page});lastPage=Math.min(Number(listing.last_page||page),100);totalAvailable=Number(listing.total||0);
        const rows=await mapInBatches(listing.data||[],5,async(summary:SweducStudentSummary)=>{
          let detail:{detalhes:Record<string,unknown>;responsaveis:Array<Record<string,unknown>>;financeiro:Array<Record<string,unknown>>}={detalhes:{},responsaveis:[],financeiro:[]};let detailError="";
          try{detail=await getSweducStudentDetailsWithToken(creds.host,token.accessToken,Number(summary.matricula_id))}catch(error){detailError=error instanceof Error?error.message:"Detalhes indisponíveis"}
          const d=detail.detalhes;
          return {matricula_id:Number(summary.matricula_id),aluno_id:Number(summary.aluno_id||d.aluno_id)||null,nome:String(summary.nome||d.nome||"Aluno sem nome"),data_nascimento:String(summary.data_nascimento||d.data_nascimento||"")||null,numero_aluno:String(summary.num_aluno||d.numeroaluno||"")||null,numero_matricula:String(summary.num_matricula||"")||null,status:String(summary.status||d.status||"")||null,unidade:String(summary.unidade||d.unidade||"")||null,curso:String(summary.curso||d.curso||"")||null,serie:String(summary.serie||d.serie||"")||null,turma:String(summary.turma||d.turma||"")||null,ano_letivo:String(summary.ano_letivo||d.ano_letivo||"")||null,endereco:String(d.endereco||"")||null,responsaveis:detail.responsaveis,financeiro:detail.financeiro,dados_origem:{resumo:summary,detalhes:d,detalhes_erro:detailError||undefined},sincronizado_em:new Date().toISOString()};
        });
        if(rows.length){const result=await auth.supabase.from("sweduc_alunos").upsert(rows,{onConflict:"matricula_id"});if(result.error)throw new Error("Não foi possível atualizar os alunos no JPI Fiscal.");synced+=rows.length}
      }
      const hasNext=page<lastPage;const at=new Date().toISOString();const statusUpdate:Record<string,unknown>={ultimo_status:hasNext?"sincronizando":"conectado",ultimo_erro:null,updated_at:at,updated_by:auth.user.id};if(!hasNext){statusUpdate.sincronizada_em=at;statusUpdate.total_sincronizado=totalAvailable||synced}await auth.supabase.from("sweduc_config").update(statusUpdate).eq("id",true);
      return json({ok:true,synced,page,lastPage,nextPage:hasNext?page+1:null,message:hasNext?`Página ${page} de ${lastPage} sincronizada.`:`Sincronização concluída.`});
    }catch(error){const message=error instanceof Error?error.message:"A sincronização foi interrompida.";await auth.supabase.from("sweduc_config").update({ultimo_status:"erro",ultimo_erro:message.slice(0,500),updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);return json({error:message,synced},400)}
  }
  return json({error:"Ação SWeduc inválida."},400);
}
