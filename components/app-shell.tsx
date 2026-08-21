"use client";
import { useState } from "react";
import { BarChart3, BookOpen, ChevronDown, FileText, GraduationCap, HelpCircle, LogOut, Menu, ReceiptText, Search, Settings, Users, WalletCards, X } from "lucide-react";
import { Dashboard, Students, Payments, Invoices, SettingsPage } from "./pages";

export type Role = "Administrador"|"Financeiro"|"Secretaria"|"Consulta";
export type AppPage = "Painel"|"Alunos e Responsáveis"|"Mensalidades"|"NFS-e"|"Configurações";
const nav: {name:AppPage; icon: typeof BarChart3; roles:Role[]}[] = [
 {name:"Painel",icon:BarChart3,roles:["Administrador","Financeiro","Secretaria","Consulta"]},
 {name:"Alunos e Responsáveis",icon:GraduationCap,roles:["Administrador","Financeiro","Secretaria","Consulta"]},
 {name:"Mensalidades",icon:WalletCards,roles:["Administrador","Financeiro","Secretaria","Consulta"]},
 {name:"NFS-e",icon:ReceiptText,roles:["Administrador","Financeiro","Consulta"]},
 {name:"Configurações",icon:Settings,roles:["Administrador"]}
];
export function AppShell({email,role,onRoleChange,page,onPageChange,onSignOut}:{email:string;role:Role;onRoleChange:(r:Role)=>void;page:AppPage;onPageChange:(p:AppPage)=>void;onSignOut:()=>void}) {
 const [open,setOpen]=useState(false); const visible=nav.filter(n=>n.roles.includes(role));
 const content = page==="Painel"?<Dashboard/>:page==="Alunos e Responsáveis"?<Students role={role}/>:page==="Mensalidades"?<Payments role={role}/>:page==="NFS-e"?<Invoices role={role}/>:<SettingsPage/>;
 return <div className="app-layout"><aside className={open?"sidebar open":"sidebar"}>
  <div className="sidebar-head"><div className="brand-seal small">JPI</div><div><strong>JPI Fiscal</strong><span>Gestão escolar</span></div><button className="close-mobile" onClick={()=>setOpen(false)}><X/></button></div>
  <nav><span className="nav-label">MENU PRINCIPAL</span>{visible.map(({name,icon:Icon})=><button key={name} className={page===name?"nav-item active":"nav-item"} onClick={()=>{onPageChange(name);setOpen(false)}}><Icon size={19}/>{name}</button>)}</nav>
  <div className="sidebar-foot"><button className="nav-item"><HelpCircle size={19}/>Central de ajuda</button><div className="school-badge"><BookOpen size={18}/><div><strong>João Paulo I</strong><span>Ambiente seguro</span></div></div></div>
 </aside><div className="main-area"><header className="topbar"><button className="menu-mobile" onClick={()=>setOpen(true)}><Menu/></button><div className="top-search"><Search size={18}/><span>Buscar aluno, responsável ou nota…</span></div><div className="user-menu"><div className="avatar">{email[0].toUpperCase()}</div><div className="user-copy"><strong>{email.split("@")[0]}</strong><select value={role} onChange={e=>{const next=e.target.value as Role;onRoleChange(next);if(next!=="Administrador"&&page==="Configurações")onPageChange("Painel")}} aria-label="Nível de acesso">{(["Administrador","Financeiro","Secretaria","Consulta"] as Role[]).map(r=><option key={r}>{r}</option>)}</select></div><ChevronDown size={16}/><button className="logout" onClick={onSignOut} title="Sair"><LogOut size={18}/></button></div></header>
 <main className="content">{content}</main><footer>Sistema JPI Fiscal · Emissão fiscal real permanece desativada até homologação</footer></div></div>;
}
