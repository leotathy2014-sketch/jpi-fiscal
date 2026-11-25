import { createClient } from "@supabase/supabase-js";
import { request as httpsRequest } from "node:https";
import { NextRequest, NextResponse } from "next/server";
import { hasServerPermission } from "@/lib/server-permissions";
import { checkSefin, sefinEndpoints, type SefinEnvironment } from "@/lib/sefin-status";

export const runtime = "nodejs";
export const maxDuration = 20;

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function probe(url: string, pfx: Buffer, passphrase: string) {
  return new Promise<number>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET", pfx, passphrase, agent: false,
      minVersion: "TLSv1.2", maxVersion: "TLSv1.2",
      signal: AbortSignal.timeout(6000),
    }, response => {
      resolve(response.statusCode ?? 0);
      response.destroy();
    });
    request.on("error", reject);
    request.end();
  });
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!authorization || !token) return json({ error: "Sessão inválida." }, 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !serviceKey) return json({ error: "Monitoramento indisponível." }, 503);

  const auth = { persistSession: false, autoRefreshToken: false };
  const scoped = createClient(url, key, { auth, global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await scoped.auth.getUser(token);
  if (error || !user) return json({ error: "Sessão inválida." }, 401);
  if (!await hasServerPermission(scoped, "system.status.view") && !await hasServerPermission(scoped, "nfse.test_connection")) {
    return json({ error: "Acesso não autorizado." }, 403);
  }

  const admin = createClient(url, serviceKey, { auth });
  const { data: certificate, error: certificateError } = await admin.from("certificados_a1")
    .select("id,arquivo_caminho,validade,senha_configurada").eq("status", "ATIVO")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (certificateError) return json({ error: "Não foi possível consultar o certificado A1." }, 503);
  if (!certificate?.senha_configurada || new Date(certificate.validade + "T23:59:59-03:00").getTime() < Date.now()) {
    return json({ error: "Certificado A1 indisponível para a verificação." }, 503);
  }

  const [secret, file] = await Promise.all([
    admin.rpc("get_certificate_password_service", { p_certificate_id: certificate.id }),
    admin.storage.from("certificados-a1").download(certificate.arquivo_caminho),
  ]);
  if (secret.error || typeof secret.data !== "string" || !secret.data || file.error || !file.data) {
    return json({ error: "Não foi possível abrir o certificado A1 para a verificação." }, 503);
  }

  const pfx = Buffer.from(await file.data.arrayBuffer());
  try {
    const check = async (environment: SefinEnvironment) => {
      const result = await checkSefin(environment, () => probe(sefinEndpoints[environment], pfx, secret.data));
      console.info(JSON.stringify({ event: "sefin_status", environment, ...result }));
      return result;
    };
    const [production, homologation] = await Promise.all([check("production"), check("homologation")]);
    return json({ production, homologation });
  } finally {
    pfx.fill(0);
  }
}
