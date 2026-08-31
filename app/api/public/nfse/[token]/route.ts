import { NextRequest, NextResponse } from "next/server";
import { backendSecret, publicSupabase, protectedTokenPattern, tokenHash } from "@/lib/protected-delivery";

export const runtime="nodejs";
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});

export async function GET(_request:NextRequest,context:{params:Promise<{token:string}>}){
  const {token}=await context.params;if(!protectedTokenPattern.test(token))return json({error:"Link inválido ou expirado."},404);
  try{
    const supabase=publicSupabase();const secret=backendSecret();
    const {data,error}=await supabase.rpc("inspect_nfse_delivery_access",{p_token_hash:tokenHash(token),p_backend_secret:secret});
    const record=(Array.isArray(data)?data[0]:data) as {valid:boolean;competencia:string;expires_at:string;visualizado_em:string|null}|undefined;
    if(error){console.error("[nfse-public] Falha ao consultar link protegido",{code:error.code});return json({error:"Não foi possível consultar o documento agora."},503)}
    if(!record?.valid)return json({error:"Este link é inválido ou expirou."},404);
    return json({ok:true,competence:record.competencia,expiresAt:record.expires_at,viewedAt:record.visualizado_em});
  }catch{return json({error:"Não foi possível consultar o documento agora."},503)}
}
