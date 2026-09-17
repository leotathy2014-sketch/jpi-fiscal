import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const runtime="nodejs";
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const hostnamePattern=/^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const labelPattern=/^(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function client(service=false){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=service?process.env.SUPABASE_SERVICE_ROLE_KEY:(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if(!url||!key)throw new Error("Supabase do servidor não configurado.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function masterContext(request:NextRequest){
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return {error:json({error:"Sessão inválida."},401)};
  const admin=client(true);
  const {data:{user},error}=await admin.auth.getUser(token);
  if(error||!user?.email)return {error:json({error:"Sessão expirada. Entre novamente."},401)};
  const {data:appUser}=await admin.from("app_users").select("role,active").eq("email",user.email.toLowerCase()).maybeSingle();
  if(!appUser?.active||appUser.role!=="master")return {error:json({error:"Somente o Master pode configurar o domínio do sistema."},403)};
  return {admin,user};
}

async function dnsLookup(domain:string){
  const response=await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=CNAME`,{headers:{Accept:"application/dns-json"},cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("O serviço de consulta DNS não respondeu.");
  const result=await response.json() as {Status?:number;Answer?:Array<{data?:string}>};
  return (result.Answer||[]).map(answer=>String(answer.data||"").replace(/\.$/,"").toLowerCase()).filter(Boolean);
}

export async function GET(request:NextRequest){
  try{
    const context=await masterContext(request);if("error" in context)return context.error;
    const [{data:config,error},{data:history,error:historyError}]=await Promise.all([
      context.admin.from("domain_settings").select("*").eq("id",true).maybeSingle(),
      context.admin.from("domain_change_history").select("id,action,previous_domain,requested_domain,dns_value,status,details,created_at,created_by_email").order("created_at",{ascending:false}).limit(12),
    ]);
    if(error||historyError)throw error||historyError;
    return json({ok:true,config,history:history||[],automationConfigured:Boolean(process.env.VERCEL_API_TOKEN)});
  }catch(error){return json({error:error instanceof Error?error.message:"Não foi possível carregar a configuração de domínio."},500)}
}

export async function POST(request:NextRequest){
  try{
    const context=await masterContext(request);if("error" in context)return context.error;
    const body=await request.json().catch(()=>({})) as Record<string,unknown>;
    const action=String(body.action||"save");
    const {data:current,error:currentError}=await context.admin.from("domain_settings").select("*").eq("id",true).single();
    if(currentError)throw currentError;
    if(action==="verify"){
      const desired=String(current.desired_domain||"").toLowerCase();
      if(!desired)return json({error:"Salve primeiro o domínio desejado."},400);
      const values=await dnsLookup(desired);
      const expected=String(current.dns_target||"").replace(/\.$/,"").toLowerCase();
      const confirmed=values.includes(expected)||values.some(value=>value.includes("vercel-dns"));
      const checkedAt=new Date().toISOString();
      const status=confirmed?"dns_confirmado":"aguardando_dns";
      const dnsValue=values.join(", ")||"Nenhum CNAME publicado";
      await context.admin.from("domain_settings").update({status,last_dns_value:dnsValue,last_checked_at:checkedAt,updated_at:checkedAt,updated_by:context.user.id}).eq("id",true);
      await context.admin.from("domain_change_history").insert({action:"verificar_dns",previous_domain:current.current_domain,requested_domain:desired,dns_value:dnsValue,status,details:confirmed?"CNAME da Vercel localizado.":"O CNAME esperado ainda não foi localizado.",created_by:context.user.id,created_by_email:context.user.email});
      return json({ok:true,confirmed,dnsValue,status,checkedAt});
    }
    const baseDomain=String(body.baseDomain||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"");
    const subdomain=String(body.subdomain||"").trim().toLowerCase();
    if(!hostnamePattern.test(baseDomain))return json({error:"Informe um domínio válido registrado na Locaweb, sem http ou caminho."},400);
    if(!labelPattern.test(subdomain))return json({error:"Informe somente o nome do subdomínio, como fiscal ou sistema."},400);
    const desiredDomain=`${subdomain}.${baseDomain}`;
    const updatedAt=new Date().toISOString();
    const payload={base_domain:baseDomain,subdomain,desired_domain:desiredDomain,dns_type:"CNAME",dns_target:"cname.vercel-dns-0.com",status:"planejado",last_dns_value:null,last_checked_at:null,updated_at:updatedAt,updated_by:context.user.id};
    const {data,error}=await context.admin.from("domain_settings").update(payload).eq("id",true).select().single();
    if(error)throw error;
    await context.admin.from("domain_change_history").insert({action:"salvar_planejamento",previous_domain:current.current_domain,requested_domain:desiredDomain,dns_value:payload.dns_target,status:"planejado",details:"Planejamento salvo; nenhum DNS foi alterado automaticamente.",created_by:context.user.id,created_by_email:context.user.email});
    return json({ok:true,config:data});
  }catch(error){return json({error:error instanceof Error?error.message:"Não foi possível salvar a configuração de domínio."},500)}
}
