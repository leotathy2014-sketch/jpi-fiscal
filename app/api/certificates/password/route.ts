import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import forge from "node-forge";
import { hasServerPermission } from "@/lib/server-permissions";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const backendSecret = process.env.JPI_BACKEND_SECRET;
  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !supabaseKey || !backendSecret) return json({ error: "O cofre de senhas ainda não foi configurado no servidor." }, 503);
  if (!authorization || !token) return json({ error: "Sessão inválida." }, 401);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.email) return json({ error: "Sessão expirada. Entre novamente." }, 401);
  if (!await hasServerPermission(supabase,"settings.certificate.manage")) return json({ error: "Seu usuário não possui permissão para gerenciar o certificado." }, 403);

  let certificateId = "";
  let password = "";
  try {
    const body = await request.json();
    certificateId = String(body.certificateId || "");
    password = String(body.password || "");
  } catch {
    return json({ error: "Dados da solicitação inválidos." }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(certificateId)) return json({ error: "Certificado inválido." }, 400);
  if (!password || password.length > 256) return json({ error: "Informe uma senha válida para o certificado." }, 400);

  const { data: certificate, error: certificateError } = await supabase
    .from("certificados_a1")
    .select("id,arquivo_caminho,status")
    .eq("id", certificateId)
    .eq("status", "ATIVO")
    .maybeSingle();
  if (certificateError || !certificate) return json({ error: "Certificado A1 ativo não encontrado." }, 404);

  const { data: pfxFile, error: fileError } = await supabase.storage.from("certificados-a1").download(certificate.arquivo_caminho);
  if (fileError || !pfxFile) return json({ error: "Não foi possível conferir o arquivo privado do certificado." }, 403);

  const pfx = Buffer.from(await pfxFile.arrayBuffer());
  try {
    const asn1 = forge.asn1.fromDer(pfx.toString("binary"));
    forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    password = "";
    pfx.fill(0);
    return json({ error: "A senha não abre o certificado A1 atual. Confira e tente novamente." }, 400);
  }
  pfx.fill(0);

  const { error: vaultError } = await supabase.rpc("store_certificate_password", {
    p_certificate_id: certificateId,
    p_password: password,
    p_backend_secret: backendSecret,
  });
  password = "";
  if (vaultError) return json({ error: "Não foi possível guardar a senha no cofre seguro." }, 500);
  return json({ ok: true });
}

