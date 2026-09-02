export type EmailDeliveryConfig={
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
};

export function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));
}

export function safeColor(value:string|null|undefined,fallback:string){
  return /^#[0-9a-f]{6}$/i.test(String(value||""))?String(value).toUpperCase():fallback;
}

function cleanHeader(value:string){return value.replace(/[\r\n]+/g," ").trim();}
function emailValid(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
function utf8Base64(value:string){
  const bytes=new TextEncoder().encode(value);let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
}
function encodedHeader(value:string){return `=?UTF-8?B?${utf8Base64(cleanHeader(value))}?=`;}

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

async function sendSmtp(config:EmailDeliveryConfig,to:string,subject:string,html:string){
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
    await smtp.command(utf8Base64(username),334);
    await smtp.command(utf8Base64(password),235);
    await smtp.command(`MAIL FROM:<${fromAddress}>`,250);
    await smtp.command(`RCPT TO:<${to}>`,[250,251]);
    await smtp.command("DATA",354);
    await smtp.write(`${data}\r\n.\r\n`);
    await smtp.expect(250);
    await smtp.command("QUIT",221).catch(()=>undefined);
  }finally{smtp.close();}
}

export async function sendEmail(config:EmailDeliveryConfig,to:string,subject:string,html:string){
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
