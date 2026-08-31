"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, Building2, CalendarDays, Check, CircleDollarSign, Clock3, FileCheck2, FilePlus2, Filter, KeyRound, Link2, Mail, MessageCircle, MoreHorizontal, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, UploadCloud, UserCog, UsersRound, WalletCards, X } from "lucide-react";
import type { Role } from "./app-shell";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { TransmissionProgress } from "./transmission-progress";
import { AgendaEduStudentLinks } from "./agenda-edu-student-links";

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
const maskWhatsappPhone = (value: string) => {
  const raw = value.replace(/\D/g, "");
  const national = raw.startsWith("55") && raw.length > 11 ? raw.slice(2) : raw;
  return maskPhone(national);
};
const maskCep = (value: string) => onlyDigits(value, 8).replace(/^(\d{5})(\d)/, "$1-$2");
const upperCompanyInput = (event: React.FormEvent<HTMLInputElement>) => {
  event.currentTarget.value = event.currentTarget.value.toLocaleUpperCase("pt-BR");
};
const students: Array<{name:string;class:string;guardian:string;phone:string;status:string}>=[];
const payments: Array<{student:string;due:string;value:number;status:string}>=[];
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
            <strong>—</strong>
            <small>
              <ArrowUpRight /> Consulte os dados atuais
            </small>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon green">
            <CircleDollarSign />
          </span>
          <div>
            <span>Recebido no mês</span>
            <strong>—</strong>
            <small>
              <ArrowUpRight /> Consulte os dados atuais
            </small>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon amber">
            <Clock3 />
          </span>
          <div>
            <span>Mensalidades pendentes</span>
            <strong>—</strong>
            <small>Consulte os dados atuais</small>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon purple">
            <FileCheck2 />
          </span>
          <div>
            <span>Notas preparadas</span>
            <strong>—</strong>
            <small>Consulte os dados atuais</small>
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
              <b>Dados atuais</b>
            </div>
            <progress value="0" max="1" />
          </div>
          <div className="fiscal-total">
            <span>Valor total preparado</span>
            <strong>—</strong>
          </div>
          <div className="notice compact">
            <AlertCircle />
            <span>Consulte as notas atuais antes da homologação.</span>
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
  const [vals, setVals] = useState<Record<string, string>>({});
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
  regime_tributario: string;
  pis_aliquota: number;
  cofins_aliquota: number;
  pis_cofins_cst: string;
  pis_cofins_retencao: number;
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
    const pisRate = Number(text("pis_aliquota").replace(",", "."));
    const cofinsRate = Number(text("cofins_aliquota").replace(",", "."));
    if (!Number.isFinite(pisRate) || pisRate < 0 || pisRate > 100 || !Number.isFinite(cofinsRate) || cofinsRate < 0 || cofinsRate > 100) {
      setError("Informe alíquotas válidas de PIS e COFINS entre 0 e 100%.");
      setBusy(false);
      return;
    }
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
      regime_tributario: text("regime_tributario").toLocaleUpperCase("pt-BR"),
      pis_aliquota: pisRate,
      cofins_aliquota: cofinsRate,
      pis_cofins_cst: onlyDigits(text("pis_cofins_cst"), 2),
      pis_cofins_retencao: Number(text("pis_cofins_retencao")),
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
        <div className="panel-title">
          <div>
            <h2>Configuração fiscal</h2>
            <p>Tributação aplicada às próximas DPS de homologação.</p>
          </div>
        </div>
        <label>
          Regime tributário
          <select name="regime_tributario" defaultValue={config.regime_tributario} required>
            <option value="LUCRO PRESUMIDO">Lucro Presumido</option>
          </select>
        </label>
        <div className="form-row">
          <label>
            Alíquota do PIS (%)
            <input name="pis_aliquota" type="number" inputMode="decimal" min="0" max="100" step="0.01" defaultValue={Number(config.pis_aliquota)} required />
          </label>
          <label>
            Alíquota da COFINS (%)
            <input name="cofins_aliquota" type="number" inputMode="decimal" min="0" max="100" step="0.01" defaultValue={Number(config.cofins_aliquota)} required />
          </label>
        </div>
        <div className="form-row">
          <label>
            CST do PIS/COFINS
            <select name="pis_cofins_cst" defaultValue={config.pis_cofins_cst} required>
              <option value="01">01 — Operação tributável com alíquota básica</option>
            </select>
          </label>
          <label>
            Retenção do PIS/COFINS/CSLL
            <select name="pis_cofins_retencao" defaultValue={String(config.pis_cofins_retencao)} required>
              <option value="0">0 — Não retidos</option>
            </select>
          </label>
        </div>
        <div className="notice compact">
          <ShieldCheck />
          <span>Configuração baseada na NFS-e real conferida: PIS 0,65%, COFINS 3,00%, apuração própria e sem retenção.</span>
        </div>
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
  senha_configurada: boolean;
  senha_configurada_em: string | null;
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
async function savePasswordInVault(certificateId: string, password: string, accessToken: string) {
  const response = await authenticatedFetch("/api/certificates/password", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ certificateId, password }),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível guardar a senha no cofre seguro.");
}
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
    const inspectResponse = await authenticatedFetch("/api/certificates/inspect", {
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
    const { data: inserted, error: insertError } = await supabase.from("certificados_a1").insert({
      arquivo_nome: file.name,
      arquivo_caminho: path,
      emissao: inspected.validFrom,
      validade,
      titular: inspected.holder || null,
      cnpj: inspected.cnpj || null,
      emissor: inspected.issuer || null,
      numero_serie: inspected.serialNumber || null,
      enviado_por: userData.user.id,
    }).select("id").single();
    if (insertError || !inserted) {
      await supabase.storage.from("certificados-a1").remove([path]);
      setError(insertError?.message || "Não foi possível registrar o certificado.");
      setBusy(false);
      return;
    }
    try {
      await savePasswordInVault(inserted.id, password, accessToken);
    } catch (vaultError) {
      await supabase.from("certificados_a1").delete().eq("id", inserted.id);
      await supabase.storage.from("certificados-a1").remove([path]);
      setError(vaultError instanceof Error ? vaultError.message : "Não foi possível proteger a senha do certificado.");
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
    setMessage(active ? "Certificado substituído e senha protegida no cofre seguro." : "Certificado anexado e senha protegida no cofre seguro.");
    setBusy(false);
    await load();
  }
  async function saveCurrentPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !active) return;
    const form = event.currentTarget;
    const password = String(new FormData(form).get("senha_atual") || "");
    if (!password) {
      setError("Informe a senha do certificado A1 atual.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setError("Sessão expirada. Entre novamente para guardar a senha.");
      setBusy(false);
      return;
    }
    try {
      await savePasswordInVault(active.id, password, accessToken);
      form.reset();
      setMessage("Senha conferida e guardada no cofre seguro. As próximas homologações não pedirão a senha.");
      await load();
    } catch (vaultError) {
      setError(vaultError instanceof Error ? vaultError.message : "Não foi possível guardar a senha.");
    } finally {
      setBusy(false);
    }
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
    setMessage("Certificado, senha protegida, arquivos, histórico e aviso de validade excluídos definitivamente.");
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
            <span>A validade e os dados do titular serão lidos automaticamente. A senha será criptografada no Supabase Vault e não ficará exposta no cadastro.</span>
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
                <div className={`notice compact ${active.senha_configurada ? "" : "warning"}`}>
                  <KeyRound />
                  <span>{active.senha_configurada
                    ? `Senha protegida no cofre${active.senha_configurada_em ? ` desde ${new Date(active.senha_configurada_em).toLocaleString("pt-BR")}` : ""}. As homologações usarão o A1 automaticamente.`
                    : "Senha automática ainda não configurada. Informe-a uma única vez abaixo para liberar as homologações sem nova digitação."}</span>
                </div>
                <form className="data-form certificate-password-form" onSubmit={saveCurrentPassword}>
                  <label>
                    {active.senha_configurada ? "Atualizar senha protegida" : "Guardar senha do certificado"}
                    <input name="senha_atual" type="password" autoComplete="off" maxLength={256} placeholder="Informe a senha do A1 atual" required />
                  </label>
                  <button className="secondary full" disabled={busy}>
                    <KeyRound size={17} />
                    {busy ? "Protegendo…" : active.senha_configurada ? "Conferir e atualizar senha" : "Guardar senha com segurança"}
                  </button>
                </form>
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
type WhatsappManualSenderSetting = {id?:number;nome:string;numero:string;ativo:boolean;ordem:number};
type CommunicationConfig = {
  email_provider: string;
  email_from_name: string;
  email_from_address: string | null;
  email_reply_to: string | null;
  email_smtp_host: string | null;
  email_smtp_port: number;
  email_smtp_username: string | null;
  email_credencial_configurada: boolean;
  email_testada_em: string | null;
  email_ultimo_status: string;
  whatsapp_provider: string;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  whatsapp_sender_number: string | null;
  whatsapp_template_name: string;
  whatsapp_test_recipient: string | null;
  whatsapp_token_configurado: boolean;
  whatsapp_testada_em: string | null;
  whatsapp_ultimo_status: string;
  agenda_edu_provider: string;
  agenda_edu_school_identifier: string | null;
  agenda_edu_channel_id: string | null;
  agenda_edu_environment: string;
  agenda_edu_documentacao_confirmada: boolean;
  agenda_edu_credencial_configurada: boolean;
  agenda_edu_testada_em: string | null;
  agenda_edu_ultimo_status: string;
};

function CommunicationsSettings({accessToken,onClose,onChanged}:{accessToken:string|null;onClose:()=>void;onChanged:(config:CommunicationConfig)=>void}) {
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [config,setConfig]=useState<CommunicationConfig|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [fromName,setFromName]=useState("JPI Fiscal");
  const [fromAddress,setFromAddress]=useState("nfse@jejoaopaulo.com.br");
  const [replyTo,setReplyTo]=useState("");
  const [emailProvider,setEmailProvider]=useState("locaweb_email");
  const [smtpUsername,setSmtpUsername]=useState("nfse@jejoaopaulo.com.br");
  const [emailCredential,setEmailCredential]=useState("");
  const [testRecipient,setTestRecipient]=useState("nfse@jejoaopaulo.com.br");
  const [phoneNumberId,setPhoneNumberId]=useState("");
  const [businessAccountId,setBusinessAccountId]=useState("");
  const [senderNumber,setSenderNumber]=useState("");
  const [templateName,setTemplateName]=useState("envio_nfse");
  const [whatsappTestRecipient,setWhatsappTestRecipient]=useState("");
  const [manualSenders,setManualSenders]=useState<WhatsappManualSenderSetting[]>([]);
  const [accessTokenMeta,setAccessTokenMeta]=useState("");
  const [agendaEduSchoolIdentifier,setAgendaEduSchoolIdentifier]=useState("");
  const [agendaEduChannelId,setAgendaEduChannelId]=useState("");
  const [agendaEduClientId,setAgendaEduClientId]=useState("");
  const [agendaEduClientSecret,setAgendaEduClientSecret]=useState("");
  const [agendaEduSchoolToken,setAgendaEduSchoolToken]=useState("");

  const load=useCallback(async()=>{
    if(!accessToken){setError("Sessão expirada. Entre novamente.");setLoading(false);return;}
    try{
      const response=await authenticatedFetch("/api/integrations/communications",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {config?:CommunicationConfig;error?:string};
      if(response.status===401)window.dispatchEvent(new Event("jpi-session-invalid"));
      if(!response.ok||!data.config)throw new Error(data.error||"Não foi possível carregar as integrações.");
      const current=data.config;setConfig(current);onChanged(current);
      setFromName(current.email_from_name||"JPI Fiscal");setFromAddress(current.email_from_address||"nfse@jejoaopaulo.com.br");setReplyTo(current.email_reply_to||"");setEmailProvider(current.email_provider||"locaweb_email");setSmtpUsername(current.email_smtp_username||current.email_from_address||"nfse@jejoaopaulo.com.br");
      setPhoneNumberId(current.whatsapp_phone_number_id||"");setBusinessAccountId(current.whatsapp_business_account_id||"");setSenderNumber(maskWhatsappPhone(current.whatsapp_sender_number||""));setTemplateName(current.whatsapp_template_name||"envio_nfse");setWhatsappTestRecipient(maskWhatsappPhone(current.whatsapp_test_recipient||""));
      if(supabase){const senderResult=await supabase.from("whatsapp_manual_senders").select("id,nome,numero,ativo,ordem").order("ordem",{ascending:true}).order("id",{ascending:true});if(!senderResult.error)setManualSenders(((senderResult.data||[]) as WhatsappManualSenderSetting[]).map(sender=>({...sender,numero:maskWhatsappPhone(sender.numero)})));}
      setAgendaEduSchoolIdentifier(current.agenda_edu_school_identifier||"");
      setAgendaEduChannelId(current.agenda_edu_channel_id||"");
    }catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível carregar as integrações.");}
    finally{setLoading(false);}
  },[accessToken,onChanged,supabase]);
  useEffect(()=>{load();},[load]);

  async function run(action:string,payload:Record<string,string>){
    if(!accessToken)throw new Error("Sessão expirada. Entre novamente.");
    const response=await authenticatedFetch("/api/integrations/communications",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action,...payload}),cache:"no-store"});
    const data=await response.json().catch(()=>({})) as {message?:string;error?:string};
    if(response.status===401)window.dispatchEvent(new Event("jpi-session-invalid"));
    if(!response.ok)throw new Error(data.error||"Não foi possível concluir a operação.");
    return data.message||"Operação concluída.";
  }
  async function saveEmail(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy("save-email");setError("");setMessage("");try{setMessage(await run("save-email",{provider:emailProvider,fromName,fromAddress,replyTo,smtpUsername,credential:emailCredential}));setEmailCredential("");await load();}catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível salvar o e-mail.");}finally{setBusy("");}}
  async function testEmail(){setBusy("test-email");setError("");setMessage("");try{setMessage(await run("test-email",{recipient:testRecipient}));await load();}catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível testar o e-mail.");}finally{setBusy("");}}
  async function saveWhatsapp(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy("save-whatsapp");setError("");setMessage("");try{setMessage(await run("save-whatsapp",{phoneNumberId,businessAccountId,senderNumber,testRecipient:whatsappTestRecipient,templateName,accessToken:accessTokenMeta}));setAccessTokenMeta("");await load();}catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível salvar o WhatsApp.");}finally{setBusy("");}}
  async function saveManualSenders(){if(!supabase)return;setBusy("save-manual-senders");setError("");setMessage("");try{const normalized=manualSenders.filter(sender=>sender.nome.trim()||sender.numero.trim()).slice(0,4).map((sender,index)=>({nome:sender.nome.trim(),numero:sender.numero.trim(),ativo:sender.ativo,ordem:index+1}));if(!normalized.length)throw new Error("Cadastre pelo menos uma conta de WhatsApp da escola.");const {data,error}=await supabase.rpc("replace_whatsapp_manual_senders",{p_senders:normalized});if(error)throw new Error(error.message);setMessage(String(data||normalized.length)+" conta(s) de WhatsApp salva(s). Elas já podem ser escolhidas antes do envio manual.");await load();}catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível salvar os números do WhatsApp.");}finally{setBusy("");}}
  function updateManualSender(index:number,field:"nome"|"numero"|"ativo",value:string|boolean){setManualSenders(current=>current.map((sender,i)=>i===index?{...sender,[field]:value}:sender));}
  function addManualSender(){setManualSenders(current=>current.length>=4?current:[...current,{nome:"",numero:"",ativo:true,ordem:current.length+1}]);}
  function removeManualSender(index:number){setManualSenders(current=>current.filter((_,i)=>i!==index).map((sender,i)=>({...sender,ordem:i+1})));}
  async function testWhatsapp(){setBusy("test-whatsapp");setError("");setMessage("");try{setMessage(await run("test-whatsapp",{}));await load();}catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível testar o WhatsApp.");}finally{setBusy("");}}
  async function saveAgenda(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy("save-agenda");setError("");setMessage("");try{setMessage(await run("save-agenda",{schoolIdentifier:agendaEduSchoolIdentifier,channelId:agendaEduChannelId,clientId:agendaEduClientId,clientSecret:agendaEduClientSecret,schoolToken:agendaEduSchoolToken}));setAgendaEduClientId("");setAgendaEduClientSecret("");setAgendaEduSchoolToken("");await load();}catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível salvar a Agenda Edu.");}finally{setBusy("");}}
  async function testAgenda(){setBusy("test-agenda");setError("");setMessage("");try{setMessage(await run("test-agenda",{}));await load();}catch(requestError){setError(requestError instanceof Error?requestError.message:"Não foi possível testar a Agenda Edu.");}finally{setBusy("");}}
  const disabled=loading||Boolean(busy);
  return <div className="modal-backdrop"><div className="modal-card communications-modal">
    <div className="modal-head"><div><h2>Integrações de comunicação</h2><p>Configure os canais sem alterar o código do sistema.</p></div><button className="icon-button" onClick={onClose} disabled={Boolean(busy)} aria-label="Fechar"><X/></button></div>
    <div className="communications-body">
      {error&&<div className="error-box">{error}</div>}{message&&<div className="success-box">{message}</div>}
      <div className="notice compact"><KeyRound/><span>Chaves e tokens são criptografados no cofre do servidor. Depois de salvos, eles nunca voltam a ser exibidos no navegador.</span></div>
      {loading?<div className="communications-loading">Carregando configurações…</div>:<div className="communication-settings-grid">
        <form className="communication-channel-card data-form" onSubmit={saveEmail}>
          <div className="communication-channel-head"><span className="integration-icon blue"><Mail/></span><div><h3>E-mail</h3><small>{emailProvider==="resend"?"Resend":emailProvider==="locaweb_smtp"?"SMTP Locaweb":"E-mail Locaweb"}</small></div><Status>{config?.email_ultimo_status==="conectado"?"Conectado":config?.email_credencial_configurada?"Configurar":"Pendente"}</Status></div>
          <label>Provedor de envio<select value={emailProvider} onChange={event=>{const provider=event.target.value;setEmailProvider(provider);if(provider==="locaweb_email")setSmtpUsername(fromAddress);}}><option value="locaweb_email">E-mail Locaweb</option><option value="locaweb_smtp">SMTP Locaweb contratado</option><option value="resend">Resend</option></select><small>Para a caixa atual, selecione E-mail Locaweb.</small></label>
          <label>Nome do remetente<input value={fromName} onChange={event=>setFromName(event.target.value)} required maxLength={100}/></label>
          <label>E-mail do remetente<input type="email" value={fromAddress} onChange={event=>{setFromAddress(event.target.value);if(emailProvider==="locaweb_email")setSmtpUsername(event.target.value);}} required/><small>{emailProvider==="resend"?"O domínio precisa estar verificado no Resend.":"A conta deve estar ativa no painel da Locaweb."}</small></label>
          <label>Responder para (opcional)<input type="email" value={replyTo} onChange={event=>setReplyTo(event.target.value)}/></label>
          {emailProvider!=="resend"&&<div className="smtp-server-summary"><span>Servidor seguro</span><strong>{emailProvider==="locaweb_smtp"?"smtplw.com.br":"email-ssl.com.br"}</strong><small>Porta 465 · SSL/TLS</small></div>}
          {emailProvider!=="resend"&&<label>Usuário SMTP<input value={smtpUsername} onChange={event=>setSmtpUsername(event.target.value)} required placeholder={emailProvider==="locaweb_email"?"E-mail completo":"Login informado no painel SMTP"}/><small>{emailProvider==="locaweb_email"?"Use nfse@jejoaopaulo.com.br.":"Use o login exibido no serviço SMTP Locaweb."}</small></label>}
          <label>{emailProvider==="resend"?"Chave da API do Resend":"Senha da Locaweb"}<input type="password" value={emailCredential} onChange={event=>setEmailCredential(event.target.value)} placeholder={config?.email_credencial_configurada?"Credencial protegida — deixe vazio para manter":emailProvider==="resend"?"re_...":"Senha da conta de e-mail"} autoComplete="new-password"/><small>{config?.email_credencial_configurada?"Já existe uma credencial protegida. Preencha apenas para substituí-la.":emailProvider==="resend"?"Crie a chave no painel do Resend.":"A senha será criptografada e armazenada somente no cofre."}</small></label>
          <button className="primary full" disabled={disabled}>{busy==="save-email"?"Salvando…":"Salvar configuração de e-mail"}</button>
          <div className="communication-test"><label>Destinatário do teste<input type="email" value={testRecipient} onChange={event=>setTestRecipient(event.target.value)}/></label><button type="button" className="secondary full" onClick={testEmail} disabled={disabled||!config?.email_credencial_configurada}>{busy==="test-email"?"Enviando teste…":"Enviar e-mail de teste"}</button></div>
          {config?.email_testada_em&&<small className="last-test">Último teste: {new Date(config.email_testada_em).toLocaleString("pt-BR")}</small>}
        </form>
        <form className="communication-channel-card data-form" onSubmit={saveWhatsapp}>
          <div className="communication-channel-head"><span className="integration-icon green"><MessageCircle/></span><div><h3>WhatsApp</h3><small>Meta Cloud API</small></div><Status>{config?.whatsapp_ultimo_status==="conectado"?"Conectado":config?.whatsapp_token_configurado?"Configurar":"Pendente"}</Status></div>
          <label>ID do número do WhatsApp<input inputMode="numeric" value={phoneNumberId} onChange={event=>setPhoneNumberId(event.target.value)} required placeholder="Phone Number ID"/></label>
          <label>ID da conta comercial<input inputMode="numeric" value={businessAccountId} onChange={event=>setBusinessAccountId(event.target.value)} required placeholder="WhatsApp Business Account ID"/></label>
          <label>Número remetente<input inputMode="tel" value={senderNumber} onChange={event=>setSenderNumber(maskWhatsappPhone(event.target.value))} required maxLength={15} placeholder="(21) 99999-9999"/><small>Digite DDD + número. O sistema adiciona o DDI 55 automaticamente.</small></label>
          <label>Número interno para homologação<input inputMode="tel" value={whatsappTestRecipient} onChange={event=>setWhatsappTestRecipient(maskWhatsappPhone(event.target.value))} required maxLength={15} placeholder="(21) 99999-9999"/><small>Durante os testes, todas as notas serão enviadas somente para este número.</small></label>
          <label>Modelo aprovado para NFS-e<input value={templateName} onChange={event=>setTemplateName(event.target.value)} required placeholder="envio_nfse"/></label>
          <label>Token permanente da Meta<input type="password" value={accessTokenMeta} onChange={event=>setAccessTokenMeta(event.target.value)} placeholder={config?.whatsapp_token_configurado?"Token protegido — deixe vazio para manter":"Cole o token permanente"} autoComplete="new-password"/><small>{config?.whatsapp_token_configurado?"Já existe um token protegido. Preencha apenas para substituí-lo.":"Use um token de usuário do sistema da Meta."}</small></label>
          <button className="primary full" disabled={disabled}>{busy==="save-whatsapp"?"Salvando…":"Salvar configuração do WhatsApp"}</button>
          <button type="button" className="secondary full" onClick={testWhatsapp} disabled={disabled||!config?.whatsapp_token_configurado}>{busy==="test-whatsapp"?"Testando conexão…":"Testar conexão sem enviar mensagem"}</button>
          {config?.whatsapp_testada_em&&<small className="last-test">Último teste: {new Date(config.whatsapp_testada_em).toLocaleString("pt-BR")}</small>}
        </form><div className="communication-channel-card data-form"><div className="communication-channel-head"><span className="integration-icon green"><MessageCircle/></span><div><h3>WhatsApps da escola</h3><small>Envio manual pelo Web ou app</small></div><Status>{manualSenders.length?String(manualSenders.length)+"/4":"Pendente"}</Status></div><div className="notice compact"><ShieldCheck/><span>Cadastre até 4 contas da escola, por exemplo Secretaria e Central de Matrícula. Antes de cada envio, o usuário escolherá qual conta utilizar.</span></div>{manualSenders.map((sender,index)=><div className="panel compact-panel" key={sender.id||index}><div className="form-row"><label>Identificação<input value={sender.nome} onChange={event=>updateManualSender(index,"nome",event.target.value)} maxLength={60} placeholder={index===0?"Secretaria":"Central de Matrícula"}/></label><label>Número com WhatsApp<input inputMode="tel" value={sender.numero} onChange={event=>updateManualSender(index,"numero",maskWhatsappPhone(event.target.value))} maxLength={15} placeholder="(21) 99999-9999"/></label></div><div className="form-actions"><label className="checkbox-line"><input type="checkbox" checked={sender.ativo} onChange={event=>updateManualSender(index,"ativo",event.target.checked)}/>Ativo para escolha</label><button type="button" className="secondary" onClick={()=>removeManualSender(index)} disabled={disabled}>Remover</button></div></div>)}<div className="form-actions"><button type="button" className="secondary" onClick={addManualSender} disabled={disabled||manualSenders.length>=4}><Plus size={17}/>Adicionar número</button><button type="button" className="primary" onClick={saveManualSenders} disabled={disabled||!manualSenders.length}>{busy==="save-manual-senders"?"Salvando…":"Salvar WhatsApps da escola"}</button></div><small>O WhatsApp Web/app precisa estar conectado na mesma conta escolhida no JPI Fiscal.</small></div>
        <form className="communication-channel-card data-form" onSubmit={saveAgenda}>
          <div className="communication-channel-head"><span className="integration-icon purple"><CalendarDays/></span><div><h3>Agenda Edu</h3><small>Mensagens com os responsáveis</small></div><Status>{config?.agenda_edu_ultimo_status==="conectado"?"Conectado":config?.agenda_edu_credencial_configurada?"Testar":"Configurar"}</Status></div>
          <div className="notice compact"><ShieldCheck/><span>Documentação oficial v2 confirmada. A conexão usará somente o Sandbox até concluirmos os testes dos responsáveis e anexos.</span></div>
          <label>Identificação da escola (opcional)<input value={agendaEduSchoolIdentifier} onChange={event=>setAgendaEduSchoolIdentifier(event.target.value)} maxLength={100} placeholder="Jardim Escola João Paulo I"/><small>É apenas um nome interno para facilitar a conferência.</small></label>
          <label>ID do canal de família (opcional)<input value={agendaEduChannelId} onChange={event=>setAgendaEduChannelId(event.target.value)} maxLength={100} placeholder="Informado ou localizado após o teste"/><small>O canal precisa incluir as turmas dos alunos que receberão as NFS-e.</small></label>
          <div className="smtp-server-summary"><span>Ambiente oficial</span><strong>Sandbox</strong><small>sandbox-api.agendaedu.dev · nenhuma mensagem real nesta etapa.</small></div>
          <label>Client ID<input type="password" value={agendaEduClientId} onChange={event=>setAgendaEduClientId(event.target.value)} placeholder={config?.agenda_edu_credencial_configurada?"Protegido — deixe vazio para manter":"Client ID fornecido pela Agenda Edu"} autoComplete="new-password"/></label>
          <label>Client Secret<input type="password" value={agendaEduClientSecret} onChange={event=>setAgendaEduClientSecret(event.target.value)} placeholder={config?.agenda_edu_credencial_configurada?"Protegido — deixe vazio para manter":"Client Secret fornecido pela Agenda Edu"} autoComplete="new-password"/></label>
          <label>X-School-Token<input type="password" value={agendaEduSchoolToken} onChange={event=>setAgendaEduSchoolToken(event.target.value)} placeholder={config?.agenda_edu_credencial_configurada?"Protegido — deixe vazio para manter":"Token da escola"} autoComplete="new-password"/><small>As três credenciais são criptografadas juntas e nunca voltam para o navegador.</small></label>
          <div className="agenda-checklist"><span className="done"><Check/>Base local e rota protegida</span><span className="done"><Check/>Documentação oficial da API</span><span className={config?.agenda_edu_credencial_configurada?"done":""}>{config?.agenda_edu_credencial_configurada?<Check/>:<Clock3/>}Credenciais do Sandbox</span><span className={config?.agenda_edu_testada_em?"done":""}>{config?.agenda_edu_testada_em?<Check/>:<Clock3/>}Teste sem enviar mensagem</span><span><Clock3/>PDF e XML em Mensagens</span></div>
          <button className="primary full" disabled={disabled}>{busy==="save-agenda"?"Salvando…":"Salvar configuração da Agenda Edu"}</button>
          <button type="button" className="secondary full" onClick={testAgenda} disabled={disabled||!config?.agenda_edu_credencial_configurada}>{busy==="test-agenda"?"Testando conexão…":"Testar conexão sem enviar mensagem"}</button>
          {config?.agenda_edu_testada_em&&<small className="last-test">Último teste: {new Date(config.agenda_edu_testada_em).toLocaleString("pt-BR")}</small>}
        </form>
        <AgendaEduStudentLinks/>
      </div>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={Boolean(busy)}>Fechar</button></div>
    </div>
  </div></div>;
}

function Integrations({accessToken}:{accessToken:string|null}) {
  const [open, setOpen] = useState(false);
  const [communicationsOpen,setCommunicationsOpen]=useState(false);
  const [communicationConfig,setCommunicationConfig]=useState<CommunicationConfig|null>(null);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [connectionStage, setConnectionStage] = useState("");
  useEffect(()=>{
    if(!accessToken)return;
    let active=true;
    authenticatedFetch("/api/integrations/communications",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"})
      .then(async response=>{if(response.status===401)window.dispatchEvent(new Event("jpi-session-invalid"));return {response,data:await response.json().catch(()=>({})) as {config?:CommunicationConfig}}})
      .then(({response,data})=>{if(active&&response.ok&&data.config)setCommunicationConfig(data.config);})
      .catch(()=>undefined);
    return()=>{active=false;};
  },[accessToken]);
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
    setElapsed(0);setBusy(true);setError("");setMessage("");setConnectionStage("Preparando certificado A1…");
    const token = accessToken;
    if (!token) { setError("Sessão expirada. Saia do sistema e entre novamente.");setBusy(false);setConnectionStage("");return; }
    let timeout = 0;
    try {
      setConnectionStage("Conectando ao Emissor Nacional de testes…");
      const response = await Promise.race([
        authenticatedFetch("/api/nfse/homologation/test", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test-connection" }),
          cache: "no-store",
        }),
        new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error("JPI_CONNECTION_TIMEOUT")), 25000); }),
      ]);
      const data = await response.json().catch(() => ({})) as { ok?:boolean;environment?:string;error?:string;ready?:boolean;issuanceStatus?:number };
      window.dispatchEvent(new Event("jpi-sefin-status-updated"));
      if (!response.ok || !data?.ok) { setError(data?.error || "Não foi possível testar a integração.");return; }
      if (!data.ready) { setError("O servidor de emissão está instável. Não tente enviar a nota agora.");return; }
      setTested(true);setMessage(`Certificado confirmado e servidor de emissão da SEFIN respondendo no ambiente de ${data.environment}. Você pode tentar a homologação; nenhuma nota foi emitida neste teste.`);
    } catch (requestError) {
      const timedOut = requestError instanceof Error && (requestError.message === "JPI_CONNECTION_TIMEOUT" || requestError.name === "AbortError");
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
          <Status>{communicationConfig?.email_ultimo_status==="conectado"||communicationConfig?.whatsapp_ultimo_status==="conectado"?"Conectado":"Pendente"}</Status>
        </div>
        <h3>Comunicações</h3>
        <p>Configure e-mail, WhatsApp e Agenda Edu para recibos e avisos.</p>
        <div className="integration-meta">
          <span>Canal</span>
          <strong>{communicationConfig?.agenda_edu_ultimo_status==="conectado"?"3 canais conectados":communicationConfig?.email_credencial_configurada&&communicationConfig?.whatsapp_token_configurado?"E-mail e WhatsApp":communicationConfig?.email_credencial_configurada?"E-mail configurado":communicationConfig?.whatsapp_token_configurado?"WhatsApp configurado":"Não configurado"}</strong>
        </div>
        <button className="secondary full" onClick={()=>setCommunicationsOpen(true)}>Configurar canais</button>
      </article>
    </div>{communicationsOpen&&<CommunicationsSettings accessToken={accessToken} onClose={()=>setCommunicationsOpen(false)} onChanged={setCommunicationConfig}/>} {open&&<div className="modal-backdrop"><div className="modal-card small-modal"><div className="modal-head"><h2>Testar ambiente de homologação</h2><button className="icon-button" onClick={()=>setOpen(false)}><X/></button></div><form className="data-form" onSubmit={testHomologation}>{error&&<div className="error-box">{error}</div>}{message&&<div className="success-box">{message}</div>}<div className="notice compact warning"><ShieldCheck/><span>Este teste usa o certificado A1 e a senha protegida no cofre somente para autenticar a conexão com a produção restrita. Nenhuma DPS ou NFS-e será enviada.</span></div>{(busy||elapsed>0)&&<div className="connection-timer"><Clock3/><span>{busy?(connectionStage||"Iniciando conexão…"):"Tempo da tentativa"}</span><strong>{elapsedLabel}</strong></div>}{busy&&<TransmissionProgress kind="connection"/>}<div className="notice compact"><KeyRound/><span>A senha será recuperada somente pelo servidor e não será exibida no navegador.</span></div><div className="form-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)} disabled={busy}>Fechar</button><button className="primary" disabled={busy||tested}>{busy?`Conectando · ${elapsedLabel}`:tested?"Conexão confirmada":"Testar conexão"}</button></div></form></div></div>}</>
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
