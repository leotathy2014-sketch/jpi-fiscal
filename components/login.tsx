"use client";
import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

export function Login({ onSignIn, configured }: { onSignIn: (email: string, password: string, remember: boolean) => Promise<void>; configured: boolean }) {
  const [email, setEmail] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem("jpi-remembered-email") ?? "");
  const [password, setPassword] = useState(""); const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { await onSignIn(email, password, remember); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível entrar."); } finally { setBusy(false); } }
  return <main className="login-page">
    <section className="login-brand"><div><div className="brand-seal">JPI</div><h1>JPI Fiscal</h1><p>Gestão escolar e fiscal em um só lugar.</p></div><small>Jardim Escola João Paulo I</small></section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}>
      <div className="mobile-brand"><div className="brand-seal small">JPI</div><strong>JPI Fiscal</strong></div>
      <div><span className="eyebrow">ACESSO SEGURO</span><h2>Bem-vindo de volta</h2><p className="muted">Entre com seu e-mail e senha para continuar.</p></div>
      <label>E-mail<div className="input-wrap"><Mail size={18}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" required autoComplete="email"/></div></label>
      <label>Senha<div className="input-wrap"><LockKeyhole size={18}/><input type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" required={configured} autoComplete="current-password"/><button type="button" className="icon-button" onClick={()=>setShow(!show)} aria-label="Mostrar senha">{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
      <div className="login-options"><label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Lembrar meu e-mail</label><span>Sessão protegida</span></div>
      {error && <div className="error-box">{error}</div>}
      {!configured && <div className="demo-box">Ambiente de apresentação: use qualquer e-mail para visualizar o sistema.</div>}
      <button className="primary full" disabled={busy}>{busy?"Entrando…":"Entrar no sistema"}</button>
      <p className="privacy">Seus dados são tratados com segurança e conforme a LGPD.</p>
    </form></section>
  </main>;
}
