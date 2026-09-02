"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { BrandLogo } from "./branding";

export function Login({ onSignIn, onResetPassword, configured, externalError="", externalMessage="" }: { onSignIn: (email: string, password: string, remember: boolean) => Promise<void>; onResetPassword:(email:string)=>Promise<void>; configured: boolean; externalError?:string; externalMessage?:string }) {
  const [email, setEmail] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem("jpi-remembered-email") ?? "");
  const [password, setPassword] = useState(""); const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [resetBusy,setResetBusy]=useState(false);const [resetMessage,setResetMessage]=useState("");
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { await onSignIn(email, password, remember); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível entrar."); } finally { setBusy(false); } }
  async function resetPassword(){setError("");setResetMessage("");if(!email||!email.includes("@")){setError("Informe seu e-mail cadastrado para recuperar a senha.");return}setResetBusy(true);try{await onResetPassword(email);setResetMessage("Enviamos um novo link de recuperação para seu e-mail. Use o link mais recente para criar uma nova senha no JPI Fiscal.")}catch(err){setError(err instanceof Error?err.message:"Não foi possível enviar o link.")}finally{setResetBusy(false)}}
  return <main className="login-page">
    <section className="login-brand"><div><BrandLogo/><h1>JPI Fiscal</h1><p>Gestão escolar e fiscal em um só lugar.</p></div><small>Jardim Escola João Paulo I</small></section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}>
      <div className="mobile-brand"><BrandLogo small/><strong>JPI Fiscal</strong></div>
      <div><span className="eyebrow">ACESSO SEGURO</span><h2>Bem-vindo de volta</h2><p className="muted">Entre com seu e-mail e senha para continuar.</p></div>
      <label>E-mail<div className="input-wrap"><Mail size={18}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" required autoComplete="email"/></div></label>
      <label>Senha<div className="input-wrap"><LockKeyhole size={18}/><input type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" required={configured} autoComplete="current-password"/><button type="button" className="icon-button" onClick={()=>setShow(!show)} aria-label="Mostrar senha">{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
      <div className="login-options"><label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Lembrar meu e-mail</label><button type="button" className="forgot-password" onClick={resetPassword} disabled={resetBusy}>{resetBusy?"Enviando…":"Esqueci minha senha"}</button></div>
      {(error||externalError) && <div className="error-box">{error||externalError}</div>}
      {externalMessage&&<div className="success-box">{externalMessage}</div>}
      {resetMessage&&<div className="success-box">{resetMessage}</div>}
      {!configured && <div className="demo-box">Ambiente de apresentação: use qualquer e-mail para visualizar o sistema.</div>}
      <button className="primary full" disabled={busy}>{busy?"Entrando…":"Entrar no sistema"}</button>
      <p className="privacy">Seus dados são tratados com segurança e conforme a LGPD.</p>
    </form></section>
  </main>;
}

export function InviteConfirm({onContinue,onCancel}:{onContinue:()=>Promise<void>;onCancel:()=>void}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function proceed(){if(busy)return;setBusy(true);setError("");try{await onContinue()}catch(err){setError(err instanceof Error?err.message:"Não foi possível validar o convite.");setBusy(false)}}
  return <main className="login-page recovery-confirm-page">
    <section className="login-brand"><div><BrandLogo/><h1>JPI Fiscal</h1><p>Seu acesso começa aqui.</p></div><small>Jardim Escola João Paulo I</small></section>
    <section className="login-panel"><div className="login-card recovery-confirm-card">
      <div className="recovery-security-icon"><UserPlus/></div>
      <div><span className="eyebrow">CONVITE DE ACESSO</span><h2>Aceite seu convite</h2><p className="muted">Confirme o convite para iniciar seu cadastro. Na próxima etapa, você criará sua senha pessoal de acesso ao JPI Fiscal.</p></div>
      <div className="notice compact"><ShieldCheck/><span>Este link é pessoal e de uso único. Nunca compartilhe o convite ou a senha criada.</span></div>
      {error&&<div className="error-box">{error}</div>}
      <button type="button" className="primary full recovery-continue" disabled={busy} onClick={proceed}>{busy?"Confirmando convite…":<>Aceitar convite <ArrowRight size={18}/></>}</button>
      <button type="button" className="recovery-back-link recovery-back-button" onClick={onCancel}>Voltar para o acesso ao sistema</button>
    </div></section>
  </main>;
}

export function RecoveryConfirm({onContinue,onCancel}:{onContinue:()=>Promise<void>;onCancel:()=>void}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function proceed(){if(busy)return;setBusy(true);setError("");try{await onContinue()}catch(err){setError(err instanceof Error?err.message:"Não foi possível validar o link de recuperação.");setBusy(false)}}
  return <main className="login-page recovery-confirm-page">
    <section className="login-brand"><div><BrandLogo/><h1>JPI Fiscal</h1><p>Recuperação segura de acesso.</p></div><small>Jardim Escola João Paulo I</small></section>
    <section className="login-panel"><div className="login-card recovery-confirm-card">
      <div className="recovery-security-icon"><KeyRound/></div>
      <div><span className="eyebrow">RECUPERAÇÃO DE SENHA</span><h2>Confirme para continuar</h2><p className="muted">Por segurança, o link só será validado quando você clicar no botão abaixo. Depois, você poderá criar uma nova senha.</p></div>
      <div className="notice compact"><ShieldCheck/><span>Use somente o e-mail de recuperação mais recente. Cada link é de uso único e pode expirar.</span></div>
      {error&&<div className="error-box">{error}</div>}
      <button type="button" className="primary full recovery-continue" disabled={busy} onClick={proceed}>{busy?"Validando link…":<>Continuar recuperação <ArrowRight size={18}/></>}</button>
      <button type="button" className="recovery-back-link recovery-back-button" onClick={onCancel}>Voltar para o acesso ao sistema</button>
    </div></section>
  </main>;
}

export function SetPassword({onSave,recovery=false}:{onSave:(password:string)=>Promise<void>;recovery?:boolean}){const [password,setPassword]=useState("");const [confirm,setConfirm]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");async function submit(e:FormEvent){e.preventDefault();if(password.length<8){setError("A senha deve ter pelo menos 8 caracteres.");return}if(password!==confirm){setError("As senhas não são iguais.");return}setBusy(true);setError("");try{await onSave(password)}catch(err){setError(err instanceof Error?err.message:"Não foi possível definir a senha.")}finally{setBusy(false)}}return <main className="login-page"><section className="login-brand"><div><BrandLogo/><h1>JPI Fiscal</h1><p>{recovery?"Recuperação segura de acesso.":"Primeiro acesso seguro."}</p></div><small>Jardim Escola João Paulo I</small></section><section className="login-panel"><form className="login-card" onSubmit={submit}><div><span className="eyebrow">{recovery?"RECUPERAÇÃO DE SENHA":"PRIMEIRO ACESSO"}</span><h2>{recovery?"Crie uma nova senha":"Defina sua senha"}</h2><p className="muted">{recovery?"Este link é de uso único. Crie sua nova senha para recuperar o acesso ao JPI Fiscal.":"Use uma senha pessoal com pelo menos 8 caracteres."}</p></div><label>Nova senha<div className="input-wrap"><LockKeyhole size={18}/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required autoComplete="new-password"/></div></label><label>Confirmar senha<div className="input-wrap"><LockKeyhole size={18}/><input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} required autoComplete="new-password"/></div></label>{error&&<div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy?"Salvando…":recovery?"Salvar nova senha":"Criar minha senha"}</button></form></section></main>}
