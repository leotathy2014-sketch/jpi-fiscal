"use client";

import { useEffect, useState } from "react";

export type TransmissionKind = "issue" | "substitute" | "cancel" | "connection";

const labels: Record<TransmissionKind, string[]> = {
  issue: ["Preparando os dados da DPS…", "Assinando com o certificado A1…", "Transmitindo ao Ambiente Nacional…", "Aguardando a confirmação da SEFIN…"],
  substitute: ["Preparando a nota substituta…", "Assinando com o certificado A1…", "Transmitindo a substituição…", "Aguardando a nova chave da SEFIN…"],
  cancel: ["Preparando o evento de cancelamento…", "Assinando com o certificado A1…", "Transmitindo o cancelamento…", "Aguardando a confirmação da SEFIN…"],
  connection: ["Preparando o certificado A1…", "Abrindo a conexão segura…", "Consultando o servidor de emissão…", "Aguardando a resposta da SEFIN…"],
};

function progressFor(elapsed: number) {
  if (elapsed < 2) return { index: 0, value: 12 };
  if (elapsed < 5) return { index: 1, value: 35 };
  if (elapsed < 10) return { index: 2, value: 62 };
  return { index: 3, value: Math.min(92, 76 + Math.floor((elapsed - 10) / 3)) };
}

export function TransmissionProgress({ kind }: { kind: TransmissionKind }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, []);

  const progress = progressFor(elapsed);
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="transmission-progress" role="status" aria-live="polite">
      <div className="transmission-progress-head">
        <strong>{labels[kind][progress.index]}</strong>
        <span>{elapsedLabel}</span>
      </div>
      <div
        className="transmission-progress-track"
        role="progressbar"
        aria-label="Andamento estimado da transmissão"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.value}
      >
        <span style={{ width: `${progress.value}%` }} />
      </div>
      <small>Andamento estimado. Aguarde a confirmação oficial antes de sair desta tela.</small>
    </div>
  );
}
