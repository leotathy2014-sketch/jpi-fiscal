import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {createSweducAccessToken,currentSweducAcademicYear,resolveSweducAcademicYear,listSweducStudentsWithToken,normalizeSweducHost,parseSweducCredentials,type SweducCredentials,type SweducStudentSummary} from "@/lib/sweduc";

export const runtime="nodejs";export const maxDuration=60;
const MAX_PAGES_PER_RUN=20;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0"}});

function sanitizeSyncYears(value:unknown){
  const current=currentSweducAcademicYear();
  const fallback=[current-1,current];
  const source=Array.isArray(value)&&value.length?value:fallback;
  const years=source.map(year=>Number(year)).filter(year=>Number.isSafeInteger(year)&&year>=2020&&year<=2100);
  return Array.from(new Set(years)).sort((a,b)=>a-b);
}
const DEFAULT_SWEDUC_UNITS=["JPI - Matriz"];
const SWEDUC_UNIT_OPTIONS=["JPI - Matriz","JPI - Filial"];
function sanitizeSyncUnits(value:unknown){
  const source=Array.isArray(value)&&value.length?value:DEFAULT_SWEDUC_UNITS;
  const units=source.map(unit=>String(unit||"").replace(/\s+/g," ").trim()).filter(unit=>SWEDUC_UNIT_OPTIONS.includes(unit));
  return Array.from(new Set(units));
}
function normalizeUnit(value:unknown){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toLocaleLowerCase("pt-BR")}
function filterRowsByUnits(rows:Array<Record<string,unknown>>,units:string[]){return rows.filter(row=>units.some(unit=>normalizeUnit(unit)===normalizeUnit(row.unidade)))}

function safeSweducError(error:unknown,current?:SweducCredentials,sensitiveValues:string[]=[]){
  let message=error instanceof Error?error.message:"A SWeduc não confirmou a sincronização automática.";
  const basic=current?Buffer.from(`${current.clientId}:${current.clientSecret}`,"utf8").toString("base64"):"";
  for(const secret of [current?.clientId,current?.clientSecret,current?.username,current?.password,basic,...sensitiveValues]){
    if(!secret)continue;
    message=message.split(secret).join("[protegido]").split(encodeURIComponent(secret)).join("[protegido]");
  }
  return message.slice(0,500);
}

function mapSummaryToMirror(summary:SweducStudentSummary,at:string){
  return {
    matricula_id:Number(summary.matricula_id),
    aluno_id:Number(summary.aluno_id||0)||null,
    nome:String(summary.nome||"Aluno sem nome"),
    data_nascimento:String(summary.data_nascimento||"")||null,
    numero_aluno:String(summary.num_aluno||"")||null,
    numero_matricula:String(summary.num_matricula||"")||null,
    status:String(summary.status||"")||null,
    unidade:String(summary.unidade||"")||null,
    curso:String(summary.curso||"")||null,
    serie:String(summary.serie||"")||null,
    turma:String(summary.turma||"")||null,
    ano_letivo:String(summary.ano_letivo||"")||null,
    responsaveis:[],
    financeiro:[],
    dados_origem:{resumo:summary},
    sincronizado_em:at
  };
}

function normalizeSearchText(value:unknown){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim().toLocaleLowerCase("pt-BR")}
function referenceSourceId(row:Record<string,unknown>,keys:string[]){
  const origin=row.dados_origem&&typeof row.dados_origem==="object"?row.dados_origem as Record<string,unknown>:{};
  const summary=origin.resumo&&typeof origin.resumo==="object"?origin.resumo as Record<string,unknown>:{};
  for(const source of [row,summary]){
    for(const key of keys){
      const value=source[key];
      if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();
    }
  }
  return null;
}
function academicReferenceRows(rows:Array<Record<string,unknown>>,fallbackYear?:number,at=new Date().toISOString()){
  const references=new Map<string,Record<string,unknown>>();
  for(const row of rows){
    const year=Number(row.ano_letivo||fallbackYear||0);
    const curso=String(row.curso||"").replace(/\s+/g," ").trim();
    if(!Number.isSafeInteger(year)||year<2020||year>2100||!curso)continue;
    const serie=String(row.serie||"").replace(/\s+/g," ").trim();
    const turma=String(row.turma||"").replace(/\s+/g," ").trim();
    const cursoNormalizado=normalizeSearchText(curso);
    const serieNormalizada=normalizeSearchText(serie);
    const turmaNormalizada=normalizeSearchText(turma);
    const key=[year,cursoNormalizado,serieNormalizada,turmaNormalizada].join("|");
    if(!references.has(key))references.set(key,{
      ano_letivo:year,
      curso_id:referenceSourceId(row,["curso_id","cursoId","id_curso","idCurso"]),
      curso,
      curso_normalizado:cursoNormalizado,
      serie_id:referenceSourceId(row,["serie_id","serieId","id_serie","idSerie"]),
      serie:serie||null,
      serie_normalizada:serieNormalizada,
      turma_id:referenceSourceId(row,["turma_id","turmaId","id_turma","idTurma"]),
      turma:turma||null,
      turma_normalizada:turmaNormalizada,
      ativo:true,
      ultima_sincronizacao_em:at,
      updated_at:at,
    });
  }
  return Array.from(references.values());
}

export async function GET(request:NextRequest){
  const cronSecret=process.env.CRON_SECRET;
  if(!cronSecret||request.headers.get("authorization")!==`Bearer ${cronSecret}`)return json({error:"Sincronização automática não autorizada."},401);
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const backendSecret=process.env.JPI_BACKEND_SECRET;
  if(!supabaseUrl||!serviceRoleKey||!backendSecret)return json({error:"Configure SUPABASE_SERVICE_ROLE_KEY, JPI_BACKEND_SECRET e CRON_SECRET na Vercel para ativar a sincronização automática."},503);
  const supabase=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  let activeCredentials:SweducCredentials|undefined;let activeAccessToken="";let synced=0;let page=1;let lastPage=1;const syncedYears:number[]=[];
  try{
    const [secretResult,configResult]=await Promise.all([
      supabase.rpc("get_sweduc_secret_service",{p_backend_secret:backendSecret}),
      supabase.from("sweduc_config").select("host,anos_sincronizacao,unidades_sincronizacao").eq("id",true).single()
    ]);
    if(secretResult.error||!secretResult.data)throw new Error("Cadastre primeiro as credenciais da SWeduc.");
    const parsed=parseSweducCredentials(String(secretResult.data));
    activeCredentials={...parsed,host:normalizeSweducHost(String(configResult.data?.host||parsed.host))};
    const token=await createSweducAccessToken(activeCredentials);activeAccessToken=token.accessToken;
    const at=new Date().toISOString();
    await supabase.from("sweduc_config").update({ultimo_status:"sincronizando",ultimo_erro:null,updated_at:at}).eq("id",true);
    const years=sanitizeSyncYears(configResult.data?.anos_sincronizacao);
    const units=sanitizeSyncUnits(configResult.data?.unidades_sincronizacao);
    for(const year of years){
      const resolved=await resolveSweducAcademicYear(activeCredentials.host,year);
      const academicYear=resolved.selected;
      page=1;lastPage=1;let syncedThisYear=0;
      while(page<=lastPage&&page<=MAX_PAGES_PER_RUN){
        const listing=await listSweducStudentsWithToken(activeCredentials.host,token.accessToken,{page,ano_letivo_id:academicYear.id});
        lastPage=Math.max(1,Number(listing.last_page||page));
        const rows=filterRowsByUnits((listing.data||[]).map(summary=>mapSummaryToMirror(summary,at)),units);
        if(rows.length){
          const result=await supabase.from("sweduc_alunos").upsert(rows,{onConflict:"matricula_id"});
          if(result.error)throw new Error("Não foi possível atualizar o espelho SWeduc.");
          const references=academicReferenceRows(rows,academicYear.year,at);
          if(references.length){
            const referenceResult=await supabase.from("sweduc_referencias_academicas").upsert(references,{onConflict:"ano_letivo,curso_normalizado,serie_normalizada,turma_normalizada"});
            if(referenceResult.error)throw new Error("Não foi possível atualizar as referências acadêmicas da SWeduc.");
          }
        }
        synced+=rows.length;syncedThisYear+=rows.length;page++;
      }
      if(syncedThisYear||page>lastPage)syncedYears.push(academicYear.year);
    }
    const finished=page>lastPage;const doneAt=new Date().toISOString();
    await supabase.from("sweduc_config").update({ultimo_status:"conectado",ultimo_erro:null,sincronizada_em:doneAt,total_sincronizado:synced,updated_at:doneAt}).eq("id",true);
    return json({ok:true,academicYears:syncedYears,synced,finished,nextPage:finished?null:page,message:finished?`Sincronização automática concluída para ${syncedYears.join(", ")} com ${synced} matrícula(s).`:`Sincronização parcial concluída com ${synced} matrícula(s). Próxima execução continua atualizando.`});
  }catch(error){
    const message=safeSweducError(error,activeCredentials,[activeAccessToken]);
    try{await supabase.from("sweduc_config").update({ultimo_status:"erro",ultimo_erro:message,updated_at:new Date().toISOString()}).eq("id",true)}catch{}
    return json({error:message,synced,page},400);
  }
}
