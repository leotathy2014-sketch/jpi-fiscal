"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, Eye, FileText, GraduationCap, HelpCircle, KeyRound, LogOut, MailCheck, Menu, ReceiptText, RefreshCw, Search, Settings, Sparkles, WalletCards, X } from "lucide-react";
import { SettingsPage } from "./pages";
import { LiveDashboard, LiveStudents, LivePayments, LiveInvoices } from "./live-pages";
import { HelpPage } from "./help-page";
import { DeliveryCenter } from "./delivery-center";
import { IssuanceAssistant } from "./issuance-assistant";
import { DeclarationsPage } from "./declarations-page";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { BrandLogo } from "./branding";
import { useAccess } from "./access";
import { LgpdConsentGate } from "./lgpd-consent-gate";
import { prioritizeSweducAcademicYears } from "@/lib/sweduc-years";

export type Role = "Master"|"Administrador"|"Financeiro"|"Secretaria"|"Consulta";
export type AppPage = "Painel"|"Alunos e Responsáveis"|"Mensalidades"|"Declarações"|"Assistente de emissão"|"NFS-e"|"Ajustes NFS-e"|"Enviar notas"|"Configurações"|"Ajuda";
type SefinAvailability = "checking"|"available"|"unstable"|"unavailable"|"unknown"|"session";
const nav: {name:AppPage; icon: typeof BarChart3; permissions:string[]}[] = [
 {name:"Painel",icon:BarChart3,permissions:["dashboard.view"]},
 {name:"Alunos e Responsáveis",icon:GraduationCap,permissions:["students.view"]},
 {name:"Mensalidades",icon:WalletCards,permissions:["payments.view"]},
 {name:"Declarações",icon:FileText,permissions:["declarations.view"]},
 {name:"Assistente de emissão",icon:Sparkles,permissions:["nfse.view"]},
 {name:"NFS-e",icon:ReceiptText,permissions:["nfse.view"]},
 {name:"Ajustes NFS-e",icon:RefreshCw,permissions:["nfse.view"]},
 {name:"Enviar notas",icon:MailCheck,permissions:["deliveries.view"]},
 {name:"Configurações",icon:Settings,permissions:["settings.company.view","settings.company.edit","settings.branding.view","settings.branding.edit","settings.certificate.view","settings.certificate.manage","settings.integrations.view","settings.integrations.edit","settings.users.view","settings.users.manage","declarations.manage","system.announcements.send"]}
];
export function AppShell({email,accessToken,role,page,onPageChange,onSignOut,previewUser,onEndPreview}:{email:string;accessToken:string|null;role:Role;page:AppPage;onPageChange:(p:AppPage)=>void;onSignOut:()=>void;previewUser?:{name:string;email:string;role:Role;permissions:string[]}|null;onEndPreview?:()=>void}) {
 const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);const {can,canAny}=useAccess();const [open,setOpen]=useState(false);const [displayName,setDisplayName]=useState("");const [certificateExpiry,setCertificateExpiry]=useState<string|null>(null);const [certificateLoaded,setCertificateLoaded]=useState(false);const [sefinStatus,setSefinStatus]=useState<SefinAvailability>("checking");const [sefinCheckedAt,setSefinCheckedAt]=useState<Date|null>(null);const [productionEnabled,setProductionEnabled]=useState(false); const visible=nav.filter(n=>canAny(n.permissions));
 useEffect(()=>{if(previewUser){setDisplayName(previewUser.name);return}if(!supabase)return;let mounted=true;const loadUserName=async()=>{const {data}=await supabase.from("app_users").select("nome").eq("email",email.toLowerCase()).maybeSingle();if(mounted)setDisplayName(String(data?.nome||""))};void loadUserName();return()=>{mounted=false}},[supabase,email,previewUser]);
 useEffect(()=>{if(!accessToken||!can("system.status.view"))return;let mounted=true;const loadSystemStatus=async()=>{try{const response=await authenticatedFetch("/api/system/status",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});const data=await response.json().catch(()=>({})) as {certificateExpiry?:string|null;productionEnabled?:boolean};if(!mounted)return;if(response.ok){setCertificateExpiry(data.certificateExpiry||null);setProductionEnabled(data.productionEnabled===true)}}finally{if(mounted)setCertificateLoaded(true)}};const refresh=()=>{void loadSystemStatus()};void loadSystemStatus();window.addEventListener("jpi-certificate-updated",refresh);window.addEventListener("jpi-nfse-production-updated",refresh);window.addEventListener("focus",refresh);const timer=window.setInterval(refresh,60000);return()=>{mounted=false;window.removeEventListener("jpi-certificate-updated",refresh);window.removeEventListener("jpi-nfse-production-updated",refresh);window.removeEventListener("focus",refresh);window.clearInterval(timer)}},[accessToken,can]);
 useEffect(()=>{
  if(!accessToken||!canAny(["students.view","payments.create","nfse.prepare","settings.integrations.view","declarations.view"]))return;
  let cancelled=false;
  const preload=async()=>{
   if(cancelled)return;
   try{
    const configResponse=await authenticatedFetch("/api/integrations/sweduc",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
    const config=await configResponse.json().catch(()=>({})) as {syncYears?:number[];syncUnits?:string[];selectedAcademicYear?:number;config?:{credencial_configurada?:boolean};error?:string};
    if(cancelled||!configResponse.ok||!config.config?.credencial_configurada)return;
    const years=prioritizeSweducAcademicYears(config.syncYears||[],config.selectedAcademicYear);
    if(!years.length)return;
    const key=`jpi-sweduc-login-preload-v2:${config.selectedAcademicYear||"auto"}:${years.join(",")}`;
    const now=Date.now();const last=Number(localStorage.getItem(key)||"0");
    if(last&&now-last<2*60*60*1000)return;
    for(const [index,year] of years.entries()){
     let page=1;let pages=0;let completed=true;
     while(!cancelled&&page&&pages<1000){
      pages++;
      const response=await authenticatedFetch("/api/integrations/sweduc",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"sync",academicYear:year,page,syncUnits:config.syncUnits||[]}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {nextPage?:number|null};
      if(!response.ok){completed=false;break}
      page=Number(data.nextPage||0);
     }
     if(cancelled)return;
     if(!completed||page)return;
     if(index===0||index===years.length-1)window.dispatchEvent(new Event("jpi-sweduc-preloaded"));
    }
    if(!cancelled)localStorage.setItem(key,String(Date.now()));
   }catch{}
  };
  void preload();
  return()=>{cancelled=true};
 },[accessToken,canAny]);
 useEffect(()=>{if(!accessToken)return;let mounted=true;let inFlight=false;let lastCheck=0;const checkSefin=async()=>{if(inFlight||document.visibilityState==="hidden")return;inFlight=true;if(lastCheck===0)setSefinStatus("checking");try{const response=await authenticatedFetch("/api/nfse/homologation/test",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"server-status"}),cache:"no-store"});const data=await response.json().catch(()=>({})) as {ready?:boolean;diagnosticCode?:string};if(!mounted)return;if(response.status===401){setSefinStatus("session");window.dispatchEvent(new Event("jpi-session-invalid"));return}if(!response.ok)setSefinStatus(data.diagnosticCode==="NFSE_HML_SERVIDOR_INSTAVEL"?"unstable":"unknown");else setSefinStatus(data.ready?"available":"unstable")}catch{if(mounted)setSefinStatus("unknown")}finally{lastCheck=Date.now();inFlight=false;if(mounted)setSefinCheckedAt(new Date())}};const refresh=()=>{if(Date.now()-lastCheck>120000)void checkSefin()};const refreshNow=()=>void checkSefin();void checkSefin();const timer=window.setInterval(()=>void checkSefin(),300000);window.addEventListener("focus",refresh);window.addEventListener("online",refresh);window.addEventListener("jpi-sefin-status-updated",refreshNow);return()=>{mounted=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);window.removeEventListener("jpi-sefin-status-updated",refreshNow)}},[accessToken,can]);
 const certificateDays=certificateExpiry?Math.ceil((new Date(`${certificateExpiry}T23:59:59`).getTime()-Date.now())/86400000):null;const certificateUrgent=certificateDays!==null&&certificateDays<=30;const greetingHour=new Date().getHours();const greeting=greetingHour<12?"Bom dia":greetingHour<18?"Boa tarde":"Boa noite";const nameParticles=new Set(["da","das","de","do","dos","e"]);const greetingName=(displayName||email.split("@")[0]).split(/\s+/).filter(Boolean).map((part,index)=>{const normalized=part.toLocaleLowerCase("pt-BR");return index>0&&nameParticles.has(normalized)?normalized:normalized.charAt(0).toLocaleUpperCase("pt-BR")+normalized.slice(1)}).join(" ");
 const sefinCopy=sefinStatus==="available"?{title:"SEFIN disponível",detail:productionEnabled?"Pronto e enviando":"API fiscal confirmada"}:sefinStatus==="unstable"?{title:"SEFIN com oscilação",detail:"Teste novamente antes de enviar"}:sefinStatus==="unavailable"?{title:"SEFIN indisponível",detail:"Falha confirmada da API"}:sefinStatus==="session"?{title:"Sessão expirada",detail:"Entre novamente"}:sefinStatus==="unknown"?{title:"SEFIN não confirmado",detail:"Nova verificação em andamento"}:{title:"SEFIN verificando",detail:"Consultando API de emissão"};
 const sefinTone=sefinStatus==="available"?"available":sefinStatus==="unstable"?"unstable":sefinStatus==="unavailable"||sefinStatus==="session"?"unavailable":sefinStatus==="unknown"?"unknown":"checking";
 const content = page==="Painel"?<LiveDashboard/>:page==="Alunos e Responsáveis"?<LiveStudents role={role} onNavigate={onPageChange}/>:page==="Mensalidades"?<LivePayments role={role}/>:page==="Declarações"?<DeclarationsPage accessToken={accessToken}/>:page==="Assistente de emissão"?<IssuanceAssistant onNavigate={onPageChange}/>:page==="NFS-e"?<LiveInvoices role={role} onNavigate={onPageChange}/>:page==="Ajustes NFS-e"?<LiveInvoices role={role} onNavigate={onPageChange} adjustmentsOnly/>:page==="Enviar notas"?<DeliveryCenter role={role} accessToken={accessToken} onNavigate={onPageChange}/>:page==="Ajuda"?<HelpPage onNavigate={onPageChange}/>:<SettingsPage accessToken={accessToken} onNavigate={onPageChange}/>;
 return <div className={`app-layout${previewUser?" user-preview-active":""}`}>{!previewUser&&<LgpdConsentGate accessToken={accessToken} role={role} email={email}/>}<aside className={open?"sidebar open":"sidebar"}>
  <div className="sidebar-head"><BrandLogo small/><div><strong>JPI Fiscal</strong><span>Gestão escolar</span></div><button className="close-mobile" onClick={()=>setOpen(false)}><X/></button></div>
  <nav><span className="nav-label">MENU PRINCIPAL</span>{visible.map(({name,icon:Icon})=><button key={name} className={page===name?"nav-item active":"nav-item"} onClick={()=>{onPageChange(name);setOpen(false)}}><Icon size={19}/>{name}</button>)}</nav>
  <div className="sidebar-foot"><button className={page==="Ajuda"?"nav-item active":"nav-item"} onClick={()=>{onPageChange("Ajuda");setOpen(false)}}><HelpCircle size={19}/>Central de ajuda</button><div className="school-badge"><BookOpen size={18}/><div><strong>João Paulo I</strong><span>Ambiente seguro</span></div></div></div>
 </aside><div className="main-area"><header className="topbar"><button className="menu-mobile" onClick={()=>setOpen(true)}><Menu/></button><div className="top-search top-greeting"><Search size={18}/><span>{greeting}, <strong>{greetingName}</strong></span></div><div className="topbar-right">{can("system.status.view")&&<div className={`sefin-top-status ${sefinTone}`} role="status" aria-live="polite" title={sefinCheckedAt?`Última verificação: ${sefinCheckedAt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`:"Verificando o servidor da SEFIN"}><span className="sefin-status-dot" aria-hidden="true"/><div><strong>{sefinCopy.title}</strong><span>{sefinCopy.detail}</span></div></div>}{can("system.status.view")&&certificateLoaded&&(certificateExpiry?<div className={`certificate-top-alert ${certificateUrgent?"urgent":"safe"}`}><KeyRound/><div><strong>{certificateDays!==null&&certificateDays>=0?`${certificateDays} dias para vencer`:"Certificado vencido"}</strong><span>A1 · {new Date(`${certificateExpiry}T12:00:00`).toLocaleDateString("pt-BR")}</span></div></div>:<div className="certificate-top-alert urgent"><KeyRound/><div><strong>Certificado não cadastrado</strong><span>Solicite ao Administrador</span></div></div>)}<div className="user-menu"><div className="avatar">{greetingName.charAt(0).toUpperCase()}</div><div className="user-copy"><strong>{greetingName}</strong><span>{role}</span></div><button className="logout" onClick={previewUser?onEndPreview:onSignOut} title={previewUser?"Sair da prévia":"Sair"}>{previewUser?<X size={18}/>:<LogOut size={18}/>}</button></div></div></header>{previewUser&&<div className="user-preview-banner"><Eye/><span><strong>Visualizando e testando como {previewUser.name}</strong><small>Perfil {role} · ações seguem as permissões do perfil e ficam registradas na sessão do Master</small></span><button type="button" onClick={onEndPreview}>Encerrar prévia</button></div>}
 <main className="content">{content}</main><footer>{productionEnabled?"Sistema JPI Fiscal · Emissão fiscal real habilitada e operacional":"Sistema JPI Fiscal · Ambiente fiscal protegido"}</footer></div></div>;
}


