export type CancellationReasonCode = "1" | "2" | "9";

export type CancellationRequest = {
  key: string;
  authorCnpj: string;
  reasonCode: CancellationReasonCode;
  reason: string;
  occurredAt: string;
};

const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const escapeXml = (value: unknown) => String(value || "").replace(/[<>&"']/g, character => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
}[character] || character));

export function buildCancellationRequest(input: CancellationRequest) {
  const key = digits(input.key);
  const authorCnpj = digits(input.authorCnpj);
  const reason = String(input.reason || "").trim();
  if (!/^\d{50}$/.test(key)) throw new Error("A chave da NFS-e deve conter 50 dígitos.");
  if (!/^\d{14}$/.test(authorCnpj)) throw new Error("O CNPJ do autor do evento é inválido.");
  if (!["1", "2", "9"].includes(input.reasonCode)) throw new Error("O motivo do cancelamento é inválido.");
  if (reason.length < 15 || reason.length > 255) throw new Error("Descreva o motivo do cancelamento entre 15 e 255 caracteres.");
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(input.occurredAt)) {
    throw new Error("A data e hora do evento são inválidas.");
  }
  const id = `PRE${key}101101`;
  return {
    id,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infPedReg Id="${id}">
    <tpAmb>2</tpAmb>
    <verAplic>JPI-FISCAL-1.01</verAplic>
    <dhEvento>${input.occurredAt}</dhEvento>
    <CNPJAutor>${authorCnpj}</CNPJAutor>
    <chNFSe>${key}</chNFSe>
    <e101101>
      <xDesc>Cancelamento de NFS-e</xDesc>
      <cMotivo>${input.reasonCode}</cMotivo>
      <xMotivo>${escapeXml(reason)}</xMotivo>
    </e101101>
  </infPedReg>
</pedRegEvento>`,
  };
}
