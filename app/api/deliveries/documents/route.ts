import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildDanfsePdf } from "@/lib/danfse-pdf";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime="nodejs";
export const maxDuration=30;

const XML_BUCKET="documentos-nfse";

const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
type DocumentSource={id:number;chave_acesso:string;nfse_xml_path:string;estado:string};

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
  if(!await hasServerPermission(supabase,"deliveries.view"))return {ok:false as const,response:json({error:"Seu usuário não possui permissão para consultar documentos."},403)};
  return {ok:true as const,supabase};
}

function filename(key:string,format:"pdf"|"xml"){
  const safeKey=key.replace(/[^0-9]/g,"").slice(0,50);
  return format==="pdf"?`danfse-homologacao-${safeKey}.pdf`:`nfse-homologacao-${safeKey}.xml`;
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  const documentId=Number(request.nextUrl.searchParams.get("documentId"));
  const format=request.nextUrl.searchParams.get("format");
  const disposition=request.nextUrl.searchParams.get("disposition");
  if(!Number.isSafeInteger(documentId)||documentId<=0||!["pdf","xml"].includes(String(format))||!["inline","attachment"].includes(String(disposition)))return json({error:"Identificação do documento inválida."},400);
  const selectedFormat=format as "pdf"|"xml";const selectedDisposition=disposition as "inline"|"attachment";
  const {data,error}=await auth.supabase.from("nfse_documentos_homologacao").select("id,chave_acesso,nfse_xml_path,estado").eq("id",documentId).maybeSingle();
  const document=data as DocumentSource|null;
  if(error||!document)return json({error:"A NFS-e de homologação não foi encontrada."},404);
  const {data:xmlBlob,error:xmlError}=await auth.supabase.storage.from(XML_BUCKET).download(document.nfse_xml_path);
  if(xmlError||!xmlBlob)return json({error:"O XML armazenado não pôde ser recuperado."},404);
  const xmlBuffer=Buffer.from(await xmlBlob.arrayBuffer());
  if(xmlBuffer.length===0||xmlBuffer.length>10*1024*1024)return json({error:"O XML armazenado é inválido ou muito grande."},422);
  let body:Buffer;let contentType:string;
  try{
    if(selectedFormat==="pdf"){body=buildDanfsePdf(xmlBuffer.toString("utf8"),document.chave_acesso).pdf;contentType="application/pdf"}
    else{body=xmlBuffer;contentType="application/xml; charset=utf-8"}
  }catch{return json({error:"O documento não pôde ser preparado a partir do XML armazenado."},422)}
  return new NextResponse(new Uint8Array(body),{status:200,headers:{
    "Content-Type":contentType,
    "Content-Disposition":`${selectedDisposition}; filename="${filename(document.chave_acesso,selectedFormat)}"`,
    "Cache-Control":"private, no-store, max-age=0",
    "X-Content-Type-Options":"nosniff",
  }});
}
