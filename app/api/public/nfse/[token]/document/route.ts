import { NextRequest, NextResponse } from "next/server";
import { buildDanfsePdf } from "@/lib/danfse-pdf";
import { backendSecret, protectedTokenPattern, protectedViewCookie, publicSupabase, tokenHash, verifyViewCookie } from "@/lib/protected-delivery";

export const runtime="nodejs";
const json=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});
function filename(key:string,format:"pdf"|"xml"){const safe=key.replace(/[^0-9]/g,"").slice(0,50);return format==="pdf"?`danfse-${safe}.pdf`:`nfse-${safe}.xml`}

export async function GET(request:NextRequest,context:{params:Promise<{token:string}>}){
  const {token}=await context.params;const format=request.nextUrl.searchParams.get("format");const disposition=request.nextUrl.searchParams.get("disposition");
  if(!protectedTokenPattern.test(token)||!["pdf","xml"].includes(String(format))||!["inline","attachment"].includes(String(disposition)))return json("Solicitação inválida.",400);
  try{
    const secret=backendSecret();
    if(!verifyViewCookie(request.cookies.get(protectedViewCookie)?.value,token,secret))return json("Toque primeiro em Visualizar NFS-e para liberar o documento.",403);
    const {data,error}=await publicSupabase().rpc("read_nfse_delivery_access",{p_token_hash:tokenHash(token),p_backend_secret:secret});
    const record=(Array.isArray(data)?data[0]:data) as {chave_acesso:string;xml_base64:string}|undefined;
    if(error){console.error("[nfse-public] Falha ao ler documento protegido",{code:error.code});return json("Não foi possível preparar o documento agora.",503)}
    if(!record)return json("Este link é inválido ou expirou.",404);
    const xml=Buffer.from(record.xml_base64,"base64");if(!xml.length||xml.length>10*1024*1024)return json("Documento inválido.",422);
    const selectedFormat=format as "pdf"|"xml";const body=selectedFormat==="pdf"?buildDanfsePdf(xml.toString("utf8"),record.chave_acesso).pdf:xml;
    return new NextResponse(new Uint8Array(body),{headers:{"Content-Type":selectedFormat==="pdf"?"application/pdf":"application/xml; charset=utf-8","Content-Disposition":`${disposition}; filename="${filename(record.chave_acesso,selectedFormat)}"`,"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"}});
  }catch{return json("Não foi possível preparar o documento agora.",503)}
}
