"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient, SUPABASE_URL } from "@/lib/supabase";

type Branding = {
  primaryColor: string;
  sidebarColor: string;
  successColor: string;
  updatedAt: string;
};

const DEFAULT_BRANDING: Branding = {
  primaryColor: "#1466DF",
  sidebarColor: "#14263D",
  successColor: "#16875F",
  updatedAt: "default",
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

function validHex(value: unknown, fallback: string) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : fallback;
}

function applyTheme(branding: Branding) {
  const root = document.documentElement;
  root.style.setProperty("--blue", branding.primaryColor);
  root.style.setProperty("--navy", branding.sidebarColor);
  root.style.setProperty("--green", branding.successColor);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  const loadBranding = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_public_branding");
    if (error) return;
    const row = (Array.isArray(data) ? data[0] : data) as {
      primary_color?: string;
      sidebar_color?: string;
      success_color?: string;
      updated_at?: string;
    } | null;
    if (!row) return;
    const next: Branding = {
      primaryColor: validHex(row.primary_color, DEFAULT_BRANDING.primaryColor),
      sidebarColor: validHex(row.sidebar_color, DEFAULT_BRANDING.sidebarColor),
      successColor: validHex(row.success_color, DEFAULT_BRANDING.successColor),
      updatedAt: row.updated_at || new Date().toISOString(),
    };
    setBranding(next);
    applyTheme(next);
  }, [supabase]);

  useEffect(() => {
    applyTheme(branding);
    void loadBranding();
    const refresh = () => void loadBranding();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadBranding();
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("jpi-branding-updated", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("jpi-branding-updated", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [branding, loadBranding]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}

export function BrandLogo({ small = false, preview = false }: { small?: boolean; preview?: boolean }) {
  const branding = useBranding();
  const [loaded, setLoaded] = useState(false);
  const logoUrl = SUPABASE_URL
    ? `${SUPABASE_URL}/storage/v1/object/public/logos-empresa/empresa/logo?v=${encodeURIComponent(branding.updatedAt)}`
    : null;
  const className = `brand-seal${small ? " small" : ""}${preview ? " preview" : ""}${loaded ? " has-logo" : ""}`;
  return <div className={className}>
    <span>JPI</span>
    {logoUrl ? <img src={logoUrl} alt="Logomarca da empresa" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} /> : null}
  </div>;
}
