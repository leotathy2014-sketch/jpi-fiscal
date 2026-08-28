import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

export const runtime="nodejs";
export const maxDuration=60;

const XML_BUCKET="documentos-nfse";
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const brazilPhonePattern=/^55[1-9][0-9]{9,10}$/;
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
const digits=(value:string)=>value.replace(/\D/g,"");
const normalizeBrazilPhone=(value:string)=>{const phone=digits(value);return phone.length===10||phone.length===11?`55${phone}`:phone};
const maskPhone=(value:string)=>value.length>=12?`+${value.slice(0,2)} (${value.slice(2,4)}) •••••-${value.slice(-4)}`:"Número interno configurado";

type ManualConfig={whatsapp_test_recipient:string|null};
type PaymentSource={id:number;competencia:string;valor_nfse:number;alunos:{nome:string;responsavel:string;whatsapp:string|null}|null};
type DocumentSource={id:number;mensalidade_id:number;versao:number;chave_acesso:string;nfse_xml_path:string;estado:string};

async function authorizedClient(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey)return {ok:false as const,response:json({error:"A conexão com o banco ainda não está configurada."},503)};
  if(!authorization||!token)return {ok:false as const,response:json({error:"Sessão inválida."},401)};
  const supabase=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user?.email)return {ok:false as const,response:json({error:"Sessão expirada. Entre novamente."},401)};
  const {data:access}=await supabase.from("app_users").select("role,active,nome").eq("email",user.email).maybeSingle();
  if(!access?.active||!["admin","financeiro"].includes(access.role))return {ok:false as const,response:json({error:"Seu usuário não possui permissão para enviar documentos."},403)};
  return {ok:true as const,supabase,user,auditName:String(access.nome||user.email).slice(0,180)};
}
async function readConfig(supabase:SupabaseClient,backendSecret:string){
  const result=await supabase.rpc("get_whatsapp_delivery_config",{p_backend_secret:backendSecret});
  const config=(Array.isArray(result.data)?result.data[0]:result.data) as unknown as ManualConfig|undefined;
  return {config,error:result.error};
}

function manualMessage(payment:PaymentSource,protectedUrl:string){
  return [
    "TESTE DE HOMOLOGAÇÃO — SEM VALIDADE FISCAL",
    "",
    `Olá, ${payment.alunos?.responsavel||"responsável"}.`,
    `A NFS-e de ${payment.alunos?.nome||"aluno"}, competência ${payment.competencia}, está disponível no link privado abaixo:`,
    protectedUrl,
    "",
    "O link é individual e válido por 30 dias. Não o encaminhe a terceiros.",
  ].join("\n");
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  const {config,error}=await readConfig(auth.supabase,backendSecret);
  if(error||!config)return json({error:"Não foi possível carregar a configuração segura do WhatsApp."},503);
  const testRecipient=normalizeBrazilPhone(config.whatsapp_test_recipient||"");
  const ready=brazilPhonePattern.test(testRecipient);
  return json({ok:true,ready,testRecipient:ready?maskPhone(testRecipient):null,mode:"manual",cost:"gratuito"});
}

export async function POST(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const backendSecret=process.env.JPI_BACKEND_SECRET;if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  let body:Record<string,unknown>={};try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const action=String(body.action||"prepare");

  if(action==="confirm"||action==="cancel"){
    const deliveryId=Number(body.deliveryId);
    if(!Number.isSafeInteger(deliveryId)||deliveryId<=0)return json({error:"Identificação da entrega inválida."},400);
    if(action==="cancel"){
      const revoked=await auth.supabase.rpc("revoke_nfse_delivery_access",{p_delivery_id:deliveryId,p_backend_secret:backendSecret});
      if(revoked.error)return json({error:"Não foi possível cancelar esta tentativa ou ela pertence a outro usuário."},409);
    }
    const now=new Date().toISOString();
    const changes=action==="confirm"
      ?{status:"enviado",erro_mensagem:null,enviado_em:now,confirmado_em:now,confirmado_por:auth.user.id,confirmado_por_nome:auth.auditName,updated_at:now}
      :{status:"erro",erro_mensagem:"Envio manual não confirmado pelo usuário.",updated_at:now};
    const {data,error}=await auth.supabase.from("nfse_entregas").update(changes).eq("id",deliveryId).eq("canal","whatsapp_manual").eq("status","aguardando_confirmacao").select("id").maybeSingle();
    if(error||!data)return json({error:"Esta confirmação não está mais disponível ou pertence a outro usuário."},409);
    return json({ok:true,status:action==="confirm"?"enviado":"erro",sentAt:action==="confirm"?now:null});
  }

  if(action!=="prepare")return json({error:"Ação de entrega inválida."},400);
  const monthlyId=Number(body.monthlyId);const documentId=Number(body.documentId);const requestId=String(body.requestId||"");
  if(!Number.isSafeInteger(monthlyId)||monthlyId<=0||!Number.isSafeInteger(documentId)||documentId<=0||!uuidPattern.test(requestId))return json({error:"Identificação da entrega inválida."},400);

  const {data:existing}=await auth.supabase.from("nfse_entregas").select("id,status").eq("request_id",requestId).maybeSingle();
  if(existing)return json({error:"Esta preparação já foi processada. Atualize a lista antes de tentar novamente.",alreadyProcessed:true,status:existing.status},409);

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
  if(!brazilPhonePattern.test(testRecipient))return json({error:"Cadastre o número interno de homologação em Configurações → Integrações."},400);

  const subject=`TESTE — NFS-e de homologação · ${payment.alunos?.nome||"Aluno"} · ${payment.competencia}`;
  const insert=await auth.supabase.from("nfse_entregas").insert({mensalidade_id:monthlyId,documento_homologacao_id:documentId,request_id:requestId,canal:"whatsapp_manual",ambiente:"homologacao",destinatario_pretendido:intendedRecipient,destinatario_utilizado:testRecipient,assunto:subject,status:"enviando",created_by:auth.user.id,aberto_por:auth.user.id,aberto_por_nome:auth.auditName,updated_at:new Date().toISOString()}).select("id").single();
  if(insert.error){
    if(insert.error.code==="23505")return json({error:"Esta nota já está aberta para envio em outro computador. Conclua ou cancele a tentativa atual."},409);
    return json({error:"Não foi possível iniciar o histórico seguro do envio manual."},500);
  }

  const deliveryId=Number(insert.data.id);
  try{
    const {data:xmlBlob,error:xmlError}=await auth.supabase.storage.from(XML_BUCKET).download(document.nfse_xml_path);
    if(xmlError||!xmlBlob)throw new Error("O XML da NFS-e não pôde ser recuperado.");
    const xmlBuffer=Buffer.from(await xmlBlob.arrayBuffer());
    if(xmlBuffer.length===0||xmlBuffer.length>10*1024*1024)throw new Error("O XML armazenado é inválido ou muito grande.");
    const accessToken=randomBytes(32).toString("base64url");const accessTokenHash=createHash("sha256").update(accessToken).digest("hex");
    const accessResult=await auth.supabase.rpc("create_nfse_delivery_access",{p_delivery_id:deliveryId,p_token_hash:accessTokenHash,p_xml_base64:xmlBuffer.toString("base64"),p_chave_acesso:document.chave_acesso,p_backend_secret:backendSecret});
    if(accessResult.error)throw new Error("Não foi possível criar o link protegido da NFS-e.");
    const protectedUrl=new URL(`/nota/${accessToken}`,request.nextUrl.origin).toString();
    const whatsappUrl=new URL(`https://wa.me/${testRecipient}`);whatsappUrl.searchParams.set("text",manualMessage(payment,protectedUrl));
    const openedAt=new Date().toISOString();
    const update=await auth.supabase.from("nfse_entregas").update({status:"aguardando_confirmacao",aberto_em:openedAt,updated_at:openedAt}).eq("id",deliveryId).select("id").maybeSingle();
    if(update.error||!update.data)throw new Error("O histórico do envio manual não pôde ser atualizado.");
    return json({ok:true,status:"aguardando_confirmacao",deliveryId,whatsappUrl:whatsappUrl.toString(),expiresAt:accessResult.data,actualRecipient:maskPhone(testRecipient),intendedRecipient,message:"WhatsApp preparado. Confirme no sistema depois de enviar a mensagem."});
  }catch{
    await auth.supabase.from("nfse_entregas").update({status:"erro",erro_mensagem:"Não foi possível preparar o link privado para o WhatsApp.",updated_at:new Date().toISOString()}).eq("id",deliveryId);
    return json({error:"Não foi possível preparar o link privado para o WhatsApp. Nenhum documento foi exposto."},400);
  }
}
