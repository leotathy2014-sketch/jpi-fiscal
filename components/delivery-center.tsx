"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Clock3, Download, Eye, FileCode2, FileText, Filter, Mail, MailCheck, MessageCircle, RefreshCw, Search, Send, Settings, ShieldCheck, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { AppPage, Role } from "./app-shell";

type DeliveryPayment={id:number;aluno_id:number;competencia:string;valor_nfse:number;status_nfse:string;alunos:{nome:string;responsavel:string;email:string|null}|null};
type DeliveryDocument={id:number;mensalidade_id:number;versao:number;chave_acesso:string;estado:string;emitida_em:string|null};
type DeliveryHistory={id:number;mensalidade_id:number;documento_homologacao_id:number;request_id:string;destinatario_pretendido:string;destinatario_utilizado:string;status:"enviando"|"enviado"|"erro";erro_mensagem:string|null;enviado_em:string|null;created_at:string};
type DeliveryRow={payment:DeliveryPayment;document:DeliveryDocument;latest?:DeliveryHistory};
type BatchStatus="waiting"|"sending"|"success"|"error";
type BatchItem={row:DeliveryRow;status:BatchStatus;error?:string};
type DeliveryChannel="email"|"whatsapp"|"agenda-edu";
const money=(value:number)=>Number(value).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");

function Modal({onClose,children}:{onClose:()=>void;children:React.ReactNode}){return <div className="modal-backdrop"><div className="modal-card delivery-modal"><div className="modal-head"><div><h2>Enviar NFS-e de teste por e-mail</h2><p>PDF e XML · fila segura de homologação</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X/></button></div>{children}</div></div>}

function PendingChannel({channel,role,onNavigate}:{channel:Exclude<DeliveryChannel,"email">;role:Role;onNavigate:(page:AppPage)=>void}){
  const whatsapp=channel==="whatsapp";const Icon=whatsapp?MessageCircle:CalendarDays;
  return <section className="delivery-channel-pending"><span className={whatsapp?"green":"purple"}><Icon/></span><div><small>{whatsapp?"META CLOUD API":"AGENDA EDU"}</small><h2>{whatsapp?"Enviar notas por WhatsApp":"Enviar notas pelo Agenda Edu"}</h2><p>{whatsapp?"Este canal utilizará o número e o modelo aprovados na Meta para encaminhar cada nota ao WhatsApp do responsável.":"Este canal permitirá encaminhar as notas pelo aplicativo Agenda Edu depois que a escola fornecer o acesso oficial à integração."}</p><div className="notice compact"><ShieldCheck/><span>{whatsapp?"A configuração da Meta já possui espaço próprio no sistema. O envio de documentos ainda será implementado e testado antes da ativação.":"Ainda será necessário obter com o Agenda Edu as credenciais e a documentação da API da conta da escola. Nenhuma senha deve ser enviada pelo chat."}</span></div>{role==="Administrador"?<button className="secondary" onClick={()=>onNavigate("Configurações")}><Settings size={17}/>{whatsapp?"Abrir configuração do WhatsApp":"Abrir configurações"}</button>:<small>Solicite ao Administrador a configuração deste canal.</small>}</div></section>;
}

export function DeliveryCenter({role,accessToken,onNavigate}:{role:Role;accessToken:string|null;onNavigate:(page:AppPage)=>void}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);const canManage=role==="Administrador"||role==="Financeiro";
  const [channel,setChannel]=useState<DeliveryChannel>("email");
  const [rows,setRows]=useState<DeliveryRow[]>([]);const [history,setHistory]=useState<DeliveryHistory[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const [query,setQuery]=useState("");const [statusFilter,setStatusFilter]=useState("pendente");const [selected,setSelected]=useState<Set<number>>(()=>new Set());
  const [modalOpen,setModalOpen]=useState(false);const [batch,setBatch]=useState<BatchItem[]>([]);const [busy,setBusy]=useState(false);const inFlight=useRef(false);
  const [documentBusy,setDocumentBusy]=useState("");

  const load=useCallback(async()=>{
    if(!supabase)return;setLoading(true);setError("");
    const [paymentsResult,documentsResult,historyResult]=await Promise.all([
      supabase.from("mensalidades").select("id,aluno_id,competencia,valor_nfse,status_nfse,alunos(nome,responsavel,email)").order("created_at",{ascending:false}),
      supabase.from("nfse_documentos_homologacao").select("id,mensalidade_id,versao,chave_acesso,estado,emitida_em").eq("estado","ativa").order("versao",{ascending:false}),
      supabase.from("nfse_entregas").select("id,mensalidade_id,documento_homologacao_id,request_id,destinatario_pretendido,destinatario_utilizado,status,erro_mensagem,enviado_em,created_at").eq("canal","email").eq("ambiente","homologacao").order("created_at",{ascending:false}),
    ]);
    if(paymentsResult.error||documentsResult.error||historyResult.error){setError(paymentsResult.error?.message||documentsResult.error?.message||historyResult.error?.message||"Não foi possível carregar as entregas.");setLoading(false);return}
    const payments=(paymentsResult.data||[]) as unknown as DeliveryPayment[];const documents=(documentsResult.data||[]) as DeliveryDocument[];const deliveries=(historyResult.data||[]) as DeliveryHistory[];
    const paymentById=new Map(payments.map(payment=>[payment.id,payment]));const latestByDocument=new Map<number,DeliveryHistory>();for(const delivery of deliveries)if(!latestByDocument.has(delivery.documento_homologacao_id))latestByDocument.set(delivery.documento_homologacao_id,delivery);
    setRows(documents.flatMap(document=>{const payment=paymentById.get(document.mensalidade_id);return payment?[{payment,document,latest:latestByDocument.get(document.id)}]:[]}));setHistory(deliveries);setLoading(false);
  },[supabase]);
  useEffect(()=>{void load()},[load]);

  const filtered=useMemo(()=>{const search=normalize(query.trim());return rows.filter(row=>{const latest=row.latest;const deliveryStatus=latest?.status||"pendente";const haystack=normalize([row.payment.alunos?.nome,row.payment.alunos?.responsavel,row.payment.alunos?.email,row.payment.competencia,row.document.chave_acesso].filter(Boolean).join(" "));return(!search||haystack.includes(search))&&(statusFilter==="todas"||statusFilter===deliveryStatus)})},[query,rows,statusFilter]);
  const selectedRows=useMemo(()=>filtered.filter(row=>selected.has(row.document.id)),[filtered,selected]);
  const selectableRows=useMemo(()=>filtered.filter(row=>row.latest?.status!=="enviado"&&row.latest?.status!=="enviando"&&Boolean(row.payment.alunos?.email)),[filtered]);
  const sentCount=rows.filter(row=>row.latest?.status==="enviado").length;const errorCount=rows.filter(row=>row.latest?.status==="erro").length;const pendingCount=rows.length-sentCount-errorCount;
  function toggle(documentId:number){if(busy)return;setSelected(current=>{const next=new Set(current);if(next.has(documentId))next.delete(documentId);else next.add(documentId);return next})}
  function selectAll(){setSelected(new Set(selectableRows.map(row=>row.document.id)))}
  function openConfirmation(){if(!selectedRows.length)return;setError("");setMessage("");setBatch(selectedRows.map(row=>({row,status:"waiting"})));setModalOpen(true)}
  function closeModal(){if(busy)return;setModalOpen(false);setBatch([])}
  async function runDelivery(targets:DeliveryRow[]){
    if(!accessToken||!targets.length||inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setMessage("");const results:BatchItem[]=targets.map(row=>({row,status:"waiting"}));setBatch([...results]);
    for(const row of targets){const index=results.findIndex(item=>item.row.document.id===row.document.id);results[index]={row,status:"sending"};setBatch([...results]);try{const response=await fetch("/api/deliveries/email",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({monthlyId:row.payment.id,documentId:row.document.id,requestId:crypto.randomUUID()}),cache:"no-store"});const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};if(!response.ok||!data.ok)throw new Error(data.error||"O provedor não confirmou esta entrega.");results[index]={row,status:"success"}}catch(cause){results[index]={row,status:"error",error:cause instanceof Error?cause.message:"Não foi possível enviar."}}finally{setBatch([...results])}}
    const failures=results.filter(item=>item.status==="error");const successes=results.length-failures.length;setSelected(new Set(failures.map(item=>item.row.document.id)));setStatusFilter("pendente");setMessage(failures.length?`Entrega concluída: ${successes} enviada(s) e ${failures.length} pendente(s).`:`${successes} ${successes===1?"NFS-e de teste enviada":"NFS-e de teste enviadas"} para a caixa interna.`);await load();inFlight.current=false;setBusy(false);
  }
  async function handleDocument(documentId:number,format:"pdf"|"xml",disposition:"inline"|"attachment"){
    if(!accessToken||documentBusy)return;
    const actionKey=`${documentId}-${format}-${disposition}`;const preview=disposition==="inline"?window.open("","_blank"):null;
    if(preview)preview.opener=null;
    setDocumentBusy(actionKey);setError("");
    try{
      const params=new URLSearchParams({documentId:String(documentId),format,disposition});
      const response=await fetch(`/api/deliveries/documents?${params}`,{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
      if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};throw new Error(data.error||"O documento não pôde ser aberto.")}
      const blob=await response.blob();const url=URL.createObjectURL(blob);
      if(disposition==="inline"){
        if(preview)preview.location.href=url;else window.open(url,"_blank","noopener,noreferrer");
      }else{
        const anchor=document.createElement("a");anchor.href=url;anchor.download=response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]||`nfse.${format}`;document.body.appendChild(anchor);anchor.click();anchor.remove();
      }
      window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
    }catch(cause){preview?.close();setError(cause instanceof Error?cause.message:"Não foi possível acessar o documento.")}
    finally{setDocumentBusy("")}
  }
  const batchDone=batch.length>0&&batch.every(item=>item.status==="success"||item.status==="error");const batchErrors=batch.filter(item=>item.status==="error");

  return <div className="delivery-page">
    <div className="page-heading"><div><span className="eyebrow">COMUNICAÇÕES</span><h1>Enviar notas</h1><p>Escolha o canal para encaminhar as NFS-e aos responsáveis.</p></div><div className="delivery-heading-icon"><MailCheck/></div></div>
    <section className="delivery-channels" aria-label="Canais para envio de notas"><button className={channel==="email"?"active email":"email"} onClick={()=>setChannel("email")}><span><Mail/></span><div><strong>Enviar por e-mail</strong><small>Locaweb conectada</small></div></button><button className={channel==="whatsapp"?"active whatsapp":"whatsapp"} onClick={()=>setChannel("whatsapp")}><span><MessageCircle/></span><div><strong>WhatsApp</strong><small>Meta Cloud API</small></div></button><button className={channel==="agenda-edu"?"active agenda":"agenda"} onClick={()=>setChannel("agenda-edu")}><span><CalendarDays/></span><div><strong>Agenda Edu</strong><small>Canal escolar</small></div></button></section>
    {channel==="email"?<>
    <div className="notice warning"><ShieldCheck/><div><strong>Modo seguro de homologação</strong><span>O responsável aparece para conferência, mas todos os testes são enviados somente para <b>administracao@jejoaopaulo.com.br</b>. As famílias não receberão documentos sem validade fiscal.</span></div></div>
    {error&&<div className="error-box page-error">{error}</div>}{message&&<div className="success-box">{message}</div>}
    <section className="delivery-stats"><article><span>Pendentes</span><strong>{pendingCount}</strong><small>Aguardando teste</small></article><article><span>Enviadas</span><strong>{sentCount}</strong><small>Caixa interna</small></article><article><span>Com erro</span><strong>{errorCount}</strong><small>Disponíveis para repetir</small></article><article><span>Histórico</span><strong>{history.length}</strong><small>Tentativas registradas</small></article></section>
    <section className="delivery-toolbar"><div className="search-input"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar aluno, responsável, e-mail ou chave"/></div><label><Filter/><select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="todas">Todas as situações</option><option value="pendente">Pendentes</option><option value="enviado">Enviadas</option><option value="erro">Com erro</option><option value="enviando">Em andamento</option></select></label></section>
    {canManage&&selectableRows.length>0&&<section className="delivery-batch-bar"><div><strong>{selectedRows.length}</strong><span>selecionadas</span></div><button className="text-button" disabled={busy} onClick={selectAll}>Selecionar todas ({selectableRows.length})</button><button className="text-button" disabled={busy||!selected.size} onClick={()=>setSelected(new Set())}>Limpar</button><button className="primary" disabled={busy||!selectedRows.length} onClick={openConfirmation}><Send size={17}/>Enviar selecionadas</button></section>}
    {loading?<div className="empty-state"><strong>Carregando entregas…</strong></div>:filtered.length===0?<div className="empty-state"><MailCheck/><strong>Nenhuma NFS-e disponível</strong><p>As notas ativas de homologação aparecerão aqui automaticamente.</p></div>:<div className="delivery-list">{filtered.map(row=>{const latest=row.latest;const state=latest?.status||"pendente";const email=row.payment.alunos?.email;return <article key={row.document.id} className={`delivery-row ${state}`}>
      {canManage&&state!=="enviado"?<input type="checkbox" checked={selected.has(row.document.id)} disabled={busy||!email||state==="enviando"} onChange={()=>toggle(row.document.id)} aria-label={`Selecionar ${row.payment.alunos?.nome||"aluno"}`}/>:<span className="delivery-selection-spacer" aria-hidden="true"/>}<div className="delivery-main"><strong>{row.payment.alunos?.nome||`Aluno #${row.payment.aluno_id}`}</strong><span>{row.payment.alunos?.responsavel||"Responsável não informado"}</span><small>{email||"E-mail do responsável não informado"}</small></div><div className="delivery-document"><span>{row.payment.competencia} · {money(row.payment.valor_nfse)}</span><small>Versão {row.document.versao} · Chave {row.document.chave_acesso.slice(0,8)}…{row.document.chave_acesso.slice(-6)}</small></div><div className={`delivery-status ${state}`}>{state==="enviado"?<Check/>:state==="erro"?<X/>:<Clock3/>}<span><strong>{state==="enviado"?"Enviada":state==="erro"?"Falhou":state==="enviando"?"Enviando":"Pendente"}</strong><small>{latest?.enviado_em?new Date(latest.enviado_em).toLocaleString("pt-BR"):latest?.erro_mensagem||"Aguardando envio"}</small></span></div>
      {state==="enviado"&&<div className="delivery-files"><div><span><FileText/><strong>PDF</strong></span><button type="button" disabled={Boolean(documentBusy)} onClick={()=>void handleDocument(row.document.id,"pdf","inline")}><Eye/>Visualizar</button><button type="button" disabled={Boolean(documentBusy)} onClick={()=>void handleDocument(row.document.id,"pdf","attachment")}><Download/>Baixar</button></div><div><span><FileCode2/><strong>XML</strong></span><button type="button" disabled={Boolean(documentBusy)} onClick={()=>void handleDocument(row.document.id,"xml","inline")}><Eye/>Visualizar</button><button type="button" disabled={Boolean(documentBusy)} onClick={()=>void handleDocument(row.document.id,"xml","attachment")}><Download/>Baixar</button></div></div>}
    </article>})}</div>}
    {modalOpen&&<Modal onClose={closeModal}><div className="delivery-modal-body"><div className="notice warning"><ShieldCheck/><div><strong>Confirme o teste interno</strong><span>{batch.length} {batch.length===1?"documento será enviado":"documentos serão enviados"} separadamente para administracao@jejoaopaulo.com.br, com o PDF e o XML de homologação anexados.</span></div></div>{busy&&<div className="delivery-progress"><strong>Enviando e registrando</strong><span>{batch.filter(item=>item.status==="success"||item.status==="error").length} de {batch.length}</span><progress max={Math.max(batch.length,1)} value={batch.filter(item=>item.status==="success"||item.status==="error").length}/></div>}<div className="nfse-batch-results">{batch.map(item=><div key={item.row.document.id} className={`nfse-batch-result ${item.status}`}><span className="nfse-batch-result-icon">{item.status==="success"?<Check/>:item.status==="error"?<X/>:item.status==="sending"?<RefreshCw/>:<Clock3/>}</span><span><strong>{item.row.payment.alunos?.nome||"Aluno"}</strong><small>{item.row.payment.alunos?.email||"Sem e-mail cadastrado"}</small>{item.error&&<small>{item.error}</small>}</span><b>{item.status==="success"?"Enviada":item.status==="error"?"Pendente":item.status==="sending"?"Enviando":"Aguardando"}</b></div>)}</div><div className="form-actions"><button className="secondary" disabled={busy} onClick={closeModal}>{batchDone?"Fechar":"Cancelar"}</button>{!busy&&!batchDone&&<button className="primary" onClick={()=>void runDelivery(batch.map(item=>item.row))}><Send size={17}/>Confirmar e enviar</button>}{!busy&&batchDone&&batchErrors.length>0&&<button className="primary" onClick={()=>void runDelivery(batchErrors.map(item=>item.row))}><RefreshCw size={17}/>Repetir pendentes</button>}</div></div></Modal>}
    </>:<PendingChannel channel={channel} role={role} onNavigate={onNavigate}/>}
  </div>;
}
