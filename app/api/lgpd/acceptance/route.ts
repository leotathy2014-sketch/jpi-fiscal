import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { LGPD_TERM_TEXT, LGPD_TERM_TITLE, LGPD_TERM_VERSION } from "@/lib/lgpd-consent";

const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Vary:"Authorization","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
const termHash=()=>createHash("sha256").update(`${LGPD_TERM_VERSION}\n${LGPD_TERM_TEXT}`,"utf8").digest("hex");
const clientIp=(request:NextRequest)=>String(request.headers.get("x-forwarded-for")||request.headers.get("x-real-ip")||"").split(",")[0].trim()||null;

async function getAuthenticatedClient(request:NextRequest){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization")||"";
  const token=authorization.replace(/^Bearer\s+/i,"").trim();
  if(!url||!key||!token)return {error:json({error:"Sessão expirada. Entre novamente."},401)};
  const supabase=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user)return {error:json({error:"Sessão expirada. Entre novamente."},401)};
  return {supabase,user};
}

export async function GET(request:NextRequest){
  const auth=await getAuthenticatedClient(request);
  if(auth.error)return auth.error;
  const {supabase,user}=auth;
  const {data,error}=await supabase.from("lgpd_user_acceptances").select("accepted_at,term_version").eq("user_id",user.id).eq("term_version",LGPD_TERM_VERSION).maybeSingle();
  if(error)return json({error:"Não foi possível verificar o aceite LGPD agora."},500);
  return json({accepted:Boolean(data?.accepted_at),acceptedAt:data?.accepted_at||null,termVersion:LGPD_TERM_VERSION,title:LGPD_TERM_TITLE,text:LGPD_TERM_TEXT});
}

export async function POST(request:NextRequest){
  const auth=await getAuthenticatedClient(request);
  if(auth.error)return auth.error;
  const {supabase,user}=auth;
  const body=await request.json().catch(()=>({})) as {confirmed?:boolean;role?:string};
  if(body.confirmed!==true)return json({error:"Marque que leu e concorda com o termo para continuar."},400);
  const userAgent=String(request.headers.get("user-agent")||"").slice(0,1000);
  const payload={
    user_id:user.id,
    user_email:user.email||null,
    user_role:typeof body.role==="string"?body.role.slice(0,80):null,
    term_version:LGPD_TERM_VERSION,
    term_title:LGPD_TERM_TITLE,
    acceptance_text:LGPD_TERM_TEXT,
    acceptance_hash:termHash(),
    ip_address:clientIp(request),
    user_agent:userAgent
  };
  const {data,error}=await supabase.from("lgpd_user_acceptances").upsert(payload,{onConflict:"user_id,term_version"}).select("accepted_at,term_version").single();
  if(error)return json({error:"Não foi possível registrar o aceite LGPD. Tente novamente."},500);
  return json({accepted:true,acceptedAt:data.accepted_at,termVersion:data.term_version});
}
