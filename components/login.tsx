"use client";
import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

function CompanyLogo({ small = false }: { small?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const logoUrl = supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/logos-empresa/empresa/logo` : null;

  return <div className={`brand-seal${small ? " small" : ""}${loaded ? " has-logo" : ""}`}>
    <span>JPI</span>
    {logoUrl ? <img src={logoUrl} alt="Logo da empresa" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)}/> : null}
  </div>;
}

export function Login({ onSignIn, onResetPassword, configured, externalError="" }: { onSignIn: (email: string, password: string, remember: boolean) => Promise<void>; onResetPassword:(email:string)=>Promise<void>; configured: boolean; externalError?:string }) {
  const [email, setEmail] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem("jpi-remembered-email") ?? "");
  const [password, setPassword] = useState(""); const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [resetBusy,setResetBusy]=useState(false);const [resetMessage,setResetMessage]=useState("");
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { await onSignIn(email, password, remember); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível entrar."); } finally { setBusy(false); } }
  async function resetPassword(){setError("");setResetMessage("");if(!email||!email.includes("@")){setError("Informe seu e-mail cadastrado para recuperar a senha.");return}setResetBusy(true);try{await onResetPassword(email);setResetMessage("Enviamos um link de recuperação para seu e-mail.")}catch(err){setError(err instanceof Error?err.message:"Não foi possível enviar o link.")}finally{setResetBusy(false)}}
  return <main className="login-page">
    <section className="login-brand"><div><CompanyLogo/><h1>JPI Fiscal</h1><p>Gestão escolar e fiscal em um só lugar.</p></div><small>Jardim Escola João Paulo I</small></section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}>
      <div className="mobile-brand"><CompanyLogo small/><strong>JPI Fiscal</strong></div>
      <div><span className="eyebrow">ACESSO SEGURO</span><h2>Bem-vindo de volta</h2><p className="muted">Entre com seu e-mail e senha para continuar.</p></div>
      <label>E-mail<div className="input-wrap"><Mail size={18}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" required autoComplete="email"/></div></label>
      <label>Senha<div className="input-wrap"><LockKeyhole size={18}/><input type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" required={configured} autoComplete="current-password"/><button type="button" className="icon-button" onClick={()=>setShow(!show)} aria-label="Mostrar senha">{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
      <div className="login-options"><label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Lembrar meu e-mail</label><button type="button" className="forgot-password" onClick={resetPassword} disabled={resetBusy}>{resetBusy?"Enviando…":"Esqueci minha senha"}</button></div>
      {(error||externalError) && <div className="error-box">{error||externalError}</div>}
      {resetMessage&&<div className="success-box">{resetMessage}</div>}
      {!configured && <div className="demo-box">Ambiente de apresentação: use qualquer e-mail para visualizar o sistema.</div>}
      <button className="primary full" disabled={busy}>{busy?"Entrando…":"Entrar no sistema"}</button>
      <p className="privacy">Seus dados são tratados com segurança e conforme a LGPD.</p>
    </form></section>
  </main>;
}

export function SetPassword({onSave,recovery=false}:{onSave:(password:string)=>Promise<void>;recovery?:boolean}){const [password,setPassword]=useState("");const [confirm,setConfirm]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");async function submit(e:FormEvent){e.preventDefault();if(password.length<8){setError("A senha deve ter pelo menos 8 caracteres.");return}if(password!==confirm){setError("As senhas não são iguais.");return}setBusy(true);setError("");try{await onSave(password)}catch(err){setError(err instanceof Error?err.message:"Não foi possível definir a senha.")}finally{setBusy(false)}}return <main className="login-page"><section className="login-brand"><div><CompanyLogo/><h1>JPI Fiscal</h1><p>{recovery?"Recuperação segura de acesso.":"Primeiro acesso seguro."}</p></div><small>Jardim Escola João Paulo I</small></section><section className="login-panel"><form className="login-card" onSubmit={submit}><div><span className="eyebrow">{recovery?"RECUPERAÇÃO DE SENHA":"PRIMEIRO ACESSO"}</span><h2>{recovery?"Crie uma nova senha":"Defina sua senha"}</h2><p className="muted">Use uma senha pessoal com pelo menos 8 caracteres.</p></div><label>Nova senha<div className="input-wrap"><LockKeyhole size={18}/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required autoComplete="new-password"/></div></label><label>Confirmar senha<div className="input-wrap"><LockKeyhole size={18}/><input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} required autoComplete="new-password"/></div></label>{error&&<div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy?"Salvando…":recovery?"Salvar nova senha":"Salvar senha e entrar"}</button></form></section></main>}
