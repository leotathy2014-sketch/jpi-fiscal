"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, CircleAlert, FileCode2, FileText, GraduationCap, MailCheck, ReceiptText, RefreshCw, Search, Send, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { AppPage } from "./app-shell";

type AssistantPayment={
  id:number;
  aluno_id:number;
  competencia:string;
  valor_nfse:number;
  status_pagamento:string;
  status_nfse:string;
  dps_xml_path:string|null;
  dps_xml_id:string|null;
  nfse_homologacao_xml_path:string|null;
  chave_nfse_homologacao:string|null;
  homologacao_emitida_em:string|null;
  alunos:{
    nome:string;
    responsavel:string;
    cpf_cnpj:string|null;
    email:string|null;
    whatsapp:string|null;
    cep:string|null;
    logradouro:string|null;
    numero:string|null;
    cidade:string|null;
    uf:string|null;
  }|null;
};
type DeliveryState={mensalidade_id:number;status:string;canal:string;created_at:string};
type StepState="done"|"current"|"pending"|"warning";
type AssistantStep={key:string;label:string;short:string;description:string;state:StepState};

const money=(value:number)=>Number(value).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");

function statusOrder(payment:AssistantPayment){
  const status=normalize(payment.status_nfse||"");
  const validationDone=Boolean(
    payment.dps_xml_path||
    payment.chave_nfse_homologacao||
    status.includes("homologacao validada")||
    status.includes("previa dps aprovada")||
    status.includes("xml dps")
  );
  const dpsDone=Boolean(
    payment.dps_xml_path||
    payment.chave_nfse_homologacao||
    status.includes("previa dps aprovada")||
    status.includes("xml dps")
  );
  const previewDone=Boolean(
    payment.dps_xml_path||
    payment.chave_nfse_homologacao||
    status.includes("previa dps aprovada")||
    status.includes("xml dps")
  );
  const xmlDone=Boolean(payment.dps_xml_path&&payment.dps_xml_id);
  const sefinDone=Boolean(payment.chave_nfse_homologacao);
  const finished=Boolean(payment.chave_nfse_homologacao&&payment.homologacao_emitida_em);
  return {validationDone,dpsDone,previewDone,xmlDone,sefinDone,finished};
}

function missingStudentFields(payment:AssistantPayment){
  const student=payment.alunos;
  if(!student)return ["cadastro do aluno"];
  const missing:string[]=[];
  if(!student.responsavel)missing.push("responsável financeiro");
  if(!student.cpf_cnpj)missing.push("CPF/CNPJ");
  if(!student.email)missing.push("e-mail");
  if(!student.cep||!student.logradouro||!student.numero||!student.cidade||!student.uf)missing.push("endereço completo");
  return missing;
}

export function IssuanceAssistant({onNavigate}:{onNavigate:(page:AppPage)=>void}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [payments,setPayments]=useState<AssistantPayment[]>([]);
  const [deliveries,setDeliveries]=useState<DeliveryState[]>([]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");

  const load=useCallback(async(silent=false)=>{
    if(!supabase)return;
    if(!silent)setLoading(true);else setRefreshing(true);
    setError("");
    const [paymentsResult,deliveriesResult]=await Promise.all([
      supabase.from("mensalidades").select("id,aluno_id,competencia,valor_nfse,status_pagamento,status_nfse,dps_xml_path,dps_xml_id,nfse_homologacao_xml_path,chave_nfse_homologacao,homologacao_emitida_em,alunos(nome,responsavel,cpf_cnpj,email,whatsapp,cep,logradouro,numero,cidade,uf)").order("created_at",{ascending:false}),
      supabase.from("nfse_entregas").select("mensalidade_id,status,canal,created_at").order("created_at",{ascending:false}),
    ]);
    if(paymentsResult.error||deliveriesResult.error){
      setError(paymentsResult.error?.message||deliveriesResult.error?.message||"Não foi possível carregar o assistente.");
    }else{
      const nextPayments=(paymentsResult.data||[]) as unknown as AssistantPayment[];
      setPayments(nextPayments);
      setDeliveries((deliveriesResult.data||[]) as DeliveryState[]);
      const remembered=Number(localStorage.getItem("jpi-issuance-assistant-payment")||"0");
      setSelectedId(current=>{
        if(current&&nextPayments.some(item=>item.id===current))return current;
        if(remembered&&nextPayments.some(item=>item.id===remembered))return remembered;
        return nextPayments[0]?.id||null;
      });
    }
    setLoading(false);setRefreshing(false);
  },[supabase]);

  useEffect(()=>{void load();const onFocus=()=>void load(true);window.addEventListener("focus",onFocus);return()=>window.removeEventListener("focus",onFocus)},[load]);
  useEffect(()=>{if(selectedId)localStorage.setItem("jpi-issuance-assistant-payment",String(selectedId))},[selectedId]);

  const filtered=useMemo(()=>{
    const q=normalize(query.trim());
    if(!q)return payments;
    return payments.filter(payment=>normalize([payment.alunos?.nome,payment.alunos?.responsavel,payment.competencia,payment.status_nfse,String(payment.id)].filter(Boolean).join(" ")).includes(q));
  },[payments,query]);
  const selected=useMemo(()=>payments.find(item=>item.id===selectedId)||null,[payments,selectedId]);
  const delivery=useMemo(()=>selected?deliveries.find(item=>item.mensalidade_id===selected.id&&item.status==="enviado")||null:null,[deliveries,selected]);
  const missing=selected?missingStudentFields(selected):[];
  const progress=selected?statusOrder(selected):null;

  const steps=useMemo<AssistantStep[]>(()=>{
    if(!selected||!progress)return [
      {key:"student",label:"Aluno",short:"1",description:"Selecione uma mensalidade para iniciar.",state:"current"},
      ...["Validação","DPS","Prévia","XML","SEFIN","Conclusão","Enviar"].map((label,index)=>({key:String(index),label,short:String(index+2),description:"Aguardando etapa anterior.",state:"pending" as StepState}))
    ];
    const completion=[
      true,
      progress.validationDone,
      progress.dpsDone,
      progress.previewDone,
      progress.xmlDone,
      progress.sefinDone,
      progress.finished,
      Boolean(delivery),
    ];
    const firstIncomplete=completion.findIndex(done=>!done);
    const current=firstIncomplete<0?7:firstIncomplete;
    const descriptions=[
      missing.length?`Cadastro selecionado com ${missing.length} pendência(s).`:"Aluno e responsável selecionados.",
      progress.validationDone?"Dados fiscais já validados.":"Conferir cadastro, competência, valor e certificado.",
      progress.dpsDone?"DPS preparada.":"Preparar e revisar os dados editáveis da DPS.",
      progress.previewDone?"Prévia aprovada.":"Conferir a prévia e aprovar antes do XML.",
      progress.xmlDone?"XML da DPS armazenado.":"Gerar e validar o XML da DPS.",
      progress.sefinDone?"SEFIN retornou a nota de teste.":"Transmitir somente para homologação enquanto produção estiver bloqueada.",
      progress.finished?"Nota concluída no ambiente atual.":"Conferir retorno, chave e documento gerado.",
      delivery?"Nota já possui envio concluído.":"Escolher canal e enviar a nota ao responsável.",
    ];
    const labels=["Aluno","Validação","DPS","Prévia","XML","SEFIN","Conclusão","Enviar"];
    return labels.map((label,index)=>({
      key:label.toLowerCase(),
      label,
      short:String(index+1),
      description:descriptions[index],
      state:completion[index]?"done":index===current?(index===1&&missing.length?"warning":"current"):"pending",
    }));
  },[delivery,missing.length,progress,selected]);

  const currentIndex=steps.findIndex(step=>step.state==="current"||step.state==="warning");
  const effectiveCurrent=currentIndex<0?7:currentIndex;
  const nextTitle=selected?[
    "Aluno selecionado",
    missing.length?"Corrigir cadastro antes de validar":"Validar dados da nota",
    "Preparar / editar DPS",
    "Aprovar prévia da DPS",
    "Gerar e validar XML",
    "Enviar para homologação",
    "Conferir nota concluída",
    delivery?"Envio concluído":"Enviar nota ao responsável",
  ][effectiveCurrent]:"Selecione uma nota";

  function focusAndNavigate(target:"NFS-e"|"Enviar notas"|"Alunos e Responsáveis"){
    if(!selected)return;
    const focus=String(selected.id);
    if(target==="NFS-e")sessionStorage.setItem("jpi-nfse-focus",focus);
    if(target==="Enviar notas")sessionStorage.setItem("jpi-delivery-focus",focus);
    if(target==="Alunos e Responsáveis")sessionStorage.setItem("jpi-student-focus",selected.alunos?.nome||String(selected.aluno_id));
    onNavigate(target);
  }
  function continueProcess(){
    if(!selected)return;
    if(effectiveCurrent===1&&missing.length){focusAndNavigate("Alunos e Responsáveis");return}
    if(effectiveCurrent>=7){focusAndNavigate("Enviar notas");return}
    focusAndNavigate("NFS-e");
  }

  return <div className="issuance-assistant-page">
    <div className="page-heading assistant-heading">
      <div><span className="eyebrow">FLUXO GUIADO</span><h1>Assistente de Emissão</h1><p>O sistema identifica automaticamente onde cada nota parou e conduz o usuário até a emissão e o envio.</p></div>
      <button className="secondary" onClick={()=>void load(true)} disabled={refreshing}><RefreshCw size={17}/>{refreshing?"Atualizando…":"Atualizar"}</button>
    </div>

    <div className="notice warning"><ShieldCheck/><div><strong>Implantação segura e não destrutiva</strong><span>As telas atuais de NFS-e e Enviar notas continuam funcionando. O assistente apenas organiza e direciona o processo.</span></div></div>
    {error&&<div className="error-box">{error}</div>}

    <section className="assistant-stepper" aria-label="Etapas da emissão">
      {steps.map((step,index)=><div className={`assistant-step ${step.state}`} key={step.key}>
        <span className="assistant-step-number">{step.state==="done"?<Check size={15}/>:step.short}</span>
        <div><strong>{step.label}</strong><small>{step.description}</small></div>
        {index<steps.length-1&&<ChevronRight className="assistant-step-arrow" size={16}/>}</div>)}
    </section>

    <section className="assistant-grid">
      <article className="panel assistant-selector">
        <div className="panel-title"><div><h2>1. Escolha a nota</h2><p>Mensalidades já cadastradas aparecem automaticamente.</p></div><span className="assistant-count">{payments.length}</span></div>
        <div className="search-input"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar aluno, responsável, competência ou nº interno"/></div>
        {loading?<div className="assistant-loading">Carregando notas…</div>:filtered.length===0?<div className="assistant-empty">Nenhuma mensalidade encontrada.</div>:<div className="assistant-payment-list">
          {filtered.slice(0,40).map(payment=>{
            const order=statusOrder(payment);
            const issued=Boolean(payment.chave_nfse_homologacao);
            return <button key={payment.id} className={selectedId===payment.id?"assistant-payment selected":"assistant-payment"} onClick={()=>setSelectedId(payment.id)}>
              <span className="assistant-payment-icon"><GraduationCap size={17}/></span>
              <span><strong>{payment.alunos?.nome||`Aluno #${payment.aluno_id}`}</strong><small>{payment.competencia} · {money(payment.valor_nfse)}</small></span>
              <em className={issued?"done":order.xmlDone?"xml":"pending"}>{issued?"Emitida":order.xmlDone?"XML pronto":payment.status_nfse}</em>
            </button>
          })}
        </div>}
      </article>

      <article className="panel assistant-action-panel">
        {!selected?<div className="assistant-empty large"><Sparkles/><strong>Selecione uma nota para começar</strong><span>O assistente mostrará automaticamente a próxima ação segura.</span></div>:<>
          <div className="assistant-current-head">
            <div><span>PRÓXIMA AÇÃO</span><h2>{nextTitle}</h2><p>{selected.alunos?.nome} · {selected.competencia} · {money(selected.valor_nfse)}</p></div>
            <span className={`assistant-current-badge ${missing.length&&effectiveCurrent===1?"warning":"active"}`}>Etapa {effectiveCurrent+1} de 8</span>
          </div>

          <div className="assistant-summary">
            <div><span><WalletCards size={17}/></span><small>Valor NFS-e</small><strong>{money(selected.valor_nfse)}</strong></div>
            <div><span><ReceiptText size={17}/></span><small>Status fiscal</small><strong>{selected.status_nfse}</strong></div>
            <div><span><FileCode2 size={17}/></span><small>XML</small><strong>{progress?.xmlDone?"Pronto":"Aguardando"}</strong></div>
            <div><span><MailCheck size={17}/></span><small>Entrega</small><strong>{delivery?"Enviada":"Aguardando"}</strong></div>
          </div>

          {missing.length>0&&effectiveCurrent<=1&&<div className="assistant-warning-box"><CircleAlert/><div><strong>Cadastro precisa de atenção</strong><span>Complete: {missing.join(", ")}. O assistente não recomenda avançar antes disso.</span></div></div>}

          <div className="assistant-next-card">
            {effectiveCurrent===1&&<><ShieldCheck/><div><strong>Validação automática e segura</strong><span>Confira dados do tomador, competência, valor, configuração fiscal e certificado A1 antes de preparar a DPS.</span></div></>}
            {effectiveCurrent===2&&<><FileText/><div><strong>DPS em foco</strong><span>A próxima tela abrirá diretamente a nota selecionada para revisar os campos que podem ser editados.</span></div></>}
            {effectiveCurrent===3&&<><FileText/><div><strong>Aprovação da prévia</strong><span>A emissão só continua depois da confirmação da prévia pelo usuário.</span></div></>}
            {effectiveCurrent===4&&<><FileCode2/><div><strong>Gerar XML</strong><span>O XML será guardado no repositório privado e precisa estar válido antes da transmissão.</span></div></>}
            {effectiveCurrent===5&&<><Send/><div><strong>SEFIN / homologação</strong><span>Enquanto produção não estiver liberada, esta etapa continua protegida como homologação.</span></div></>}
            {effectiveCurrent===6&&<><Check/><div><strong>Conferência final</strong><span>Confira a chave e o documento retornado antes de iniciar a entrega ao responsável.</span></div></>}
            {effectiveCurrent>=7&&<><MailCheck/><div><strong>Enviar nota</strong><span>O assistente leva a mesma nota para os canais de entrega já existentes, preservando o histórico.</span></div></>}
          </div>

          <div className="assistant-actions">
            <button className="primary assistant-main-action" onClick={continueProcess}>
              {effectiveCurrent===1&&missing.length?"Corrigir cadastro":effectiveCurrent>=7?"Ir para envio":"Continuar processo"} <ChevronRight size={18}/>
            </button>
            {effectiveCurrent>1&&effectiveCurrent<7&&<button className="secondary" onClick={()=>focusAndNavigate("NFS-e")}>Abrir NFS-e atual</button>}
            {progress?.finished&&<button className="secondary" onClick={()=>focusAndNavigate("Enviar notas")}>Ir direto para envio</button>}
          </div>
        </>}
      </article>
    </section>
  </div>;
}
