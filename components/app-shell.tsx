"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, GraduationCap, HelpCircle, KeyRound, LogOut, Menu, ReceiptText, Search, Settings, WalletCards, X } from "lucide-react";
import { SettingsPage } from "./pages";
import { LiveDashboard, LiveStudents, LivePayments, LiveInvoices } from "./live-pages";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export type Role = "Administrador"|"Financeiro"|"Secretaria"|"Consulta";
export type AppPage = "Painel"|"Alunos e Responsáveis"|"Mensalidades"|"NFS-e"|"Configurações";
const nav: {name:AppPage; icon: typeof BarChart3; roles:Role[]}[] = [
 {name:"Painel",icon:BarChart3,roles:["Administrador","Financeiro","Secretaria","Consulta"]},
 {name:"Alunos e Responsáveis",icon:GraduationCap,roles:["Administrador","Financeiro","Secretaria","Consulta"]},
 {name:"Mensalidades",icon:WalletCards,roles:["Administrador","Financeiro","Secretaria","Consulta"]},
 {name:"NFS-e",icon:ReceiptText,roles:["Administrador","Financeiro","Consulta"]},
 {name:"Configurações",icon:Settings,roles:["Administrador"]}
];
export function AppShell({email,role,page,onPageChange,onSignOut}:{email:string;role:Role;page:AppPage;onPageChange:(p:AppPage)=>void;onSignOut:()=>void}) {
 const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);const [open,setOpen]=useState(false);const [logoLoaded,setLogoLoaded]=useState(false);const [certificateExpiry,setCertificateExpiry]=useState<string|null>(null);const [certificateLoaded,setCertificateLoaded]=useState(false); const visible=nav.filter(n=>n.roles.includes(role));
 const logoUrl=supabase?.storage.from("logos-empresa").getPublicUrl("empresa/logo").data.publicUrl;
 useEffect(()=>{if(!supabase)return;let mounted=true;const loadCertificate=async()=>{const {data}=await supabase.from("certificado_a1_alerta").select("validade").eq("id",true).maybeSingle();if(mounted){setCertificateExpiry(data?.validade||null);setCertificateLoaded(true)}};const refresh=()=>{void loadCertificate()};void loadCertificate();window.addEventListener("jpi-certificate-updated",refresh);window.addEventListener("focus",refresh);const timer=window.setInterval(refresh,60000);return()=>{mounted=false;window.removeEventListener("jpi-certificate-updated",refresh);window.removeEventListener("focus",refresh);window.clearInterval(timer)}},[supabase]);
 const certificateDays=certificateExpiry?Math.ceil((new Date(`${certificateExpiry}T23:59:59`).getTime()-Date.now())/86400000):null;const certificateUrgent=certificateDays!==null&&certificateDays<=30;
 const content = page==="Painel"?<LiveDashboard/>:page==="Alunos e Responsáveis"?<LiveStudents role={role}/>:page==="Mensalidades"?<LivePayments role={role}/>:page==="NFS-e"?<LiveInvoices role={role}/>:<SettingsPage/>;
 return <div className="app-layout"><aside className={open?"sidebar open":"sidebar"}>
  <div className="sidebar-head"><div className={`brand-seal small ${logoLoaded?"has-logo":""}`}><span>JPI</span>{logoUrl&&<img src={logoUrl} alt="Logo da empresa" onLoad={()=>setLogoLoaded(true)} onError={()=>setLogoLoaded(false)}/>}</div><div><strong>JPI Fiscal</strong><span>Gestão escolar</span></div><button className="close-mobile" onClick={()=>setOpen(false)}><X/></button></div>
  <nav><span className="nav-label">MENU PRINCIPAL</span>{visible.map(({name,icon:Icon})=><button key={name} className={page===name?"nav-item active":"nav-item"} onClick={()=>{onPageChange(name);setOpen(false)}}><Icon size={19}/>{name}</button>)}</nav>
  <div className="sidebar-foot"><button className="nav-item"><HelpCircle size={19}/>Central de ajuda</button><div className="school-badge"><BookOpen size={18}/><div><strong>João Paulo I</strong><span>Ambiente seguro</span></div></div></div>
 </aside><div className="main-area"><header className="topbar"><button className="menu-mobile" onClick={()=>setOpen(true)}><Menu/></button><div className="top-search"><Search size={18}/><span>Buscar aluno, responsável ou nota…</span></div><div className="topbar-right">{certificateLoaded&&(certificateExpiry?<div className={`certificate-top-alert ${certificateUrgent?"urgent":"safe"}`}><KeyRound/><div><strong>{certificateDays!==null&&certificateDays>=0?`${certificateDays} dias para vencer`:"Certificado vencido"}</strong><span>A1 · {new Date(`${certificateExpiry}T12:00:00`).toLocaleDateString("pt-BR")}</span></div></div>:<div className="certificate-top-alert urgent"><KeyRound/><div><strong>Certificado não cadastrado</strong><span>Solicite ao Administrador</span></div></div>)}<div className="user-menu"><div className="avatar">{email[0].toUpperCase()}</div><div className="user-copy"><strong>{email.split("@")[0]}</strong><span>{role}</span></div><button className="logout" onClick={onSignOut} title="Sair"><LogOut size={18}/></button></div></div></header>
 <main className="content">{content}</main><footer>Sistema JPI Fiscal · Emissão fiscal real permanece desativada até homologação</footer></div></div>;
}
