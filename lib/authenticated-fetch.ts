import { createSupabaseBrowserClient } from "@/lib/supabase";

function signalInvalidSession() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("jpi-session-invalid"));
  }
}

async function currentAccessToken(forceRefresh = false) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("A autenticação do sistema não está configurada.");

  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      signalInvalidSession();
      throw new Error("Sua sessão terminou. Entre novamente para continuar.");
    }
    return data.session.access_token;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
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

  if (response.status !== 401 && response.status !== 403) return response;

  const freshToken = await currentAccessToken(true);
  response = await fetch(input, withBearer(init, freshToken));

  if (response.status === 401 || response.status === 403) {
    signalInvalidSession();
  }
  return response;
}
