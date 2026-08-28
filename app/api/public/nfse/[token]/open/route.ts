import { NextRequest, NextResponse } from "next/server";
import { backendSecret, createViewCookie, protectedTokenPattern, protectedViewCookie, publicSupabase, tokenHash } from "@/lib/protected-delivery";

export const runtime="nodejs";
export async function POST(request:NextRequest,context:{params:Promise<{token:string}>}){
  const {token}=await context.params;
  if(!protectedTokenPattern.test(token))return NextResponse.json({error:"Link inválido ou expirado."},{status:404});
  try{
    const secret=backendSecret();const supabase=publicSupabase();
    const {data,error}=await supabase.rpc("open_nfse_delivery_access",{p_token_hash:tokenHash(token),p_backend_secret:secret});
    const record=(Array.isArray(data)?data[0]:data) as {chave_acesso:string}|undefined;
    if(error||!record)return NextResponse.json({error:"Este link é inválido ou expirou."},{status:404});
    const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
    response.cookies.set(protectedViewCookie,createViewCookie(token,secret),{httpOnly:true,secure:request.nextUrl.protocol==="https:",sameSite:"strict",maxAge:30*60,path:`/api/public/nfse/${token}`});
    return response;
  }catch{return NextResponse.json({error:"Não foi possível abrir o documento agora."},{status:503})}
}
