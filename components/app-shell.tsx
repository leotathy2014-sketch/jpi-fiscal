"use client";
import { useState } from "react";
import { BarChart3, BookOpen, GraduationCap, HelpCircle, LogOut, Menu, ReceiptText, Search, Settings, WalletCards, X } from "lucide-react";
import { SettingsPage } from "./pages";
import { LiveDashboard, LiveStudents, LivePayments, LiveInvoices } from "./live-pages";

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
 const [open,setOpen]=useState(false); const visible=nav.filter(n=>n.roles.includes(role));
 const content = page==="Painel"?<LiveDashboard/>:page==="Alunos e Responsáveis"?<LiveStudents role={role}/>:page==="Mensalidades"?<LivePayments role={role}/>:page==="NFS-e"?<LiveInvoices role={role}/>:<SettingsPage/>;
 return <div className="app-layout"><aside className={open?"sidebar open":"sidebar"}>
  <div className="sidebar-head"><div className="brand-seal small">JPI</div><div><strong>JPI Fiscal</strong><span>Gestão escolar</span></div><button className="close-mobile" onClick={()=>setOpen(false)}><X/></button></div>
  <nav><span className="nav-label">MENU PRINCIPAL</span>{visible.map(({name,icon:Icon})=><button key={name} className={page===name?"nav-item active":"nav-item"} onClick={()=>{onPageChange(name);setOpen(false)}}><Icon size={19}/>{name}</button>)}</nav>
  <div className="sidebar-foot"><button className="nav-item"><HelpCircle size={19}/>Central de ajuda</button><div className="school-badge"><BookOpen size={18}/><div><strong>João Paulo I</strong><span>Ambiente seguro</span></div></div></div>
 </aside><div className="main-area"><header className="topbar"><button className="menu-mobile" onClick={()=>setOpen(true)}><Menu/></button><div className="top-search"><Search size={18}/><span>Buscar aluno, responsável ou nota…</span></div><div className="user-menu"><div className="avatar">{email[0].toUpperCase()}</div><div className="user-copy"><strong>{email.split("@")[0]}</strong><span>{role}</span></div><button className="logout" onClick={onSignOut} title="Sair"><LogOut size={18}/></button></div></header>
 <main className="content">{content}</main><footer>Sistema JPI Fiscal · Emissão fiscal real permanece desativada até homologação</footer></div></div>;
}
