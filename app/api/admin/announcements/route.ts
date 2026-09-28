import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendSmtpEmail } from "@/lib/smtp";

export const runtime = "nodejs";
export const maxDuration = 60;

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]||character);
const paragraphHtml=(value:string)=>escapeHtml(value).split(/\n{2,}/).map(paragraph=>`<p>${paragraph.replace(/\n/g,"<br/>")}</p>`).join("");

function adminClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!serviceKey)throw new Error("Supabase do servidor não configurado.");
  return createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
}

function userClient(request:NextRequest){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization")||"";
  if(!url||!key||!authorization)return null;
  return createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{autoRefreshToken:false,persistSession:false}});
}

async function hasPermission(admin:SupabaseClient,role:string,permissionKey:string){
  if(role==="master")return true;
  const {data}=await admin.from("jpi_role_permissions").select("allowed").eq("role",role).eq("permission_key",permissionKey).maybeSingle();
  return data?.allowed===true;
}

async function getContext(request:NextRequest){
  const admin=adminClient();
  const authorization=request.headers.get("authorization")||"";
  const token=authorization.replace(/^Bearer\s+/i,"");
  if(!token)return {error:json({error:"Sessão inválida."},401)};
  const {data:{user},error:userError}=await admin.auth.getUser(token);
  if(userError||!user?.email)return {error:json({error:"Sessão expirada. Entre novamente."},401)};
  const {data:appUser,error:appUserError}=await admin.from("app_users").select("id,nome,email,role,active").eq("email",user.email.toLowerCase()).maybeSingle();
  if(appUserError||!appUser?.active)return {error:json({error:"Seu usuário não possui acesso ao sistema."},403)};
  const allowed=appUser.role==="master"||await hasPermission(admin,String(appUser.role),"system.announcements.send")||await hasPermission(admin,String(appUser.role),"settings.users.manage");
  if(!allowed)return {error:json({error:"Seu perfil não possui permissão para enviar comunicados."},403)};
  const scoped=userClient(request);
  if(!scoped)return {error:json({error:"Sessão inválida para acessar o cofre de e-mail."},401)};
  return {admin,scoped,user:appUser};
}

async function emailConfig(scoped:SupabaseClient){
  const backendSecret=process.env.JPI_BACKEND_SECRET;
  if(!backendSecret)throw new Error("O cofre de credenciais ainda não está configurado no servidor.");
  const {data:config,error:configError}=await scoped.from("integracoes_comunicacao").select("email_provider,email_from_name,email_from_address,email_reply_to,email_smtp_host,email_smtp_port,email_smtp_username,email_credencial_configurada").eq("id",true).single();
  if(configError||!config)throw new Error("Configuração de e-mail não encontrada.");
  if(!config.email_from_address||!config.email_credencial_configurada)throw new Error("Configure e teste o e-mail antes de enviar comunicados.");
  const {data:secret,error:secretError}=await scoped.rpc("get_communication_secret",{p_channel:"email",p_backend_secret:backendSecret});
  if(secretError||!secret)throw new Error("Não foi possível recuperar a credencial protegida do e-mail.");
  return {config,secret:String(secret)};
}

async function sendOne(config:Record<string,unknown>,secret:string,to:string,subject:string,html:string){
  if(config.email_provider==="resend"){
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json","Idempotency-Key":`jpi-comunicado-${Date.now()}-${to}`},body:JSON.stringify({from:`${config.email_from_name} <${config.email_from_address}>`,to:[to],reply_to:config.email_reply_to||undefined,subject,html}),cache:"no-store"});
    const result=await response.json().catch(()=>({})) as {message?:string;name?:string};
    if(!response.ok)throw new Error(result.message||result.name||"O provedor não concluiu o envio.");
    return;
  }
  if(!config.email_smtp_host||!config.email_smtp_username)throw new Error("Dados SMTP incompletos.");
  await sendSmtpEmail({host:String(config.email_smtp_host),port:Number(config.email_smtp_port||465),username:String(config.email_smtp_username),password:secret,fromName:String(config.email_from_name||"JPI Fiscal"),fromAddress:String(config.email_from_address),replyTo:config.email_reply_to?String(config.email_reply_to):null,to,subject,html});
}

export async function GET(request:NextRequest){
  try{
    const context=await getContext(request);if("error" in context)return context.error;
    const {data,error}=await context.admin.from("system_announcements").select("id,subject,recipients_count,success_count,error_count,status,sent_by_email,created_at,error_message").order("created_at",{ascending:false}).limit(20);
    if(error)throw error;
    return json({ok:true,items:data||[]});
  }catch(error){
    return json({error:error instanceof Error?error.message:"Não foi possível carregar os comunicados."},500);
  }
}

export async function POST(request:NextRequest){
  try{
    const context=await getContext(request);if("error" in context)return context.error;
    const body=await request.json().catch(()=>({})) as Record<string,unknown>;
    const subject=String(body.subject||"").replace(/\s+/g," ").trim();
    const message=String(body.message||"").replace(/\r\n/g,"\n").trim();
    const onlyActive=body.onlyActive!==false;
    const recipientIds=Array.isArray(body.recipientIds)?body.recipientIds.map(Number).filter(Number.isSafeInteger):[];
    if(subject.length<6||subject.length>120)return json({error:"Informe um assunto entre 6 e 120 caracteres."},400);
    if(message.length<20||message.length>4000)return json({error:"Informe uma mensagem entre 20 e 4.000 caracteres."},400);
    const {data:users,error:usersError}=await context.admin.from("app_users").select("id,nome,email,role,active").not("email","is",null).order("nome",{ascending:true});
    if(usersError)throw usersError;
    const recipients=(users||[]).filter(user=>(recipientIds.length?recipientIds.includes(Number(user.id)):(!onlyActive||user.active))&&emailPattern.test(String(user.email||"")));
    if(!recipients.length)return json({error:"Nenhum usuário com e-mail válido foi encontrado."},400);
    const {config,secret}=await emailConfig(context.scoped);
    const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#14263d"><h2 style="margin:0 0 12px;color:#970b0b">Comunicado JPI Fiscal</h2>${paragraphHtml(message)}<hr style="border:none;border-top:1px solid #e5eaf2;margin:24px 0"/><p style="font-size:12px;color:#64748b">Mensagem enviada pela administração do sistema JPI Fiscal.</p></div>`;
    const details:Array<{email:string;ok:boolean;error?:string}>=[];
    for(const recipient of recipients){
      const email=String(recipient.email).toLowerCase();
      try{await sendOne(config as Record<string,unknown>,secret,email,subject,html);details.push({email,ok:true})}
      catch(sendError){details.push({email,ok:false,error:sendError instanceof Error?sendError.message:"Falha no envio."})}
    }
    const successCount=details.filter(item=>item.ok).length;
    const errorCount=details.length-successCount;
    await context.admin.from("system_announcements").insert({subject,message_text:message,recipients_count:details.length,success_count:successCount,error_count:errorCount,status:errorCount?"parcial":"enviado",sent_by:context.user.id,sent_by_email:context.user.email,details,error_message:errorCount?`${errorCount} envio(s) falharam.`:null});
    await context.admin.from("integracoes_comunicacao").update({email_ultimo_status:successCount?"conectado":"erro",email_testada_em:successCount?new Date().toISOString():undefined,updated_at:new Date().toISOString()}).eq("id",true);
    return json({ok:successCount>0,recipients:details.length,successCount,errorCount,details:details.map(item=>item.ok?{email:item.email,ok:true}:item)});
  }catch(error){
    return json({error:error instanceof Error?error.message:"Não foi possível enviar o comunicado."},500);
  }
}
