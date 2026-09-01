import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildDanfsePdf } from "@/lib/danfse-pdf";
import { createAgendaEduAccessToken, parseAgendaEduCredentials, resolveAgendaEduFamilyChat, sendAgendaEduAttachment } from "@/lib/agenda-edu";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime="nodejs";
export const maxDuration=60;

const XML_BUCKET="documentos-nfse";
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const studentIdPattern=/^[A-Za-z0-9._-]{1,120}$/;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const safeKey=(value:string)=>value.replace(/[^a-z0-9]/gi,"").slice(0,60)||"documento";

type AgendaConfig={agenda_edu_channel_id:string|null;agenda_edu_environment:string;agenda_edu_credencial_configurada:boolean;agenda_edu_ultimo_status:string};
type PaymentSource={id:number;competencia:string;valor_nfse:number;alunos:{nome:string;responsavel:string;agenda_edu_student_id:string|null;agenda_edu_use_external_id:boolean}|null};
type DocumentSource={id:number;mensalidade_id:number;versao:number;chave_acesso:string;nfse_xml_path:string;estado:string};

function agendaEduMessage(payment:PaymentSource){
  const responsavel=payment.alunos?.responsavel||"responsável";
  const aluno=payment.alunos?.nome||"aluno";
  return [
    "TESTE DE HOMOLOGAÇÃO — SEM VALIDADE FISCAL",
    "",
    `Olá, ${responsavel}.`,
    "",
    `Segue a NFS-e referente ao aluno(a) ${aluno}, competência ${payment.competencia}.`,
    "",
    "O documento segue anexado em formato PDF.",
    "",
    "Jardim Escola João Paulo I",
  ].join("\n");
}

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

async function readConfig(supabase:SupabaseClient,backendSecret:string){
  const result=await supabase.rpc("get_agenda_edu_delivery_config",{p_backend_secret:backendSecret});
  return {config:(Array.isArray(result.data)?result.data[0]:result.data) as AgendaConfig|undefined,error:result.error};
}

function safeDeliveryError(error:unknown){
  const message=error instanceof Error?error.message:String(error||"");
  if(/token|oauth|credencia|unauthorized|forbidden|permission/i.test(message))return "A Agenda Edu recusou as credenciais ou permissões do Sandbox. Revise a integração.";
  if(/chat|aluno|student|respons/i.test(message))return "Não foi possível localizar a mensagem dos responsáveis vinculada a este aluno na Agenda Edu.";
  if(/anexo|attachment|document|arquivo|PDF|XML/i.test(message))return "A Agenda Edu não aceitou o PDF da NFS-e. A nota, o XML e o histórico anterior foram preservados.";
  return "A Agenda Edu não concluiu a entrega. Confira o canal Mensagens com os responsáveis e tente novamente.";
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  const {config,error}=await readConfig(auth.supabase,backendSecret);
  if(error||!config)return json({error:"Não foi possível carregar a configuração segura da Agenda Edu."},503);
  const ready=Boolean(config.agenda_edu_environment==="homologacao"&&config.agenda_edu_credencial_configurada&&config.agenda_edu_ultimo_status==="conectado"&&config.agenda_edu_channel_id);
  return json({ok:true,ready,environment:"sandbox",channelConfigured:Boolean(config.agenda_edu_channel_id),message:ready?"Agenda Edu pronta para enviar mensagem e PDF da NFS-e aos responsáveis no Sandbox.":"Configure, salve e teste a Agenda Edu antes do primeiro envio."});
}

export async function POST(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  let body:Record<string,unknown>={};try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const monthlyId=Number(body.monthlyId);const documentId=Number(body.documentId);const requestId=String(body.requestId||"");
  if(!Number.isSafeInteger(monthlyId)||monthlyId<=0||!Number.isSafeInteger(documentId)||documentId<=0||!uuidPattern.test(requestId))return json({error:"Identificação da entrega inválida."},400);

  const {data:existing}=await auth.supabase.from("nfse_entregas").select("id,status,enviado_em,erro_mensagem").eq("request_id",requestId).maybeSingle();
  if(existing)return json({ok:existing.status==="enviado",alreadyProcessed:true,status:existing.status,sentAt:existing.enviado_em,error:existing.erro_mensagem},existing.status==="erro"?409:200);

  const [paymentResult,documentResult,configResult]=await Promise.all([
    auth.supabase.from("mensalidades").select("id,competencia,valor_nfse,alunos(nome,responsavel,agenda_edu_student_id,agenda_edu_use_external_id)").eq("id",monthlyId).maybeSingle(),
    auth.supabase.from("nfse_documentos_homologacao").select("id,mensalidade_id,versao,chave_acesso,nfse_xml_path,estado").eq("id",documentId).eq("mensalidade_id",monthlyId).eq("estado","ativa").maybeSingle(),
    readConfig(auth.supabase,backendSecret),
  ]);
  const payment=paymentResult.data as unknown as PaymentSource|null;const document=documentResult.data as DocumentSource|null;const config=configResult.config;
  if(paymentResult.error||!payment)return json({error:"Mensalidade não encontrada."},404);
  if(documentResult.error||!document)return json({error:"A versão ativa da NFS-e de teste não foi encontrada."},404);
  if(configResult.error||!config)return json({error:"Não foi possível carregar a configuração segura da Agenda Edu."},503);
  if(config.agenda_edu_environment!=="homologacao")return json({error:"A entrega pela Agenda Edu está autorizada somente no Sandbox."},403);
  if(!config.agenda_edu_credencial_configurada||config.agenda_edu_ultimo_status!=="conectado"||!config.agenda_edu_channel_id)return json({error:"A integração da Agenda Edu precisa estar configurada e testada."},400);
  const studentId=String(payment.alunos?.agenda_edu_student_id||"").trim();
  if(!studentIdPattern.test(studentId))return json({error:"Cadastre o ID deste aluno na Agenda Edu antes do envio."},400);

  const subject=`TESTE — NFS-e de homologação · ${payment.alunos?.nome||"Aluno"} · ${payment.competencia}`;
  const usedRecipient=`sandbox:student:${studentId}`;
  const intendedRecipient=`${payment.alunos?.responsavel||"Responsáveis"} · ${payment.alunos?.nome||"Aluno"}`.slice(0,250);
  const insert=await auth.supabase.from("nfse_entregas").insert({mensalidade_id:monthlyId,documento_homologacao_id:documentId,request_id:requestId,canal:"agenda_edu",ambiente:"homologacao",destinatario_pretendido:intendedRecipient,destinatario_utilizado:usedRecipient,assunto:subject,status:"enviando",created_by:auth.user.id,updated_at:new Date().toISOString()}).select("id").single();
  if(insert.error){
    if(insert.error.code==="23505")return json({error:"Esta nota já possui um envio em andamento. Aguarde antes de tentar novamente."},409);
    return json({error:"Não foi possível iniciar o histórico seguro da entrega."},500);
  }
  const deliveryId=Number(insert.data.id);const providerIds:{pdf?:string}={};let protectedSecret="";
  try{
    const [{data:storedSecret,error:secretError},{data:xmlBlob,error:xmlError}]=await Promise.all([
      auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret}),
      auth.supabase.storage.from(XML_BUCKET).download(document.nfse_xml_path),
    ]);
    if(secretError||!storedSecret)throw new Error("Credenciais da Agenda Edu não encontradas.");
    if(xmlError||!xmlBlob)throw new Error("O XML da NFS-e não pôde ser recuperado para gerar o PDF.");
    const xmlBuffer=Buffer.from(await xmlBlob.arrayBuffer());
    if(xmlBuffer.length===0||xmlBuffer.length>10*1024*1024)throw new Error("O XML armazenado é inválido ou muito grande.");
    const {pdf:pdfBuffer}=buildDanfsePdf(xmlBuffer.toString("utf8"),document.chave_acesso);
    protectedSecret=String(storedSecret);const credentials=parseAgendaEduCredentials(protectedSecret);const {accessToken}=await createAgendaEduAccessToken(credentials);
    const common={accessToken,schoolToken:credentials.schoolToken,channelId:config.agenda_edu_channel_id,studentId,useExternalId:Boolean(payment.alunos?.agenda_edu_use_external_id)};
    const chatId=await resolveAgendaEduFamilyChat(common);
    providerIds.pdf=await sendAgendaEduAttachment({
      accessToken,
      schoolToken:credentials.schoolToken,
      channelId:config.agenda_edu_channel_id,
      chatId,
      content:agendaEduMessage(payment),
      filename:`danfse-homologacao-${safeKey(document.chave_acesso)}.pdf`,
      contentType:"application/pdf",
      bytes:new Uint8Array(pdfBuffer),
    });
    const sentAt=new Date().toISOString();const update=await auth.supabase.from("nfse_entregas").update({status:"enviado",provider_message_id:providerIds.pdf,provider_message_ids:providerIds,erro_mensagem:null,enviado_em:sentAt,provider_aceito_em:sentAt,updated_at:sentAt}).eq("id",deliveryId).select("id").maybeSingle();
    if(update.error||!update.data)return json({error:"A Agenda Edu aceitou o PDF, mas o histórico precisa ser conferido.",sent:true},500);
    return json({ok:true,status:"enviado",sentAt,providerMessages:providerIds,message:"Mensagem e PDF da NFS-e aceitos pela Agenda Edu para os responsáveis do aluno no Sandbox."});
  }catch(error){
    const safeError=safeDeliveryError(error);
    await auth.supabase.from("nfse_entregas").update({status:"erro",provider_message_id:providerIds.pdf||null,provider_message_ids:providerIds,erro_mensagem:safeError,updated_at:new Date().toISOString()}).eq("id",deliveryId);
    return json({error:safeError},400);
  }finally{protectedSecret="";}
}
