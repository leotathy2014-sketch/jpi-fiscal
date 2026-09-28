import { CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";

type PageProps = {
  params: Promise<{ codigo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const valueOf = (params: Record<string, string | string[] | undefined>, key: string) => {
  const value = params[key];
  return Array.isArray(value) ? value[0] || "" : value || "";
};

export default async function DeclarationValidationPage({ params, searchParams }: PageProps) {
  const { codigo } = await params;
  const query = await searchParams;
  const aluno = valueOf(query, "aluno");
  const matricula = valueOf(query, "matricula");
  const ano = valueOf(query, "ano");
  const tipo = valueOf(query, "tipo");
  const assinante = valueOf(query, "assinante");
  const titulos = valueOf(query, "titulos");
  const total = valueOf(query, "total");
  const data = valueOf(query, "data");

  return (
    <main className="validation-page">
      <section className="validation-card">
        <div className="validation-icon"><ShieldCheck size={34} /></div>
        <p className="eyebrow">JPI Fiscal</p>
        <h1>Declaração com validação eletrônica</h1>
        <p className="validation-status"><CheckCircle2 size={18} /> Código de conferência recebido</p>
        <div className="validation-code">{codigo}</div>
        <p className="validation-muted">
          Esta página confirma os dados informados no QR Code da declaração. Em ambiente de teste,
          a conferência é eletrônica interna do sistema.
        </p>
        <dl className="validation-grid">
          <div><dt>Tipo</dt><dd>{tipo || "Não informado"}</dd></div>
          <div><dt>Aluno</dt><dd>{aluno || "Não informado"}</dd></div>
          <div><dt>Matrícula</dt><dd>{matricula || "Não informada"}</dd></div>
          <div><dt>Ano letivo</dt><dd>{ano || "Não informado"}</dd></div>
          <div><dt>Assinante</dt><dd>{assinante || "Não informado"}</dd></div>
          <div><dt>Títulos</dt><dd>{titulos || "Nenhum"}</dd></div>
          <div><dt>Total</dt><dd>{total || "Não informado"}</dd></div>
          <div><dt>Data da declaração</dt><dd>{data || "Não informada"}</dd></div>
        </dl>
        <div className="validation-note">
          <FileCheck2 size={18} />
          <span>Para validade forte com prova em banco, o próximo passo é gravar cada declaração emitida com este código e hash do documento.</span>
        </div>
      </section>
    </main>
  );
}
