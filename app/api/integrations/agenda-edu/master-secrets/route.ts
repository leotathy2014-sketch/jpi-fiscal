import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseAgendaEduCredentials } from "@/lib/agenda-edu";

export const runtime="nodejs";

const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{
  status,
  headers:{
    "Cache-Control":"private, no-store, max-age=0",
    "Pragma":"no-cache",
    "Vary":"Authorization",
    "Referrer-Policy":"no-referrer",
  },
});

export async function POST(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const backendSecret=process.env.JPI_BACKEND_SECRET;
  const authorization=request.headers.get("authorization");
  const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey||!backendSecret)return json({error:"O cofre seguro não está disponível no servidor."},503);
  if(!authorization||!token)return json({error:"Sessão inválida."},401);

  let body:Record<string,unknown>={};
  try{body=await request.json()}catch{return json({error:"Solicitação inválida."},400)}
  if(body.confirm!==true)return json({error:"Confirme a visualização das credenciais protegidas."},400);

  const supabase=createClient(supabaseUrl,supabaseKey,{
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user?.email)return json({error:"Sessão expirada. Entre novamente."},401);

  const {data:access,error:accessError}=await supabase.rpc("get_my_access");
  const role=String((access as {role?:string}|null)?.role||"").toLowerCase();
  if(accessError||role!=="master")return json({error:"Somente o usuário Master pode revelar estas credenciais."},403);

  const {data:storedSecret,error:secretError}=await supabase.rpc("get_communication_secret",{
    p_channel:"agenda_edu",
    p_backend_secret:backendSecret,
  });
  if(secretError||!storedSecret)return json({error:"As credenciais da Agenda Edu não foram encontradas no cofre seguro."},404);

  try{
    const credentials=parseAgendaEduCredentials(String(storedSecret));
    return json({
      ok:true,
      expiresIn:60,
      secrets:{
        clientId:credentials.clientId,
        clientSecret:credentials.clientSecret,
        schoolToken:credentials.schoolToken,
      },
    });
  }catch{
    return json({error:"A credencial protegida da Agenda Edu precisa ser cadastrada novamente."},500);
  }
}
