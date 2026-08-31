import { createSupabaseBrowserClient } from "@/lib/supabase";

function signalInvalidSession() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("jpi-session-invalid"));
  }
}

function isInvalidSessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; code?: string; message?: string };
  if (candidate.status === 401 || candidate.status === 403) return true;
  const code = String(candidate.code || "").toLowerCase();
  const message = String(candidate.message || "").toLowerCase();
  return code.includes("session_not_found")
    || code.includes("refresh_token_not_found")
    || message.includes("session not found")
    || message.includes("refresh token not found")
    || message.includes("invalid refresh token");
}

async function invalidateLocalSession() {
  const supabase = createSupabaseBrowserClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  signalInvalidSession();
}

async function currentAccessToken(forceRefresh = false) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("A autenticação do sistema não está configurada.");

  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      if (isInvalidSessionError(error)) {
        await invalidateLocalSession();
        throw new Error("Sua sessão terminou. Entre novamente para continuar.");
      }
      throw new Error("Não foi possível renovar sua sessão agora. Verifique a conexão e tente novamente.");
    }
    return data.session.access_token;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    if (isInvalidSessionError(error)) {
      await invalidateLocalSession();
      throw new Error("Sua sessão terminou. Entre novamente para continuar.");
    }
    throw new Error("Não foi possível verificar sua sessão agora. Tente novamente.");
  }
  if (!data.session?.access_token) {
    signalInvalidSession();
    throw new Error("Sua sessão terminou. Entre novamente para continuar.");
  }
  return data.session.access_token;
}

function withBearer(init: RequestInit, token: string) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await currentAccessToken(false);
  let response = await fetch(input, withBearer(init, token));

  if (response.status !== 401) return response;

  const freshToken = await currentAccessToken(true);
  response = await fetch(input, withBearer(init, freshToken));

  if (response.status === 401) {
    await invalidateLocalSession();
  }
  return response;
}
