import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime="nodejs";
export const maxDuration=60;

const XML_BUCKET="documentos-nfse";
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const publicBaseUrl=(request:NextRequest)=>String(process.env.NEXT_PUBLIC_APP_URL||(request.nextUrl.hostname==="localhost"?request.nextUrl.origin:"https://jpi-fiscal.vercel.app")).replace(/\/+$/,"");

type PaymentSource={id:number;competencia:string;valor_nfse:number;alunos:{nome:string;responsavel:string;turma:string|null;segmento:string|null}|null};
type DocumentSource={id:number;mensalidade_id:number;versao:number;chave_acesso:string;nfse_xml_path:string;estado:string};

async function authorizedClient(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey)return {ok:false as const,response:json({error:"A conexão com o banco ainda não está configurada."},503)};
  if(!authorization||!token)return {ok:false as const,response:json({error:"Sessão inválida."},401)};
  const supabase=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user?.email)return {ok:false as const,response:json({error:"Sessão expirada. Entre novamente."},401)};
  if(!await hasServerPermission(supabase,"deliveries.send_agenda"))return {ok:false as const,response:json({error:"Seu usuário não possui permissão para enviar pela Agenda Edu."},403)};
  return {ok:true as const,supabase,user};
}

function manualAgendaMessage(payment:PaymentSource,protectedUrl:string){
  const aluno=payment.alunos?.nome||"aluno(a)";
  const responsavel=payment.alunos?.responsavel||"responsável";
  const valor=Number(payment.valor_nfse).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  return [
    "Olá!",
    "",
    `Segue a NFS-e referente à mensalidade de ${payment.competencia} do aluno(a) ${aluno}, responsável ${responsavel}, no valor de ${valor}.`,
    "",
    `Acesse a nota pelo link seguro: ${protectedUrl}`,
    "",
    "Jardim Escola João Paulo I"
  ].join("\n");
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  return json({ok:true,ready:true,mode:"manual-link",message:"Agenda Edu em modo manual: o sistema gera o link seguro e a mensagem para colar no canal."});
}

export async function POST(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  let body:Record<string,unknown>={};try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const action=String(body.action||"prepare");
  if(action==="confirm"){
    const deliveryId=Number(body.deliveryId);
    if(!Number.isSafeInteger(deliveryId)||deliveryId<=0)return json({error:"Identificação da entrega inválida."},400);
    const now=new Date().toISOString();
    const {data,error}=await auth.supabase.from("nfse_entregas").update({status:"enviado",erro_mensagem:null,enviado_em:now,confirmado_em:now,confirmado_por:auth.user.id,confirmado_por_nome:auth.user.email,updated_at:now}).eq("id",deliveryId).eq("canal","agenda_edu").eq("status","aguardando_confirmacao").select("id").maybeSingle();
    if(error||!data)return json({error:"Não foi possível marcar esta mensagem como enviada. Confira se ela ainda está aguardando confirmação."},400);
    return json({ok:true,status:"enviado",sentAt:now,message:"Mensagem marcada como enviada manualmente na Agenda Edu."});
  }
  const monthlyId=Number(body.monthlyId);const documentId=Number(body.documentId);const requestId=String(body.requestId||"");
  if(!Number.isSafeInteger(monthlyId)||monthlyId<=0||!Number.isSafeInteger(documentId)||documentId<=0||!uuidPattern.test(requestId))return json({error:"Identificação da entrega inválida."},400);

  const {data:existing}=await auth.supabase.from("nfse_entregas").select("id,status,enviado_em,erro_mensagem").eq("request_id",requestId).maybeSingle();
  if(existing)return json({ok:existing.status==="enviado",alreadyProcessed:true,status:existing.status,sentAt:existing.enviado_em,error:existing.erro_mensagem},existing.status==="erro"?409:200);

  const [paymentResult,documentResult]=await Promise.all([
    auth.supabase.from("mensalidades").select("id,competencia,valor_nfse,alunos(nome,responsavel,turma,segmento)").eq("id",monthlyId).maybeSingle(),
    auth.supabase.from("nfse_documentos_homologacao").select("id,mensalidade_id,versao,chave_acesso,nfse_xml_path,estado").eq("id",documentId).eq("mensalidade_id",monthlyId).eq("estado","ativa").maybeSingle(),
  ]);
  const payment=paymentResult.data as unknown as PaymentSource|null;const document=documentResult.data as DocumentSource|null;
  if(paymentResult.error||!payment)return json({error:"Mensalidade não encontrada."},404);
  if(documentResult.error||!document)return json({error:"A versão ativa da NFS-e não foi encontrada."},404);

  const subject=`NFS-e · ${payment.alunos?.nome||"Aluno"} · ${payment.competencia}`;
  const usedRecipient=`agenda:producao:student:manual-${monthlyId}`;
  const intendedRecipient=`${payment.alunos?.responsavel||"Responsáveis"} · ${payment.alunos?.nome||"Aluno"}`.slice(0,250);
  const insert=await auth.supabase.from("nfse_entregas").insert({mensalidade_id:monthlyId,documento_homologacao_id:documentId,request_id:requestId,canal:"agenda_edu",ambiente:"homologacao",destinatario_pretendido:intendedRecipient,destinatario_utilizado:usedRecipient,assunto:subject,status:"enviando",created_by:auth.user.id,updated_at:new Date().toISOString()}).select("id").single();
  if(insert.error){
    if(insert.error.code==="23505")return json({error:"Esta nota já possui um envio em andamento. Aguarde antes de tentar novamente."},409);
    return json({error:"Não foi possível iniciar o histórico seguro da entrega."},500);
  }
  const deliveryId=Number(insert.data.id);
  try{
    const {data:xmlBlob,error:xmlError}=await auth.supabase.storage.from(XML_BUCKET).download(document.nfse_xml_path);
    if(xmlError||!xmlBlob)throw new Error("O XML da NFS-e não pôde ser recuperado.");
    const xmlBuffer=Buffer.from(await xmlBlob.arrayBuffer());
    if(xmlBuffer.length===0||xmlBuffer.length>10*1024*1024)throw new Error("O XML armazenado é inválido ou muito grande.");
    const accessTokenValue=randomBytes(32).toString("base64url");const accessTokenHash=createHash("sha256").update(accessTokenValue).digest("hex");
    const accessResult=await auth.supabase.rpc("create_nfse_delivery_access",{p_delivery_id:deliveryId,p_token_hash:accessTokenHash,p_xml_base64:xmlBuffer.toString("base64"),p_chave_acesso:document.chave_acesso,p_backend_secret:backendSecret});
    if(accessResult.error)throw new Error("Não foi possível criar o link protegido da NFS-e.");
    const protectedUrl=new URL(`/nota/${accessTokenValue}`,publicBaseUrl(request)).toString();
    const preparedAt=new Date().toISOString();const manualMessage=manualAgendaMessage(payment,protectedUrl);
    const update=await auth.supabase.from("nfse_entregas").update({status:"aguardando_confirmacao",erro_mensagem:null,aberto_em:preparedAt,updated_at:preparedAt}).eq("id",deliveryId).select("id").maybeSingle();
    if(update.error||!update.data)throw new Error("O histórico do link manual não pôde ser atualizado.");
    return json({ok:true,status:"aguardando_confirmacao",deliveryId,protectedUrl,manualMessage,expiresAt:accessResult.data,message:"Link protegido gerado. Copie a mensagem e cole no canal da Agenda Edu."});
  }catch{
    await auth.supabase.from("nfse_entregas").update({status:"erro",erro_mensagem:"Não foi possível preparar o link seguro para colar na Agenda Edu.",updated_at:new Date().toISOString()}).eq("id",deliveryId);
    return json({error:"Não foi possível preparar o link seguro para colar na Agenda Edu. Nenhum documento foi exposto."},400);
  }
}
