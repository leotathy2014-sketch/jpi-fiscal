import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const protectedTokenPattern=/^[A-Za-z0-9_-]{43}$/;
export const protectedViewCookie="jpi_nfse_view";

export function tokenHash(token:string){return createHash("sha256").update(token).digest("hex")}

export function publicSupabase(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)throw new Error("Banco indisponível.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

export function backendSecret(){const secret=process.env.JPI_BACKEND_SECRET;if(!secret)throw new Error("Servidor indisponível.");return secret}

export function createViewCookie(token:string,secret:string){
  const hash=tokenHash(token);const expires=Math.floor(Date.now()/1000)+30*60;
  const payload=`${hash}.${expires}`;const signature=createHmac("sha256",secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyViewCookie(cookie:string|undefined,token:string,secret:string){
  if(!cookie)return false;const parts=cookie.split(".");if(parts.length!==3)return false;
  const [hash,expiresText,signature]=parts;const expires=Number(expiresText);
  if(hash!==tokenHash(token)||!Number.isSafeInteger(expires)||expires<=Math.floor(Date.now()/1000))return false;
  const expected=createHmac("sha256",secret).update(`${hash}.${expires}`).digest("base64url");
  const left=Buffer.from(signature);const right=Buffer.from(expected);
  return left.length===right.length&&timingSafeEqual(left,right);
}
