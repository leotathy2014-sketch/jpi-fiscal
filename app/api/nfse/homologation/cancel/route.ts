import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { gzipSync, gunzipSync } from "node:zlib";
import { buildCancellationRequest, type CancellationReasonCode } from "@/lib/nfse-event";
import {
  digits,
  issueDateTime,
  postJsonWithCertificate,
  readCertificate,
  safeFiscalErrors,
  safeTechnicalError,
  signXmlElement,
} from "@/lib/nfse-node";
import { NFSE_RESTRICTED_ENDPOINT } from "@/lib/nfse-dps";

export const runtime = "nodejs";
export const maxDuration = 60;

const XML_BUCKET = "documentos-nfse";
const CERTIFICATE_BUCKET = "certificados-a1";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function eventUrl(key: string) {
  const base = NFSE_RESTRICTED_ENDPOINT.replace(/\/+$/, "");
  return `${base}/${key}/eventos`;
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const backendSecret = process.env.JPI_BACKEND_SECRET;
  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !supabaseKey || !backendSecret) return json({ error: "O ambiente seguro ainda não está configurado." }, 503);
  if (!authorization || !token) return json({ error: "Sessão inválida." }, 401);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.email) return json({ error: "Sessão expirada. Entre novamente." }, 401);
  const { data: access } = await supabase.from("app_users").select("role,active").eq("email", user.email).maybeSingle();
  if (!access?.active || !["admin", "financeiro"].includes(access.role)) return json({ error: "Seu usuário não possui permissão para cancelar notas de teste." }, 403);

  let monthlyId = 0;
  let reasonCode = "";
  let reason = "";
  try {
    const body = await request.json();
    monthlyId = Number(body.monthlyId);
    reasonCode = String(body.reasonCode || "");
    reason = String(body.reason || "").trim();
  } catch {
    return json({ error: "Dados da solicitação inválidos." }, 400);
  }
  if (!Number.isSafeInteger(monthlyId) || monthlyId <= 0) return json({ error: "Mensalidade inválida." }, 400);
  if (!["1", "2", "9"].includes(reasonCode)) return json({ error: "Selecione um motivo válido para o cancelamento." }, 400);
  if (reason.length < 15 || reason.length > 255) return json({ error: "Descreva o motivo do cancelamento entre 15 e 255 caracteres." }, 400);

  const { data: payment } = await supabase
    .from("mensalidades")
    .select("id,valor_nfse,status_nfse,chave_nfse_homologacao")
    .eq("id", monthlyId)
    .maybeSingle();
  if (!payment?.chave_nfse_homologacao) return json({ error: "Esta mensalidade não possui uma NFS-e de teste ativa." }, 404);
  const { data: document } = await supabase
    .from("nfse_documentos_homologacao")
    .select("id,chave_acesso,estado,versao")
    .eq("mensalidade_id", monthlyId)
    .eq("estado", "ativa")
    .maybeSingle();
  if (!document) return json({ error: "A nota já está cancelada, substituída ou sendo processada." }, 409);
  if (document.chave_acesso !== payment.chave_nfse_homologacao) return json({ error: "A versão ativa da nota precisa ser sincronizada antes do cancelamento." }, 409);

  const { data: company } = await supabase.from("configuracoes_empresa").select("cnpj").eq("id", true).maybeSingle();
  if (!company?.cnpj) return json({ error: "O CNPJ do prestador não foi encontrado." }, 400);
  const { data: certificate } = await supabase
    .from("certificados_a1")
    .select("id,arquivo_caminho,validade,senha_configurada")
    .eq("status", "ATIVO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!certificate || !certificate.senha_configurada) return json({ error: "Certificado A1 ativo e com senha protegida não encontrado." }, 400);
  if (new Date(`${certificate.validade}T23:59:59-03:00`).getTime() < Date.now()) return json({ error: "O certificado A1 está vencido." }, 400);
  const { data: storedPassword, error: passwordError } = await supabase.rpc("get_certificate_password", {
    p_certificate_id: certificate.id,
    p_backend_secret: backendSecret,
  });
  let password = typeof storedPassword === "string" ? storedPassword : "";
  if (passwordError || !password) return json({ error: "Não foi possível abrir a senha protegida do certificado." }, 500);
  const { data: pfxFile, error: pfxError } = await supabase.storage.from(CERTIFICATE_BUCKET).download(certificate.arquivo_caminho);
  if (pfxError || !pfxFile) {
    password = "";
    return json({ error: "Não foi possível acessar o certificado privado." }, 403);
  }

  const pfx = Buffer.from(await pfxFile.arrayBuffer());
  const previousStatus = payment.status_nfse;
  let locked = false;
  let sefinAccepted = false;
  try {
    const lock = await supabase
      .from("nfse_documentos_homologacao")
      .update({ estado: "cancelando", evento_motivo_codigo: reasonCode, evento_motivo_descricao: reason })
      .eq("id", document.id)
      .eq("estado", "ativa")
      .select("id")
      .maybeSingle();
    if (lock.error || !lock.data) {
      password = "";
      pfx.fill(0);
      return json({ error: "A nota já está sendo processada. Aguarde a conclusão." }, 409);
    }
    locked = true;
    await supabase.from("mensalidades").update({ status_nfse: "Cancelamento em processamento" }).eq("id", monthlyId);

    const requestXml = buildCancellationRequest({
      key: document.chave_acesso,
      authorCnpj: digits(company.cnpj),
      reasonCode: reasonCode as CancellationReasonCode,
      reason,
      occurredAt: issueDateTime(),
    });
    const keys = readCertificate(pfx, password, company.cnpj);
    const signedXml = signXmlElement(requestXml.xml, "infPedReg", keys.privateKeyPem, keys.certificatePem);
    const attemptId = `${new Date().toISOString().replace(/\D/g, "").slice(0, 17)}-${crypto.randomUUID().slice(0, 8)}`;
    const basePath = `dps/${monthlyId}/eventos/cancelamento/${attemptId}`;
    const requestPath = `${basePath}/${requestXml.id}.xml`;
    const signedPath = `${basePath}/${requestXml.id}-assinado.xml`;
    const uploads = await Promise.all([
      supabase.storage.from(XML_BUCKET).upload(requestPath, new Blob([requestXml.xml], { type: "application/xml" }), { contentType: "application/xml", upsert: true }),
      supabase.storage.from(XML_BUCKET).upload(signedPath, new Blob([signedXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true }),
    ]);
    if (uploads.some(result => result.error)) throw new Error("O pedido de cancelamento não pôde ser guardado antes do envio.");

    const payload = JSON.stringify({ pedidoRegistroEventoXmlGZipB64: gzipSync(Buffer.from(signedXml, "utf8")).toString("base64") });
    const response = await postJsonWithCertificate(eventUrl(document.chave_acesso), payload, pfx, password);
    password = "";
    pfx.fill(0);
    let sefinPayload: unknown = {};
    try { sefinPayload = response.body ? JSON.parse(response.body) : {}; } catch { sefinPayload = response.body; }
    const responseRecord = sefinPayload && typeof sefinPayload === "object" && !Array.isArray(sefinPayload) ? sefinPayload as Record<string, unknown> : {};
    const eventB64 = typeof responseRecord.eventoXmlGZipB64 === "string" ? responseRecord.eventoXmlGZipB64 : "";
    if (response.status < 200 || response.status >= 300 || !eventB64) {
      const errors = safeFiscalErrors(sefinPayload);
      const formatted = errors.map(error => [error.codigo, error.descricao, error.complemento].filter(Boolean).join(" - "));
      await supabase.from("nfse_documentos_homologacao").update({ estado: "ativa" }).eq("id", document.id).eq("estado", "cancelando");
      await supabase.from("mensalidades").update({ status_nfse: previousStatus }).eq("id", monthlyId);
      await supabase.from("historico_nfse").insert({
        mensalidade_id: monthlyId,
        evento: "nfse_cancelamento_homologacao_rejeitado",
        valor_anterior: payment.valor_nfse,
        valor_novo: payment.valor_nfse,
        detalhes: `Tentativa ${attemptId}. HTTP ${response.status}. ${formatted.join(" | ")}. Pedido ${requestPath}; assinado ${signedPath}.`.slice(0, 2000),
      });
      return json({ error: formatted[0] || "A produção restrita rejeitou o cancelamento.", errors }, 422);
    }

    sefinAccepted = true;
    const eventXml = gunzipSync(Buffer.from(eventB64, "base64")).toString("utf8");
    const eventPath = `${basePath}/evento-autorizado.xml`;
    const { error: eventUploadError } = await supabase.storage.from(XML_BUCKET).upload(eventPath, new Blob([eventXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (eventUploadError) throw new Error("O cancelamento foi confirmado, mas o XML do evento não pôde ser guardado.");
    const processedAt = typeof responseRecord.dataHoraProcessamento === "string" ? responseRecord.dataHoraProcessamento : new Date().toISOString();
    const { error: documentUpdateError } = await supabase.from("nfse_documentos_homologacao").update({
      estado: "cancelada",
      evento_xml_path: eventPath,
      evento_processado_em: processedAt,
    }).eq("id", document.id).eq("estado", "cancelando");
    if (documentUpdateError) throw new Error("O cancelamento foi confirmado, mas a versão da nota não pôde ser atualizada.");
    await supabase.from("mensalidades").update({ status_nfse: "NFS-e cancelada em homologação" }).eq("id", monthlyId);
    await supabase.from("historico_nfse").insert({
      mensalidade_id: monthlyId,
      evento: "nfse_cancelada_homologacao",
      valor_anterior: payment.valor_nfse,
      valor_novo: payment.valor_nfse,
      detalhes: `Versão ${document.versao} cancelada na produção restrita. Motivo ${reasonCode}: ${reason}. Evento autorizado ${eventPath}.`,
    });
    return json({ ok: true, environment: "Produção restrita", processedAt });
  } catch (error) {
    password = "";
    pfx.fill(0);
    if (locked && !sefinAccepted) {
      await supabase.from("nfse_documentos_homologacao").update({ estado: "ativa" }).eq("id", document.id).eq("estado", "cancelando");
      await supabase.from("mensalidades").update({ status_nfse: previousStatus }).eq("id", monthlyId);
    } else if (sefinAccepted) {
      await supabase.from("nfse_documentos_homologacao").update({ estado: "cancelada", evento_processado_em: new Date().toISOString() }).eq("id", document.id);
      await supabase.from("mensalidades").update({ status_nfse: "NFS-e cancelada em homologação" }).eq("id", monthlyId);
    }
    await supabase.from("historico_nfse").insert({
      mensalidade_id: monthlyId,
      evento: sefinAccepted ? "nfse_cancelamento_confirmado_sincronizacao_pendente" : "nfse_cancelamento_homologacao_falhou",
      valor_anterior: payment.valor_nfse,
      valor_novo: payment.valor_nfse,
      detalhes: `Falha técnica: ${safeTechnicalError(error)}. ${sefinAccepted ? "A SEFIN confirmou o evento; o estado local foi mantido como cancelado." : "Nenhum cancelamento foi confirmado."}`.slice(0, 2000),
    });
    return json({ error: sefinAccepted ? "O cancelamento foi confirmado, mas alguns arquivos ainda precisam ser sincronizados." : "Não foi possível concluir o cancelamento na produção restrita.", confirmed: sefinAccepted }, sefinAccepted ? 202 : 502);
  }
}
