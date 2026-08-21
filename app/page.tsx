"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase";
import { AppShell, type AppPage, type Role } from "@/components/app-shell";
import { Login } from "@/components/login";

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("Administrador");
  const [page, setPage] = useState<AppPage>("Painel");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setEmail(data.session?.user.email ?? null); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !email) return;
    supabase.from("app_users").select("role").eq("email", email).eq("active", true).maybeSingle()
      .then(({ data }) => {
        const roles: Record<string, Role> = { admin: "Administrador", financeiro: "Financeiro", secretaria: "Secretaria", consulta: "Consulta" };
        if (data?.role && roles[data.role]) setRole(roles[data.role]);
      });
  }, [supabase, email]);

  async function signIn(inputEmail: string, password: string, remember: boolean) {
    if (!supabase) { localStorage.setItem("jpi-demo-session", "1"); setEmail(inputEmail); return; }
    if (remember) localStorage.setItem("jpi-remembered-email", inputEmail); else localStorage.removeItem("jpi-remembered-email");
    const { error } = await supabase.auth.signInWithPassword({ email: inputEmail, password });
    if (error) throw error;
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); localStorage.removeItem("jpi-demo-session"); setEmail(null); }

  if (loading) return <div className="splash"><div className="logo-mark">JPI</div><p>Carregando sistema…</p></div>;
  const demoSession = typeof window !== "undefined" && localStorage.getItem("jpi-demo-session") === "1";
  if (!email && !demoSession) return <Login onSignIn={signIn} configured={hasSupabaseConfig()} />;
  return <AppShell email={email ?? "administrador@jpi.edu.br"} role={role} onRoleChange={setRole} page={page} onPageChange={setPage} onSignOut={signOut} />;
}
