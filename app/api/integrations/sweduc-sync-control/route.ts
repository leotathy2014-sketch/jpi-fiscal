import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const runtime="nodejs";
export const maxDuration=300;
const CRM_URL="https://tkcfghalihjkrujfavcn.supabase.co";
const CRM_PUBLIC_KEY="sb_publishable_8k_cXL0Fv09kLntxhUNcPw_TdyxTPTE";
const corsHeaders=(origin:string|null)=>{
  const allowed=origin==="https://crm.novaltsistemas.com.br"||origin==="https://crm-matriculas-lovat.vercel.app"||/^https:\/\/crm-matriculas-[a-z0-9-]+\.vercel\.app$/i.test(origin||"");
  return {"Access-Control-Allow-Origin":allowed&&origin?origin:"https://crm-matriculas-lovat.vercel.app","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type","Cache-Control":"no-store","Vary":"Origin"};
};
const json=(body:Record<string,unknown>,status=200,origin:string|null=null)=>NextResponse.json(body,{status,headers:corsHeaders(origin)});

async function authorizeMaster(request:NextRequest){
  const authorization=request.headers.get("authorization")||"";
  if(!/^Bearer\s+[^\s]+$/.test(authorization))return false;
  const userResponse=await fetch(`${CRM_URL}/auth/v1/user`,{headers:{apikey:CRM_PUBLIC_KEY,Authorization:authorization},cache:"no-store"});
  if(!userResponse.ok)return false;
  const permissionResponse=await fetch(`${CRM_URL}/rest/v1/rpc/crm_can_manage_settings`,{method:"POST",headers:{apikey:CRM_PUBLIC_KEY,Authorization:authorization,"Content-Type":"application/json"},body:"{}",cache:"no-store"});
  if(!permissionResponse.ok)return false;
  return permissionResponse.json().then(value=>value===true).catch(()=>false);
}

async function control(action="status",intervalMinutes?:number){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!serviceKey)throw new Error("A conexão interna da sincronização não está configurada.");
  const client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc("crm_sweduc_sync_control",{p_action:action,p_interval_minutes:intervalMinutes??null});
  if(error)throw new Error(error.message);
  return data as Record<string,unknown>;
}

export async function OPTIONS(request:NextRequest){return new NextResponse(null,{status:204,headers:corsHeaders(request.headers.get("origin"))});}
export async function GET(request:NextRequest){
  const origin=request.headers.get("origin");
  try{if(!await authorizeMaster(request))return json({error:"Acesso exclusivo do Master."},403,origin);return json(await control(),200,origin);}
  catch(error){return json({error:error instanceof Error?error.message:"Não foi possível consultar a sincronização."},503,origin);}
}
export async function POST(request:NextRequest){
  const origin=request.headers.get("origin");
  try{
    if(!await authorizeMaster(request))return json({error:"Acesso exclusivo do Master."},403,origin);
    let body:Record<string,unknown>;try{body=await request.json();}catch{return json({error:"Comando inválido."},400,origin);}
    const action=String(body.action||"");
    if(action==="set_interval"){
      const interval=Number(body.intervalMinutes);
      if(!Number.isInteger(interval)||![5,10,15,20,30,60].includes(interval))return json({error:"Escolha um intervalo de 5, 10, 15, 20, 30 ou 60 minutos."},400,origin);
      return json(await control(action,interval),200,origin);
    }
    if(action==="pause"||action==="resume")return json(await control(action),200,origin);
    if(action==="run_now"){
      const cronSecret=process.env.CRON_SECRET||process.env.JPI_SYNC_CRON_SECRET;
      if(!cronSecret)return json({error:"A credencial da rotina automática não está configurada."},503,origin);
      const response=await fetch(new URL("/api/cron/sweduc-sync",request.url),{headers:{Authorization:`Bearer ${cronSecret}`},cache:"no-store",signal:AbortSignal.timeout(285000)});
      let result:Record<string,unknown>={};try{result=await response.json();}catch{}
      return json({run:result,...await control()},response.ok?200:response.status,origin);
    }
    return json({error:"Ação não reconhecida."},400,origin);
  }catch(error){return json({error:error instanceof Error?error.message:"Não foi possível atualizar a sincronização."},503,origin);}
}
