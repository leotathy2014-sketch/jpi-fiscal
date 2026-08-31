import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime="nodejs";

const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});

async function authorizedClient(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey)return {ok:false as const,response:json({error:"A conexão com o banco ainda não está configurada."},503)};
  if(!authorization||!token)return {ok:false as const,response:json({error:"Sessão inválida."},401)};
  const supabase=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user?.email)return {ok:false as const,response:json({error:"Sessão expirada. Entre novamente."},401)};
  return {ok:true as const,supabase};
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"settings.integrations.view")&&!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para consultar esta integração."},403);
  const {data,error}=await auth.supabase.from("integracoes_comunicacao").select("agenda_edu_school_identifier,agenda_edu_channel_id,agenda_edu_environment,agenda_edu_documentacao_confirmada,agenda_edu_credencial_configurada,agenda_edu_testada_em,agenda_edu_ultimo_status").eq("id",true).maybeSingle();
  if(error||!data)return json({error:"A preparação da Agenda Edu ainda não foi aplicada ao banco."},503);
  return json({ok:true,ready:false,phase:data.agenda_edu_ultimo_status,environment:"sandbox",schoolIdentifierConfigured:Boolean(data.agenda_edu_school_identifier),channelConfigured:Boolean(data.agenda_edu_channel_id),checklist:{baseLocal:true,documentation:true,credential:Boolean(data.agenda_edu_credencial_configurada),connectionTest:Boolean(data.agenda_edu_testada_em),parentMessaging:false},message:"O envio permanecerá bloqueado até validarmos Mensagens com os responsáveis em canal somente de leitura e os anexos PDF/XML no Sandbox."});
}

export async function POST(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"deliveries.send_agenda"))return json({error:"Seu usuário não possui permissão para enviar pela Agenda Edu."},403);
  return json({ok:false,blocked:true,error:"O envio pela Agenda Edu ainda está bloqueado. Nenhuma chamada externa ou mensagem aos responsáveis foi realizada."},423);
}
