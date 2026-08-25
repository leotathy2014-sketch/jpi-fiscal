import { createClient } from "npm:@supabase/supabase-js@2.56.0";
import forge from "npm:node-forge@1.3.1";

const PARAMETERIZATION_TEST_URL = "https://adn.producaorestrita.nfse.gov.br/parametrizacao/3304557/convenio";
const ISSUANCE_SERVER_URL = "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse";
const CERTIFICATE_BUCKET = "certificados-a1";
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "https://jpi-fiscal.vercel.app",
  Vary: "Origin",
};

type ForgeCertificate = forge.pki.Certificate;
type ForgePrivateKey = forge.pki.rsa.PrivateKey;
type CachedServerStatus = { body: Record<string, unknown>; status: number; expiresAt: number };

let cachedServerStatus: CachedServerStatus | null = null;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function binaryString(bytes: Uint8Array) {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return result;
}

function sameRsaKey(certificate: ForgeCertificate, key: ForgePrivateKey) {
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  return publicKey.n.compareTo(key.n) === 0 && publicKey.e.compareTo(key.e) === 0;
}

function verifiesCertificate(issuer: ForgeCertificate, certificate: ForgeCertificate) {
  try {
    return issuer.verify(certificate);
  } catch {
    return false;
  }
}

function isSelfSigned(certificate: ForgeCertificate) {
  return certificate.subject.hash === certificate.issuer.hash && verifiesCertificate(certificate, certificate);
}

function orderedCertificateChainPem(leaf: ForgeCertificate, certificates: ForgeCertificate[]) {
  const chain: ForgeCertificate[] = [leaf];
  const used = new Set([leaf]);
  let current = leaf;
  while (!isSelfSigned(current)) {
    const issuer = certificates.find(certificate =>
      !used.has(certificate)
      && certificate.subject.hash === current.issuer.hash
      && verifiesCertificate(certificate, current),
    );
    if (!issuer) break;
    chain.push(issuer);
    used.add(issuer);
    if (isSelfSigned(issuer)) break;
    current = issuer;
  }
  return chain.map(certificate => forge.pki.certificateToPem(certificate)).join("\n");
}

function readCertificate(pfx: Uint8Array, password: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(binaryString(pfx)));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new Error("Não foi possível abrir o A1. Confira a senha do certificado.");
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const key = keyBags.map(bag => bag.key).find(Boolean) as ForgePrivateKey | undefined;
  const certificates = certBags.map(bag => bag.cert).filter(Boolean) as ForgeCertificate[];
  const leaf = key ? certificates.find(certificate => sameRsaKey(certificate, key)) : undefined;
  if (!key || !leaf) throw new Error("O A1 não contém uma chave RSA e um certificado compatíveis.");

  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key));
  return {
    privateKeyPem: forge.pki.privateKeyInfoToPem(privateKeyInfo),
    certificateChainPem: orderedCertificateChainPem(leaf, certificates),
  };
}

async function testRestrictedEndpoint(
  url: string,
  method: "GET" | "HEAD",
  certificateChainPem: string,
  privateKeyPem: string,
) {
  const client = Deno.createHttpClient({
    cert: certificateChainPem,
    key: privateKeyPem,
    http1: true,
    http2: false,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      method,
      headers: { Accept: "application/json,text/html" },
      signal: controller.signal,
      client,
    } as RequestInit & { client: Deno.HttpClient });
    const status = response.status;
    await response.body?.cancel();
    return status;
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

function safeConnectionMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Falha de comunicação.");
  if (/abort|timeout|tempo/i.test(message)) {
    return "O Ambiente Nacional não respondeu dentro do prazo de segurança. Tente novamente mais tarde.";
  }
  if (/reset by peer|connection reset|sending request/i.test(message)) {
    return "O servidor fiscal encerrou a conexão segura. Tente novamente mais tarde.";
  }
  if (/Não foi possível abrir o A1|chave RSA/i.test(message)) return message;
  return "Não foi possível concluir o teste de conexão segura com o Ambiente Nacional.";
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: "Configuração segura indisponível." }, 500);
  }

  const token = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user?.email) return json({ error: "Sessão expirada. Entre novamente." }, 401);

  let action = "";
  try {
    const body = await request.json();
    action = String(body?.action || "");
  } catch {
    return json({ error: "Dados da solicitação inválidos." }, 400);
  }
  if (!["test-connection", "server-status"].includes(action)) return json({ error: "Ação de teste inválida." }, 400);

  const { data: access } = await userClient.from("app_users").select("role,active").eq("email", user.email).maybeSingle();
  if (!access?.active) return json({ error: "Seu usuário não possui acesso ao sistema." }, 403);
  if (action === "test-connection" && !["admin", "financeiro"].includes(access.role)) {
    return json({ error: "Seu usuário não possui permissão para testar a integração fiscal." }, 403);
  }
  if (action === "server-status" && cachedServerStatus && cachedServerStatus.expiresAt > Date.now()) {
    return json({ ...cachedServerStatus.body, action, cached: true }, cachedServerStatus.status);
  }
  const serverStatusResponse = (body: Record<string, unknown>, status: number, ttlMs: number) => {
    cachedServerStatus = { body, status, expiresAt: Date.now() + ttlMs };
    return json(body, status);
  };

  const { data: certificate } = await admin
    .from("certificados_a1")
    .select("id,arquivo_caminho,validade,senha_configurada")
    .eq("status", "ATIVO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!certificate) return json({ error: "Certificado A1 ativo não encontrado." }, 400);
  if (new Date(`${certificate.validade}T23:59:59-03:00`).getTime() < Date.now()) {
    return json({ error: "O certificado A1 está vencido." }, 400);
  }
  if (!certificate.senha_configurada) {
    return json({ error: "Guarde primeiro a senha do certificado em Configurações > Certificado A1." }, 400);
  }

  const { data: storedPassword, error: passwordError } = await admin.rpc("get_certificate_password_service", {
    p_certificate_id: certificate.id,
  });
  let password = typeof storedPassword === "string" ? storedPassword : "";
  if (passwordError || !password) return json({ error: "Não foi possível abrir a senha protegida do certificado." }, 500);

  const { data: pfxFile, error: pfxError } = await admin.storage.from(CERTIFICATE_BUCKET).download(certificate.arquivo_caminho);
  if (pfxError || !pfxFile) {
    password = "";
    return json({ error: "Não foi possível acessar o certificado privado." }, 500);
  }

  const pfx = new Uint8Array(await pfxFile.arrayBuffer());
  try {
    const keys = readCertificate(pfx, password);
    password = "";
    pfx.fill(0);
    const [parameterizationProbe, issuanceProbe] = await Promise.allSettled([
      testRestrictedEndpoint(PARAMETERIZATION_TEST_URL, "GET", keys.certificateChainPem, keys.privateKeyPem),
      testRestrictedEndpoint(ISSUANCE_SERVER_URL, "HEAD", keys.certificateChainPem, keys.privateKeyPem),
    ]);
    if (parameterizationProbe.status === "rejected") throw parameterizationProbe.reason;
    const parameterizationStatus = parameterizationProbe.value;
    if (parameterizationStatus < 200 || parameterizationStatus >= 400) {
      const message = parameterizationStatus === 403
        ? "O certificado não foi aceito pela produção restrita. Confira a habilitação fiscal do A1."
        : `O Ambiente Nacional respondeu com o código ${parameterizationStatus}. Tente novamente mais tarde.`;
      console.error(JSON.stringify({ event: "nfse_teste_conexao_falhou", parameterizationStatus }));
      return json({ error: message, diagnosticCode: "NFSE_HML_TESTAR_CONEXAO" }, 502);
    }
    if (issuanceProbe.status === "rejected") {
      const technicalMessage = issuanceProbe.reason instanceof Error
        ? `${issuanceProbe.reason.name}: ${issuanceProbe.reason.message}`
        : String(issuanceProbe.reason || "Falha de comunicação.");
      console.error(JSON.stringify({ event: "nfse_servidor_emissao_indisponivel", technicalMessage }));
      return serverStatusResponse({
        error: "O certificado está confirmado, mas o servidor de emissão da SEFIN está instável. Não tente enviar a nota agora.",
        diagnosticCode: "NFSE_HML_SERVIDOR_INSTAVEL",
        ready: false,
      }, 503, 120000);
    }
    const issuanceStatus = issuanceProbe.value;
    if (issuanceStatus >= 500) {
      console.error(JSON.stringify({ event: "nfse_servidor_emissao_indisponivel", issuanceStatus }));
      return serverStatusResponse({
        error: `O servidor de emissão da SEFIN respondeu com o código ${issuanceStatus}. Não tente enviar a nota agora.`,
        diagnosticCode: "NFSE_HML_SERVIDOR_INSTAVEL",
        ready: false,
      }, 503, 120000);
    }
    console.log(JSON.stringify({ event: "nfse_teste_conexao_confirmado", parameterizationStatus, issuanceStatus }));
    return serverStatusResponse({
      ok: true,
      action,
      environment: "Produção restrita",
      server: new URL(ISSUANCE_SERVER_URL).hostname,
      parameterizationStatus,
      issuanceStatus,
      ready: true,
      transmitted: false,
    }, 200, 300000);
  } catch (error) {
    password = "";
    pfx.fill(0);
    const message = safeConnectionMessage(error);
    const technicalMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "Falha de comunicação.");
    console.error(JSON.stringify({
      event: "nfse_teste_conexao_falhou",
      diagnosticCode: "NFSE_HML_TESTAR_CONEXAO",
      technicalMessage,
    }));
    return json({ error: message, diagnosticCode: "NFSE_HML_TESTAR_CONEXAO" }, 502);
  }
});
