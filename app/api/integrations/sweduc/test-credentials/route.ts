import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {createSweducAccessToken,getSweducStudentDetailsWithToken,listSweducStudentsWithToken,normalizeSweducHost,type SweducCredentials,type SweducTokenGrant} from "@/lib/sweduc";

export const runtime="nodejs";
export const maxDuration=60;

const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Vary:"Authorization","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});

function safeError(error:unknown,credentials:SweducCredentials,sensitiveValues:string[]=[]){
  let message=error instanceof Error?error.message:"A SWeduc não confirmou estas credenciais.";
  const basic=Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`,"utf8").toString("base64");
  for(const secret of [credentials.clientId,credentials.clientSecret,basic,...sensitiveValues])if(secret)message=message.split(secret).join("[protegido]");
  return message.slice(0,500);
}

export async function POST(request:NextRequest){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");
  const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!url||!key)return json({error:"A conexão com o banco não está configurada."},503);
  if(!authorization||!token)return json({error:"Sessão inválida."},401);

  const supabase=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user)return json({error:"Sessão expirada. Entre novamente."},401);
  const {data:access,error:accessError}=await supabase.rpc("get_my_access");
  if(accessError||String((access as {role?:string}|null)?.role||"").toLowerCase()!=="master")return json({error:"Somente o usuário Master pode testar credenciais ainda não salvas."},403);

  let body:Record<string,unknown>;
  try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const hostInput=String(body.host||"");
  const clientId=String(body.clientId||"").trim();
  const clientSecret=String(body.clientSecret||"").trim();
  const useUsernamePassword=body.useUsernamePassword===true;
  const username=String(body.username||"").trim();
  const password=String(body.password||"");
  if(!hostInput.trim()||!clientId||!clientSecret)return json({error:"Informe HOST, CLIENT_ID e CLIENT_SECRET para fazer o teste temporário."},400);
  if(useUsernamePassword&&!username||useUsernamePassword&&!password)return json({error:"Informe USUÁRIO e SENHA para testar o fluxo alternativo."},400);
  if([hostInput,clientId,clientSecret,username,password].some(value=>value.length>2000))return json({error:"Um dos dados ultrapassa o tamanho permitido."},400);

  let credentials:SweducCredentials;
  try{credentials={host:normalizeSweducHost(hostInput),clientId,clientSecret}}catch(error){return json({error:error instanceof Error?error.message:"Informe um HOST válido."},400)}

  try{
    const grantType:SweducTokenGrant=useUsernamePassword?"password":"client_credentials";
    const oauth=await createSweducAccessToken(credentials,fetch,{grantType,username,password});
    const listing=await listSweducStudentsWithToken(credentials.host,oauth.accessToken,{page:1});
    const firstEnrollment=(listing.data||[]).find(student=>Number.isSafeInteger(Number(student.matricula_id))&&Number(student.matricula_id)>0)?.matricula_id;
    let details:"confirmed"|"not_checked"="not_checked";
    if(firstEnrollment){await getSweducStudentDetailsWithToken(credentials.host,oauth.accessToken,Number(firstEnrollment));details="confirmed"}
    const visible=Number(listing.total||listing.data?.length||0);
    return json({
      ok:true,
      message:`Fluxo ${grantType==="password"?"com usuário e senha":"client_credentials"} confirmado. A SWeduc permitiu consultar ${visible} matrícula(s). Nada foi salvo ou importado.`,
      checks:{oauth:"confirmed",studentList:"confirmed",studentDetails:details,grantType},
    });
  }catch(error){
    return json({error:safeError(error,credentials,[username,password])},400);
  }
}
