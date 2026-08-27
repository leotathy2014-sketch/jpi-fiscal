import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSmtpEmail } from "@/lib/smtp";

export const runtime="nodejs";
export const maxDuration=60;

const TEST_RECIPIENT="nfse@jejoaopaulo.com.br";
const XML_BUCKET="documentos-nfse";
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]||character);
const safeFilename=(key:string)=>`nfse-homologacao-${key.replace(/[^a-z0-9]/gi,"").slice(0,60)||"documento"}.xml`;

type EmailConfig={email_provider:string;email_from_name:string;email_from_address:string;email_reply_to:string|null;email_smtp_host:string|null;email_smtp_port:number;email_smtp_username:string|null;email_credencial_configurada:boolean;email_ultimo_status:string};
type PaymentSource={id:number;competencia:string;valor_nfse:number;alunos:{nome:string;responsavel:string;email:string|null}|null};
type DocumentSource={id:number;mensalidade_id:number;versao:number;chave_acesso:string;nfse_xml_path:string;estado:string};

function safeDeliveryError(error:unknown){
  const message=error instanceof Error?error.message:String(error||"");
  if(/535|autentica|senha|credential|unauthorized|forbidden/i.test(message))return "A Locaweb recusou a autenticação. Confira a senha salva em Configurações → Integrações.";
  if(/timeout|demorou|timed out|encerrou a conexão|connect/i.test(message))return "O servidor de e-mail não respondeu a tempo. Tente novamente.";
  if(/recipient|destinat|address|endereço/i.test(message))return "O endereço de entrega não foi aceito pelo provedor.";
  return "O provedor não concluiu o envio. Tente novamente e, se persistir, revise a integração de e-mail.";
}

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
  if(!access?.active||!["admin","financeiro"].includes(access.role))return {ok:false as const,response:json({error:"Seu usuário não possui permissão para enviar documentos."},403)};
  return {ok:true as const,supabase,user};
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
    auth.supabase.from("mensalidades").select("id,competencia,valor_nfse,alunos(nome,responsavel,email)").eq("id",monthlyId).maybeSingle(),
    auth.supabase.from("nfse_documentos_homologacao").select("id,mensalidade_id,versao,chave_acesso,nfse_xml_path,estado").eq("id",documentId).eq("mensalidade_id",monthlyId).eq("estado","ativa").maybeSingle(),
    auth.supabase.rpc("get_email_delivery_config",{p_backend_secret:backendSecret}),
  ]);
  const payment=paymentResult.data as unknown as PaymentSource|null;const document=documentResult.data as DocumentSource|null;
  const config=(Array.isArray(configResult.data)?configResult.data[0]:configResult.data) as EmailConfig|undefined;
  if(paymentResult.error||!payment)return json({error:"Mensalidade não encontrada."},404);
  if(documentResult.error||!document)return json({error:"A versão ativa da NFS-e de teste não foi encontrada."},404);
  if(configResult.error||!config)return json({error:"Não foi possível carregar a configuração segura de e-mail."},503);
  const intendedRecipient=String(payment.alunos?.email||"").trim().toLowerCase();
  if(!emailPattern.test(intendedRecipient))return json({error:"O responsável não possui um e-mail válido no cadastro."},400);
  if(!config.email_credencial_configurada||config.email_ultimo_status!=="conectado")return json({error:"A integração de e-mail precisa estar configurada e testada antes das entregas."},400);
  if(String(config.email_from_address||"").toLowerCase()!==TEST_RECIPIENT)return json({error:"O remetente interno de homologação não corresponde ao endereço autorizado."},400);

  const subject=`TESTE — NFS-e de homologação · ${payment.alunos?.nome||"Aluno"} · ${payment.competencia}`;
  const insertResult=await auth.supabase.from("nfse_entregas").insert({mensalidade_id:monthlyId,documento_homologacao_id:documentId,request_id:requestId,canal:"email",ambiente:"homologacao",destinatario_pretendido:intendedRecipient,destinatario_utilizado:TEST_RECIPIENT,assunto:subject,status:"enviando",created_by:auth.user.id,updated_at:new Date().toISOString()}).select("id").single();
  if(insertResult.error){
    if(insertResult.error.code==="23505")return json({error:"Esta nota já possui um envio em andamento. Aguarde a conclusão antes de tentar novamente."},409);
    return json({error:"Não foi possível iniciar o histórico seguro da entrega."},500);
  }
  const deliveryId=Number(insertResult.data.id);let credential="";
  try{
    const [{data:storedSecret,error:secretError},{data:xmlBlob,error:xmlError}]=await Promise.all([
      auth.supabase.rpc("get_communication_secret",{p_channel:"email",p_backend_secret:backendSecret}),
      auth.supabase.storage.from(XML_BUCKET).download(document.nfse_xml_path),
    ]);
    if(secretError||!storedSecret)throw new Error("Credencial de e-mail não encontrada.");
    if(xmlError||!xmlBlob)throw new Error("O XML da NFS-e de teste não pôde ser recuperado.");
    const xmlBuffer=Buffer.from(await xmlBlob.arrayBuffer());if(xmlBuffer.length===0||xmlBuffer.length>10*1024*1024)throw new Error("O XML armazenado é inválido ou muito grande.");
    credential=String(storedSecret);const filename=safeFilename(document.chave_acesso);
    const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#243247;max-width:640px"><div style="padding:14px 18px;background:#fff4df;border:1px solid #edcf98;border-radius:10px"><strong style="color:#8a5700">DOCUMENTO DE HOMOLOGAÇÃO — SEM VALIDADE FISCAL</strong><br><span>Este e-mail foi direcionado à caixa interna da escola para validar a Central de Entregas.</span></div><h2 style="color:#174b8a">NFS-e de teste anexada</h2><p>Aluno: <strong>${escapeHtml(payment.alunos?.nome||"Aluno")}</strong><br>Responsável cadastrado: <strong>${escapeHtml(payment.alunos?.responsavel||"Responsável")}</strong><br>Competência: <strong>${escapeHtml(payment.competencia)}</strong><br>Versão: <strong>${document.versao}</strong></p><p>Destinatário previsto quando a produção real for ativada: <strong>${escapeHtml(intendedRecipient)}</strong>.</p><p>O XML de homologação segue anexado somente para conferência interna.</p><hr style="border:0;border-top:1px solid #dfe5ec"><small>JPI Fiscal · Jardim Escola João Paulo I</small></div>`;
    let providerMessageId:string|undefined;
    if(config.email_provider==="resend"){
      const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${credential}`,"Content-Type":"application/json","Idempotency-Key":`jpi-delivery-${requestId}`},body:JSON.stringify({from:`${config.email_from_name} <${config.email_from_address}>`,to:[TEST_RECIPIENT],reply_to:config.email_reply_to||undefined,subject,html,attachments:[{filename,content:xmlBuffer.toString("base64")}]}),cache:"no-store"});
      const result=await response.json().catch(()=>({})) as {id?:string;message?:string;name?:string};if(!response.ok)throw new Error(result.message||result.name||"O Resend não concluiu a entrega.");providerMessageId=result.id;
    }else{
      if(!config.email_smtp_host||!config.email_smtp_username)throw new Error("Configuração SMTP incompleta.");
      const sent=await sendSmtpEmail({host:config.email_smtp_host,port:config.email_smtp_port||465,username:config.email_smtp_username,password:credential,fromName:config.email_from_name,fromAddress:config.email_from_address,replyTo:config.email_reply_to,to:TEST_RECIPIENT,subject,html,attachments:[{filename,content:xmlBuffer,contentType:"application/xml"}]});providerMessageId=sent.response.slice(0,250);
    }
    const sentAt=new Date().toISOString();const updateResult=await auth.supabase.from("nfse_entregas").update({status:"enviado",provider_message_id:providerMessageId||null,erro_mensagem:null,enviado_em:sentAt,updated_at:sentAt}).eq("id",deliveryId).select("id").maybeSingle();
    if(updateResult.error||!updateResult.data)return json({error:"O e-mail foi aceito pelo provedor, mas o histórico ainda precisa ser conferido.",sent:true},500);
    return json({ok:true,status:"enviado",sentAt,actualRecipient:TEST_RECIPIENT,intendedRecipient,message:"NFS-e de homologação enviada para a caixa interna da escola."});
  }catch(error){
    const safeError=safeDeliveryError(error);await auth.supabase.from("nfse_entregas").update({status:"erro",erro_mensagem:safeError,updated_at:new Date().toISOString()}).eq("id",deliveryId);
    return json({error:safeError},400);
  }finally{credential="";}
}
