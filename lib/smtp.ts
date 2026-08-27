import { randomUUID } from "node:crypto";
import tls, { type TLSSocket } from "node:tls";

export type SmtpAttachment={filename:string;content:Buffer;contentType:string};
type SmtpOptions={host:string;port:number;username:string;password:string;fromName:string;fromAddress:string;replyTo?:string|null;to:string;subject:string;html:string;attachments?:SmtpAttachment[]};
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanHeader=(value:string)=>value.replace(/[\r\n]+/g," ").trim();
const encodedHeader=(value:string)=>`=?UTF-8?B?${Buffer.from(cleanHeader(value),"utf8").toString("base64")}?=`;

const wrapBase64=(value:string)=>value.match(/.{1,76}/g)?.join("\r\n")||"";

export function buildSmtpMessage(options:Pick<SmtpOptions,"fromName"|"fromAddress"|"replyTo"|"to"|"subject"|"html"|"attachments">){
  for(const address of [options.fromAddress,options.to,options.replyTo].filter(Boolean) as string[])if(!emailPattern.test(address))throw new Error("Endereço de e-mail inválido.");
  const domain=options.fromAddress.split("@")[1];
  const attachments=options.attachments||[];
  for(const attachment of attachments){
    if(!/^[\w.-]{1,180}$/i.test(attachment.filename))throw new Error("Nome de anexo inválido.");
    if(!attachment.contentType||attachment.content.length>10*1024*1024)throw new Error("Anexo de e-mail inválido ou muito grande.");
  }
  const boundary=`jpi-${randomUUID()}`;
  const headers=[
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    `From: ${encodedHeader(options.fromName)} <${options.fromAddress}>`,
    `To: <${options.to}>`,
    ...(options.replyTo?[`Reply-To: <${options.replyTo}>`]:[]),
    `Subject: ${encodedHeader(options.subject)}`,
    "MIME-Version: 1.0",
    ...(attachments.length?[`Content-Type: multipart/mixed; boundary=\"${boundary}\"`]:["Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: 8bit"]),
  ];
  const html=options.html.replace(/\r?\n/g,"\r\n");
  const body=attachments.length?[
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    ...attachments.flatMap(attachment=>[
      `--${boundary}`,
      `Content-Type: ${cleanHeader(attachment.contentType)}; name=\"${attachment.filename}\"`,
      `Content-Disposition: attachment; filename=\"${attachment.filename}\"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(attachment.content.toString("base64")),
    ]),
    `--${boundary}--`,
  ].join("\r\n"):html;
  const dotSafeBody=body.replace(/(^|\r\n)\./g,"$1..");
  return `${headers.join("\r\n")}\r\n\r\n${dotSafeBody}`;
}

class SmtpConnection{
  private socket:TLSSocket;
  private buffer="";
  private lines:string[]=[];
  private waiting:Array<{resolve:(line:string)=>void;reject:(error:Error)=>void}>=[];
  private terminalError:Error|null=null;
  constructor(socket:TLSSocket){
    this.socket=socket;
    socket.setEncoding("utf8");
    socket.on("data",chunk=>{
      this.buffer+=String(chunk);
      let boundary=this.buffer.indexOf("\r\n");
      while(boundary>=0){const line=this.buffer.slice(0,boundary);this.buffer=this.buffer.slice(boundary+2);const waiter=this.waiting.shift();if(waiter)waiter.resolve(line);else this.lines.push(line);boundary=this.buffer.indexOf("\r\n");}
    });
    const fail=(error:Error)=>{this.terminalError=error;for(const waiter of this.waiting.splice(0))waiter.reject(error);};
    socket.on("error",fail);socket.on("timeout",()=>{const error=new Error("O servidor SMTP demorou para responder.");fail(error);socket.destroy(error);});socket.on("close",()=>{if(!this.terminalError)fail(new Error("O servidor SMTP encerrou a conexão."));});
  }
  private nextLine(){if(this.lines.length)return Promise.resolve(this.lines.shift()!);if(this.terminalError)return Promise.reject(this.terminalError);return new Promise<string>((resolve,reject)=>this.waiting.push({resolve,reject}));}
  async response(expected:number|number[]){
    const accepted=Array.isArray(expected)?expected:[expected];const lines:string[]=[];let code=0;
    while(true){const line=await this.nextLine();lines.push(line);const match=line.match(/^(\d{3})([ -])/);if(!match)continue;code=Number(match[1]);if(match[2]===" ")break;}
    if(!accepted.includes(code))throw new Error(`SMTP ${code}: ${lines.join(" ").slice(0,500)}`);
    return lines.join("\n");
  }
  async command(command:string,expected:number|number[]){this.socket.write(`${command}\r\n`);return this.response(expected);}
  writeData(message:string){this.socket.write(`${message}\r\n.\r\n`);}
  close(){this.socket.end();}
}

export async function sendSmtpEmail(options:SmtpOptions){
  if(!["email-ssl.com.br","smtplw.com.br"].includes(options.host))throw new Error("Servidor SMTP não autorizado.");
  if(options.port!==465)throw new Error("Use a porta segura 465 para a Locaweb.");
  if(!emailPattern.test(options.username)&&options.host==="email-ssl.com.br")throw new Error("O usuário SMTP deve ser o e-mail completo.");
  const socket=await new Promise<TLSSocket>((resolve,reject)=>{const connection=tls.connect({host:options.host,port:options.port,servername:options.host,rejectUnauthorized:true},()=>resolve(connection));connection.once("error",reject);});
  socket.setTimeout(20000);
  const smtp=new SmtpConnection(socket);
  try{
    await smtp.response(220);
    await smtp.command("EHLO jpi-fiscal.vercel.app",250);
    await smtp.command("AUTH LOGIN",334);
    await smtp.command(Buffer.from(options.username,"utf8").toString("base64"),334);
    await smtp.command(Buffer.from(options.password,"utf8").toString("base64"),235);
    await smtp.command(`MAIL FROM:<${options.fromAddress}>`,250);
    await smtp.command(`RCPT TO:<${options.to}>`,[250,251]);
    await smtp.command("DATA",354);
    smtp.writeData(buildSmtpMessage(options));
    const response=await smtp.response(250);
    await smtp.command("QUIT",221).catch(()=>undefined);
    return {response};
  }finally{options.password="";smtp.close();}
}
