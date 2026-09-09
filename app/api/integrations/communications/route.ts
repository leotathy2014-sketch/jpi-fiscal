import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendSmtpEmail } from "@/lib/smtp";
import { AGENDA_EDU_ENDPOINTS, createAgendaEduAccessToken, serializeAgendaEduCredentials, parseAgendaEduCredentials, searchAgendaEduStudents, testAgendaEduConnection, listAgendaEduStudents, getAgendaEduStudentDetails, listAgendaEduChannels, lookupAgendaEduFamilyChat, type AgendaEduEnvironment } from "@/lib/agenda-edu";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime = "nodejs";
export const maxDuration = 30;

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits=(value:string)=>value.replace(/\D/g,"");
const normalizeBrazilPhone=(value:string)=>{const phone=digits(value);return phone.length===10||phone.length===11?`55${phone}`:phone};
const maskPhone=(value:string)=>value.length>=12?`+${value.slice(0,2)} (${value.slice(2,4)}) •••••-${value.slice(-4)}`:"Número interno configurado";
const json=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]||character);
const safeSample=(value:unknown,depth=0):unknown=>{
  if(depth>4)return "[limite de profundidade]";
  if(Array.isArray(value))return value.slice(0,5).map(item=>safeSample(item,depth+1));
  if(value&&typeof value==="object"){
    const output:Record<string,unknown>={};
    for(const [key,raw] of Object.entries(value as Record<string,unknown>).slice(0,30)){
      if(/token|secret|password|senha|authorization/i.test(key)){output[key]="[protegido]";continue}
      output[key]=safeSample(raw,depth+1);
    }
    return output;
  }
  if(typeof value==="string"&&value.length>300)return `${value.slice(0,300)}...`;
  return value;
};
type AgendaDiagnosticProbe={label:string;method:string;endpoint:string;status:number;ok:boolean;durationMs:number;count:number|null;sample:unknown};
const agendaEnvironment=(value:unknown):AgendaEduEnvironment=>String(value)==="producao"?"producao":"homologacao";
const agendaBaseUrl=(environment:AgendaEduEnvironment)=>environment==="producao"?AGENDA_EDU_ENDPOINTS.productionBaseUrl:AGENDA_EDU_ENDPOINTS.sandboxBaseUrl;
const agendaEnvironmentLabel=(environment:AgendaEduEnvironment)=>environment==="producao"?"Plataforma oficial":"Sandbox";
async function agendaProbe(accessToken:string,schoolToken:string,label:string,path:string,environment:AgendaEduEnvironment,init?:RequestInit){
  const url=`${agendaBaseUrl(environment)}${path}`;
  const started=Date.now();
  try{
    const response=await fetch(url,{...init,headers:{Accept:"application/json",Authorization:`Bearer ${accessToken}`,"x-school-token":schoolToken,...(init?.headers||{})},cache:"no-store"});
    const text=await response.text();
    let body:unknown=text;try{body=text?JSON.parse(text):null}catch{}
    const data=body&&typeof body==="object"&&(body as {data?:unknown}).data;
    const meta=body&&typeof body==="object"?(body as {meta?:unknown}).meta:null;
    return {label,method:init?.method||"GET",endpoint:path,status:response.status,ok:response.ok,durationMs:Date.now()-started,count:Array.isArray(data)?data.length:null,sample:safeSample(meta?{meta,data}:body)};
  }catch(error){
    return {label,method:init?.method||"GET",endpoint:path,status:0,ok:false,durationMs:Date.now()-started,count:null,sample:{error:error instanceof Error?error.message:"Falha de rede ao consultar a Agenda Edu."}};
  }
}
const normalizeText=(value:unknown)=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s/-]/gu," ").replace(/\s+/g," ").trim();
const normalizeKey=(value:unknown)=>normalizeText(value).toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"")||"NAO_INFORMADO";
const firstEmail=(responsible:unknown)=>Array.isArray((responsible as {emails?:unknown[]})?.emails)?String(((responsible as {emails:unknown[]}).emails[0] as {email?:unknown})?.email||"").trim().toLowerCase():"";
const firstPhone=(responsible:unknown)=>Array.isArray((responsible as {telefones?:unknown[]})?.telefones)?digits(String(((responsible as {telefones:unknown[]}).telefones[0] as {telefone?:unknown;numero?:unknown})?.telefone||((responsible as {telefones:unknown[]}).telefones[0] as {numero?:unknown})?.numero||"")):"";
const isFinancialResponsible=(responsible:unknown)=>{
  const row=responsible as Record<string,unknown>;
  return row?.responsavel_financeiro===1||row?.responsavel_financeiro===true||row?.segundo_responsavel_financeiro===1||row?.segundo_responsavel_financeiro===true;
};
const inferPeriod=(turma:unknown)=>{
  const value=normalizeText(turma).toLocaleLowerCase("pt-BR");
  if(/integral|integ/.test(value))return "integral";
  if(/tarde|vesp|\/\s*t\b|\bt\b/.test(value))return "afternoon";
  return "morning";
};
function buildAgendaStructure(rows:Array<Record<string,unknown>>){
  const units=new Map<string,Record<string,unknown>>();
  const classrooms=new Map<string,Record<string,unknown>>();
  const students:Array<Record<string,unknown>>=[];
  const responsibles=new Map<string,Record<string,unknown>>();
  const links:Array<Record<string,unknown>>=[];
  const issues:string[]=[];
  for(const row of rows){
    const studentLegacyId=String(row.matricula_id||row.numero_matricula||"").trim();
    if(!studentLegacyId){issues.push(`Aluno ${row.nome||"sem nome"} sem matrícula/legacy_id.`);continue}
    const unitName=normalizeText(row.unidade)||"JPI - Matriz";
    const unitLegacyId=normalizeKey(unitName);
    units.set(unitLegacyId,{legacy_id:unitLegacyId,name:unitName});
    const classroomLegacyId=[row.ano_letivo,unitName,row.curso,row.serie,row.turma].map(normalizeKey).join("|");
    classrooms.set(classroomLegacyId,{legacy_id:classroomLegacyId,unit_id:unitLegacyId,name:normalizeText(row.turma)||"Turma não informada",grade:normalizeText(row.serie)||normalizeText(row.curso)||"Série não informada",course:normalizeText(row.curso)||"Curso não informado",school_year:String(row.ano_letivo||""),period:inferPeriod(row.turma)});
    if(!row.data_nascimento)issues.push(`${row.nome||studentLegacyId}: data de nascimento ausente; a Agenda Edu pode exigir este campo.`);
    students.push({legacy_id:studentLegacyId,classroom_id:classroomLegacyId,name:normalizeText(row.nome)||"Aluno sem nome",date_of_birth:row.data_nascimento||null,period:inferPeriod(row.turma)});
    const responsibleRows=Array.isArray(row.responsaveis)?row.responsaveis as unknown[]:[];
    const ordered=[...responsibleRows].sort((a,b)=>Number(isFinancialResponsible(b))-Number(isFinancialResponsible(a)));
    if(!ordered.length)issues.push(`${row.nome||studentLegacyId}: sem responsáveis no espelho SWeduc.`);
    for(const responsible of ordered){
      const data=responsible as Record<string,unknown>;
      const cpf=digits(String(data.cpf||data.cpf_cnpj||""));
      const email=firstEmail(responsible);
      const phone=firstPhone(responsible);
      const responsibleLegacyId=cpf||email||normalizeKey(data.nome);
      if(!responsibleLegacyId){issues.push(`${row.nome||studentLegacyId}: responsável sem CPF, e-mail ou nome.`);continue}
      if(!responsibles.has(responsibleLegacyId))responsibles.set(responsibleLegacyId,{legacy_id:responsibleLegacyId,name:normalizeText(data.nome)||"Responsável sem nome",cpf:cpf||null,email:email||null,phone:phone||null,kinship:data.parentesco||null,financial:isFinancialResponsible(responsible),pedagogical:data.responsavel_pedagogico===1||data.responsavel_pedagogico===true});
      links.push({student_id:studentLegacyId,responsible_id:responsibleLegacyId,financial:isFinancialResponsible(responsible),pedagogical:data.responsavel_pedagogico===1||data.responsavel_pedagogico===true});
    }
  }
  return {counts:{units:units.size,classrooms:classrooms.size,students:students.length,responsibles:responsibles.size,links:links.length,issues:issues.length},samples:{units:Array.from(units.values()).slice(0,3),classrooms:Array.from(classrooms.values()).slice(0,3),students:students.slice(0,3),responsibles:Array.from(responsibles.values()).slice(0,3),links:links.slice(0,3)},issues:issues.slice(0,20)};
}

async function authorizedClient(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization=request.headers.get("authorization");
  const token=authorization?.replace(/^Bearer\s+/i,"");
  if(!supabaseUrl||!supabaseKey)return {ok:false as const,response:json({error:"A conexão com o banco ainda não está configurada."},503)};
  if(!authorization||!token)return {ok:false as const,response:json({error:"Sessão inválida."},401)};
  const supabase=createClient(supabaseUrl,supabaseKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user?.email)return {ok:false as const,response:json({error:"Sessão expirada. Entre novamente."},401)};
  return {ok:true as const,supabase,user};
}

async function readConfig(supabase:SupabaseClient){
  return supabase.from("integracoes_comunicacao").select("email_provider,email_from_name,email_from_address,email_reply_to,email_smtp_host,email_smtp_port,email_smtp_username,email_credencial_configurada,email_testada_em,email_ultimo_status,whatsapp_provider,whatsapp_phone_number_id,whatsapp_business_account_id,whatsapp_sender_number,whatsapp_template_name,whatsapp_test_recipient,whatsapp_token_configurado,whatsapp_testada_em,whatsapp_ultimo_status,whatsapp_manual_message_template,agenda_edu_provider,agenda_edu_school_identifier,agenda_edu_channel_id,agenda_edu_environment,agenda_edu_documentacao_confirmada,agenda_edu_credencial_configurada,agenda_edu_testada_em,agenda_edu_ultimo_status").eq("id",true).single();
}

export async function GET(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"settings.integrations.view")&&!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para visualizar as integrações."},403);
  const {data,error}=await readConfig(auth.supabase);
  if(error||!data)return json({error:error?.message||"Configuração de comunicação não encontrada."},404);
  return json({ok:true,config:data});
}

export async function POST(request:NextRequest){
  const auth=await authorizedClient(request);if(!auth.ok)return auth.response;
  if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para configurar as integrações."},403);
  const backendSecret=process.env.JPI_BACKEND_SECRET;
  if(!backendSecret)return json({error:"O cofre de credenciais ainda não está configurado no servidor."},503);
  let body:Record<string,unknown>={};
  try{body=await request.json()}catch{return json({error:"Dados da solicitação inválidos."},400)}
  const action=String(body.action||"");

  if(action==="save-email"){
    const provider=String(body.provider||"");const fromName=String(body.fromName||"").trim();const fromAddress=String(body.fromAddress||"").trim().toLowerCase();const replyTo=String(body.replyTo||"").trim().toLowerCase();const smtpUsername=String(body.smtpUsername||"").trim().toLowerCase();let credential=String(body.credential||"").trim();
    if(!["resend","locaweb_email","locaweb_smtp"].includes(provider))return json({error:"Selecione um provedor de e-mail válido."},400);
    if(!fromName||fromName.length>100)return json({error:"Informe um nome de remetente válido."},400);
    if(!emailPattern.test(fromAddress))return json({error:"Informe um e-mail de remetente válido."},400);
    if(replyTo&&!emailPattern.test(replyTo))return json({error:"Informe um e-mail de resposta válido."},400);
    if(provider==="resend"&&credential&&(!credential.startsWith("re_")||credential.length<20))return json({error:"A chave do Resend é inválida."},400);
    if(provider!=="resend"&&!smtpUsername)return json({error:"Informe o usuário SMTP da Locaweb."},400);
    if(provider==="locaweb_email"&&!emailPattern.test(smtpUsername))return json({error:"No E-mail Locaweb, o usuário SMTP deve ser o e-mail completo."},400);
    if(provider!=="resend"&&credential&&credential.length<6)return json({error:"A senha SMTP informada é inválida."},400);
    const {data:current}=await readConfig(auth.supabase);
    if(current?.email_provider!==provider&&!credential)return json({error:"Informe a credencial do novo provedor para concluir a troca."},400);
    const smtpHost=provider==="locaweb_email"?"email-ssl.com.br":provider==="locaweb_smtp"?"smtplw.com.br":null;
    const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({email_provider:provider,email_from_name:fromName,email_from_address:fromAddress,email_reply_to:replyTo||null,email_smtp_host:smtpHost,email_smtp_port:465,email_smtp_username:provider==="resend"?null:smtpUsername,email_ultimo_status:"pendente",updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:updateError.message},400);
    if(credential){const {error:vaultError}=await auth.supabase.rpc("store_communication_secret",{p_channel:"email",p_secret:credential,p_backend_secret:backendSecret});credential="";if(vaultError)return json({error:"Não foi possível guardar a credencial de e-mail no cofre seguro."},500)}
    return json({ok:true,message:`Configuração de e-mail salva com ${provider==="resend"?"Resend":"Locaweb"}. Faça o teste antes de usar.`});
  }

  if(action==="test-email"){
    const recipient=String(body.recipient||"").trim().toLowerCase();if(!emailPattern.test(recipient))return json({error:"Informe um destinatário de teste válido."},400);
    const {data:config,error:configError}=await readConfig(auth.supabase);if(configError||!config)return json({error:"Configuração de e-mail não encontrada."},404);
    if(!config.email_from_address)return json({error:"Salve primeiro o e-mail do remetente."},400);
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"email",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro a credencial do provedor de e-mail."},400);
    const html=`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Integração confirmada</h2><p>Olá!</p><p>Este é um teste seguro do canal de e-mail do <strong>${escapeHtml(config.email_from_name)}</strong>.</p><p>Nenhuma NFS-e foi anexada ou enviada neste teste.</p></div>`;
    try{
      let providerId:string|undefined;
      if(config.email_provider==="resend"){
        const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${storedSecret}`,"Content-Type":"application/json","Idempotency-Key":`jpi-email-test-${Date.now()}`},body:JSON.stringify({from:`${config.email_from_name} <${config.email_from_address}>`,to:[recipient],reply_to:config.email_reply_to||undefined,subject:"Teste de e-mail — JPI Fiscal",html}),cache:"no-store"});
        const result=await response.json().catch(()=>({})) as {id?:string;message?:string;name?:string};
        if(!response.ok)throw new Error(result.message||result.name||"O Resend não concluiu o envio de teste.");providerId=result.id;
      }else{
        if(!config.email_smtp_host||!config.email_smtp_username)return json({error:"Complete os dados SMTP da Locaweb antes do teste."},400);
        await sendSmtpEmail({host:config.email_smtp_host,port:config.email_smtp_port||465,username:config.email_smtp_username,password:String(storedSecret),fromName:config.email_from_name,fromAddress:config.email_from_address,replyTo:config.email_reply_to,to:recipient,subject:"Teste de e-mail — JPI Fiscal",html});
      }
      await auth.supabase.from("integracoes_comunicacao").update({email_ultimo_status:"conectado",email_testada_em:new Date().toISOString(),updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
      return json({ok:true,message:`E-mail de teste enviado pela ${config.email_provider==="resend"?"Resend":"Locaweb"}. Confira a caixa de entrada e o spam.`,providerId});
    }catch(sendError){
      await auth.supabase.from("integracoes_comunicacao").update({email_ultimo_status:"erro",updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
      return json({error:sendError instanceof Error?sendError.message:"O provedor não concluiu o envio de teste."},400);
    }
  }

  if(action==="save-whatsapp-manual-message"){
    const template=String(body.template||"").replace(/\r\n/g,"\n").trim();
    if(template.length<20||template.length>2000)return json({error:"A mensagem do WhatsApp deve ter entre 20 e 2.000 caracteres."},400);
    if(!template.includes("{link}"))return json({error:"A mensagem precisa conter a variável {link} para incluir o acesso à nota."},400);
    const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({whatsapp_manual_message_template:template,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:"Não foi possível salvar a mensagem padrão do WhatsApp."},400);
    return json({ok:true,message:"Mensagem padrão do WhatsApp salva. Ela será usada nos próximos envios manuais."});
  }

  if(action==="save-whatsapp-manual"){
    const testRecipient=normalizeBrazilPhone(String(body.testRecipient||""));
    if(!/^55[1-9][0-9]{9,10}$/.test(testRecipient))return json({error:"Informe um número brasileiro interno para os testes, com DDI e DDD."},400);
    const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({whatsapp_test_recipient:testRecipient,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:"Não foi possível salvar o número interno de teste."},400);
    return json({ok:true,ready:true,testRecipient:maskPhone(testRecipient),message:"Número interno salvo. O WhatsApp manual gratuito está liberado."});
  }

  if(action==="save-whatsapp"){
    const phoneNumberId=digits(String(body.phoneNumberId||""));const businessAccountId=digits(String(body.businessAccountId||""));const senderNumber=normalizeBrazilPhone(String(body.senderNumber||""));const testRecipient=normalizeBrazilPhone(String(body.testRecipient||""));const templateName=String(body.templateName||"").trim();let accessToken=String(body.accessToken||"").trim();
    if(!phoneNumberId||phoneNumberId.length>30)return json({error:"Informe o ID do número do WhatsApp."},400);
    if(!businessAccountId||businessAccountId.length>30)return json({error:"Informe o ID da conta comercial."},400);
    if(!senderNumber||senderNumber.length<10||senderNumber.length>15)return json({error:"Informe o número remetente com DDI e DDD."},400);
    if(!/^55[1-9][0-9]{9,10}$/.test(testRecipient))return json({error:"Informe um número brasileiro interno para os testes, com DDI e DDD."},400);
    if(!/^[a-z0-9_]{3,100}$/i.test(templateName))return json({error:"Informe um nome de modelo válido."},400);
    if(accessToken&&accessToken.length<20)return json({error:"O token da WhatsApp Cloud API é inválido."},400);
    const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({whatsapp_provider:"meta_cloud",whatsapp_phone_number_id:phoneNumberId,whatsapp_business_account_id:businessAccountId,whatsapp_sender_number:senderNumber,whatsapp_template_name:templateName,whatsapp_test_recipient:testRecipient,whatsapp_ultimo_status:"pendente",updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:updateError.message},400);
    if(accessToken){const {error:vaultError}=await auth.supabase.rpc("store_communication_secret",{p_channel:"whatsapp",p_secret:accessToken,p_backend_secret:backendSecret});accessToken="";if(vaultError)return json({error:"Não foi possível guardar o token do WhatsApp no cofre seguro."},500)}
    return json({ok:true,message:"Configuração do WhatsApp salva. Faça o teste antes de enviar mensagens."});
  }

  if(action==="test-whatsapp"){
    const {data:config,error:configError}=await readConfig(auth.supabase);if(configError||!config)return json({error:"Configuração do WhatsApp não encontrada."},404);
    if(!config.whatsapp_phone_number_id)return json({error:"Salve primeiro o ID do número do WhatsApp."},400);
    const {data:accessToken,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"whatsapp",p_backend_secret:backendSecret});
    if(secretError||!accessToken)return json({error:"Cadastre primeiro o token da WhatsApp Cloud API."},400);
    const response=await fetch(`https://graph.facebook.com/${encodeURIComponent(config.whatsapp_phone_number_id)}?fields=display_phone_number,verified_name`,{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
    const result=await response.json().catch(()=>({})) as {display_phone_number?:string;verified_name?:string;error?:{message?:string}};
    await auth.supabase.from("integracoes_comunicacao").update({whatsapp_ultimo_status:response.ok?"conectado":"erro",whatsapp_testada_em:response.ok?new Date().toISOString():null,updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(!response.ok)return json({error:result.error?.message||"A Meta não confirmou a conexão com este número."},400);
    return json({ok:true,message:`WhatsApp confirmado${result.verified_name?` para ${result.verified_name}`:""}${result.display_phone_number?` · ${result.display_phone_number}`:""}. Nenhuma mensagem foi enviada.`});
  }

  if(action==="save-agenda"){
    const schoolIdentifier=String(body.schoolIdentifier||"").trim();const channelId=String(body.channelId||"").trim();let clientId=String(body.clientId||"").trim();let clientSecret=String(body.clientSecret||"").trim();let schoolToken=String(body.schoolToken||"").trim();
    const environment=agendaEnvironment(body.environment);
    if(schoolIdentifier.length>100||!/^[-_. a-z0-9À-ÿ]*$/i.test(schoolIdentifier))return json({error:"O identificador da escola contém caracteres inválidos."},400);
    if(channelId&&!/^[a-z0-9_-]{1,100}$/i.test(channelId))return json({error:"O ID do canal da Agenda Edu é inválido."},400);
    const supplied=[clientId,clientSecret,schoolToken].filter(Boolean).length;
    if(supplied>0&&supplied<3)return json({error:"Informe client_id, client_secret e x-school-token juntos."},400);
    if(supplied===3&&(clientId.length>300||clientSecret.length>1000||schoolToken.length>1000))return json({error:"Uma das credenciais da Agenda Edu ultrapassa o tamanho permitido."},400);
    const {data:current}=await readConfig(auth.supabase);
    if(!current?.agenda_edu_credencial_configurada&&supplied===0)return json({error:"Informe as três credenciais de homologação da Agenda Edu."},400);
    const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({agenda_edu_school_identifier:schoolIdentifier||null,agenda_edu_channel_id:channelId||null,agenda_edu_environment:environment,agenda_edu_documentacao_confirmada:true,agenda_edu_ultimo_status:"pendente",updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
    if(updateError)return json({error:"A configuração local da Agenda Edu ainda não foi aplicada ao banco."},503);
    if(supplied===3){const protectedCredential=serializeAgendaEduCredentials({clientId,clientSecret,schoolToken});const {error:vaultError}=await auth.supabase.rpc("store_communication_secret",{p_channel:"agenda_edu",p_secret:protectedCredential,p_backend_secret:backendSecret});clientId="";clientSecret="";schoolToken="";if(vaultError)return json({error:"Não foi possível guardar as credenciais da Agenda Edu no cofre seguro."},500)}
    return json({ok:true,message:`Configuração da Agenda Edu salva para ${agendaEnvironmentLabel(environment)}. Nenhuma mensagem foi enviada.`});
  }

  if(action==="test-agenda"){
    const {data:currentConfig}=await readConfig(auth.supabase);
    const environment=agendaEnvironment(currentConfig?.agenda_edu_environment);
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro as credenciais da Agenda Edu."},400);
    try{
      const result=await testAgendaEduConnection(parseAgendaEduCredentials(String(storedSecret)),fetch,environment);
      if(!result.channelId)throw new Error("A Agenda Edu confirmou a conexão, mas não retornou nenhum canal de Mensagens disponível para esta escola.");
      const testedAt=new Date().toISOString();
      const {error:updateError}=await auth.supabase.from("integracoes_comunicacao").update({agenda_edu_channel_id:String(result.channelId),agenda_edu_documentacao_confirmada:true,agenda_edu_ultimo_status:"conectado",agenda_edu_testada_em:testedAt,updated_at:testedAt,updated_by:auth.user.id}).eq("id",true);
      if(updateError)return json({error:"A conexão foi confirmada, mas não foi possível salvar automaticamente o canal da Agenda Edu."},500);
      return json({ok:true,ready:true,channelId:String(result.channelId),message:`Conexão com ${agendaEnvironmentLabel(environment)} da Agenda Edu confirmada${result.channelName?` · canal encontrado: ${result.channelName}`:""}. Canal salvo automaticamente. Nenhuma mensagem foi enviada.`});
    }catch(testError){
      await auth.supabase.from("integracoes_comunicacao").update({agenda_edu_ultimo_status:"erro",updated_at:new Date().toISOString(),updated_by:auth.user.id}).eq("id",true);
      return json({error:testError instanceof Error?testError.message:`A Agenda Edu não confirmou a conexão com ${agendaEnvironmentLabel(environment)}.`},400);
    }
  }

  if(action==="diagnose-agenda"){
    if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para diagnosticar a Agenda Edu."},403);
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro as credenciais da Agenda Edu."},400);
    const {data:currentConfig}=await readConfig(auth.supabase);
    const environment=agendaEnvironment(currentConfig?.agenda_edu_environment);
    const channelId=String(body.channelId||"").trim();
    const sweducMatriculaId=String(body.sweducMatriculaId||"").replace(/\D/g,"").trim();
    const studentName=String(body.studentName||"").trim();
    try{
      const credentials=parseAgendaEduCredentials(String(storedSecret));
      const token=await createAgendaEduAccessToken(credentials,fetch,environment);
      const probes:AgendaDiagnosticProbe[]=[{label:"OAuth/token",method:"POST",endpoint:"/oauth/v2/token",status:200,ok:true,durationMs:0,count:null,sample:{access_token:"[protegido]",expires_in:token.expiresIn}}];
      probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Canais de mensagens","/channels?page%5Bsize%5D=10",environment));
      probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Listar alunos — student_profiles","/student_profiles?pagina=1&por_pagina=10",environment));
      probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Listar alunos com sede 23","/student_profiles?id_da_sede=23&pagina=1&por_pagina=10",environment));
      if(studentName)probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Busca aluno por nome — student_profiles",`/student_profiles?nome=${encodeURIComponent(studentName)}&pagina=1&por_pagina=10`,environment));
      if(studentName)probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Busca aluno parâmetro search",`/student_profiles?search=${encodeURIComponent(studentName)}&pagina=1&por_pagina=10`,environment));
      if(sweducMatriculaId)probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Busca aluno por external_ids",`/student_profiles?external_ids%5B%5D=${encodeURIComponent(sweducMatriculaId)}&pagina=1&por_pagina=10`,environment));
      if(sweducMatriculaId)probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Aluno por ID direto",`/student_profiles/${encodeURIComponent(sweducMatriculaId)}`,environment));
      if(channelId){
        probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Chats do canal",`/channels/${encodeURIComponent(channelId)}/chats?page%5Bsize%5D=10`,environment));
        if(studentName)probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Chats por nome do aluno",`/channels/${encodeURIComponent(channelId)}/chats?filter%5Bsearch%5D=${encodeURIComponent(studentName)}&page%5Bsize%5D=10`,environment));
        if(sweducMatriculaId)probes.push(await agendaProbe(token.accessToken,credentials.schoolToken,"Chat familiar por matrícula externa",`/channels/${encodeURIComponent(channelId)}/chats?filter%5Bkind%5D=family&filter%5BstudentId%5D=${encodeURIComponent(sweducMatriculaId)}&filter%5BuseExternalId%5D=true&page%5Bsize%5D=5`,environment));
      }
      return json({ok:true,message:"Diagnóstico Agenda Edu concluído. Nenhuma mensagem foi enviada e nada foi gravado.",baseUrl:agendaBaseUrl(environment),environment,channelId:channelId||null,sweducMatriculaId:sweducMatriculaId||null,studentName:studentName||null,probes});
    }catch(testError){
      return json({error:testError instanceof Error?testError.message:"Não foi possível diagnosticar a Agenda Edu."},400);
    }
  }

  if(action==="list-agenda-channels"){
    if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para listar canais da Agenda Edu."},403);
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro as credenciais da Agenda Edu."},400);
    try{
      const {data:currentConfig}=await readConfig(auth.supabase);
      const environment=agendaEnvironment(currentConfig?.agenda_edu_environment);
      const credentials=parseAgendaEduCredentials(String(storedSecret));
      const token=await createAgendaEduAccessToken(credentials,fetch,environment);
      const result=await listAgendaEduChannels({accessToken:token.accessToken,schoolToken:credentials.schoolToken,page:Number(body.page||1),perPage:Number(body.perPage||50),environment},fetch);
      return json({ok:true,message:`Lista de canais Agenda Edu carregada: página ${result.page}${result.totalPages?` de ${result.totalPages}`:""}. Nada foi gravado.`,baseUrl:agendaBaseUrl(environment),environment,...result});
    }catch(listError){
      return json({error:listError instanceof Error?listError.message:"Não foi possível listar os canais da Agenda Edu."},400);
    }
  }

  if(action==="list-agenda-students"){
    if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para listar alunos da Agenda Edu."},403);
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro as credenciais da Agenda Edu."},400);
    try{
      const {data:currentConfig}=await readConfig(auth.supabase);
      const environment=agendaEnvironment(currentConfig?.agenda_edu_environment);
      const credentials=parseAgendaEduCredentials(String(storedSecret));
      const token=await createAgendaEduAccessToken(credentials,fetch,environment);
      const result=await listAgendaEduStudents({accessToken:token.accessToken,schoolToken:credentials.schoolToken,page:Number(body.page||1),perPage:Number(body.perPage||50),environment},fetch);
      return json({ok:true,message:`Lista Agenda Edu carregada: página ${result.page}${result.totalPages?` de ${result.totalPages}`:""}. Nada foi gravado.`,baseUrl:agendaBaseUrl(environment),environment,...result});
    }catch(listError){
      return json({error:listError instanceof Error?listError.message:"Não foi possível listar os alunos da Agenda Edu."},400);
    }
  }

  if(action==="get-agenda-student-details"){
    if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para consultar detalhes do aluno na Agenda Edu."},403);
    const studentId=String(body.studentId||"").trim();
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro as credenciais da Agenda Edu."},400);
    try{
      const {data:currentConfig}=await readConfig(auth.supabase);
      const environment=agendaEnvironment(currentConfig?.agenda_edu_environment);
      const credentials=parseAgendaEduCredentials(String(storedSecret));
      const token=await createAgendaEduAccessToken(credentials,fetch,environment);
      const result=await getAgendaEduStudentDetails({accessToken:token.accessToken,schoolToken:credentials.schoolToken,studentId,environment},fetch);
      return json({ok:true,message:`Detalhes do aluno ${studentId} carregados. Nada foi gravado.`,baseUrl:agendaBaseUrl(environment),environment,...result,raw:safeSample(result.raw)});
    }catch(detailError){
      return json({error:detailError instanceof Error?detailError.message:"Não foi possível consultar detalhes do aluno na Agenda Edu."},400);
    }
  }

  if(action==="lookup-agenda-family-chat"){
    if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para localizar chats da Agenda Edu."},403);
    const channelId=String(body.channelId||"").trim();
    const studentId=String(body.studentId||"").trim();
    const useExternalId=body.useExternalId===true||String(body.useExternalId)==="true";
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro as credenciais da Agenda Edu."},400);
    try{
      const {data:currentConfig}=await readConfig(auth.supabase);
      const environment=agendaEnvironment(currentConfig?.agenda_edu_environment);
      const credentials=parseAgendaEduCredentials(String(storedSecret));
      const token=await createAgendaEduAccessToken(credentials,fetch,environment);
      const result=await lookupAgendaEduFamilyChat({accessToken:token.accessToken,schoolToken:credentials.schoolToken,channelId,studentId,useExternalId,environment},fetch);
      return json({ok:true,message:result.found?`Chat familiar encontrado: ${result.chatId}. Nada foi gravado e nenhuma mensagem foi enviada.`:"Nenhum chat familiar encontrado para este canal/aluno. Nada foi criado.",baseUrl:agendaBaseUrl(environment),environment,...result,raw:safeSample(result.raw)});
    }catch(chatError){
      return json({error:chatError instanceof Error?chatError.message:"Não foi possível localizar o chat familiar na Agenda Edu."},400);
    }
  }

  if(action==="prepare-agenda-structure"){
    if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para preparar a estrutura Agenda Edu."},403);
    const year=String(body.year||new Date().getFullYear()).replace(/\D/g,"").trim();
    const unit=String(body.unit||"JPI - Matriz").replace(/\s+/g," ").trim();
    const course=String(body.course||"").replace(/\s+/g," ").trim();
    const serie=String(body.serie||"").replace(/\s+/g," ").trim();
    const turma=String(body.turma||"").replace(/\s+/g," ").trim();
    let query=auth.supabase.from("sweduc_alunos").select("matricula_id,nome,data_nascimento,numero_matricula,ano_letivo,unidade,curso,serie,turma,responsaveis").limit(1000);
    if(year)query=query.eq("ano_letivo",year);
    if(unit)query=query.eq("unidade",unit);
    if(course)query=query.eq("curso",course);
    if(serie)query=query.eq("serie",serie);
    if(turma)query=query.eq("turma",turma);
    const {data,error}=await query.order("nome",{ascending:true});
    if(error)return json({error:"Não foi possível carregar o espelho SWeduc para preparar a estrutura Agenda Edu."},500);
    const rows=(data||[]) as Array<Record<string,unknown>>;
    const structure=buildAgendaStructure(rows);
    return json({ok:true,message:`Estrutura preparada com ${structure.counts.students} aluno(s) do espelho SWeduc. Nada foi gravado na Agenda Edu.`,filters:{year:year||null,unit:unit||null,course:course||null,serie:serie||null,turma:turma||null},...structure});
  }

  if(action==="find-agenda-student"){
    if(!await hasServerPermission(auth.supabase,"settings.integrations.edit"))return json({error:"Seu usuário não possui permissão para vincular alunos da Agenda Edu."},403);
    const studentId=Number(body.studentId);
    if(!Number.isSafeInteger(studentId)||studentId<=0)return json({error:"Selecione um aluno válido para localizar na Agenda Edu."},400);
    const {data:student,error:studentError}=await auth.supabase.from("alunos").select("id,nome,turma,segmento,sweduc_matricula_id,agenda_edu_student_id").eq("id",studentId).maybeSingle();
    if(studentError||!student)return json({error:"Aluno não encontrado no cadastro fiscal."},404);
    const {data:storedSecret,error:secretError}=await auth.supabase.rpc("get_communication_secret",{p_channel:"agenda_edu",p_backend_secret:backendSecret});
    if(secretError||!storedSecret)return json({error:"Cadastre primeiro as credenciais da Agenda Edu."},400);
    try{
      const {data:currentConfig}=await readConfig(auth.supabase);
      const environment=agendaEnvironment(currentConfig?.agenda_edu_environment);
      const credentials=parseAgendaEduCredentials(String(storedSecret));const {accessToken}=await createAgendaEduAccessToken(credentials,fetch,environment);
      const result=await searchAgendaEduStudents({accessToken,schoolToken:credentials.schoolToken,name:String(student.nome||""),className:String(student.turma||""),grade:String(student.segmento||""),externalId:student.sweduc_matricula_id?String(student.sweduc_matricula_id):null,environment});
      const best=result.candidates[0];const trustedMatches=result.candidates.filter(candidate=>candidate.score>=140);
      const autoLinked=Boolean(student.sweduc_matricula_id&&best&&best.score>=140&&trustedMatches.length===1);
      if(autoLinked){
        let updateRequest=auth.supabase.from("alunos").update({agenda_edu_student_id:best.id,agenda_edu_use_external_id:false});
        updateRequest=student.sweduc_matricula_id?updateRequest.eq("sweduc_matricula_id",student.sweduc_matricula_id):updateRequest.eq("id",studentId);
        const {error:updateError}=await updateRequest;
        if(updateError)return json({error:"Aluno encontrado na Agenda Edu, mas não foi possível salvar o vínculo."},500);
      }
      return json({ok:true,autoLinked,candidates:result.candidates,attempted:result.attempted,message:autoLinked?`Vínculo Agenda Edu salvo para ${student.nome}.`:student.sweduc_matricula_id?"Não vinculei automaticamente porque a Agenda Edu não retornou um aluno com ID externo igual à matrícula SWeduc. Confira a lista antes de salvar.":`Encontramos ${result.candidates.length} possível(is) aluno(s). Confira antes de salvar.`});
    }catch(testError){
      return json({error:testError instanceof Error?testError.message:"A Agenda Edu não permitiu localizar o aluno."},400);
    }
  }

  return json({error:"Ação de integração inválida."},400);
}
