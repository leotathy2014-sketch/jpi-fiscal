import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ConnectionOptions } from "node:tls";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const PARAMETERIZATION_TEST_URL = "https://adn.producaorestrita.nfse.gov.br/parametrizacao/3304557/convenio";
const ISSUANCE_SERVER_URL = "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse";
const CERTIFICATE_BUCKET = "certificados-a1";

type TestAction = "test-connection" | "server-status";
type CachedServerStatus = { body: Record<string, unknown>; status: number; expiresAt: number };

let cachedServerStatus: CachedServerStatus | null = null;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function probeMutualTls(url: string, method: "GET" | "HEAD", pfx: Buffer, passphrase: string) {
  return new Promise<number>((resolve, reject) => {
    const target = new URL(url);
    const options: RequestOptions & ConnectionOptions = {
      method,
      pfx,
      passphrase,
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: true,
      agent: false,
      headers: {
        Accept: "application/json,text/html",
        Connection: "close",
      },
    };
    const request = httpsRequest(target, options, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode || 0));
      response.on("error", reject);
    });
    request.setTimeout(18000, () => request.destroy(new Error("Tempo esgotado ao acessar o Ambiente Nacional.")));
    request.on("error", reject);
    request.end();
  });
}

function safeConnectionMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Falha de comunicação.");
  if (/abort|timeout|tempo/i.test(message)) {
    return "O Ambiente Nacional não respondeu dentro do prazo de segurança. Tente novamente mais tarde.";
  }
  if (/reset|socket hang up|ECONNRESET|connection/i.test(message)) {
    return "O servidor fiscal encerrou a conexão segura. Tente novamente mais tarde.";
  }
  if (/mac verify|password|decrypt|bad certificate/i.test(message)) {
    return "Não foi possível abrir o A1. Confira a senha do certificado.";
  }
  return "Não foi possível concluir o teste de conexão segura com o Ambiente Nacional.";
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const backendSecret = process.env.JPI_BACKEND_SECRET;
  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !supabaseKey || !backendSecret) return json({ error: "O cofre de senhas do certificado ainda não foi configurado no servidor." }, 503);
  if (!authorization || !token) return json({ error: "Sessão inválida." }, 401);

  let action: TestAction;
  try {
    const body = await request.json();
    action = String(body?.action || "") as TestAction;
  } catch {
    return json({ error: "Dados da solicitação inválidos." }, 400);
  }
  if (!["test-connection", "server-status"].includes(action)) return json({ error: "Ação de teste inválida." }, 400);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.email) return json({ error: "Sessão expirada. Entre novamente." }, 401);

  if (!await hasServerPermission(supabase,"nfse.test_connection")) {
    return json({ error: "Seu usuário não possui permissão para testar ou consultar a integração fiscal." }, 403);
  }
  if (action === "server-status" && cachedServerStatus && cachedServerStatus.expiresAt > Date.now()) {
    return json({ ...cachedServerStatus.body, action, cached: true }, cachedServerStatus.status);
  }
  const serverStatusResponse = (body: Record<string, unknown>, status: number, ttlMs: number) => {
    cachedServerStatus = { body, status, expiresAt: Date.now() + ttlMs };
    return json(body, status);
  };

  const { data: certificate, error: certificateError } = await supabase
    .from("certificados_a1")
    .select("id,arquivo_caminho,validade,senha_configurada")
    .eq("status", "ATIVO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (certificateError || !certificate) return json({ error: "Certificado A1 ativo não encontrado." }, 400);
  if (new Date(`${certificate.validade}T23:59:59-03:00`).getTime() < Date.now()) return json({ error: "O certificado A1 está vencido." }, 400);
  if (!certificate.senha_configurada) return json({ error: "Guarde primeiro a senha do certificado em Configurações > Certificado A1." }, 400);

  const { data: storedPassword, error: passwordError } = await supabase.rpc("get_certificate_password", {
    p_certificate_id: certificate.id,
    p_backend_secret: backendSecret,
  });
  let password = typeof storedPassword === "string" ? storedPassword : "";
  if (passwordError || !password) return json({ error: "Não foi possível abrir a senha protegida do certificado." }, 500);

  const { data: file, error: downloadError } = await supabase.storage.from(CERTIFICATE_BUCKET).download(certificate.arquivo_caminho);
  if (downloadError || !file) {
    password = "";
    return json({ error: "Não foi possível acessar o arquivo privado do certificado." }, 403);
  }

  const pfx = Buffer.from(await file.arrayBuffer());
  try {
    const [parameterizationProbe, issuanceProbe] = await Promise.allSettled([
      probeMutualTls(PARAMETERIZATION_TEST_URL, "GET", pfx, password),
      probeMutualTls(ISSUANCE_SERVER_URL, "HEAD", pfx, password),
    ]);
    password = "";
    pfx.fill(0);

    if (parameterizationProbe.status === "rejected") throw parameterizationProbe.reason;
    const parameterizationStatus = parameterizationProbe.value;
    if (parameterizationStatus < 200 || parameterizationStatus >= 400) {
      const message = parameterizationStatus === 403
        ? "O certificado não foi aceito pela produção restrita. Confira a habilitação fiscal do A1."
        : `O Ambiente Nacional respondeu com o código ${parameterizationStatus}. Tente novamente mais tarde.`;
      console.error(JSON.stringify({ event: "nfse_node_parametrizacao_falhou", parameterizationStatus }));
      return json({ error: message, diagnosticCode: "NFSE_HML_TESTAR_CONEXAO", transport: "vercel-node" }, 502);
    }

    if (issuanceProbe.status === "rejected") {
      const technicalMessage = issuanceProbe.reason instanceof Error
        ? `${issuanceProbe.reason.name}: ${issuanceProbe.reason.message}`
        : String(issuanceProbe.reason || "Falha de comunicação.");
      console.error(JSON.stringify({ event: "nfse_node_sefin_indisponivel", technicalMessage }));
      return serverStatusResponse({
        error: "O certificado está confirmado, mas o servidor de emissão da SEFIN está instável. Não tente enviar a nota agora.",
        diagnosticCode: "NFSE_HML_SERVIDOR_INSTAVEL",
        ready: false,
        transport: "vercel-node",
      }, 503, 120000);
    }

    const issuanceStatus = issuanceProbe.value;
    if (issuanceStatus >= 500) {
      console.error(JSON.stringify({ event: "nfse_node_sefin_indisponivel", issuanceStatus }));
      return serverStatusResponse({
        error: `O servidor de emissão da SEFIN respondeu com o código ${issuanceStatus}. Não tente enviar a nota agora.`,
        diagnosticCode: "NFSE_HML_SERVIDOR_INSTAVEL",
        ready: false,
        transport: "vercel-node",
      }, 503, 120000);
    }

    console.log(JSON.stringify({ event: "nfse_node_conexao_confirmada", parameterizationStatus, issuanceStatus }));
    return serverStatusResponse({
      ok: true,
      action,
      environment: "Produção restrita",
      server: new URL(ISSUANCE_SERVER_URL).hostname,
      parameterizationStatus,
      issuanceStatus,
      ready: true,
      transmitted: false,
      transport: "vercel-node",
    }, 200, 300000);
  } catch (error) {
    password = "";
    pfx.fill(0);
    const technicalMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "Falha de comunicação.");
    console.error(JSON.stringify({ event: "nfse_node_teste_falhou", diagnosticCode: "NFSE_HML_TESTAR_CONEXAO", technicalMessage }));
    return json({ error: safeConnectionMessage(error), diagnosticCode: "NFSE_HML_TESTAR_CONEXAO", transport: "vercel-node" }, 502);
  }
}
