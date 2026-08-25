import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ncjtxysknpsloauzgmiv.supabase.co";

export const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_46fyN3JTYOzTPqoz21AbLw_VgI4wTR7";

let sharedBrowserClient: SupabaseClient | null = null;

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY);
}

export function createSupabaseBrowserClient() {
  if (sharedBrowserClient) return sharedBrowserClient;
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) return null;
  sharedBrowserClient = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return sharedBrowserClient;
}
