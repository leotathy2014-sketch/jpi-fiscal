import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime = "nodejs";

export async function GET(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization=request.headers.get("authorization");
  const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey||!serviceRoleKey)return NextResponse.json({error:"Configuração do servidor indisponível."},{status:503});
  if(!authorization||!token)return NextResponse.json({error:"Sessão inválida."},{status:401});
  const scoped=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await scoped.auth.getUser(token);
  if(userError||!user)return NextResponse.json({error:"Sessão expirada."},{status:401});
  if(!await hasServerPermission(scoped,"system.status.view"))return NextResponse.json({error:"Acesso não autorizado."},{status:403});
  const admin=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const [certificateResult,operationalResult]=await Promise.all([
    admin.from("certificado_a1_alerta").select("validade").eq("id",true).maybeSingle(),
    scoped.rpc("get_nfse_operational_status"),
  ]);
  const operational=(Array.isArray(operationalResult.data)?operationalResult.data[0]:operationalResult.data) as {production_enabled?:boolean}|null;
  return NextResponse.json({certificateExpiry:certificateResult.data?.validade||null,productionEnabled:operational?.production_enabled===true},{headers:{"Cache-Control":"no-store"}});
}
