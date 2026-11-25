export const sefinEndpoints = {
  production: "https://sefin.nfse.gov.br/SefinNacional/docs/index",
  homologation: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index",
};

export type SefinEnvironment = keyof typeof sefinEndpoints;
export type SefinCheck = {
  tone: "available" | "unstable" | "unavailable" | "unknown";
  detail: string;
  checkedAt: string;
};

export async function checkSefin(environment: SefinEnvironment, probe: () => Promise<number>): Promise<SefinCheck> {
  try {
    const status = await probe();
    const tone = status === 200 ? "available"
      : status === 403 && environment === "homologation" ? "unstable"
      : status >= 500 || status === 403 ? "unavailable"
      : "unknown";
    const detail = status === 200 ? "online" : tone === "unknown" ? "não confirmado — HTTP " + status
      : "indisponível — HTTP " + status + (tone === "unstable" ? " externo" : "");
    return { tone, detail, checkedAt: new Date().toISOString() };
  } catch (error) {
    const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
    return {
      tone: "unavailable",
      detail: timeout ? "indisponível — tempo limite excedido" : "indisponível — falha de conexão",
      checkedAt: new Date().toISOString(),
    };
  }
}
