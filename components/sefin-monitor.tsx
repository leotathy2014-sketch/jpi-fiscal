"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SefinCheck, SefinEnvironment } from "@/lib/sefin-status";

const environments = { production: "Produção", homologation: "Homologação" };
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });

export function SefinMonitor({ accessToken }: { accessToken: string | null }) {
  const [checks, setChecks] = useState<Record<SefinEnvironment, SefinCheck> | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (!accessToken || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setChecking(true);
    setError("");
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/nfse/status", {
        headers: { Authorization: "Bearer " + accessToken },
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.production || !data?.homologation) {
        throw new Error(data?.error || "Não foi possível consultar o monitoramento.");
      }
      if (inFlight.current === controller) setChecks(data);
    } catch (error) {
      if (inFlight.current !== controller) return;
      setError(controller.signal.aborted ? "A consulta ao monitoramento excedeu o tempo limite."
        : error instanceof Error ? error.message : "Não foi possível consultar o monitoramento.");
    } finally {
      window.clearTimeout(timer);
      if (inFlight.current === controller) {
        inFlight.current = null;
        setChecking(false);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) setChecking(false);
    void check();
    const refresh = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = window.setInterval(refresh, 300000);
    window.addEventListener("online", refresh);
    window.addEventListener("jpi-sefin-status-updated", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("jpi-sefin-status-updated", refresh);
      const pending = inFlight.current;
      inFlight.current = null;
      pending?.abort();
    };
  }, [accessToken, check]);

  return <div className="sefin-monitor">
    <div className="sefin-monitor-results" role="status">
      {(Object.keys(environments) as SefinEnvironment[]).map(environment => {
        const result = checks?.[environment];
        return <div key={environment} className={`sefin-top-status ${result?.tone ?? "unknown"}`}>
          <span className="sefin-status-dot" aria-hidden="true"/>
          <div>
            <strong>SEFIN {environments[environment]} {result?.detail ?? "sem verificação"}</strong>
            {result && <small>Última verificação <time dateTime={result.checkedAt}>{dateFormat.format(new Date(result.checkedAt))}</time></small>}
          </div>
        </div>;
      })}
      {error && <small>{error}</small>}
    </div>
    <button type="button" className="secondary mini" onClick={() => void check()} disabled={!accessToken || checking}>
      {checking ? "Verificando…" : "Verificar novamente"}
    </button>
  </div>;
}
