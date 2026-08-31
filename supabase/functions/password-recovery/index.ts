import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.56.0";

const APP_URL="https://jpi-fiscal.vercel.app";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const LOGO_URL=`${SUPABASE_URL}/storage/v1/object/public/logos-empresa/empresa/logo`;
const allowedOrigins=new Set([APP_URL,"http://localhost:3000"]);

type RecoveryEmailConfig={
  email_provider:string;
  email_from_name:string;
  email_from_address:string;
  email_reply_to:string|null;
  email_smtp_host:string|null;
  email_smtp_port:number|null;
  email_smtp_username:string|null;
  email_credencial_configurada:boolean;
  email_ultimo_status:string;
  email_secret:string|null;
  primary_color:string|null;
  sidebar_color:string|null;
  success_color:string|null;
  branding_updated_at:string|null;
};

function cors(origin:string|null){
  const safeOrigin=origin&&allowedOrigins.has(origin)?origin:APP_URL;
  return {
    "Access-Control-Allow-Origin":safeOrigin,
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin",
  };
}
function json(body:Record<string,unknown>,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{status,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));
}
function cleanHeader(value:string){return value.replace(/[\r\n]+/g," ").trim();}
function emailValid(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
function color(value:string|null|undefined,fallback:string){return /^#[0-9a-f]{6}$/i.test(String(value||""))?String(value).toUpperCase():fallback;}
function utf8Base64(value:string){
  const bytes=new TextEncoder().encode(value);let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
}
function encodedHeader(value:string){return `=?UTF-8?B?${utf8Base64(cleanHeader(value))}?=`;}
async function sha256(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

class SmtpConnection{
  conn:Deno.TlsConn;
  buffer="";
  decoder=new TextDecoder();
  encoder=new TextEncoder();
  constructor(conn:Deno.TlsConn){this.conn=conn;}
  async readLine(){
    while(true){
      const idx=this.buffer.indexOf("\r\n");
      if(idx>=0){const line=this.buffer.slice(0,idx);this.buffer=this.buffer.slice(idx+2);return line;}
      const chunk=new Uint8Array(2048);
      const read=await this.conn.read(chunk);
      if(read===null)throw new Error("SMTP_CONNECTION_CLOSED");
      this.buffer+=this.decoder.decode(chunk.subarray(0,read),{stream:true});
    }
  }
  async expect(expected:number|number[]){
    const accepted=Array.isArray(expected)?expected:[expected];
    const lines:string[]=[];let code=0;
    while(true){
      const line=await this.readLine();lines.push(line);
      const match=line.match(/^(\d{3})([ -])/);
      if(!match)continue;
      code=Number(match[1]);
      if(match[2]===" ")break;
    }
    if(!accepted.includes(code))throw new Error(`SMTP_${code}_${lines.join(" ").slice(0,240)}`);
    return lines.join("\n");
  }
  async write(value:string){await this.conn.write(this.encoder.encode(value));}
  async command(value:string,expected:number|number[]){await this.write(`${value}\r\n`);return this.expect(expected);}
  close(){try{this.conn.close();}catch{}}
}

async function sendSmtp(config:RecoveryEmailConfig,to:string,subject:string,html:string){
  const host=String(config.email_smtp_host||"");
  const port=Number(config.email_smtp_port||465);
  const username=String(config.email_smtp_username||"");
  const password=String(config.email_secret||"");
  const fromAddress=String(config.email_from_address||"").toLowerCase();
  if(!["email-ssl.com.br","smtplw.com.br"].includes(host)||port!==465)throw new Error("SMTP_CONFIG_INVALID");
  if(!emailValid(username)||!emailValid(fromAddress)||!emailValid(to)||!password)throw new Error("SMTP_CONFIG_INVALID");

  const conn=await Deno.connectTls({hostname:host,port});
  const smtp=new SmtpConnection(conn);
  const messageId=crypto.randomUUID();
  const domain=fromAddress.split("@")[1];
  const headers=[
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}@${domain}>`,
    `From: ${encodedHeader(config.email_from_name||"JPI Fiscal")} <${fromAddress}>`,
    `To: <${to}>`,
    ...(config.email_reply_to&&emailValid(config.email_reply_to)?[`Reply-To: <${config.email_reply_to}>`]:[]),
    `Subject: ${encodedHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  const data=(`${headers.join("\r\n")}\r\n\r\n${html}`).replace(/(^|\r\n)\./g,"$1..");
  try{
    await smtp.expect(220);
    await smtp.command("EHLO jpi-fiscal.vercel.app",250);
    await smtp.command("AUTH LOGIN",334);
    await smtp.command(btoa(username),334);
    await smtp.command(btoa(password),235);
    await smtp.command(`MAIL FROM:<${fromAddress}>`,250);
    await smtp.command(`RCPT TO:<${to}>`,[250,251]);
    await smtp.command("DATA",354);
    await smtp.write(`${data}\r\n.\r\n`);
    await smtp.expect(250);
    await smtp.command("QUIT",221).catch(()=>undefined);
  }finally{smtp.close();}
}

async function sendEmail(config:RecoveryEmailConfig,to:string,subject:string,html:string){
  const secret=String(config.email_secret||"");
  if(config.email_provider==="resend"){
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},
      body:JSON.stringify({from:`${config.email_from_name} <${config.email_from_address}>`,to:[to],reply_to:config.email_reply_to||undefined,subject,html}),
    });
    if(!response.ok)throw new Error(`RESEND_${response.status}`);
    return;
  }
  await sendSmtp(config,to,subject,html);
}

Deno.serve(async(req)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"Método não permitido."},405,origin);
  if(origin&&!allowedOrigins.has(origin))return json({error:"Origem não autorizada."},403,origin);
  if(!SUPABASE_URL||!SERVICE_ROLE_KEY)return json({error:"Recuperação temporariamente indisponível."},503,origin);

  let email="";
  try{
    const body=await req.json();
    email=String(body?.email||"").trim().toLowerCase();
  }catch{return json({error:"Solicitação inválida."},400,origin);}
  if(!emailValid(email)||email.length>254)return json({error:"Informe um e-mail válido."},400,origin);

  const forwarded=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ||req.headers.get("cf-connecting-ip")
    ||req.headers.get("x-real-ip")
    ||"unknown";
  const [emailHash,ipHash]=await Promise.all([sha256(email),sha256(forwarded)]);
  const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

  const {data:allowed,error:limitError}=await admin.rpc("register_password_recovery_attempt",{p_email_hash:emailHash,p_ip_hash:ipHash});
  if(limitError){console.error("recovery-rate-limit",limitError.message);return json({error:"Não foi possível iniciar a recuperação agora. Tente novamente."},503,origin);}
  if(allowed!==true)return json({ok:true,message:"Se o e-mail estiver cadastrado e ativo, você receberá as instruções de recuperação."},200,origin);

  const {data:appUser,error:userError}=await admin.from("app_users").select("nome,email,active").eq("email",email).eq("active",true).maybeSingle();
  if(userError){console.error("recovery-user",userError.message);return json({error:"Não foi possível iniciar a recuperação agora. Tente novamente."},503,origin);}
  if(!appUser){
    await new Promise(resolve=>setTimeout(resolve,350));
    return json({ok:true,message:"Se o e-mail estiver cadastrado e ativo, você receberá as instruções de recuperação."},200,origin);
  }

  const {data:linkData,error:linkError}=await admin.auth.admin.generateLink({type:"recovery",email});
  const tokenHash=linkData?.properties?.hashed_token;
  if(linkError||!tokenHash){
    console.error("recovery-link",linkError?.message||"token ausente");
    return json({error:"Não foi possível gerar o link de recuperação. Tente novamente."},503,origin);
  }

  const {data:configRows,error:configError}=await admin.rpc("get_password_recovery_email_config");
  const config=(Array.isArray(configRows)?configRows[0]:configRows) as RecoveryEmailConfig|undefined;
  if(configError||!config?.email_credencial_configurada||config.email_ultimo_status!=="conectado"||!config.email_secret){
    console.error("recovery-email-config",configError?.message||"configuração indisponível");
    return json({error:"O serviço de e-mail está temporariamente indisponível. Tente novamente em alguns minutos."},503,origin);
  }

  const primary=color(config.primary_color,"#1466DF");
  const sidebar=color(config.sidebar_color,"#14263D");
  const success=color(config.success_color,"#16875F");
  const recoveryUrl=`${APP_URL}/recuperar-senha?token_hash=${encodeURIComponent(tokenHash)}`;
  const name=escapeHtml(String(appUser.nome||"Usuário"));
  const subject="JPI Fiscal — Redefinição de senha";
  const html=`<!doctype html><html><body style="margin:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#243247">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fa;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dfe6ee;border-radius:16px;overflow:hidden">
    <tr><td style="background:${sidebar};padding:22px 28px">
      <table role="presentation" cellspacing="0" cellpadding="0"><tr>
        <td style="width:58px;height:58px;background:#ffffff;border-radius:12px;text-align:center;vertical-align:middle"><img src="${LOGO_URL}" width="48" height="48" alt="JPI" style="display:block;margin:auto;max-width:48px;max-height:48px;object-fit:contain"></td>
        <td style="padding-left:14px"><div style="color:#ffffff;font-size:20px;font-weight:700">JPI Fiscal</div><div style="color:#dbe5f1;font-size:12px;margin-top:3px">Jardim Escola João Paulo I</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:30px 30px 10px">
      <div style="font-size:12px;font-weight:700;color:${primary};letter-spacing:.5px">RECUPERAÇÃO DE ACESSO</div>
      <h1 style="font-size:24px;line-height:1.25;margin:8px 0 18px;color:${sidebar}">Redefina sua senha</h1>
      <p style="font-size:14px;line-height:1.7;margin:0 0 14px">Olá, <strong>${name}</strong>.</p>
      <p style="font-size:14px;line-height:1.7;margin:0 0 20px">Recebemos uma solicitação para redefinir a senha de acesso ao <strong>JPI Fiscal</strong>. Clique no botão abaixo para continuar com segurança.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="background:${primary};border-radius:9px"><a href="${recoveryUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Redefinir minha senha</a></td></tr></table>
      <div style="border-left:4px solid ${success};background:#eff9f5;padding:12px 14px;border-radius:7px;margin:18px 0"><div style="font-size:12px;line-height:1.55;color:#375849">Por segurança, o link é de uso único e pode expirar. Use sempre o e-mail de recuperação mais recente.</div></div>
      <p style="font-size:12px;line-height:1.65;color:#66778a;margin:20px 0 6px">Se você não solicitou a redefinição, ignore esta mensagem. Nenhuma alteração será feita sem a confirmação pelo link.</p>
    </td></tr>
    <tr><td style="padding:18px 30px 26px;border-top:1px solid #edf1f5"><div style="font-size:11px;color:#8390a0">Mensagem automática de segurança · JPI Fiscal</div></td></tr>
  </table>
  </td></tr></table></body></html>`;

  try{
    await sendEmail(config,email,subject,html);
    return json({ok:true,message:"Enviamos um e-mail personalizado com as instruções de recuperação."},200,origin);
  }catch(error){
    console.error("recovery-send",error instanceof Error?error.message:String(error));
    return json({error:"Não foi possível enviar o e-mail de recuperação agora. Tente novamente em alguns minutos."},503,origin);
  }
});