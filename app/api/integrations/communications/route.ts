import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits=(value:string)=>value.replace(/\D/g,"");
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]||character);

async function authorizedClient(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");
  const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey)return {ok:false as const,response:json({error:"A conexão com o banco ainda não está configurada."},503)};
  if(!authorization||!token)return {ok:false as const,response:json({error:"Sessão inválida."},401)};
  const supabase=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user?.email)return {ok:false as const,response:json({error:"Sessão expirada. Entre novamente."},401)};
  const {data:access}=await supabase.from("app_users").select("role,active").eq("email",user.email).maybeSingle();
  if(!access?.active||access.role!=="admin")return {ok:false as const,response:json({error:"Apenas o Administrador pode configurar as comunicações."},403)};
  return {ok:true as const,supabase,user};
}

async function readConfig(supabase:SupabaseClient){
  return supabase.from("integracoes_comunicacao").select("email_provider,email_from_name,email_from_address,email_reply_to,email_api_key_configurada,email_testada_em,email_ultimo_status,whatsapp_provider,whatsapp_phone_number_id,whatsapp_business_account_id,whatsapp_sender_number,whatsapp_template_name,whatsapp_token_configurado,whatsapp_testada_em,whatsapp_ultimo_status").eq("id",true).single();
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const {data,error}=await readConfig(auth.supabase);
  if(error||!data)return json({error:error?.message||"Configuração de comunicação não encontrada."},404);
  return json({ok:true,config:data});
}

export async function POST(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const backendSecret=process.env.JPI_BACKEND_SECRET;
  if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  let body:Record<string,unknown>={};
  try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const action=String(body.action||"");

  if(action==="save-email"){
    const fromName=String(body.fromName||"").trim();const fromAddress=String(body.fromAddress||"").trim().toLowerCase();const replyTo=String(body.replyTo||"").trim().toLowerCase();let apiKey=String(body.apiKey||"").trim();
    if(!fromName||fromName.length>100)return json({error:"Informe um nome de remetente válido."},400);
    if(!emailPattern.test(fromAddress))return json({error:"Informe um e-mail de remetente válido."},400);
    if(replyTo&&!emailPattern.test(replyTo))return json({error:"Informe um e-mail de resposta válido."},400);
    if(apiKey&&(!apiKey.startsWith("re_")||apiKey.length<20))return json({error:"A chave do Resend é inválida."},400);
    const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({email_provider:"resend",email_from_name:fromName,email_from_address:fromAddress,email_reply_to:replyTo||null,email_ultimo_status:"pendente",updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:updateError.message},400);
    if(apiKey){const {error:vaultError}=await auth.supabase.rpc("store_communication_secret",{p_channel:"email",p_secret:apiKey,p_backend_secret:backendSecret});apiKey="";if(vaultError)return json({error:"Não foi possível guardar a chave do Resend no cofre seguro."},500)}
    return json({ok:true,message:"Configuração de e-mail salva. Faça o teste de conexão antes de usar."});
  }

  if(action==="test-email"){
    const recipient=String(body.recipient||"").trim().toLowerCase();if(!emailPattern.test(recipient))return json({error:"Informe um destinatário de teste válido."},400);
    const {data:config,error:configError}=await readConfig(auth.supabase);if(configError||!config)return json({error:"Configuração de e-mail não encontrada."},404);
    if(!config.email_from_address)return json({error:"Salve primeiro o e-mail do remetente."},400);
    const {data:apiKey,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"email",p_backend_secret:backendSecret});
    if(secretError||!apiKey)return json({error:"Cadastre primeiro a chave do Resend."},400);
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`jpi-email-test-${Date.now()}`},body:JSON.stringify({from:`${config.email_from_name} <${config.email_from_address}>`,to:[recipient],reply_to:config.email_reply_to||undefined,subject:"Teste de e-mail — JPI Fiscal",html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Integração confirmada</h2><p>Olá!</p><p>Este é um teste seguro do canal de e-mail do <strong>${escapeHtml(config.email_from_name)}</strong>.</p><p>Nenhuma NFS-e foi anexada ou enviada neste teste.</p></div>`}),cache:"no-store"});
    const result=await response.json().catch(()=>({})) as {id?:string;message?:string;name?:string};
    await auth.supabase.from("integracoes_comunicacao").update({email_ultimo_status:response.ok?"conectado":"erro",email_testada_em:response.ok?new Date().toISOString():null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(!response.ok)return json({error:result.message||result.name||"O Resend não concluiu o envio de teste."},400);
    return json({ok:true,message:"E-mail de teste enviado. Confira a caixa de entrada e o spam.",providerId:result.id});
  }

  if(action==="save-whatsapp"){
    const phoneNumberId=digits(String(body.phoneNumberId||""));const businessAccountId=digits(String(body.businessAccountId||""));const senderNumber=digits(String(body.senderNumber||""));const templateName=String(body.templateName||"").trim();let accessToken=String(body.accessToken||"").trim();
    if(!phoneNumberId||phoneNumberId.length>30)return json({error:"Informe o ID do número do WhatsApp."},400);
    if(!businessAccountId||businessAccountId.length>30)return json({error:"Informe o ID da conta comercial."},400);
    if(!senderNumber||senderNumber.length<10||senderNumber.length>15)return json({error:"Informe o número remetente com DDI e DDD."},400);
    if(!/^[a-z0-9_]{3,100}$/i.test(templateName))return json({error:"Informe um nome de modelo válido."},400);
    if(accessToken&&accessToken.length<20)return json({error:"O token da WhatsApp Cloud API é inválido."},400);
    const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({whatsapp_provider:"meta_cloud",whatsapp_phone_number_id:phoneNumberId,whatsapp_business_account_id:businessAccountId,whatsapp_sender_number:senderNumber,whatsapp_template_name:templateName,whatsapp_ultimo_status:"pendente",updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:updateError.message},400);
    if(accessToken){const {error:vaultError}=await auth.supabase.rpc("store_communication_secret",{p_channel:"whatsapp",p_secret:accessToken,p_backend_secret:backendSecret});accessToken="";if(vaultError)return json({error:"Não foi possível guardar o token do WhatsApp no cofre seguro."},500)}
    return json({ok:true,message:"Configuração do WhatsApp salva. Faça o teste antes de enviar mensagens."});
  }

  if(action==="test-whatsapp"){
    const {data:config,error:configError}=await readConfig(auth.supabase);if(configError||!config)return json({error:"Configuração do WhatsApp não encontrada."},404);
    if(!config.whatsapp_phone_number_id)return json({error:"Salve primeiro o ID do número do WhatsApp."},400);
    const {data:accessToken,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"whatsapp",p_backend_secret:backendSecret});
    if(secretError||!accessToken)return json({error:"Cadastre primeiro o token da WhatsApp Cloud API."},400);
    const response=await fetch(`https://graph.facebook.com/${encodeURIComponent(config.whatsapp_phone_number_id)}?fields=display_phone_number,verified_name`,{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
    const result=await response.json().catch(()=>({})) as {display_phone_number?:string;verified_name?:string;error?:{message?:string}};
    await auth.supabase.from("integracoes_comunicacao").update({whatsapp_ultimo_status:response.ok?"conectado":"erro",whatsapp_testada_em:response.ok?new Date().toISOString():null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(!response.ok)return json({error:result.error?.message||"A Meta não confirmou a conexão com este número."},400);
    return json({ok:true,message:`WhatsApp confirmado${result.verified_name?` para ${result.verified_name}`:""}${result.display_phone_number?` · ${result.display_phone_number}`:""}. Nenhuma mensagem foi enviada.`});
  }

  return json({error:"Ação de integração inválida."},400);
}
