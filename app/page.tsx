"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase";
import { AppShell, type AppPage, type Role } from "@/components/app-shell";
import { Login, RecoveryConfirm, SetPassword } from "@/components/login";
import { BrandLogo } from "@/components/branding";
import { AccessProvider } from "@/components/access";


export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("Consulta");
  const [page, setPage] = useState<AppPage>("Painel");
  const [accessReady, setAccessReady] = useState(false);
  const [permissions,setPermissions]=useState<string[]>([]);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [recoveryTokenHash,setRecoveryTokenHash]=useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active=true;
    const initialize=async()=>{
      try{
        const url=new URL(window.location.href);
        const tokenHash=String(url.searchParams.get("token_hash")||"").trim();
        if(url.searchParams.get("recovery_confirm")==="1"&&tokenHash.length>=20&&tokenHash.length<=512){
          setRecoveryTokenHash(tokenHash);
          setLoading(false);
          return;
        }
        const code=url.searchParams.get("code");
        if(code){
          const {data,error}=await supabase.auth.exchangeCodeForSession(code);
          if(!active)return;
          if(error||!data.session){
            setAuthError("Este link de recuperação é inválido ou expirou. Solicite um novo link em “Esqueci minha senha”.");
            setPasswordRecovery(false);
            window.history.replaceState({},document.title,window.location.pathname);
            setLoading(false);
            return;
          }
          setEmail(data.session.user.email??null);
          setAccessToken(data.session.access_token);
          setNeedsPassword(false);
          setPasswordRecovery(true);
          setAuthError("");
          window.history.replaceState({},document.title,window.location.pathname);
          setLoading(false);
          return;
        }
        const {data}=await supabase.auth.getSession();
        if(!active)return;
        setEmail(data.session?.user.email??null);
        setAccessToken(data.session?.access_token??null);
        setNeedsPassword(data.session?.user.user_metadata?.needs_password===true);
        if(data.session&&(url.searchParams.get("recovery")==="1"||url.hash.includes("type=recovery")))setPasswordRecovery(true);
      }catch{
        if(active)setAuthError("Não foi possível validar o link de recuperação. Solicite um novo link.");
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
      setAuthError("");setRole(roles[payload.role]);setPermissions(Array.isArray(payload.permissions)?payload.permissions:[]);setAccessReady(true);
    };
    const refresh=()=>void loadAccess();
    void loadAccess();
    const timer=window.setInterval(refresh,60000);
    window.addEventListener("focus",refresh);
    window.addEventListener("jpi-permissions-updated",refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("jpi-permissions-updated",refresh)};
  }, [supabase, email]);

  async function signIn(inputEmail: string, password: string, remember: boolean) {
    setAuthError("");
    if (!supabase) { localStorage.setItem("jpi-demo-session", "1");setRole("Master");setPermissions([]);setAccessReady(true); setEmail(inputEmail); return; }
    if (remember) localStorage.setItem("jpi-remembered-email", inputEmail); else localStorage.removeItem("jpi-remembered-email");
    const { error } = await supabase.auth.signInWithPassword({ email: inputEmail, password });
    if (error) throw error;
  }

  async function signOut() { if (supabase) await supabase.auth.signOut({ scope: "local" }); localStorage.removeItem("jpi-demo-session"); setAccessReady(false);setPermissions([]);setAccessToken(null);setEmail(null); }
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
    window.history.replaceState({},document.title,window.location.pathname);
  }
  function cancelPasswordRecovery(){
    setRecoveryTokenHash("");
    setAuthError("");
    window.history.replaceState({},document.title,window.location.pathname);
  }

  async function definePassword(password:string){
    if(!supabase)return;
    const {error}=await supabase.auth.updateUser({password,data:{needs_password:false}});
    if(error)throw error;
    await supabase.auth.signOut({scope:"local"});
    setNeedsPassword(false);setPasswordRecovery(false);setAccessReady(false);setPermissions([]);setAccessToken(null);setEmail(null);
    setAuthError("Senha alterada com sucesso. Entre novamente com a nova senha.");
  }

  if (loading) return <div className="splash"><BrandLogo/><p>Carregando sistema…</p></div>;
  if(recoveryTokenHash)return <RecoveryConfirm onContinue={confirmPasswordRecovery} onCancel={cancelPasswordRecovery}/>;
  const demoSession = typeof window !== "undefined" && localStorage.getItem("jpi-demo-session") === "1";
  if (!email && !demoSession) return <Login onSignIn={signIn} onResetPassword={requestPasswordReset} configured={hasSupabaseConfig()} externalError={authError} />;
  if (email&&(needsPassword||passwordRecovery)) return <SetPassword onSave={definePassword} recovery={passwordRecovery}/>;
  if (email&&!accessReady) return <div className="splash"><BrandLogo/><p>Verificando permissões…</p></div>;
  return <AccessProvider role={role} permissions={permissions}><AppShell email={email ?? "administrador@jpi.edu.br"} accessToken={accessToken} role={role} page={page} onPageChange={setPage} onSignOut={signOut} /></AccessProvider>;
}
