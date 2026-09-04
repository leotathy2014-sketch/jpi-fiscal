"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase";
import { AppShell, type AppPage, type Role } from "@/components/app-shell";
import { InviteConfirm, Login, RecoveryConfirm, SetPassword } from "@/components/login";
import { BrandLogo } from "@/components/branding";
import { AccessProvider } from "@/components/access";
import { authenticatedFetch } from "@/lib/authenticated-fetch";


export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("Consulta");
  const [page, setPage] = useState<AppPage>("Painel");
  const [accessReady, setAccessReady] = useState(false);
  const [openingReady,setOpeningReady]=useState(false);
  const [openingProgress,setOpeningProgress]=useState(0);
  const [openingStatus,setOpeningStatus]=useState("Preparando sistema…");
  const [permissions,setPermissions]=useState<string[]>([]);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [recoveryTokenHash,setRecoveryTokenHash]=useState("");
  const [inviteTokenHash,setInviteTokenHash]=useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const openingStartedRef=useRef(false);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active=true;
    const initialize=async()=>{
      try{
        const url=new URL(window.location.href);
        const tokenHash=String(url.searchParams.get("token_hash")||"").trim();
        if(url.searchParams.get("invite_confirm")==="1"&&tokenHash.length>=20&&tokenHash.length<=512){
          setInviteTokenHash(tokenHash);
          setLoading(false);
          return;
        }
        if(url.searchParams.get("recovery_confirm")==="1"&&tokenHash.length>=20&&tokenHash.length<=512){
          setRecoveryTokenHash(tokenHash);
          setLoading(false);
          return;
        }
        const code=url.searchParams.get("code");
        if(code){
          const recoveryRequested=url.searchParams.get("recovery")==="1"||url.searchParams.get("type")==="recovery";
          const {data,error}=await supabase.auth.exchangeCodeForSession(code);
          if(!active)return;
          if(error||!data.session){
            setAuthError(recoveryRequested?"Este link de recuperação é inválido ou expirou. Solicite um novo link em “Esqueci minha senha”.":"Este link de acesso é inválido ou expirou. Solicite um novo convite ao administrador.");
            setPasswordRecovery(false);
            window.history.replaceState({},document.title,window.location.pathname);
            setLoading(false);
            return;
          }
          setEmail(data.session.user.email??null);
          setAccessToken(data.session.access_token);
          const firstAccess=data.session.user.user_metadata?.needs_password===true;
          setNeedsPassword(firstAccess);
          setPasswordRecovery(recoveryRequested&&!firstAccess);
          setAuthError("");
          window.history.replaceState({},document.title,window.location.pathname);
          setLoading(false);
          return;
        }
        const nfseHomologationId=String(url.searchParams.get("nfse_hml")||"").trim();
        if(/^\d{1,12}$/.test(nfseHomologationId)){
          sessionStorage.setItem("jpi-nfse-focus",nfseHomologationId);
          sessionStorage.setItem("jpi-nfse-open-homologation",nfseHomologationId);
          if(url.searchParams.get("return_assistant")==="1")sessionStorage.setItem("jpi-nfse-return-assistant",nfseHomologationId);
          setPage("NFS-e");
          url.searchParams.delete("nfse_hml");
          url.searchParams.delete("return_assistant");
          window.history.replaceState({},document.title,`${url.pathname}${url.search}${url.hash}`);
        }
        const {data}=await supabase.auth.getSession();
        if(!active)return;
        setEmail(data.session?.user.email??null);
        setAccessToken(data.session?.access_token??null);
        setNeedsPassword(data.session?.user.user_metadata?.needs_password===true);
        if(data.session&&(url.searchParams.get("recovery")==="1"||url.hash.includes("type=recovery")))setPasswordRecovery(true);
      }catch{
        if(active)setAuthError("Não foi possível validar este link. Solicite um novo convite ou link de recuperação.");
      }finally{
        if(active)setLoading(false);
      }
    };
    void initialize();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if(!active)return;
      setEmail(session?.user.email ?? null);
      setAccessToken(session?.access_token ?? null);
      setNeedsPassword(session?.user.user_metadata?.needs_password===true);
      if(!session)setAccessReady(false);
      if(event==="PASSWORD_RECOVERY")setPasswordRecovery(true);
    });
    return () => {active=false;data.subscription.unsubscribe();};
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !email) return;
    let active=true;
    const roles: Record<string, Role> = { master:"Master", admin: "Administrador", financeiro: "Financeiro", secretaria: "Secretaria", consulta: "Consulta" };
    const loadAccess=async()=>{
      const {data,error}=await supabase.rpc("get_my_access");
      if(!active)return;
      const payload=(data||{}) as {role?:string;permissions?:string[]};
      if(error||!payload.role||!roles[payload.role]){
        if(error){setAuthError("Não foi possível validar suas permissões agora. Tente novamente.");return}
        await supabase.auth.signOut({scope:"local"});
        if(!active)return;
        setPermissions([]);setEmail(null);setAccessToken(null);setAuthError("Seu acesso está bloqueado ou ainda não foi autorizado.");return;
      }
      setAuthError("");setRole(roles[payload.role]);setPermissions(Array.isArray(payload.permissions)?payload.permissions:[]);if(!openingStartedRef.current)setOpeningReady(false);setAccessReady(true);
    };
    const refresh=()=>void loadAccess();
    void loadAccess();
    const timer=window.setInterval(refresh,60000);
    window.addEventListener("focus",refresh);
    window.addEventListener("jpi-permissions-updated",refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("jpi-permissions-updated",refresh)};
  }, [supabase, email]);

  useEffect(()=>{
    if(!email||!accessReady||!accessToken){setOpeningReady(false);return}
    const canPreload=permissions.some(permission=>["students.view","payments.create","nfse.prepare","settings.integrations.view"].includes(permission));
    if(!canPreload){setOpeningReady(true);return}
    let cancelled=false;const started=Date.now();const key="jpi-sweduc-login-preload";
    const finish=(message:string)=>{if(cancelled)return;setOpeningStatus(message);setOpeningProgress(100);window.setTimeout(()=>{if(!cancelled)setOpeningReady(true)},350)};
    const run=async()=>{
      openingStartedRef.current=true;
      const last=Number(localStorage.getItem(key)||"0");
      if(last&&Date.now()-last<2*60*60*1000){finish("Dados recentes já preparados.");return}
      try{
        setOpeningStatus("Conectando ao espelho SWeduc…");setOpeningProgress(12);
        const configResponse=await authenticatedFetch("/api/integrations/sweduc",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
        const config=await configResponse.json().catch(()=>({})) as {syncYears?:number[];selectedAcademicYear?:number;config?:{credencial_configurada?:boolean};error?:string};
        if(cancelled)return;
        if(!configResponse.ok||!config.config?.credencial_configurada){finish("Sistema pronto.");return}
        const years=(config.syncYears?.length?config.syncYears:[config.selectedAcademicYear]).filter((year):year is number=>Number.isSafeInteger(Number(year)));
        if(!years.length){finish("Sistema pronto.");return}
        localStorage.setItem(key,String(Date.now()));
        let done=0;const maxCalls=Math.max(1,years.length*20);
        for(const year of years){
          let page=1;
          while(!cancelled&&page&&done<maxCalls){
            if(Date.now()-started>45000){finish("Sistema liberado. A atualização continuará em segundo plano.");return}
            setOpeningStatus(`Atualizando alunos SWeduc de ${year}…`);
            setOpeningProgress(Math.min(94,18+Math.round((done/maxCalls)*76)));
            const response=await authenticatedFetch("/api/integrations/sweduc",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"sync",academicYear:year,page}),cache:"no-store"});
            const data=await response.json().catch(()=>({})) as {nextPage?:number|null};
            done++;
            if(!response.ok)break;
            page=Number(data.nextPage||0);
          }
        }
        finish("Espelho SWeduc pronto para busca.");
      }catch{finish("Sistema pronto. A SWeduc será atualizada em segundo plano.")}
    };
    void run();
    return()=>{cancelled=true};
  },[email,accessReady,accessToken,permissions]);

  async function signIn(inputEmail: string, password: string, remember: boolean) {
    setAuthError("");
    setAuthMessage("");
    if (!supabase) { localStorage.setItem("jpi-demo-session", "1");setRole("Master");setPermissions([]);setAccessReady(true); setEmail(inputEmail); return; }
    if (remember) localStorage.setItem("jpi-remembered-email", inputEmail); else localStorage.removeItem("jpi-remembered-email");
    const { error } = await supabase.auth.signInWithPassword({ email: inputEmail, password });
    if (error) throw error;
  }

  async function signOut() { openingStartedRef.current=false; if (supabase) await supabase.auth.signOut({ scope: "local" }); localStorage.removeItem("jpi-demo-session"); setAccessReady(false);setOpeningReady(false);setPermissions([]);setAccessToken(null);setEmail(null); }
  useEffect(() => {
    if (!supabase || !email) return;
    let active = true;
    const validateSession = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error) {
        const status = (error as { status?: number }).status;
        const code = String((error as { code?: string }).code || "").toLowerCase();
        const message = String(error.message || "").toLowerCase();
        const invalid = status === 401 || status === 403 || code.includes("session_not_found") || code.includes("refresh_token_not_found") || message.includes("session not found") || message.includes("refresh token not found") || message.includes("invalid refresh token");
        if (!invalid) return;
      }
      if (error || !data.user) {
        await supabase.auth.signOut({ scope: "local" });
        if (!active) return;
        setAccessReady(false);
        setAccessToken(null);
        setEmail(null);
        setAuthError("Sua sessão terminou. Entre novamente para continuar.");
      }
    };
    const onFocus = () => { void validateSession(); };
    const onInvalid = () => { void validateSession(); };
    void validateSession();
    const timer = window.setInterval(() => void validateSession(), 60000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("jpi-session-invalid", onInvalid);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("jpi-session-invalid", onInvalid);
    };
  }, [supabase, email]);

  async function requestPasswordReset(inputEmail:string){
    if(!supabase)throw new Error("Recuperação indisponível no modo de apresentação.");
    const normalized=inputEmail.trim().toLowerCase();
    const {data,error}=await supabase.functions.invoke("password-recovery",{body:{email:normalized}});
    if(error)throw new Error("Não foi possível enviar o e-mail de recuperação agora. Tente novamente.");
    if(data?.error)throw new Error(String(data.error));
  }
  async function confirmPasswordRecovery(){
    if(!supabase||!recoveryTokenHash)throw new Error("Este link de recuperação é inválido.");
    const result=await supabase.auth.verifyOtp({token_hash:recoveryTokenHash,type:"recovery"} as never);
    if(result.error)throw new Error("Este link expirou ou já foi utilizado. Solicite um novo link em “Esqueci minha senha”.");
    const {data}=await supabase.auth.getSession();
    if(!data.session)throw new Error("Não foi possível iniciar a recuperação. Solicite um novo link.");
    setEmail(data.session.user.email??null);
    setAccessToken(data.session.access_token);
    setNeedsPassword(false);
    setPasswordRecovery(true);
    setRecoveryTokenHash("");
    setAuthError("");
    setAuthMessage("");
    window.history.replaceState({},document.title,window.location.pathname);
  }
  function cancelPasswordRecovery(){
    setRecoveryTokenHash("");
    setAuthError("");
    window.history.replaceState({},document.title,window.location.pathname);
  }

  async function confirmInvitation(){
    if(!supabase||!inviteTokenHash)throw new Error("Este convite é inválido.");
    const result=await supabase.auth.verifyOtp({token_hash:inviteTokenHash,type:"invite"} as never);
    if(result.error)throw new Error("Este convite expirou ou já foi utilizado. Peça ao administrador para reenviar o convite.");
    const {data}=await supabase.auth.getSession();
    if(!data.session)throw new Error("Não foi possível confirmar o convite. Peça um novo envio ao administrador.");
    setEmail(data.session.user.email??null);
    setAccessToken(data.session.access_token);
    setNeedsPassword(true);
    setPasswordRecovery(false);
    setInviteTokenHash("");
    setAuthError("");
    setAuthMessage("");
    window.history.replaceState({},document.title,window.location.pathname);
  }
  function cancelInvitation(){
    setInviteTokenHash("");
    setAuthError("");
    setAuthMessage("");
    window.history.replaceState({},document.title,window.location.pathname);
  }

  async function definePassword(password:string){
    if(!supabase)return;
    const wasRecovery=passwordRecovery;
    const {error}=await supabase.auth.updateUser({password,data:{needs_password:false}});
    if(error)throw error;
    await supabase.auth.signOut({scope:"local"});
    setNeedsPassword(false);setPasswordRecovery(false);setAccessReady(false);setPermissions([]);setAccessToken(null);setEmail(null);
    setAuthError("");
    setAuthMessage(wasRecovery?"Senha alterada com sucesso. Entre novamente com a nova senha.":"Cadastro concluído com sucesso. Entre com seu e-mail e a senha que você criou.");
  }

  if (loading) return <div className="splash"><BrandLogo/><p>Carregando sistema…</p></div>;
  if(inviteTokenHash)return <InviteConfirm onContinue={confirmInvitation} onCancel={cancelInvitation}/>;
  if(recoveryTokenHash)return <RecoveryConfirm onContinue={confirmPasswordRecovery} onCancel={cancelPasswordRecovery}/>;
  const demoSession = typeof window !== "undefined" && localStorage.getItem("jpi-demo-session") === "1";
  if (!email && !demoSession) return <Login onSignIn={signIn} onResetPassword={requestPasswordReset} configured={hasSupabaseConfig()} externalError={authError} externalMessage={authMessage} />;
  if (email&&(needsPassword||passwordRecovery)) return <SetPassword onSave={definePassword} recovery={passwordRecovery}/>;
  if (email&&!accessReady) return <div className="splash"><BrandLogo/><p>Verificando permissões…</p></div>;
  if (email&&accessReady&&!openingReady) return <div className="splash"><BrandLogo/><p>{openingStatus}</p><div className="splash-progress" aria-label="Carregamento do sistema"><span style={{width:`${openingProgress}%`}}/></div><small>{openingProgress}%</small></div>;
  return <AccessProvider role={role} permissions={permissions}><AppShell email={email ?? "administrador@jpi.edu.br"} accessToken={accessToken} role={role} page={page} onPageChange={setPage} onSignOut={signOut} /></AccessProvider>;
}
