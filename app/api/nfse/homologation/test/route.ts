import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { request as httpsRequest } from "node:https";

export const runtime = "nodejs";

const HOMOLOGATION_URL = "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index";

function testMutualTls(pfx: Buffer, passphrase: string) {
  return new Promise<{ status: number; server: string }>((resolve, reject) => {
    const target = new URL(HOMOLOGATION_URL);
    const request = httpsRequest(
      target,
      {
        method: "GET",
        pfx,
        passphrase,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        timeout: 15000,
        headers: { Accept: "text/html,application/json" },
      },
      response => {
        response.resume();
        response.on("end", () => resolve({ status: response.statusCode || 0, server: target.hostname }));
      },
    );
    request.on("timeout", () => request.destroy(new Error("Tempo esgotado ao acessar o ambiente nacional.")));
    const hardTimeout = setTimeout(() => request.destroy(new Error("O ambiente nacional não respondeu no prazo de segurança.")), 18000);
    request.on("close", () => clearTimeout(hardTimeout));
    request.on("error", reject);
    request.end();
  });
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !supabaseKey || !token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.email) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });

  const { data: access } = await supabase.from("app_users").select("role,active").eq("email", user.email).maybeSingle();
  if (!access?.active || !["admin", "financeiro"].includes(access.role)) {
    return NextResponse.json({ error: "Seu usuário não possui permissão para testar a integração fiscal." }, { status: 403 });
  }

  const body = await request.formData();
  const password = String(body.get("password") || "");
  if (!password) return NextResponse.json({ error: "Informe a senha do certificado A1." }, { status: 400 });

  const { data: certificate, error: certificateError } = await supabase
    .from("certificados_a1")
    .select("arquivo_caminho,validade")
    .eq("status", "ATIVO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (certificateError || !certificate) return NextResponse.json({ error: "Certificado A1 ativo não encontrado." }, { status: 400 });
  if (new Date(`${certificate.validade}T23:59:59`).getTime() < Date.now()) return NextResponse.json({ error: "O certificado A1 está vencido." }, { status: 400 });

  const { data: file, error: downloadError } = await supabase.storage.from("certificados-a1").download(certificate.arquivo_caminho);
  if (downloadError || !file) return NextResponse.json({ error: "Não foi possível acessar o arquivo privado do certificado." }, { status: 403 });

  try {
    const result = await testMutualTls(Buffer.from(await file.arrayBuffer()), password);
    if (result.status < 200 || result.status >= 400) {
      return NextResponse.json({ error: `O ambiente nacional respondeu com o código ${result.status}. Confira a habilitação do certificado na produção restrita.` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, environment: "Produção restrita", server: result.server, status: result.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Falha de comunicação";
    const invalidPassword = /mac verify|password|decrypt|bad certificate/i.test(detail);
    return NextResponse.json({ error: invalidPassword ? "Não foi possível abrir o A1. Confira a senha do certificado." : `Falha na conexão segura: ${detail}` }, { status: 502 });
  }
}
