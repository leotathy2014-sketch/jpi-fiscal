"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, Building2, Check, CircleDollarSign, Clock3, FileCheck2, FilePlus2, Filter, KeyRound, Link2, MoreHorizontal, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, UploadCloud, UserCog, UsersRound, WalletCards, X } from "lucide-react";
import type { Role } from "./app-shell";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const onlyDigits = (value: string, limit: number) => value.replace(/\D/g, "").slice(0, limit);
const maskCnpj = (value: string) =>
  onlyDigits(value, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
const maskPhone = (value: string) => {
  const n = onlyDigits(value, 11);
  return n.length <= 10 ? n.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2") : n.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};
const maskCep = (value: string) => onlyDigits(value, 8).replace(/^(\d{5})(\d)/, "$1-$2");
const upperCompanyInput = (event: React.FormEvent<HTMLInputElement>) => {
  event.currentTarget.value = event.currentTarget.value.toLocaleUpperCase("pt-BR");
};
const students = [
  {
    name: "Alice Ferreira Lima",
    class: "Infantil 5",
    guardian: "Mariana Ferreira",
    phone: "(21) 99854-1203",
    status: "Ativo",
  },
  {
    name: "Bernardo Santos",
    class: "2º ano",
    guardian: "Carlos Eduardo Santos",
    phone: "(21) 99221-5578",
    status: "Ativo",
  },
  {
    name: "Clara Menezes Alves",
    class: "4º ano",
    guardian: "Renata Menezes",
    phone: "(21) 98773-8041",
    status: "Ativo",
  },
  {
    name: "Davi Oliveira Costa",
    class: "1º ano",
    guardian: "Patrícia Oliveira",
    phone: "(21) 99618-4420",
    status: "Pendente",
  },
];
const payments = [
  {
    student: "Alice Ferreira Lima",
    due: "10/08/2026",
    value: 850,
    status: "Pago",
  },
  {
    student: "Bernardo Santos",
    due: "10/08/2026",
    value: 920,
    status: "Pendente",
  },
  {
    student: "Clara Menezes Alves",
    due: "10/08/2026",
    value: 920,
    status: "Pago",
  },
  {
    student: "Davi Oliveira Costa",
    due: "10/08/2026",
    value: 850,
    status: "Atrasado",
  },
];
function Heading({ title, desc, action }: { title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {action}
    </div>
  );
}
function Status({ children }: { children: string }) {
  return <span className={`status ${children.toLowerCase()}`}>{children}</span>;
}
export function Dashboard() {
  return (
    <>
      <Heading
        title="Painel"
        desc="Visão geral da operação escolar e fiscal."
        action={
          <button className="primary">
            <FilePlus2 size={18} />
            Nova NFS-e
          </button>
        }
      />
      <div className="notice warning">
        <ShieldCheck />
        <div>
          <strong>Ambiente de homologação</strong>
          <span>A emissão fiscal real está desativada. Você pode preparar e revisar notas com segurança.</span>
        </div>
      </div>
      <section className="stat-grid">
        <article className="stat-card">
          <span className="stat-icon blue">
            <UsersRound />
          </span>
          <div>
            <span>Alunos ativos</span>
            <strong>148</strong>
            <small>
              <ArrowUpRight /> 6 novos este mês
            </small>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon green">
            <CircleDollarSign />
          </span>
          <div>
            <span>Recebido no mês</span>
            <strong>R$ 112.640</strong>
            <small>
              <ArrowUpRight /> 92% das mensalidades
            </small>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon amber">
            <Clock3 />
          </span>
          <div>
            <span>Mensalidades pendentes</span>
            <strong>12</strong>
            <small>R$ 10.780 a receber</small>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon purple">
            <FileCheck2 />
          </span>
          <div>
            <span>Notas preparadas</span>
            <strong>136</strong>
            <small>12 aguardando revisão</small>
          </div>
        </article>
      </section>
      <section className="two-col">
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Mensalidades recentes</h2>
              <p>Acompanhe os últimos pagamentos.</p>
            </div>
            <button className="text-button">Ver todas</button>
          </div>
          <div className="activity-list">
            {payments.slice(0, 3).map((p, i) => (
              <div className="activity" key={p.student}>
                <div className="avatar soft">{p.student[0]}</div>
                <div>
                  <strong>{p.student}</strong>
                  <span>Vencimento {p.due}</span>
                </div>
                <b>{money(p.value)}</b>
                <Status>{p.status}</Status>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Resumo fiscal</h2>
              <p>Competência agosto de 2026.</p>
            </div>
          </div>
          <div className="progress-item">
            <div>
              <span>Notas preparadas</span>
              <b>136 de 148</b>
            </div>
            <progress value="136" max="148" />
          </div>
          <div className="fiscal-total">
            <span>Valor total preparado</span>
            <strong>R$ 116.730,00</strong>
          </div>
          <div className="notice compact">
            <AlertCircle />
            <span>12 notas precisam ser revisadas antes da homologação.</span>
          </div>
        </article>
      </section>
    </>
  );
}

export function Students({ role }: { role: Role }) {
  const [q, setQ] = useState("");
  const list = students.filter((s) => (s.name + s.guardian).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Heading
        title="Alunos e Responsáveis"
        desc="Cadastros acadêmicos, responsáveis financeiros e contatos."
        action={
          role !== "Consulta" ? (
            <button className="primary">
              <Plus size={18} />
              Novo aluno
            </button>
          ) : undefined
        }
      />
      <div className="toolbar">
        <div className="search-input">
          <Search />
          <input placeholder="Buscar por aluno ou responsável" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="secondary">
          <Filter size={17} />
          Filtros
        </button>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Aluno</th>
              <th>Turma</th>
              <th>Responsável</th>
              <th>Contato</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.name}>
                <td>
                  <div className="name-cell">
                    <div className="avatar soft">{s.name[0]}</div>
                    <strong>{s.name}</strong>
                  </div>
                </td>
                <td>{s.class}</td>
                <td>{s.guardian}</td>
                <td>{s.phone}</td>
                <td>
                  <Status>{s.status}</Status>
                </td>
                <td>
                  <button className="icon-button">
                    <MoreHorizontal />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Payments({ role }: { role: Role }) {
  return (
    <>
      <Heading
        title="Mensalidades"
        desc="Controle de cobranças e valores que alimentam a preparação das notas."
        action={
          role !== "Consulta" ? (
            <button className="primary">
              <Plus size={18} />
              Nova cobrança
            </button>
          ) : undefined
        }
      />
      <div className="mini-stats">
        <div>
          <span>Previsto no mês</span>
          <strong>R$ 123.420,00</strong>
        </div>
        <div>
          <span>Recebido</span>
          <strong className="green-text">R$ 112.640,00</strong>
        </div>
        <div>
          <span>Em aberto</span>
          <strong className="amber-text">R$ 10.780,00</strong>
        </div>
      </div>
      <div className="toolbar">
        <div className="search-input">
          <Search />
          <input placeholder="Buscar mensalidade" />
        </div>
        <button className="secondary">
          <SlidersHorizontal size={17} />
          Agosto de 2026
        </button>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Aluno</th>
              <th>Vencimento</th>
              <th>Valor</th>
              <th>Situação</th>
              <th>NFS-e</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.student}>
                <td>
                  <strong>{p.student}</strong>
                </td>
                <td>{p.due}</td>
                <td>{money(p.value)}</td>
                <td>
                  <Status>{p.status}</Status>
                </td>
                <td>
                  <Status>{p.status === "Pago" ? "Preparada" : "Aguardando"}</Status>
                </td>
                <td>
                  <button className="icon-button">
                    <MoreHorizontal />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Invoices({ role }: { role: Role }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({
    "Alice Ferreira Lima": "850,00",
    "Clara Menezes Alves": "920,00",
  });
  return (
    <>
      <Heading
        title="NFS-e"
        desc="Prepare, revise e acompanhe as notas fiscais de serviço."
        action={
          role !== "Consulta" ? (
            <button className="primary">
              <FilePlus2 size={18} />
              Preparar notas
            </button>
          ) : undefined
        }
      />
      <div className="notice warning">
        <ShieldCheck />
        <div>
          <strong>Emissão real bloqueada até homologação</strong>
          <span>Nenhum documento será enviado à prefeitura. Os valores abaixo podem ser revisados livremente.</span>
        </div>
      </div>
      <div className="toolbar">
        <div className="search-input">
          <Search />
          <input placeholder="Buscar nota ou tomador" />
        </div>
        <button className="secondary">
          <Filter size={17} />
          Preparadas
        </button>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Tomador / Aluno</th>
              <th>Competência</th>
              <th>Origem do valor</th>
              <th>Valor da NFS-e</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments
              .filter((p) => p.status === "Pago")
              .map((p) => (
                <tr key={p.student}>
                  <td>
                    <strong>{p.student}</strong>
                    <span className="subcell">Responsável financeiro cadastrado</span>
                  </td>
                  <td>08/2026</td>
                  <td>
                    <span className="auto-tag">
                      <WalletCards size={14} />
                      Mensalidade paga
                    </span>
                  </td>
                  <td>
                    {editing === p.student ? (
                      <div className="inline-edit">
                        <span>R$</span>
                        <input autoFocus value={vals[p.student]} onChange={(e) => setVals({ ...vals, [p.student]: e.target.value })} />
                        <button onClick={() => setEditing(null)}>
                          <Check />
                        </button>
                      </div>
                    ) : (
                      <button className="editable-value" disabled={role === "Consulta"} onClick={() => setEditing(p.student)}>
                        {money(Number(vals[p.student].replace(".", "").replace(",", ".")))} <small>editar</small>
                      </button>
                    )}
                  </td>
                  <td>
                    <Status>Preparada</Status>
                  </td>
                  <td>
                    <button className="icon-button">
                      <MoreHorizontal />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type CompanyConfig = {
  id: boolean;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  inscricao_municipal: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  atividades: string[];
  autorizacoes: Array<{
    tipo: string;
    ato: string;
    data: string;
    curso?: string;
    complemento?: string;
  }>;
  updated_at: string;
};
type Tab = "Empresa" | "Certificado A1" | "Integrações" | "Usuários e Permissões";
export function SettingsPage({accessToken}:{accessToken:string|null}) {
  const [tab, setTab] = useState<Tab>("Empresa");
  return (
    <>
      <Heading title="Configurações" desc="Gerencie os dados da empresa, certificado, conexões, acessos e regras do sistema." />
      <div className="tabs">
        <button className={tab === "Empresa" ? "active" : ""} onClick={() => setTab("Empresa")}>
          <Building2 />
          Empresa
        </button>
        <button className={tab === "Certificado A1" ? "active" : ""} onClick={() => setTab("Certificado A1")}>
          <KeyRound />
          Certificado A1
        </button>
        <button className={tab === "Integrações" ? "active" : ""} onClick={() => setTab("Integrações")}>
          <Link2 />
          Integrações
        </button>
        <button className={tab === "Usuários e Permissões" ? "active" : ""} onClick={() => setTab("Usuários e Permissões")}>
          <UserCog />
          Usuários e Permissões
        </button>
      </div>
      {tab === "Empresa" ? <CompanySettings /> : tab === "Certificado A1" ? <CertificateSettings /> : tab === "Integrações" ? <Integrations accessToken={accessToken} /> : <Permissions />}
    </>
  );
}
function CompanySettings() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [config, setConfig] = useState<CompanyConfig | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("configuracoes_empresa")
      .select("*")
      .eq("id", true)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setConfig(data as CompanyConfig);
      });
  }, [supabase]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    const text = (name: string) => String(f.get(name) || "").trim();
    const logo = f.get("logo") as File;
    if (logo?.size) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(logo.type)) {
        setError("Use uma logo nos formatos PNG, JPG ou WEBP.");
        setBusy(false);
        return;
      }
      if (logo.size > 2 * 1024 * 1024) {
        setError("A logo deve ter no máximo 2 MB.");
        setBusy(false);
        return;
      }
      const { error: logoError } = await supabase.storage.from("logos-empresa").upload("empresa/logo", logo, {
        contentType: logo.type,
        cacheControl: "60",
        upsert: true,
      });
      if (logoError) {
        setError(logoError.message);
        setBusy(false);
        return;
      }
    }
    const payload = {
      cnpj: maskCnpj(text("cnpj")),
      razao_social: text("razao_social").toLocaleUpperCase("pt-BR"),
      nome_fantasia: text("nome_fantasia").toLocaleUpperCase("pt-BR"),
      inscricao_municipal: onlyDigits(text("inscricao_municipal"), 20),
      email: text("email").toLocaleLowerCase("pt-BR"),
      telefone: maskPhone(text("telefone")),
      whatsapp: maskPhone(text("whatsapp")),
      cep: maskCep(text("cep")),
      logradouro: text("logradouro").toLocaleUpperCase("pt-BR"),
      numero: text("numero").toLocaleUpperCase("pt-BR"),
      complemento: text("complemento").toLocaleUpperCase("pt-BR"),
      bairro: text("bairro").toLocaleUpperCase("pt-BR"),
      cidade: text("cidade").toLocaleUpperCase("pt-BR"),
      uf: text("uf").toLocaleUpperCase("pt-BR"),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("configuracoes_empresa").update(payload).eq("id", true).select().single();
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setConfig(data as CompanyConfig);
    setMessage(logo?.size ? "Dados e logomarca salvos. Atualize a página para visualizar a nova identidade." : "Configurações da empresa salvas com sucesso.");
  }
  if (!config) return <div className="panel">{error || "Carregando dados da empresa…"}</div>;
  const publicLogoUrl = supabase?.storage.from("logos-empresa").getPublicUrl("empresa/logo").data.publicUrl;
  const currentLogoUrl = publicLogoUrl ? `${publicLogoUrl}?v=${encodeURIComponent(config.updated_at)}` : null;
  return (
    <div className="company-settings">
      <form className="panel data-form company-form" onSubmit={save} key={config.updated_at}>
        <div className="panel-title">
          <div>
            <h2>Dados da empresa</h2>
            <p>Informações cadastrais usadas na preparação fiscal.</p>
          </div>
        </div>
        {error && <div className="error-box">{error}</div>}
        {message && <div className="success-box">{message}</div>}
        <label className="file-field">
          <span>Logomarca da empresa</span>
          <div className={`company-logo-preview ${logoLoaded ? "loaded" : ""}`}>
            <span className="company-logo-icon"><Building2 size={22} /></span>
            {currentLogoUrl && <img src={currentLogoUrl} alt="Logomarca atualmente cadastrada" onLoad={() => setLogoLoaded(true)} onError={() => setLogoLoaded(false)} />}
            <section><strong>Logomarca atual</strong><small>{logoLoaded ? "Imagem cadastrada no sistema" : "Nenhuma imagem encontrada"}</small></section>
          </div>
          <div>
            <UploadCloud />
            <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
            <small>PNG, JPG ou WEBP — máximo 2 MB</small>
          </div>
        </label>
        <div className="form-row">
          <label>
            CNPJ
            <input name="cnpj" inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" defaultValue={config.cnpj} onInput={(e) => (e.currentTarget.value = maskCnpj(e.currentTarget.value))} required />
          </label>
          <label>
            Inscrição municipal
            <input name="inscricao_municipal" inputMode="numeric" maxLength={20} defaultValue={config.inscricao_municipal || ""} onInput={(e) => (e.currentTarget.value = onlyDigits(e.currentTarget.value, 20))} />
          </label>
        </div>
        <label>
          Razão social
          <input name="razao_social" defaultValue={config.razao_social} onInput={upperCompanyInput} required />
        </label>
        <label>
          Nome fantasia
          <input name="nome_fantasia" defaultValue={config.nome_fantasia || ""} onInput={upperCompanyInput} />
        </label>
        <div className="form-row">
          <label>
            E-mail
            <input name="email" type="email" inputMode="email" defaultValue={config.email || ""} onInput={(e) => (e.currentTarget.value = e.currentTarget.value.toLocaleLowerCase("pt-BR"))} />
          </label>
          <label>
            Telefone
            <input name="telefone" inputMode="tel" maxLength={15} placeholder="(00) 0000-0000" defaultValue={config.telefone || ""} onInput={(e) => (e.currentTarget.value = maskPhone(e.currentTarget.value))} />
          </label>
        </div>
        <div className="form-row">
          <label>
            WhatsApp
            <input name="whatsapp" inputMode="tel" maxLength={15} placeholder="(00) 00000-0000" defaultValue={config.whatsapp || ""} onInput={(e) => (e.currentTarget.value = maskPhone(e.currentTarget.value))} />
          </label>
          <label>
            CEP
            <input name="cep" inputMode="numeric" maxLength={9} placeholder="00000-000" defaultValue={config.cep || ""} onInput={(e) => (e.currentTarget.value = maskCep(e.currentTarget.value))} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Logradouro
            <input name="logradouro" defaultValue={config.logradouro || ""} onInput={upperCompanyInput} />
          </label>
          <label>
            Número
            <input name="numero" defaultValue={config.numero || ""} onInput={upperCompanyInput} />
          </label>
        </div>
        <label>
          Complemento
          <input name="complemento" defaultValue={config.complemento || ""} onInput={upperCompanyInput} />
        </label>
        <div className="form-row">
          <label>
            Bairro
            <input name="bairro" defaultValue={config.bairro || ""} onInput={upperCompanyInput} />
          </label>
          <label>
            Cidade
            <input name="cidade" defaultValue={config.cidade || ""} onInput={upperCompanyInput} />
          </label>
        </div>
        <label>
          UF
          <input name="uf" maxLength={2} placeholder="RJ" defaultValue={config.uf || ""} onInput={upperCompanyInput} />
        </label>
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar configurações"}
          </button>
        </div>
      </form>
      <div className="company-side">
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Atividades educacionais</h2>
              <p>Níveis e cursos oferecidos pela instituição.</p>
            </div>
          </div>
          <ul className="config-list">
            {config.atividades.map((item) => (
              <li key={item}>
                <Check />
                {item}
              </li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Autorizações e reconhecimentos</h2>
              <p>Atos oficiais informados pela instituição.</p>
            </div>
          </div>
          <div className="authorization-list">
            {config.autorizacoes.map((item) => (
              <div key={item.ato}>
                <Status>{item.tipo}</Status>
                <strong>{item.curso || item.ato}</strong>
                {item.curso && <span>{item.ato}</span>}
                <span>{item.data}</span>
                {item.complemento && <small>{item.complemento}</small>}
              </div>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
type CertificateRow = {
  id: string;
  arquivo_nome: string;
  arquivo_caminho: string;
  emissao: string | null;
  validade: string;
  titular: string | null;
  cnpj: string | null;
  emissor: string | null;
  numero_serie: string | null;
  status: string;
  created_at: string;
  substituido_at: string | null;
};
type CertificateMetadata = {
  validFrom: string;
  validTo: string;
  holder: string;
  cnpj: string;
  issuer: string;
  serialNumber: string;
};
function CertificateSettings() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [items, setItems] = useState<CertificateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [metadata, setMetadata] = useState<CertificateMetadata | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("certificados_a1").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setItems((data || []) as CertificateRow[]);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    setMetadata(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get("certificado") as File;
    const password = String(f.get("senha") || "");
    const extension = file?.name.split(".").pop()?.toLowerCase();
    if (!file || !["pfx", "p12"].includes(extension || "")) {
      setError("Selecione um certificado A1 nos formatos .pfx ou .p12.");
      setBusy(false);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("O certificado deve ter no máximo 5 MB.");
      setBusy(false);
      return;
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError("Sessão expirada. Entre novamente para enviar o certificado.");
      setBusy(false);
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setError("Sessão expirada. Entre novamente para ler o certificado.");
      setBusy(false);
      return;
    }
    const inspectForm = new FormData();
    inspectForm.set("certificate", file);
    inspectForm.set("password", password);
    const inspectResponse = await fetch("/api/certificates/inspect", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: inspectForm,
    });
    const inspected = (await inspectResponse.json()) as CertificateMetadata & {
      error?: string;
    };
    if (!inspectResponse.ok) {
      setError(inspected.error || "Não foi possível ler o certificado.");
      setBusy(false);
      return;
    }
    const { data: company } = await supabase.from("configuracoes_empresa").select("cnpj").eq("id", true).maybeSingle();
    if (inspected.cnpj && company?.cnpj && onlyDigits(inspected.cnpj, 14) !== onlyDigits(company.cnpj, 14)) {
      setError(`O certificado pertence ao CNPJ ${maskCnpj(inspected.cnpj)}, diferente da empresa cadastrada.`);
      setBusy(false);
      return;
    }
    const validade = inspected.validTo;
    setMetadata(inspected);
    const active = items.find((item) => item.status === "ATIVO");
    const path = `certificado-a1/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("certificados-a1").upload(path, file, {
      contentType: file.type || "application/x-pkcs12",
      upsert: false,
    });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }
    const { error: insertError } = await supabase.from("certificados_a1").insert({
      arquivo_nome: file.name,
      arquivo_caminho: path,
      emissao: inspected.validFrom,
      validade,
      titular: inspected.holder || null,
      cnpj: inspected.cnpj || null,
      emissor: inspected.issuer || null,
      numero_serie: inspected.serialNumber || null,
      enviado_por: userData.user.id,
    });
    if (insertError) {
      await supabase.storage.from("certificados-a1").remove([path]);
      setError(insertError.message);
      setBusy(false);
      return;
    }
    if (active) {
      await supabase
        .from("certificados_a1")
        .update({
          status: "SUBSTITUIDO",
          substituido_at: new Date().toISOString(),
        })
        .eq("id", active.id);
      await supabase.storage.from("certificados-a1").remove([active.arquivo_caminho]);
    }
    const { error: alertError } = await supabase.from("certificado_a1_alerta").upsert({ id: true, validade, updated_at: new Date().toISOString() });
    if (alertError) {
      setError("Certificado salvo, mas não foi possível atualizar o aviso do Painel.");
      setBusy(false);
      await load();
      return;
    }
    window.dispatchEvent(new Event("jpi-certificate-updated"));
    form.reset();
    setMessage(active ? "Certificado lido e substituído com segurança." : "Certificado lido e anexado com segurança.");
    setBusy(false);
    await load();
  }
  async function deleteCertificate() {
    if (!supabase || items.length === 0) return;
    const confirmed = window.confirm("EXCLUSÃO DEFINITIVA\n\nEsta ação apagará o certificado A1, todos os arquivos armazenados, o histórico e o aviso de validade. Deseja continuar?");
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setMessage("");
    const { data: storedFiles, error: listError } = await supabase.storage.from("certificados-a1").list("certificado-a1", { limit: 1000 });
    if (listError) {
      setError("Não foi possível conferir os arquivos privados antes da exclusão.");
      setBusy(false);
      return;
    }
    const paths = Array.from(
      new Set([
        ...items.map((item) => item.arquivo_caminho),
        ...(storedFiles || []).filter((file) => file.name !== ".emptyFolderPlaceholder").map((file) => `certificado-a1/${file.name}`),
      ]),
    );
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from("certificados-a1").remove(paths);
      if (storageError) {
        setError("A exclusão foi interrompida porque o arquivo privado não pôde ser removido.");
        setBusy(false);
        return;
      }
    }
    const { error: rowsError } = await supabase.from("certificados_a1").delete().in(
      "id",
      items.map((item) => item.id),
    );
    if (rowsError) {
      setError("O arquivo foi removido, mas o banco ainda precisa ser limpo. Tente excluir novamente.");
      setBusy(false);
      return;
    }
    const { error: alertError } = await supabase.from("certificado_a1_alerta").delete().eq("id", true);
    if (alertError) {
      setError("O certificado foi excluído, mas o aviso de validade ainda precisa ser removido. Tente novamente.");
      setBusy(false);
      return;
    }
    setItems([]);
    setMetadata(null);
    setMessage("Certificado, arquivos, histórico e aviso de validade excluídos definitivamente.");
    window.dispatchEvent(new Event("jpi-certificate-updated"));
    setBusy(false);
  }
  const active = items.find((item) => item.status === "ATIVO");
  const days = active ? Math.ceil((new Date(`${active.validade}T23:59:59`).getTime() - Date.now()) / 86400000) : null;
  return (
    <div className="certificate-settings">
      <div className="notice warning">
        <ShieldCheck />
        <div>
          <strong>Emissão fiscal real permanece bloqueada</strong>
          <span>O certificado será utilizado somente depois da homologação da integração NFS-e.</span>
        </div>
      </div>
      <div className="company-settings">
        <form className="panel data-form company-form" onSubmit={upload}>
          <div className="panel-title">
            <div>
              <h2>{active ? "Substituir certificado A1" : "Anexar certificado A1"}</h2>
              <p>Arquivo privado acessível somente ao Administrador.</p>
            </div>
          </div>
          {error && <div className="error-box">{error}</div>}
          {message && <div className="success-box">{message}</div>}
          <label className="file-field">
            <span>Arquivo do certificado</span>
            <div>
              <UploadCloud />
              <input name="certificado" type="file" accept=".pfx,.p12,application/x-pkcs12,application/pkcs12" required />
              <small>Formatos .PFX ou .P12 — máximo 5 MB</small>
            </div>
          </label>
          <label>
            Senha do certificado
            <input name="senha" type="password" autoComplete="off" placeholder="Informe a senha do arquivo A1" required />
          </label>
          <div className="notice compact">
            <KeyRound />
            <span>A validade e os dados do titular serão lidos automaticamente. A senha é usada somente durante a leitura e não será armazenada.</span>
          </div>
          {metadata && (
            <div className="certificate-metadata">
              <strong>Dados reconhecidos no certificado</strong>
              <span>Titular: {metadata.holder || "Não informado"}</span>
              <span>CNPJ: {metadata.cnpj ? maskCnpj(metadata.cnpj) : "Não informado"}</span>
              <span>Emissão: {new Date(`${metadata.validFrom}T12:00:00`).toLocaleDateString("pt-BR")}</span>
              <span>Validade: {new Date(`${metadata.validTo}T12:00:00`).toLocaleDateString("pt-BR")}</span>
              <small>Emissor: {metadata.issuer || "Não informado"}</small>
            </div>
          )}
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Enviando…" : active ? "Substituir certificado" : "Salvar certificado"}
            </button>
          </div>
        </form>
        <div className="company-side">
          <article className="panel certificate-current">
            <div className="panel-title">
              <div>
                <h2>Certificado atual</h2>
                <p>Situação e validade.</p>
              </div>
              {active && <Status>Ativo</Status>}
            </div>
            {active ? (
              <>
                <strong>{active.arquivo_nome}</strong>
                <div className={`expiry-box ${days !== null && days <= 30 ? "urgent" : ""}`}>
                  <span>Validade</span>
                  <b>{new Date(`${active.validade}T12:00:00`).toLocaleDateString("pt-BR")}</b>
                  <small>{days !== null && days >= 0 ? `${days} dias restantes` : "Certificado vencido"}</small>
                </div>
                {active.titular ? (
                  <div className="certificate-saved-data">
                    <strong>Dados gravados no banco</strong>
                    <span>Titular: {active.titular}</span>
                    <span>CNPJ: {active.cnpj ? maskCnpj(active.cnpj) : "Não informado"}</span>
                    <span>Emissão: {active.emissao ? new Date(`${active.emissao}T12:00:00`).toLocaleDateString("pt-BR") : "Não informada"}</span>
                    <span>Emissor: {active.emissor || "Não informado"}</span>
                    <small>Número de série: {active.numero_serie || "Não informado"}</small>
                  </div>
                ) : (
                  <div className="notice compact warning"><AlertCircle /><span>Importe novamente este certificado para gravar permanentemente os dados detalhados.</span></div>
                )}
              </>
            ) : (
              <div className="empty-certificate">
                <KeyRound />
                <span>Nenhum certificado anexado.</span>
              </div>
            )}
            {items.length > 0 && (
              <button type="button" className="danger full certificate-delete" disabled={busy} onClick={deleteCertificate}>
                <Trash2 size={17} />
                {busy ? "Excluindo…" : "Excluir certificado completamente"}
              </button>
            )}
          </article>
          <article className="panel">
            <div className="panel-title">
              <div>
                <h2>Histórico</h2>
                <p>Substituições realizadas.</p>
              </div>
            </div>
            <div className="authorization-list">
              {items.length ? (
                items.map((item) => (
                  <div key={item.id}>
                    <Status>{item.status === "ATIVO" ? "Ativo" : "Substituído"}</Status>
                    <strong>{item.arquivo_nome}</strong>
                    {item.titular && <span>{item.titular}</span>}
                    {item.cnpj && <span>CNPJ: {maskCnpj(item.cnpj)}</span>}
                    {item.emissao && <span>Emissão: {new Date(`${item.emissao}T12:00:00`).toLocaleDateString("pt-BR")}</span>}
                    <span>Validade: {new Date(`${item.validade}T12:00:00`).toLocaleDateString("pt-BR")}</span>
                    {item.emissor && <span>Emissor: {item.emissor}</span>}
                    {item.numero_serie && <small>Número de série: {item.numero_serie}</small>}
                    <small>Enviado em {new Date(item.created_at).toLocaleString("pt-BR")}</small>
                    {item.substituido_at && <small>Substituído em {new Date(item.substituido_at).toLocaleString("pt-BR")}</small>}
                  </div>
                ))
              ) : (
                <span className="muted">Nenhum histórico disponível.</span>
              )}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
function Integrations({accessToken}:{accessToken:string|null}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [connectionStage, setConnectionStage] = useState("");
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now() - elapsed * 1000;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [busy, elapsed]);
  useEffect(() => {
    if (!busy) return;
    const watchdog = window.setTimeout(() => {
      setBusy(false);
      setConnectionStage("");
      setError("A preparação da conexão foi encerrada após 25 segundos. Atualize a página e entre novamente se o problema continuar.");
    }, 25000);
    return () => window.clearTimeout(watchdog);
  }, [busy]);
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  async function testHomologation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setElapsed(0);setBusy(true);setError("");setMessage("");setConnectionStage("Preparando certificado A1…");
    const token = accessToken;
    if (!token) { setError("Sessão expirada. Saia do sistema e entre novamente.");setBusy(false);setConnectionStage("");return; }
    const form = new FormData(event.currentTarget);
    const controller = new AbortController();
    let timeout = 0;
    try {
      setConnectionStage("Conectando ao Emissor Nacional de testes…");
      const response = await Promise.race([
        fetch("/api/nfse/homologation/test", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: controller.signal }),
        new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error("JPI_CONNECTION_TIMEOUT")), 25000); }),
      ]);
      const result = await response.json() as { ok?:boolean;environment?:string;error?:string };
      if (!response.ok || !result.ok) { setError(result.error || "Não foi possível testar a integração.");return; }
      setTested(true);setMessage(`Conexão segura confirmada no ambiente de ${result.environment}. Nenhuma nota foi emitida.`);
    } catch (requestError) {
      const timedOut = requestError instanceof Error && (requestError.message === "JPI_CONNECTION_TIMEOUT" || requestError.name === "AbortError");
      if (timedOut) controller.abort();
      setError(timedOut ? "A conexão foi encerrada após 25 segundos sem resposta. O ambiente nacional ou o acesso ao certificado não respondeu." : "A conexão foi interrompida. Confira sua internet e tente novamente.");
    } finally {
      if (timeout) window.clearTimeout(timeout);setBusy(false);setConnectionStage("");
    }
  }
  return (
    <><div className="settings-grid">
      <article className="integration-card">
        <div className="integration-head">
          <span className="integration-icon green">
            <Building2 />
          </span>
          <Status>Conectado</Status>
        </div>
        <h3>Supabase</h3>
        <p>Banco de dados, autenticação e sessões do JPI Fiscal.</p>
        <div className="integration-meta">
          <span>Ambiente atual</span>
          <strong>Produção</strong>
        </div>
        <button className="secondary full">Ver configuração</button>
      </article>
      <article className="integration-card">
        <div className="integration-head">
          <span className="integration-icon blue">
            <FileCheck2 />
          </span>
          <Status>{tested ? "Conectado" : "Homologação"}</Status>
        </div>
        <h3>Provedor de NFS-e</h3>
        <p>Integração municipal preparada, sem envio fiscal real.</p>
        <div className="integration-meta">
          <span>Emissão real</span>
          <strong className="amber-text">Desativada</strong>
        </div>
        <button className="secondary full" onClick={() => { setOpen(true);setError("");setMessage(""); }}>Testar conexão segura</button>
      </article>
      <article className="integration-card">
        <div className="integration-head">
          <span className="integration-icon purple">
            <Link2 />
          </span>
          <Status>Pendente</Status>
        </div>
        <h3>Comunicações</h3>
        <p>Configure e-mail e WhatsApp para recibos e avisos.</p>
        <div className="integration-meta">
          <span>Canal</span>
          <strong>Não configurado</strong>
        </div>
        <button className="secondary full">Configurar canais</button>
      </article>
    </div>{open&&<div className="modal-backdrop"><div className="modal-card small-modal"><div className="modal-head"><h2>Testar ambiente de homologação</h2><button className="icon-button" onClick={()=>setOpen(false)}><X/></button></div><form className="data-form" onSubmit={testHomologation}>{error&&<div className="error-box">{error}</div>}{message&&<div className="success-box">{message}</div>}<div className="notice compact warning"><ShieldCheck/><span>Este teste usa o certificado A1 somente para autenticar a conexão com a produção restrita. Nenhuma DPS ou NFS-e será enviada.</span></div>{(busy||elapsed>0)&&<div className="connection-timer"><Clock3/><span>{busy?(connectionStage||"Iniciando conexão…"):"Tempo da tentativa"}</span><strong>{elapsedLabel}</strong></div>}<label>Senha do certificado A1<input name="password" type="password" autoComplete="off" required disabled={busy}/></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)} disabled={busy}>Fechar</button><button className="primary" disabled={busy||tested}>{busy?`Conectando · ${elapsedLabel}`:tested?"Conexão confirmada":"Testar conexão"}</button></div></form></div></div>}</>
  );
}
type ManagedUser = {
  id: number;
  user_id: string | null;
  nome: string | null;
  email: string;
  role: "admin" | "financeiro" | "secretaria" | "consulta";
  active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  invited_at: string | null;
};
const roleLabels = {
  admin: "Administrador",
  financeiro: "Financeiro",
  secretaria: "Secretaria",
  consulta: "Consulta",
} as const;
function Permissions() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    setError("");
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "list" },
    });
    if (error || data?.error) setError(data?.error || error?.message || "Não foi possível carregar os usuários.");
    else setRows(data.users || []);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load]);
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: {
        action: "invite",
        nome: f.get("nome"),
        email: String(f.get("email") || "").toLowerCase(),
        role: f.get("role"),
      },
    });
    setBusy(false);
    if (error || data?.error) {
      setError(data?.error || error?.message || "Não foi possível enviar o convite.");
      return;
    }
    setOpen(false);
    setMessage("Convite enviado por e-mail com sucesso.");
    await load();
  }
  async function updateUser(user: ManagedUser, changes: Partial<Pick<ManagedUser, "role" | "active">>) {
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    const next = {
      role: changes.role ?? user.role,
      active: changes.active ?? user.active,
    };
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "update", id: user.id, ...next },
    });
    setBusy(false);
    if (error || data?.error) {
      setError(data?.error || error?.message || "Não foi possível atualizar o usuário.");
      return;
    }
    setMessage("Permissões atualizadas com sucesso.");
    await load();
  }
  return (
    <>
      {error && <div className="error-box page-error">{error}</div>}
      {message && <div className="success-box settings-message">{message}</div>}
      <div className="permission-legend">
        <div>
          <ShieldCheck />
          <div>
            <strong>Controle por nível de acesso</strong>
            <p>Administrador gerencia tudo; Financeiro opera cobranças e NFS-e; Secretaria cuida dos cadastros; Consulta apenas visualiza.</p>
          </div>
        </div>
        <button className="primary" onClick={() => setOpen(true)}>
          <Plus />
          Convidar usuário
        </button>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Nível de acesso</th>
              <th>Status</th>
              <th>Último acesso</th>
              <th>Acesso</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="name-cell">
                    <div className="avatar soft">{(u.nome || u.email)[0].toUpperCase()}</div>
                    <div>
                      <strong>{u.nome || "USUÁRIO CONVIDADO"}</strong>
                      <span className="subcell">{u.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <select
                    className="role-select"
                    value={u.role}
                    disabled={busy}
                    onChange={(e) =>
                      updateUser(u, {
                        role: e.target.value as ManagedUser["role"],
                      })
                    }
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Status>{u.active ? "Ativo" : "Bloqueado"}</Status>
                </td>
                <td>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("pt-BR") : u.invited_at ? "Convite pendente" : "Nunca acessou"}</td>
                <td>
                  <button className={`access-toggle ${u.active ? "active" : "blocked"}`} disabled={busy} onClick={() => updateUser(u, { active: !u.active })}>
                    {u.active ? "Bloquear" : "Ativar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && <div className="empty-row">Carregando usuários…</div>}
      </div>
      {open && (
        <div className="modal-backdrop">
          <div className="modal-card small-modal">
            <div className="modal-head">
              <h2>Convidar usuário</h2>
              <button className="icon-button" onClick={() => setOpen(false)}>
                <X />
              </button>
            </div>
            <form className="data-form" onSubmit={invite}>
              <label>
                Nome completo
                <input name="nome" onInput={upperCompanyInput} required />
              </label>
              <label>
                E-mail
                <input name="email" type="email" onInput={(e) => (e.currentTarget.value = e.currentTarget.value.toLocaleLowerCase("pt-BR"))} required />
              </label>
              <label>
                Nível de acesso
                <select name="role" defaultValue="consulta">
                  <option value="admin">Administrador</option>
                  <option value="financeiro">Financeiro</option>
                  <option value="secretaria">Secretaria</option>
                  <option value="consulta">Consulta</option>
                </select>
              </label>
              <div className="notice compact">
                <ShieldCheck />
                <span>O usuário receberá um link seguro para acessar e definir sua senha.</span>
              </div>
              <div className="form-actions">
                <button type="button" className="secondary" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Enviando…" : "Enviar convite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
