"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { LGPD_TERM_TEXT, LGPD_TERM_TITLE, LGPD_TERM_VERSION } from "@/lib/lgpd-consent";
import { BrandLogo } from "./branding";

type Status = "checking" | "accepted" | "pending";

export function LgpdConsentGate({accessToken,role,email}:{accessToken:string|null;role:string;email:string}) {
  const [status,setStatus]=useState<Status>("checking");
  const [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    if(!accessToken){setStatus("accepted");return}
    try{
      const response=await authenticatedFetch("/api/lgpd/acceptance",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {accepted?:boolean};
      if(response.status===401){window.dispatchEvent(new Event("jpi-session-invalid"));return}
      setStatus(response.ok&&data.accepted?"accepted":"pending");
    }catch{
      setStatus("pending");
      setError("Não foi possível confirmar seu aceite agora. Leia e registre para continuar.");
    }
  },[accessToken]);
  useEffect(()=>{void load()},[load]);
  async function accept(){
    if(!accessToken||!checked)return;
    setBusy(true);setError("");
    try{
      const response=await authenticatedFetch("/api/lgpd/acceptance",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({confirmed:true,role}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {error?:string};
      if(response.status===401){window.dispatchEvent(new Event("jpi-session-invalid"));return}
      if(!response.ok)throw new Error(data.error||"Não foi possível registrar o aceite.");
      setStatus("accepted");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Não foi possível registrar o aceite.");
    }finally{setBusy(false)}
  }
  if(status==="accepted")return null;
  return <div className="lgpd-gate" role="dialog" aria-modal="true" aria-labelledby="lgpd-title">
    <div className="lgpd-card">
      <div className="lgpd-brand"><BrandLogo/><div><strong>JPI Fiscal</strong><span>Ambiente seguro de gestão fiscal escolar</span></div></div>
      <div className="lgpd-header"><div className="lgpd-seal"><ShieldCheck/></div><div><span>Primeiro acesso obrigatório</span><h2 id="lgpd-title">{LGPD_TERM_TITLE}</h2><p>Leia e confirme para liberar o uso do sistema neste usuário.</p></div></div>
      <div className="lgpd-user"><LockKeyhole size={18}/><div><strong>{email}</strong><span>Perfil: {role} · Versão {LGPD_TERM_VERSION}</span></div></div>
      <div className="lgpd-text">{LGPD_TERM_TEXT.split("\n\n").map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
      {error&&<div className="error-box">{error}</div>}
      <label className="lgpd-check"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)}/><span>Li, entendi e concordo com o uso responsável, LGPD e sigilo dos dados do sistema.</span></label>
      <div className="lgpd-actions"><button className="primary" disabled={!checked||busy||status==="checking"} onClick={accept}><CheckCircle2 size={18}/>{busy?"Registrando…":status==="checking"?"Verificando…":"Concordo e continuar"}</button></div>
    </div>
  </div>;
}
