"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/branding";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export default function PasswordRecoveryPage(){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [tokenHash,setTokenHash]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    const url=new URL(window.location.href);
    const token=String(url.searchParams.get("token_hash")||"").trim();
    if(token.length>=20&&token.length<=512)setTokenHash(token);
    else setError("Este link de recuperação é inválido ou está incompleto. Solicite um novo link na tela de acesso.");
  },[]);

  async function continueRecovery(){
    if(!supabase||!tokenHash||busy)return;
    setBusy(true);setError("");
    try{
      const result=await supabase.auth.verifyOtp({token_hash:tokenHash,type:"recovery"} as never);
      if(result.error)throw new Error("Este link expirou ou já foi utilizado. Solicite um novo link em “Esqueci minha senha”.");
      window.location.replace("/?recovery=1");
    }catch(err){
      setError(err instanceof Error?err.message:"Não foi possível validar o link de recuperação.");
      setBusy(false);
    }
  }

  return <main className="login-page recovery-confirm-page">
    <section className="login-brand">
      <div><BrandLogo/><h1>JPI Fiscal</h1><p>Recuperação segura de acesso.</p></div>
      <small>Jardim Escola João Paulo I</small>
    </section>
    <section className="login-panel">
      <div className="login-card recovery-confirm-card">
        <div className="recovery-security-icon"><KeyRound/></div>
        <div>
          <span className="eyebrow">RECUPERAÇÃO DE SENHA</span>
          <h2>Confirme para continuar</h2>
          <p className="muted">Por segurança, o link só será validado quando você clicar no botão abaixo. Depois, você poderá criar uma nova senha.</p>
        </div>
        <div className="notice compact"><ShieldCheck/><span>Use somente o e-mail de recuperação mais recente. Cada link é de uso único e pode expirar.</span></div>
        {error&&<div className="error-box">{error}</div>}
        <button type="button" className="primary full recovery-continue" disabled={busy||!tokenHash} onClick={continueRecovery}>
          {busy?"Validando link…":<>Continuar recuperação <ArrowRight size={18}/></>}
        </button>
        <a className="recovery-back-link" href="/">Voltar para o acesso ao sistema</a>
      </div>
    </section>
  </main>;
}
