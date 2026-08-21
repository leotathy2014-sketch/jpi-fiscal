"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase";
import { AppShell, type AppPage, type Role } from "@/components/app-shell";
import { Login, SetPassword } from "@/components/login";

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("Consulta");
  const [page, setPage] = useState<AppPage>("Painel");
  const [accessReady, setAccessReady] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setEmail(data.session?.user.email ?? null);setAccessToken(data.session?.access_token ?? null);setNeedsPassword(data.session?.user.user_metadata?.needs_password===true); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {setEmail(session?.user.email ?? null);setAccessToken(session?.access_token ?? null);setNeedsPassword(session?.user.user_metadata?.needs_password===true);if(event==="PASSWORD_RECOVERY")setPasswordRecovery(true)});
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !email) return;
    setAccessReady(false);
    supabase.from("app_users").select("role,active").eq("email", email).maybeSingle()
      .then(({ data }) => {
        const roles: Record<string, Role> = { admin: "Administrador", financeiro: "Financeiro", secretaria: "Secretaria", consulta: "Consulta" };
        if (!data?.active || !data.role || !roles[data.role]) {supabase.auth.signOut();setEmail(null);setAuthError("Seu acesso está bloqueado ou ainda não foi autorizado.");return}
        setRole(roles[data.role]);setAccessReady(true);
      });
  }, [supabase, email]);

  async function signIn(inputEmail: string, password: string, remember: boolean) {
    setAuthError("");
    if (!supabase) { localStorage.setItem("jpi-demo-session", "1");setRole("Administrador");setAccessReady(true); setEmail(inputEmail); return; }
    if (remember) localStorage.setItem("jpi-remembered-email", inputEmail); else localStorage.removeItem("jpi-remembered-email");
    const { error } = await supabase.auth.signInWithPassword({ email: inputEmail, password });
    if (error) throw error;
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); localStorage.removeItem("jpi-demo-session"); setAccessToken(null);setEmail(null); }
  async function requestPasswordReset(inputEmail:string){if(!supabase)throw new Error("Recuperação indisponível no modo de apresentação.");const {error}=await supabase.auth.resetPasswordForEmail(inputEmail.trim().toLowerCase(),{redirectTo:window.location.origin});if(error)throw error}
  async function definePassword(password:string){if(!supabase)return;const {error}=await supabase.auth.updateUser({password,data:{needs_password:false}});if(error)throw error;setNeedsPassword(false);setPasswordRecovery(false)}

  if (loading) return <div className="splash"><div className="logo-mark">JPI</div><p>Carregando sistema…</p></div>;
  const demoSession = typeof window !== "undefined" && localStorage.getItem("jpi-demo-session") === "1";
  if (!email && !demoSession) return <Login onSignIn={signIn} onResetPassword={requestPasswordReset} configured={hasSupabaseConfig()} externalError={authError} />;
  if (email&&(needsPassword||passwordRecovery)) return <SetPassword onSave={definePassword} recovery={passwordRecovery}/>;
  if (email&&!accessReady) return <div className="splash"><div className="logo-mark">JPI</div><p>Verificando permissões…</p></div>;
  return <AppShell email={email ?? "administrador@jpi.edu.br"} accessToken={accessToken} role={role} page={page} onPageChange={setPage} onSignOut={signOut} />;
}
