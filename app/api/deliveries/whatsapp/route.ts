import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildDanfsePdf } from "@/lib/danfse-pdf";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime="nodejs";
export const maxDuration=60;

const XML_BUCKET="documentos-nfse";
const XML_LINK_SECONDS=7*24*60*60;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const brazilPhonePattern=/^55[1-9][0-9]{9,10}$/;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const digits=(value:string)=>value.replace(/\D/g,"");
const normalizeBrazilPhone=(value:string)=>{const phone=digits(value);return phone.length===10||phone.length===11?`55${phone}`:phone};
const safeXmlFilename=(key:string)=>`nfse-homologacao-${key.replace(/[^a-z0-9]/gi,"").slice(0,60)||"documento"}.xml`;
const safePdfFilename=(key:string)=>`danfse-homologacao-${key.replace(/[^a-z0-9]/gi,"").slice(0,60)||"documento"}.pdf`;
const maskPhone=(value:string)=>value.length>=12?`+${value.slice(0,2)} (${value.slice(2,4)}) •••••-${value.slice(-4)}`:"Número interno configurado";

type WhatsAppConfig={whatsapp_phone_number_id:string|null;whatsapp_business_account_id:string|null;whatsapp_sender_number:string|null;whatsapp_template_name:string;whatsapp_test_recipient:string|null;whatsapp_token_configurado:boolean;whatsapp_ultimo_status:string};
type PaymentSource={id:number;competencia:string;valor_nfse:number;alunos:{nome:string;responsavel:string;whatsapp:string|null}|null};
type DocumentSource={id:number;mensalidade_id:number;versao:number;chave_acesso:string;nfse_xml_path:string;estado:string};

function safeDeliveryError(error:unknown){
  const message=error instanceof Error?error.message:String(error||"");
  if(/token|oauth|unauthorized|forbidden|permission/i.test(message))return "A Meta recusou a autenticação. Confira o token e as permissões em Configurações → Integrações.";
  if(/template|modelo|parameter|parâmetro|language/i.test(message))return "O modelo aprovado na Meta não corresponde ao modelo envio_nfse esperado pelo JPI Fiscal.";
  if(/phone|telefone|número|recipient|destinat/i.test(message))return "A Meta não aceitou o número interno configurado para homologação.";
  if(/media|document|PDF|upload/i.test(message))return "A Meta não aceitou o PDF da NFS-e. O XML e o documento fiscal foram preservados.";
  if(/signed|link|XML|storage/i.test(message))return "Não foi possível criar o link privado temporário do XML. Nenhum arquivo foi exposto.";
  return "A Meta não concluiu o envio pelo WhatsApp. Revise a integração e tente novamente.";
}

async function authorizedClient(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey)return {ok:false as const,response:json({error:"A conexão com o banco ainda não está configurada."},503)};
  if(!authorization||!token)return {ok:false as const,response:json({error:"Sessão inválida."},401)};
  const supabase=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user?.email)return {ok:false as const,response:json({error:"Sessão expirada. Entre novamente."},401)};
  if(!await hasServerPermission(supabase,"deliveries.send_whatsapp"))return {ok:false as const,response:json({error:"Seu usuário não possui permissão para enviar por WhatsApp."},403)};
  return {ok:true as const,supabase,user};
}

async function readConfig(supabase:SupabaseClient,backendSecret:string){
  const result=await supabase.rpc("get_whatsapp_delivery_config",{p_backend_secret:backendSecret});
  return {config:(Array.isArray(result.data)?result.data[0]:result.data) as unknown as WhatsAppConfig|undefined,error:result.error};
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  const {config,error}=await readConfig(auth.supabase,backendSecret);
  if(error||!config)return json({error:"Não foi possível carregar a configuração segura do WhatsApp."},503);
  const testRecipient=normalizeBrazilPhone(config.whatsapp_test_recipient||"");
  const ready=Boolean(config.whatsapp_token_configurado&&config.whatsapp_ultimo_status==="conectado"&&config.whatsapp_phone_number_id&&config.whatsapp_template_name&&brazilPhonePattern.test(testRecipient));
  return json({ok:true,ready,testRecipient:ready?maskPhone(testRecipient):null,templateName:config.whatsapp_template_name||"envio_nfse"});
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
    auth.supabase.from("mensalidades").select("id,competencia,valor_nfse,alunos(nome,responsavel,whatsapp)").eq("id",monthlyId).maybeSingle(),
    auth.supabase.from("nfse_documentos_homologacao").select("id,mensalidade_id,versao,chave_acesso,nfse_xml_path,estado").eq("id",documentId).eq("mensalidade_id",monthlyId).eq("estado","ativa").maybeSingle(),
    readConfig(auth.supabase,backendSecret),
  ]);
  const payment=paymentResult.data as unknown as PaymentSource|null;const document=documentResult.data as DocumentSource|null;const config=configResult.config;
  if(paymentResult.error||!payment)return json({error:"Mensalidade não encontrada."},404);
  if(documentResult.error||!document)return json({error:"A versão ativa da NFS-e de teste não foi encontrada."},404);
  if(configResult.error||!config)return json({error:"Não foi possível carregar a configuração segura do WhatsApp."},503);
  const intendedRecipient=normalizeBrazilPhone(payment.alunos?.whatsapp||"");const testRecipient=normalizeBrazilPhone(config.whatsapp_test_recipient||"");
  if(!brazilPhonePattern.test(intendedRecipient))return json({error:"O responsável não possui um WhatsApp brasileiro válido no cadastro."},400);
  if(!config.whatsapp_token_configurado||config.whatsapp_ultimo_status!=="conectado"||!config.whatsapp_phone_number_id)return json({error:"A integração do WhatsApp precisa estar configurada e testada antes das entregas."},400);
  if(!brazilPhonePattern.test(testRecipient))return json({error:"Cadastre o número interno de homologação em Configurações → Integrações."},400);

  const subject=`TESTE — NFS-e de homologação · ${payment.alunos?.nome||"Aluno"} · ${payment.competencia}`;
  const insertResult=await auth.supabase.from("nfse_entregas").insert({mensalidade_id:monthlyId,documento_homologacao_id:documentId,request_id:requestId,canal:"whatsapp",ambiente:"homologacao",destinatario_pretendido:intendedRecipient,destinatario_utilizado:testRecipient,assunto:subject,status:"enviando",created_by:auth.user.id,updated_at:new Date().toISOString()}).select("id").single();
  if(insertResult.error){
    if(insertResult.error.code==="23505")return json({error:"Esta nota já possui um envio pelo WhatsApp em andamento. Aguarde a conclusão."},409);
    return json({error:"Não foi possível iniciar o histórico seguro da entrega pelo WhatsApp."},500);
  }

  const deliveryId=Number(insertResult.data.id);let accessToken="";
  try{
    const [{data:storedToken,error:tokenError},{data:xmlBlob,error:xmlError},{data:signedXml,error:signedError}]=await Promise.all([
      auth.supabase.rpc("get_communication_secret",{p_channel:"whatsapp",p_backend_secret:backendSecret}),
      auth.supabase.storage.from(XML_BUCKET).download(document.nfse_xml_path),
      auth.supabase.storage.from(XML_BUCKET).createSignedUrl(document.nfse_xml_path,XML_LINK_SECONDS,{download:safeXmlFilename(document.chave_acesso)}),
    ]);
    if(tokenError||!storedToken)throw new Error("Token da WhatsApp Cloud API não encontrado.");
    if(xmlError||!xmlBlob)throw new Error("O XML da NFS-e não pôde ser recuperado.");
    if(signedError||!signedXml?.signedUrl)throw new Error("O link privado do XML não pôde ser criado.");
    const xmlBuffer=Buffer.from(await xmlBlob.arrayBuffer());if(xmlBuffer.length===0||xmlBuffer.length>10*1024*1024)throw new Error("O XML armazenado é inválido ou muito grande.");
    const {pdf:pdfBuffer}=buildDanfsePdf(xmlBuffer.toString("utf8"),document.chave_acesso);const pdfFilename=safePdfFilename(document.chave_acesso);
    accessToken=String(storedToken);

    const mediaForm=new FormData();mediaForm.set("messaging_product","whatsapp");mediaForm.set("type","application/pdf");mediaForm.set("file",new Blob([new Uint8Array(pdfBuffer)],{type:"application/pdf"}),pdfFilename);
    const mediaResponse=await fetch(`https://graph.facebook.com/${encodeURIComponent(config.whatsapp_phone_number_id)}/media`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`},body:mediaForm,cache:"no-store"});
    const mediaResult=await mediaResponse.json().catch(()=>({})) as {id?:string;error?:{message?:string}};
    if(!mediaResponse.ok||!mediaResult.id)throw new Error(mediaResult.error?.message||"A Meta não aceitou o PDF.");

    const messageResponse=await fetch(`https://graph.facebook.com/${encodeURIComponent(config.whatsapp_phone_number_id)}/messages`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:testRecipient,type:"template",template:{name:config.whatsapp_template_name||"envio_nfse",language:{code:"pt_BR"},components:[{type:"header",parameters:[{type:"document",document:{id:mediaResult.id,filename:pdfFilename}}]},{type:"body",parameters:[{type:"text",text:payment.alunos?.responsavel||"Responsável"},{type:"text",text:payment.alunos?.nome||"Aluno"},{type:"text",text:payment.competencia},{type:"text",text:signedXml.signedUrl}]}]}}),cache:"no-store"});
    const messageResult=await messageResponse.json().catch(()=>({})) as {messages?:Array<{id?:string}>;error?:{message?:string}};
    const providerMessageId=messageResult.messages?.[0]?.id;if(!messageResponse.ok||!providerMessageId)throw new Error(messageResult.error?.message||"A Meta não confirmou a mensagem.");
    const sentAt=new Date().toISOString();const updateResult=await auth.supabase.from("nfse_entregas").update({status:"enviado",provider_message_id:providerMessageId,erro_mensagem:null,enviado_em:sentAt,updated_at:sentAt}).eq("id",deliveryId).select("id").maybeSingle();
    if(updateResult.error||!updateResult.data)return json({error:"A mensagem foi aceita pela Meta, mas o histórico ainda precisa ser conferido.",sent:true},500);
    return json({ok:true,status:"enviado",sentAt,actualRecipient:maskPhone(testRecipient),intendedRecipient,message:"NFS-e de homologação enviada ao WhatsApp interno com PDF e link privado do XML."});
  }catch(error){
    const safeError=safeDeliveryError(error);await auth.supabase.from("nfse_entregas").update({status:"erro",erro_mensagem:safeError,updated_at:new Date().toISOString()}).eq("id",deliveryId);
    return json({error:safeError},400);
  }finally{accessToken="";}
}
