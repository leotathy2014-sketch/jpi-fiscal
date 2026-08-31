"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, CircleAlert, FileCode2, FileText, GraduationCap, MailCheck, ReceiptText, RefreshCw, Search, Send, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { isValidCpfCnpj } from "@/lib/nfse-dps";
import type { AppPage } from "./app-shell";
import { useAccess } from "./access";

type AssistantPayment={
  id:number;
  aluno_id:number;
  competencia:string;
  valor_nfse:number;
  descricao_servico:string|null;
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
    segmento:string;
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
type FiscalContext={cnpj:string|null;razao_social:string|null;cidade:string|null;uf:string|null;regime_tributario:string;pis_aliquota:number;cofins_aliquota:number;pis_cofins_cst:string;pis_cofins_retencao:number};

const money=(value:number)=>Number(value).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
const competenceInput=(value:string)=>{const match=value.trim().match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);return match?match[2]+"-"+match[1]:value};
const formatCompetence=(value:string)=>{const parts=value.split("-");return parts[0]&&parts[1]?parts[1]+"/"+parts[0]:value};
const currentCompetenceInput=()=>{const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit"}).formatToParts(new Date());const part=(type:"year"|"month")=>parts.find(item=>item.type===type)?.value||"";return part("year")+"-"+part("month")};
const upper=(value:string)=>value.toLocaleUpperCase("pt-BR");
const fiscalServiceForSegment=(segment?:string|null)=>{const normalized=normalize(segment||"");if(normalized.includes("medio"))return {code:"08.01.01",description:"Ensino regular médio",nbs:"122013000"};if(normalized.includes("1º")||normalized.includes("6º")||normalized.includes("fundamental"))return {code:"08.01.01",description:"Ensino regular fundamental",nbs:"122012000"};return {code:"08.01.01",description:"Ensino regular pré-escolar",nbs:"122011200"}};
const defaultServiceDescription=(competence:string,segment?:string|null)=>"MENSALIDADE ESCOLAR - COMPETÊNCIA "+formatCompetence(competence)+" - "+fiscalServiceForSegment(segment).description.toLocaleUpperCase("pt-BR");

function statusOrder(payment:AssistantPayment){
  const status=normalize(payment.status_nfse||"");
  const validationDone=Boolean(
    payment.dps_xml_path||
    payment.chave_nfse_homologacao||
    status.includes("homologacao validada")||
    status.includes("dps revisada")||
    status.includes("previa dps aprovada")||
    status.includes("xml dps")
  );
  const dpsDone=Boolean(
    payment.dps_xml_path||
    payment.chave_nfse_homologacao||
    status.includes("dps revisada")||
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
  const {can}=useAccess();
  const canPrepare=can("nfse.prepare");
  const [payments,setPayments]=useState<AssistantPayment[]>([]);
  const [deliveries,setDeliveries]=useState<DeliveryState[]>([]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busyAction,setBusyAction]=useState<""|"validate"|"save-dps"|"approve">("");
  const [draftCompetence,setDraftCompetence]=useState("");
  const [draftValue,setDraftValue]=useState("");
  const [draftDescription,setDraftDescription]=useState("");
  const [fiscalContext,setFiscalContext]=useState<FiscalContext|null>(null);

  const load=useCallback(async(silent=false)=>{
    if(!supabase)return;
    if(!silent)setLoading(true);else setRefreshing(true);
    setError("");
    const [paymentsResult,deliveriesResult]=await Promise.all([
      supabase.from("mensalidades").select("id,aluno_id,competencia,valor_nfse,descricao_servico,status_pagamento,status_nfse,dps_xml_path,dps_xml_id,nfse_homologacao_xml_path,chave_nfse_homologacao,homologacao_emitida_em,alunos(nome,responsavel,segmento,cpf_cnpj,email,whatsapp,cep,logradouro,numero,cidade,uf)").order("created_at",{ascending:false}),
      supabase.from("nfse_entregas").select("mensalidade_id,status,canal,created_at").order("created_at",{ascending:false}),
    ]);
    if(paymentsResult.error){
      setError(paymentsResult.error.message||"Não foi possível carregar o assistente.");
    }else{
      const nextPayments=(paymentsResult.data||[]) as unknown as AssistantPayment[];
      setPayments(nextPayments);
      setDeliveries(deliveriesResult.error?[]:(deliveriesResult.data||[]) as DeliveryState[]);
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
  useEffect(()=>{
    if(!selected){setDraftCompetence("");setDraftValue("");setDraftDescription("");return}
    const competence=competenceInput(selected.competencia);
    setDraftCompetence(competence);
    setDraftValue(String(selected.valor_nfse));
    setDraftDescription(selected.descricao_servico||defaultServiceDescription(competence,selected.alunos?.segmento));
    setMessage("");setError("");
  },[selected?.id]);
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
  useEffect(()=>{
    if(effectiveCurrent!==3||fiscalContext||!canPrepare)return;
    void loadFiscalContext().catch(cause=>setError(cause instanceof Error?cause.message:"Não foi possível carregar a configuração fiscal."));
  },[effectiveCurrent,fiscalContext,canPrepare]);


  async function loadFiscalContext(){
    if(!supabase)return null;
    const result=await supabase.from("configuracoes_empresa").select("cnpj,razao_social,cidade,uf,regime_tributario,pis_aliquota,cofins_aliquota,pis_cofins_cst,pis_cofins_retencao").eq("id",true).maybeSingle();
    if(result.error||!result.data)throw new Error(result.error?.message||"Configuração fiscal da empresa não encontrada.");
    const context=result.data as FiscalContext;
    setFiscalContext(context);
    return context;
  }

  async function validateSelected(){
    if(!supabase||!selected||!canPrepare)return;
    setBusyAction("validate");setError("");setMessage("");
    try{
      const companyResult=await supabase.from("configuracoes_empresa").select("cnpj,razao_social,cidade,uf,regime_tributario,pis_aliquota,cofins_aliquota,pis_cofins_cst,pis_cofins_retencao").eq("id",true).maybeSingle();
      const certificateResult=await supabase.from("certificados_a1").select("validade,status,cnpj,senha_configurada").eq("status","ATIVO").order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(companyResult.error||certificateResult.error)throw new Error(companyResult.error?.message||certificateResult.error?.message||"Não foi possível conferir os dados fiscais.");
      const company=companyResult.data as FiscalContext|null;
      const certificate=certificateResult.data as {validade:string;senha_configurada:boolean}|null;
      if(company)setFiscalContext(company);
      const pending:string[]=[...missingStudentFields(selected)];
      if(selected.alunos?.cpf_cnpj&&!isValidCpfCnpj(selected.alunos.cpf_cnpj))pending.push("CPF/CNPJ válido");
      if(!company?.cnpj)pending.push("CNPJ da empresa");
      if(!company?.razao_social)pending.push("razão social");
      if(!company?.cidade||!company?.uf)pending.push("município da empresa");
      if(company?.regime_tributario!=="LUCRO PRESUMIDO")pending.push("regime tributário Lucro Presumido");
      if(!certificate)pending.push("certificado A1 ativo");
      else if(new Date(certificate.validade+"T23:59:59").getTime()<Date.now())pending.push("certificado A1 válido");
      else if(!certificate.senha_configurada)pending.push("senha protegida do certificado A1");
      const comp=competenceInput(selected.competencia);
      if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(comp)||comp>currentCompetenceInput())pending.push("competência válida");
      if(Number(selected.valor_nfse)<=0)pending.push("valor da NFS-e");
      if(pending.length)throw new Error("Antes de validar, complete: "+Array.from(new Set(pending)).join(", ")+".");
      const update=await supabase.from("mensalidades").update({status_nfse:"Homologação validada"}).eq("id",selected.id).is("chave_nfse_homologacao",null).select("id").maybeSingle();
      if(update.error||!update.data)throw new Error(update.error?.message||"Esta nota já foi emitida ou alterada por outro usuário.");
      const service=fiscalServiceForSegment(selected.alunos?.segmento);
      const history=await supabase.from("historico_nfse").insert({
        mensalidade_id:selected.id,
        evento:"validacao_homologacao_aprovada",
        valor_anterior:selected.valor_nfse,
        valor_novo:selected.valor_nfse,
        detalhes:"Validação pelo Assistente aprovada. Serviço "+service.code+" - "+service.description+". Nenhuma transmissão realizada."
      });
      if(history.error)throw new Error("Validação concluída, mas o histórico não pôde ser gravado: "+history.error.message);
      setMessage("Validação concluída. Agora revise os campos editáveis da DPS.");
      await load(true);
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível validar a nota.");}
    finally{setBusyAction("")}
  }

  async function saveDps(){
    if(!supabase||!selected||!canPrepare||selected.chave_nfse_homologacao)return;
    setBusyAction("save-dps");setError("");setMessage("");
    try{
      const amount=Number(draftValue.replace(",","."));
      if(!draftCompetence||draftCompetence>currentCompetenceInput())throw new Error("A competência não pode ser posterior ao mês atual.");
      if(!Number.isFinite(amount)||amount<=0)throw new Error("Informe um valor válido para a NFS-e.");
      const description=upper(draftDescription).trim();
      if(!description||description.length>1000)throw new Error("A descrição do serviço deve ter entre 1 e 1000 caracteres.");
      const oldValue=selected.valor_nfse;
      const update=await supabase.from("mensalidades").update({
        competencia:formatCompetence(draftCompetence),
        valor_nfse:amount,
        descricao_servico:description,
        status_nfse:"DPS revisada"
      }).eq("id",selected.id).is("chave_nfse_homologacao",null).select("id").maybeSingle();
      if(update.error||!update.data)throw new Error(update.error?.message||"Esta nota já foi emitida ou alterada por outro usuário.");
      const history=await supabase.from("historico_nfse").insert({
        mensalidade_id:selected.id,
        evento:"dps_revisada_no_assistente",
        valor_anterior:oldValue,
        valor_novo:amount,
        detalhes:"DPS revisada no Assistente. Competência "+formatCompetence(draftCompetence)+". Descrição: "+description+". Nenhuma transmissão realizada."
      });
      if(history.error)throw new Error("DPS salva, mas o histórico não pôde ser gravado: "+history.error.message);
      setDraftDescription(description);
      setMessage("DPS revisada e salva. Confira agora a prévia completa.");
      await load(true);
      await loadFiscalContext();
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar a DPS.");}
    finally{setBusyAction("")}
  }

  async function approvePreview(){
    if(!supabase||!selected||!canPrepare||selected.chave_nfse_homologacao)return;
    setBusyAction("approve");setError("");setMessage("");
    try{
      const context=fiscalContext||await loadFiscalContext();
      if(!context)throw new Error("Configuração fiscal indisponível.");
      const description=upper(draftDescription).trim();
      if(!description)throw new Error("Informe a descrição do serviço antes de aprovar.");
      const amount=Number(draftValue.replace(",","."));
      if(!Number.isFinite(amount)||amount<=0)throw new Error("Informe um valor válido para a NFS-e.");
      const update=await supabase.from("mensalidades").update({
        competencia:formatCompetence(draftCompetence),
        valor_nfse:amount,
        descricao_servico:description,
        status_nfse:"Prévia DPS aprovada"
      }).eq("id",selected.id).is("chave_nfse_homologacao",null).select("id").maybeSingle();
      if(update.error||!update.data)throw new Error(update.error?.message||"Esta nota já foi emitida ou alterada por outro usuário.");
      const service=fiscalServiceForSegment(selected.alunos?.segmento);
      const history=await supabase.from("historico_nfse").insert({
        mensalidade_id:selected.id,
        evento:"previa_dps_aprovada",
        valor_anterior:selected.valor_nfse,
        valor_novo:amount,
        detalhes:"Prévia DPS aprovada no Assistente, sem transmissão. Serviço "+service.code+"; regime "+context.regime_tributario+"; PIS "+context.pis_aliquota+"%; COFINS "+context.cofins_aliquota+"%; descrição: "+description+"."
      });
      if(history.error)throw new Error("Prévia aprovada, mas o histórico não pôde ser gravado: "+history.error.message);
      setMessage("Prévia aprovada. A próxima etapa é gerar e validar o XML.");
      await load(true);
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível aprovar a prévia.");}
    finally{setBusyAction("")}
  }

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
    if(effectiveCurrent===1){void validateSelected();return}
    if(effectiveCurrent===2){void saveDps();return}
    if(effectiveCurrent===3){void approvePreview();return}
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
    {message&&<div className="success-box" role="status">{message}</div>}

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


          {selected&&canPrepare&&!selected.chave_nfse_homologacao&&effectiveCurrent>=2&&effectiveCurrent<=3&&<section className="assistant-dps-workspace">
            <div className="assistant-workspace-head">
              <div>
                <span>{effectiveCurrent===2?"EDIÇÃO DA DPS":"PRÉVIA PARA APROVAÇÃO"}</span>
                <h3>{effectiveCurrent===2?"Revise somente o que pode ser alterado":"Confira tudo antes de aprovar"}</h3>
                <p>{effectiveCurrent===2?"Os dados do aluno e do responsável permanecem protegidos no cadastro. Aqui você ajusta competência, valor e descrição do serviço.":"Depois da aprovação, qualquer alteração deve ser feita antes da geração do XML."}</p>
              </div>
              <span className="assistant-safe-tag"><ShieldCheck size={15}/>Sem transmissão</span>
            </div>
            {effectiveCurrent===2?<div className="assistant-dps-editor">
              <div className="assistant-edit-grid">
                <label><span>Competência</span><input type="month" max={currentCompetenceInput()} value={draftCompetence} onChange={e=>setDraftCompetence(e.target.value)}/></label>
                <label><span>Valor da NFS-e</span><input type="text" inputMode="decimal" value={draftValue} onChange={e=>setDraftValue(e.target.value.replace(/[^0-9.,]/g,""))}/></label>
              </div>
              <label className="assistant-description-field"><span>Descrição do serviço <em>Editável</em></span><textarea rows={5} maxLength={1000} value={draftDescription} onChange={e=>setDraftDescription(e.target.value)}/><small>{draftDescription.length}/1000 caracteres</small></label>
              <div className="assistant-protected-data">
                <strong>Dados protegidos pelo cadastro</strong>
                <div>
                  <span>Aluno<b>{selected.alunos?.nome||"—"}</b></span>
                  <span>Responsável<b>{selected.alunos?.responsavel||"—"}</b></span>
                  <span>CPF/CNPJ<b>{selected.alunos?.cpf_cnpj||"—"}</b></span>
                  <span>Serviço fiscal<b>{fiscalServiceForSegment(selected.alunos?.segmento).code}</b></span>
                </div>
              </div>
            </div>:<div className="assistant-preview-sheet">
              <div className="assistant-preview-title"><div><strong>JPI Fiscal · Prévia DPS</strong><span>Documento para conferência — ainda não transmitido</span></div><span>#{selected.id}</span></div>
              <div className="assistant-preview-grid">
                <div><small>Aluno</small><strong>{selected.alunos?.nome||"—"}</strong></div>
                <div><small>Responsável / tomador</small><strong>{selected.alunos?.responsavel||"—"}</strong></div>
                <div><small>CPF/CNPJ</small><strong>{selected.alunos?.cpf_cnpj||"—"}</strong></div>
                <div><small>Competência</small><strong>{formatCompetence(draftCompetence)}</strong></div>
                <div><small>Valor do serviço</small><strong>{money(Number(draftValue.replace(",","."))||0)}</strong></div>
                <div><small>Código do serviço</small><strong>{fiscalServiceForSegment(selected.alunos?.segmento).code}</strong></div>
              </div>
              <div className="assistant-preview-description"><small>Descrição do serviço</small><p>{upper(draftDescription)||"—"}</p></div>
              <div className="assistant-preview-fiscal">
                <span><small>Regime</small><b>{fiscalContext?.regime_tributario||"LUCRO PRESUMIDO"}</b></span>
                <span><small>PIS</small><b>{fiscalContext?String(fiscalContext.pis_aliquota)+"%":"Conforme configuração"}</b></span>
                <span><small>COFINS</small><b>{fiscalContext?String(fiscalContext.cofins_aliquota)+"%":"Conforme configuração"}</b></span>
                <span><small>Ambiente</small><b>Homologação</b></span>
              </div>
            </div>}
          </section>}

          <div className="assistant-next-card">
            {effectiveCurrent===1&&<><ShieldCheck/><div><strong>Validação automática e segura</strong><span>Confira dados do tomador, competência, valor, configuração fiscal e certificado A1 antes de preparar a DPS.</span></div></>}
            {effectiveCurrent===2&&<><FileText/><div><strong>DPS em foco</strong><span>Os campos editáveis estão logo acima. Salve a revisão para avançar automaticamente para a prévia.</span></div></>}
            {effectiveCurrent===3&&<><FileText/><div><strong>Aprovação da prévia</strong><span>Confira o documento ampliado acima. A emissão só continua depois da sua aprovação.</span></div></>}
            {effectiveCurrent===4&&<><FileCode2/><div><strong>Gerar XML</strong><span>O XML será guardado no repositório privado e precisa estar válido antes da transmissão.</span></div></>}
            {effectiveCurrent===5&&<><Send/><div><strong>SEFIN / homologação</strong><span>Enquanto produção não estiver liberada, esta etapa continua protegida como homologação.</span></div></>}
            {effectiveCurrent===6&&<><Check/><div><strong>Conferência final</strong><span>Confira a chave e o documento retornado antes de iniciar a entrega ao responsável.</span></div></>}
            {effectiveCurrent>=7&&<><MailCheck/><div><strong>Enviar nota</strong><span>O assistente leva a mesma nota para os canais de entrega já existentes, preservando o histórico.</span></div></>}
          </div>

          {!canPrepare&&effectiveCurrent>0&&effectiveCurrent<7&&<div className="notice compact"><ShieldCheck/><span>Seu perfil pode acompanhar o processo, mas não possui permissão para preparar a NFS-e.</span></div>}
          <div className="assistant-actions">
            <button className="primary assistant-main-action" onClick={continueProcess} disabled={Boolean(busyAction)||(!canPrepare&&effectiveCurrent>0&&effectiveCurrent<7)}>
              {busyAction==="validate"?"Validando…":busyAction==="save-dps"?"Salvando DPS…":busyAction==="approve"?"Aprovando…":effectiveCurrent===1&&missing.length?"Corrigir cadastro":effectiveCurrent===1?"Validar nota":effectiveCurrent===2?"Salvar DPS e ver prévia":effectiveCurrent===3?"Aprovar prévia":effectiveCurrent>=7?"Ir para envio":"Continuar processo"} <ChevronRight size={18}/>
            </button>
            {effectiveCurrent>1&&effectiveCurrent<7&&<button className="secondary" onClick={()=>focusAndNavigate("NFS-e")}>Abrir NFS-e atual</button>}
            {progress?.finished&&<button className="secondary" onClick={()=>focusAndNavigate("Enviar notas")}>Ir direto para envio</button>}
          </div>
        </>}
      </article>
    </section>
  </div>;
}
