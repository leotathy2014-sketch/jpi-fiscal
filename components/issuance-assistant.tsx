"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronRight, CircleAlert, Eye, FileCode2, FileText, GraduationCap, Mail, MailCheck, MessageCircle, Plus, ReceiptText, RefreshCw, Search, Send, ShieldCheck, Sparkles, UsersRound, WalletCards } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { buildDpsDraft, isValidCpfCnpj, NFSE_OWN_APP_SERIES } from "@/lib/nfse-dps";
import type { AppPage } from "./app-shell";
import { useAccess } from "./access";
import { SweducOperationalPicker } from "./sweduc-operational-picker";

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
    turma:string|null;
    responsavel:string;
    segmento:string;
    cpf_cnpj:string|null;
    email:string|null;
    whatsapp:string|null;
    agenda_edu_student_id:string|null;
    agenda_edu_use_external_id:boolean;
    cep:string|null;
    logradouro:string|null;
    numero:string|null;
    cidade:string|null;
    uf:string|null;
  }|null;
};
type AssistantStudent={
  id:number;nome:string;turma:string|null;segmento:string;responsavel:string;cpf_cnpj:string|null;email:string|null;whatsapp:string|null;
  cep:string|null;logradouro:string|null;numero:string|null;cidade:string|null;uf:string|null
};
type DeliveryState={mensalidade_id:number;status:string;canal:string;created_at:string};
type StepState="done"|"current"|"pending"|"warning";
type AssistantStep={key:string;label:string;short:string;description:string;state:StepState};
type FiscalContext={cnpj:string|null;razao_social:string|null;cidade:string|null;uf:string|null;regime_tributario:string;pis_aliquota:number;cofins_aliquota:number;pis_cofins_cst:string;pis_cofins_retencao:number};
type DeliveryDocument={id:number;mensalidade_id:number;versao:number;chave_acesso:string;estado:string;emitida_em:string|null};
type DeliveryChannel="email"|"whatsapp-manual"|"agenda-edu";
type ManualSender={id:number;nome:string;numero:string};
type ManualWhatsappInfo={ready:boolean;testRecipient:string|null;senders:ManualSender[];mode:"manual";cost:"gratuito"};
type AgendaEduInfo={ready:boolean;environment:string;channelConfigured:boolean;message:string};
type ManualPending={deliveryId:number;whatsappUrl:string|null;actualRecipient:string;sender?:ManualSender|null};

const money=(value:number)=>Number(value).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
const competenceInput=(value:string)=>{const match=value.trim().match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);return match?match[2]+"-"+match[1]:value};
const formatCompetence=(value:string)=>{const parts=value.split("-");return parts[0]&&parts[1]?parts[1]+"/"+parts[0]:value};
const currentCompetenceInput=()=>{const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit"}).formatToParts(new Date());const part=(type:"year"|"month")=>parts.find(item=>item.type===type)?.value||"";return part("year")+"-"+part("month")};
const upper=(value:string)=>value.toLocaleUpperCase("pt-BR");
const fiscalServiceForSegment=(segment?:string|null)=>{const normalized=normalize(segment||"");if(normalized.includes("medio"))return {code:"08.01.01",description:"Ensino regular médio",nbs:"122013000"};if(normalized.includes("1º")||normalized.includes("6º")||normalized.includes("fundamental"))return {code:"08.01.01",description:"Ensino regular fundamental",nbs:"122012000"};return {code:"08.01.01",description:"Ensino regular pré-escolar",nbs:"122011200"}};
const defaultServiceDescription=(competence:string,student?:{nome?:string|null;turma?:string|null;segmento?:string|null}|null)=>["MENSALIDADE ESCOLAR",student?.nome?"ALUNO: "+upper(student.nome):null,student?.turma?"TURMA: "+upper(student.turma):null,student?.segmento?"SEGMENTO: "+upper(student.segmento):null,"COMPETÊNCIA "+formatCompetence(competence)].filter(Boolean).join(" - ");
const parseMoneyInput=(value:string)=>{const clean=value.replace(/R\$/g,"").replace(/\s/g,"");if(clean.includes(","))return Number(clean.replace(/\./g,"").replace(",","."));return Number(clean)};
const dpsDraftVersionPath=(paymentId:number,draftId:string)=>{const timestamp=new Date().toISOString().replace(/\D/g,"").slice(0,17);const revision=timestamp+"-"+crypto.randomUUID().slice(0,8);return "dps/"+paymentId+"/rascunhos/"+revision+"/"+draftId+".xml"};

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
  const canCreatePayment=can("payments.create");
  const canSendEmail=can("deliveries.send_email");
  const canSendWhatsapp=can("deliveries.send_whatsapp");
  const canSendAgenda=can("deliveries.send_agenda");
  const [students,setStudents]=useState<AssistantStudent[]>([]);
  const [newEmissionOpen,setNewEmissionOpen]=useState(true);
  const [resumePaymentId,setResumePaymentId]=useState<number|null>(null);
  const [newStudentId,setNewStudentId]=useState<number|null>(null);
  const [studentQuery,setStudentQuery]=useState("");
  const [newCompetence,setNewCompetence]=useState(()=>currentCompetenceInput());
  const [newValue,setNewValue]=useState("");
  const [newPaymentStatus,setNewPaymentStatus]=useState("Aberto");
  const [newDescription,setNewDescription]=useState("");
  const [newDescriptionEdited,setNewDescriptionEdited]=useState(false);
  const [payments,setPayments]=useState<AssistantPayment[]>([]);
  const [deliveries,setDeliveries]=useState<DeliveryState[]>([]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busyAction,setBusyAction]=useState<""|"create-payment"|"validate"|"save-dps"|"approve"|"xml">("");
  const [draftCompetence,setDraftCompetence]=useState("");
  const [draftValue,setDraftValue]=useState("");
  const [draftDescription,setDraftDescription]=useState("");
  const [fiscalContext,setFiscalContext]=useState<FiscalContext|null>(null);
  const [deliveryChannel,setDeliveryChannel]=useState<DeliveryChannel>("email");
  const [activeDocument,setActiveDocument]=useState<DeliveryDocument|null>(null);
  const [deliveryBusy,setDeliveryBusy]=useState(false);
  const [documentBusy,setDocumentBusy]=useState("");
  const [whatsappInfo,setWhatsappInfo]=useState<ManualWhatsappInfo|null>(null);
  const [manualSenderId,setManualSenderId]=useState<number|null>(null);
  const [manualPending,setManualPending]=useState<ManualPending|null>(null);
  const [agendaEduInfo,setAgendaEduInfo]=useState<AgendaEduInfo|null>(null);

  const load=useCallback(async(silent=false)=>{
    if(!supabase)return;
    if(!silent)setLoading(true);else setRefreshing(true);
    setError("");
    const [paymentsResult,studentsResult,deliveriesResult]=await Promise.all([
      supabase.from("mensalidades").select("id,aluno_id,competencia,valor_nfse,descricao_servico,status_pagamento,status_nfse,dps_xml_path,dps_xml_id,nfse_homologacao_xml_path,chave_nfse_homologacao,homologacao_emitida_em,alunos(nome,turma,responsavel,segmento,cpf_cnpj,email,whatsapp,agenda_edu_student_id,agenda_edu_use_external_id,cep,logradouro,numero,cidade,uf)").order("created_at",{ascending:false}),
      supabase.from("alunos").select("id,nome,turma,segmento,responsavel,cpf_cnpj,email,whatsapp,cep,logradouro,numero,cidade,uf").order("nome"),
      supabase.from("nfse_entregas").select("mensalidade_id,status,canal,created_at").order("created_at",{ascending:false}),
    ]);
    if(paymentsResult.error){
      setError(paymentsResult.error.message||"Não foi possível carregar o assistente.");
    }else{
      const nextPayments=(paymentsResult.data||[]) as unknown as AssistantPayment[];
      setPayments(nextPayments);
      setStudents(studentsResult.error?[]:(studentsResult.data||[]) as AssistantStudent[]);
      const nextDeliveries=deliveriesResult.error?[]:(deliveriesResult.data||[]) as DeliveryState[];
      setDeliveries(nextDeliveries);
      const remembered=Number(localStorage.getItem("jpi-issuance-assistant-payment")||"0");
      const rememberedPayment=nextPayments.find(item=>item.id===remembered);
      const rememberedSent=remembered?nextDeliveries.some(item=>item.mensalidade_id===remembered&&item.status==="enviado"):false;
      setResumePaymentId(rememberedPayment&&(!rememberedPayment.homologacao_emitida_em||!rememberedSent)?remembered:null);
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
  useEffect(()=>{
    const importedId=Number(sessionStorage.getItem("jpi-assistant-student-focus")||"0");
    if(!importedId||!students.some(student=>student.id===importedId))return;
    sessionStorage.removeItem("jpi-assistant-student-focus");
    setNewEmissionOpen(true);
    setNewStudentId(importedId);
    setStudentQuery("");
    setNewDescriptionEdited(false);
    setMessage("Aluno importado da SWeduc selecionado. Informe competência e valor para iniciar a nota.");
  },[students]);

  const filtered=useMemo(()=>{
    const q=normalize(query.trim());
    if(!q)return payments;
    return payments.filter(payment=>normalize([payment.alunos?.nome,payment.alunos?.responsavel,payment.competencia,payment.status_nfse,String(payment.id)].filter(Boolean).join(" ")).includes(q));
  },[payments,query]);
  const filteredStudents=useMemo(()=>{
    const q=normalize(studentQuery.trim());
    if(!q)return students;
    return students.filter(student=>normalize([student.nome,student.responsavel,student.turma,student.segmento,student.cpf_cnpj].filter(Boolean).join(" ")).includes(q));
  },[studentQuery,students]);
  const selectedStudent=useMemo(()=>students.find(student=>student.id===newStudentId)||null,[newStudentId,students]);
  const resumePayment=useMemo(()=>payments.find(item=>item.id===resumePaymentId)||null,[payments,resumePaymentId]);
  const selected=useMemo(()=>payments.find(item=>item.id===selectedId)||null,[payments,selectedId]);
  useEffect(()=>{
    if(!selected){setDraftCompetence("");setDraftValue("");setDraftDescription("");return}
    const competence=competenceInput(selected.competencia);
    setDraftCompetence(competence);
    setDraftValue(String(selected.valor_nfse));
    setDraftDescription(selected.descricao_servico||defaultServiceDescription(competence,selected.alunos));
    setMessage("");setError("");setActiveDocument(null);setManualPending(null);
  },[selected?.id]);
  useEffect(()=>{
    if(!selectedStudent){setNewDescription("");setNewDescriptionEdited(false);return}
    if(!newDescriptionEdited)setNewDescription(defaultServiceDescription(newCompetence,selectedStudent));
  },[selectedStudent,newCompetence,newDescriptionEdited]);
  const delivery=useMemo(()=>selected?deliveries.find(item=>item.mensalidade_id===selected.id&&item.status==="enviado")||null:null,[deliveries,selected]);
  const missing=selected?missingStudentFields(selected):[];
  const progress=selected?statusOrder(selected):null;

  const steps=useMemo<AssistantStep[]>(()=>{
    const labels=["Aluno","Mensalidade","Validação","DPS","Prévia","XML","SEFIN","Conclusão","Enviar"];
    if(newEmissionOpen){
      return labels.map((label,index)=>{
        const state:StepState=index===0?(selectedStudent?"done":"current"):index===1?(selectedStudent?"current":"pending"):"pending";
        const description=index===0?(selectedStudent?"Aluno cadastrado selecionado.":"Selecione um aluno já cadastrado."):index===1?(selectedStudent?"Informe competência, valor e situação do pagamento.":"Aguardando seleção do aluno."):"Aguardando etapa anterior.";
        return {key:label.toLowerCase(),label,short:String(index+1),description,state};
      });
    }
    if(!selected||!progress)return labels.map((label,index)=>({
      key:label.toLowerCase(),label,short:String(index+1),
      description:index===0?"Selecione uma emissão já iniciada.":"Aguardando etapa anterior.",
      state:(index===0?"current":"pending") as StepState
    }));
    const completion=[
      true,
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
    const current=firstIncomplete<0?8:firstIncomplete;
    const descriptions=[
      missing.length?"Cadastro selecionado com "+missing.length+" pendência(s).":"Aluno e responsável selecionados.",
      "Mensalidade criada e vinculada à emissão.",
      progress.validationDone?"Dados fiscais já validados.":"Conferir cadastro, competência, valor e certificado.",
      progress.dpsDone?"DPS preparada.":"Preparar e revisar os dados editáveis da DPS.",
      progress.previewDone?"Prévia aprovada.":"Conferir a prévia e aprovar antes do XML.",
      progress.xmlDone?"XML da DPS armazenado.":"Gerar e validar o XML da DPS.",
      progress.sefinDone?"SEFIN retornou a nota de teste.":"Transmitir somente para homologação enquanto produção estiver bloqueada.",
      progress.finished?"Nota concluída no ambiente atual.":"Conferir retorno, chave e documento gerado.",
      delivery?"Nota já possui envio concluído.":"Escolher canal e enviar a nota ao responsável.",
    ];
    return labels.map((label,index)=>({
      key:label.toLowerCase(),label,short:String(index+1),description:descriptions[index],
      state:(completion[index]?"done":index===current?(index===2&&missing.length?"warning":"current"):"pending") as StepState,
    }));
  },[delivery,missing.length,newEmissionOpen,progress,selected,selectedStudent]);

  const currentIndex=steps.findIndex(step=>step.state==="current"||step.state==="warning");
  const effectiveCurrent=currentIndex<0?8:currentIndex;
  const nextTitle=newEmissionOpen
    ?selectedStudent?"Criar mensalidade e iniciar nota":"Selecionar aluno cadastrado"
    :selected?[
      "Aluno selecionado",
      "Mensalidade criada",
      missing.length?"Corrigir cadastro antes de validar":"Validar dados da nota",
      "Preparar / editar DPS",
      "Aprovar prévia da DPS",
      "Gerar e validar XML",
      "Homologar na NFS-e",
      "Conferir nota concluída",
      delivery?"Envio concluído":"Enviar nota ao responsável",
    ][effectiveCurrent]:"Selecione uma emissão";
  useEffect(()=>{
    if(newEmissionOpen||effectiveCurrent!==4||fiscalContext||!canPrepare)return;
    void loadFiscalContext().catch(cause=>setError(cause instanceof Error?cause.message:"Não foi possível carregar a configuração fiscal."));
  },[newEmissionOpen,effectiveCurrent,fiscalContext,canPrepare]);

  useEffect(()=>{
    if(newEmissionOpen||effectiveCurrent<7||!selected?.chave_nfse_homologacao)return;
    void loadDeliveryContext().catch(cause=>setError(cause instanceof Error?cause.message:"Não foi possível preparar a conclusão da nota."));
  },[newEmissionOpen,effectiveCurrent,selected?.id,selected?.chave_nfse_homologacao,canSendWhatsapp,canSendAgenda]);


  async function createPaymentFromStudent(){
    if(!supabase||!selectedStudent||!canCreatePayment)return;
    setBusyAction("create-payment");setError("");setMessage("");
    try{
      if(!newCompetence||newCompetence>currentCompetenceInput())throw new Error("A competência não pode ser posterior ao mês atual.");
      const amount=parseMoneyInput(newValue);
      if(!Number.isFinite(amount)||amount<=0)throw new Error("Informe um valor válido para a mensalidade.");
      const description=upper(newDescription||defaultServiceDescription(newCompetence,selectedStudent)).trim();
      if(!description||description.length>1000)throw new Error("A descrição do serviço deve ter entre 1 e 1000 caracteres.");
      const competence=formatCompetence(newCompetence);
      const existing=await supabase.from("mensalidades").select("id").eq("aluno_id",selectedStudent.id).eq("competencia",competence).order("id",{ascending:false}).limit(1).maybeSingle();
      if(existing.error)throw new Error(existing.error.message);
      if(existing.data?.id){
        const existingId=Number(existing.data.id);
        setSelectedId(existingId);
        setResumePaymentId(existingId);
        localStorage.setItem("jpi-issuance-assistant-payment",String(existingId));
        setNewEmissionOpen(false);
        setMessage("Já existe uma mensalidade para este aluno nesta competência. O Assistente abriu o processo existente para evitar duplicidade.");
        await load(true);
        return;
      }
      const insert=await supabase.from("mensalidades").insert({
        aluno_id:selectedStudent.id,
        competencia:competence,
        valor_mensalidade:amount,
        valor_nfse:amount,
        descricao_servico:description,
        status_pagamento:newPaymentStatus
      }).select("id").single();
      if(insert.error||!insert.data)throw new Error(insert.error?.message||"Não foi possível criar a mensalidade.");
      const id=Number(insert.data.id);
      setSelectedId(id);
      setResumePaymentId(id);
      localStorage.setItem("jpi-issuance-assistant-payment",String(id));
      setNewEmissionOpen(false);
      setMessage("Mensalidade criada e nota iniciada. O próximo passo é validar os dados fiscais.");
      setNewValue("");setNewPaymentStatus("Aberto");setNewDescriptionEdited(false);
      await load(true);
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível iniciar a emissão.");}
    finally{setBusyAction("")}
  }

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

  async function loadDeliveryContext(){
    if(!supabase||!selected||!selected.chave_nfse_homologacao)return;
    const documentResult=await supabase.from("nfse_documentos_homologacao")
      .select("id,mensalidade_id,versao,chave_acesso,estado,emitida_em")
      .eq("mensalidade_id",selected.id).eq("estado","ativa").order("versao",{ascending:false}).limit(1).maybeSingle();
    if(documentResult.error)throw new Error(documentResult.error.message);
    setActiveDocument((documentResult.data||null) as DeliveryDocument|null);
    const {data:{session}}=await supabase.auth.getSession();
    const token=session?.access_token||null;
    if(!token)return;
    if(canSendWhatsapp){
      try{
        const response=await authenticatedFetch("/api/deliveries/whatsapp-manual",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
        const data=await response.json().catch(()=>({})) as ManualWhatsappInfo&{error?:string};
        if(response.ok){
          setWhatsappInfo(data);
          setManualSenderId(current=>current&&data.senders?.some(sender=>sender.id===current)?current:null);
        }
      }catch{}
    }
    if(canSendAgenda){
      try{
        const response=await authenticatedFetch("/api/deliveries/agenda-edu",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
        const data=await response.json().catch(()=>({})) as AgendaEduInfo&{error?:string};
        if(response.ok)setAgendaEduInfo(data);
      }catch{}
    }
  }

  async function sendCurrentDocument(){
    if(!supabase||!selected||!activeDocument||deliveryBusy)return;
    const allowed=deliveryChannel==="email"?canSendEmail:deliveryChannel==="whatsapp-manual"?canSendWhatsapp:canSendAgenda;
    if(!allowed){setError("Seu perfil não possui permissão para este canal.");return}
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){setError("Sua sessão expirou. Entre novamente.");return}
    setDeliveryBusy(true);setError("");setMessage("");
    try{
      if(deliveryChannel==="whatsapp-manual"){
        if(!whatsappInfo?.ready)throw new Error("O WhatsApp manual ainda não está configurado.");
        if(!manualSenderId)throw new Error("Escolha qual WhatsApp da escola será usado.");
        const popup=window.open("about:blank","_blank");if(popup)popup.opener=null;
        try{
          const response=await authenticatedFetch("/api/deliveries/whatsapp-manual",{
            method:"POST",
            headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
            body:JSON.stringify({action:"prepare",monthlyId:selected.id,documentId:activeDocument.id,senderId:manualSenderId,requestId:crypto.randomUUID()}),
            cache:"no-store"
          });
          const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string;deliveryId?:number;whatsappUrl?:string;actualRecipient?:string;sender?:ManualSender};
          if(!response.ok||!data.ok||!data.deliveryId||!data.whatsappUrl)throw new Error(data.error||"Não foi possível preparar o WhatsApp.");
          const whatsappUrl=new URL(data.whatsappUrl);
          if(whatsappUrl.protocol!=="https:"||whatsappUrl.hostname!=="wa.me")throw new Error("O endereço seguro do WhatsApp não pôde ser validado.");
          if(popup)popup.location.href=whatsappUrl.toString();else window.open(whatsappUrl.toString(),"_blank","noopener,noreferrer");
          setManualPending({deliveryId:data.deliveryId,whatsappUrl:whatsappUrl.toString(),actualRecipient:data.actualRecipient||"número interno",sender:data.sender||whatsappInfo.senders.find(sender=>sender.id===manualSenderId)||null});
          setMessage("WhatsApp aberto. Depois de enviar a mensagem, confirme o envio no Assistente.");
        }catch(cause){popup?.close();throw cause}
      }else{
        if(deliveryChannel==="agenda-edu"&&!agendaEduInfo?.ready)throw new Error(agendaEduInfo?.message||"A Agenda Edu ainda está aguardando configuração.");
        const endpoint=deliveryChannel==="agenda-edu"?"/api/deliveries/agenda-edu":"/api/deliveries/email";
        const response=await authenticatedFetch(endpoint,{
          method:"POST",
          headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
          body:JSON.stringify({monthlyId:selected.id,documentId:activeDocument.id,requestId:crypto.randomUUID()}),
          cache:"no-store"
        });
        const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};
        if(!response.ok||!data.ok)throw new Error(data.error||"O provedor não confirmou esta entrega.");
        setMessage(deliveryChannel==="agenda-edu"?"NFS-e enviada pela Agenda Edu e registrada no histórico.":"NFS-e enviada por e-mail e registrada no histórico.");
        await load(true);
      }
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível enviar a nota.");}
    finally{setDeliveryBusy(false)}
  }

  async function finishManualDelivery(action:"confirm"|"cancel"){
    if(!supabase||!manualPending||deliveryBusy)return;
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){setError("Sua sessão expirou. Entre novamente.");return}
    setDeliveryBusy(true);setError("");
    try{
      const response=await authenticatedFetch("/api/deliveries/whatsapp-manual",{
        method:"POST",
        headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
        body:JSON.stringify({action,deliveryId:manualPending.deliveryId}),
        cache:"no-store"
      });
      const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string};
      if(!response.ok||!data.ok)throw new Error(data.error||"Não foi possível concluir esta tentativa.");
      setMessage(action==="confirm"?"Envio por WhatsApp confirmado e registrado no histórico.":"Tentativa de WhatsApp cancelada.");
      setManualPending(null);
      await load(true);
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível concluir o envio.");}
    finally{setDeliveryBusy(false)}
  }

  async function openCurrentDocument(format:"pdf"|"xml"){
    if(!supabase||!activeDocument||documentBusy)return;
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){setError("Sua sessão expirou. Entre novamente.");return}
    const popup=window.open("","_blank");if(popup)popup.opener=null;
    setDocumentBusy(format);setError("");
    try{
      const params=new URLSearchParams({documentId:String(activeDocument.id),format,disposition:"inline"});
      const response=await authenticatedFetch("/api/deliveries/documents?"+params.toString(),{headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"});
      if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};throw new Error(data.error||"O documento não pôde ser aberto.");}
      const blob=await response.blob();const url=URL.createObjectURL(blob);
      if(popup)popup.location.href=url;else window.open(url,"_blank","noopener,noreferrer");
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(cause){popup?.close();setError(cause instanceof Error?cause.message:"Não foi possível abrir o documento.");}
    finally{setDocumentBusy("")}
  }

  async function generateXmlInAssistant(){
    if(!supabase||!selected||!canPrepare||selected.chave_nfse_homologacao)return;
    setBusyAction("xml");setError("");setMessage("");
    let storedPath="";
    try{
      if(selected.status_nfse!=="Prévia DPS aprovada")throw new Error("A prévia da DPS precisa estar aprovada antes de gerar o XML.");
      const context=fiscalContext||await loadFiscalContext();
      if(!context)throw new Error("Configuração fiscal indisponível.");
      const service=fiscalServiceForSegment(selected.alunos?.segmento);
      const description=upper(selected.descricao_servico||draftDescription||defaultServiceDescription(competenceInput(selected.competencia),selected.alunos)).trim();
      const draft=buildDpsDraft({
        municipalityCode:"3304557",
        series:NFSE_OWN_APP_SERIES,
        number:String(selected.id),
        competence:selected.competencia,
        provider:{
          cnpj:context.cnpj||"",
          municipalRegistration:null,
          name:context.razao_social
        },
        taker:{
          taxId:selected.alunos?.cpf_cnpj||"",
          name:selected.alunos?.responsavel||"",
          email:selected.alunos?.email,
          phone:selected.alunos?.whatsapp
        },
        service:{
          nationalTaxCode:service.code,
          nbs:service.nbs,
          description,
          amount:Number(selected.valor_nfse),
          issRate:5,
          federalTaxes:{
            cst:context.pis_cofins_cst,
            pisRate:Number(context.pis_aliquota),
            cofinsRate:Number(context.cofins_aliquota),
            withholdingType:Number(context.pis_cofins_retencao)
          },
          ibsCbs:{
            operationIndicator:"030101",
            taxStatus:"200",
            taxClassification:"200028"
          }
        }
      });
      storedPath=dpsDraftVersionPath(selected.id,draft.id);
      const blob=new Blob([draft.xml],{type:"application/xml"});
      const upload=await supabase.storage.from("documentos-nfse").upload(storedPath,blob,{contentType:"application/xml",upsert:false});
      if(upload.error)throw new Error("Não foi possível guardar o XML: "+upload.error.message);
      const generatedAt=new Date().toISOString();
      const update=await supabase.from("mensalidades").update({
        status_nfse:"XML DPS armazenado",
        descricao_servico:description,
        dps_xml_path:storedPath,
        dps_xml_id:draft.id,
        dps_xml_gerado_em:generatedAt
      }).eq("id",selected.id).eq("status_nfse","Prévia DPS aprovada").is("chave_nfse_homologacao",null).select("id").maybeSingle();
      if(update.error||!update.data){
        await supabase.storage.from("documentos-nfse").remove([storedPath]);
        throw new Error(update.error?.message||"A nota foi alterada por outro usuário antes da geração do XML.");
      }
      const history=await supabase.from("historico_nfse").insert({
        mensalidade_id:selected.id,
        evento:"xml_dps_armazenado",
        valor_anterior:selected.valor_nfse,
        valor_novo:selected.valor_nfse,
        detalhes:"XML DPS "+draft.version+" gerado pelo Assistente com Lucro Presumido, PIS/COFINS e IBS/CBS; arquivo privado "+storedPath+"; identificador "+draft.id+". Nenhuma transmissão realizada."
      });
      if(history.error)throw new Error("O XML foi guardado, mas o histórico não pôde ser gravado: "+history.error.message);
      setMessage("XML da DPS gerado, validado e guardado no sistema. A próxima etapa é a homologação na SEFIN.");
      await load(true);
    }catch(cause){
      if(storedPath){
        const latest=payments.find(item=>item.id===selected.id);
        if(!latest?.dps_xml_path)await supabase.storage.from("documentos-nfse").remove([storedPath]).catch(()=>undefined);
      }
      setError(cause instanceof Error?cause.message:"Não foi possível gerar o XML da DPS.");
    }finally{setBusyAction("")}
  }

  const selectedManualSender=whatsappInfo?.senders?.find(sender=>sender.id===manualSenderId)||null;
  const canCurrentDelivery=deliveryChannel==="email"?canSendEmail:deliveryChannel==="whatsapp-manual"?canSendWhatsapp:canSendAgenda;
  const currentDeliveryReady=deliveryChannel==="email"
    ?canSendEmail&&Boolean(activeDocument)
    :deliveryChannel==="whatsapp-manual"
      ?canSendWhatsapp&&Boolean(activeDocument)&&Boolean(whatsappInfo?.ready)&&Boolean(selectedManualSender)
      :canSendAgenda&&Boolean(activeDocument)&&Boolean(agendaEduInfo?.ready);
  const deliveryRecipient=deliveryChannel==="email"
    ?"Caixa interna de homologação"
    :deliveryChannel==="whatsapp-manual"
      ?whatsappInfo?.testRecipient||"Número interno não configurado"
      :agendaEduInfo?.ready
        ?"Responsáveis vinculados no Sandbox"
        :"Aguardando Agenda Edu";

  function focusAndNavigate(target:"NFS-e"|"Enviar notas"|"Alunos e Responsáveis"){
    if(!selected)return;
    const focus=String(selected.id);
    if(target==="NFS-e")sessionStorage.setItem("jpi-nfse-focus",focus);
    if(target==="Enviar notas")sessionStorage.setItem("jpi-delivery-focus",focus);
    if(target==="Alunos e Responsáveis")sessionStorage.setItem("jpi-student-focus",selected.alunos?.nome||String(selected.aluno_id));
    onNavigate(target);
  }
  function openOfficialHomologation(){
    if(!selected)return;
    const focus=String(selected.id);
    const officialOrigin="https://jpi-fiscal.vercel.app";
    if(window.location.origin===officialOrigin){
      sessionStorage.setItem("jpi-nfse-focus",focus);
      sessionStorage.setItem("jpi-nfse-open-homologation",focus);
      sessionStorage.setItem("jpi-nfse-return-assistant",focus);
      onNavigate("NFS-e");
      return;
    }
    const url=new URL(officialOrigin);
    url.searchParams.set("nfse_hml",focus);
    url.searchParams.set("return_assistant","1");
    window.open(url.toString(),"_blank","noopener,noreferrer");
    setMessage("Homologação aberta no JPI Fiscal oficial. Depois de concluir, volte a esta aba e clique em Atualizar.");
  }
  function startNewEmission(){
    setNewEmissionOpen(true);
    setNewStudentId(null);
    setNewCompetence(currentCompetenceInput());
    setNewValue("");
    setNewPaymentStatus("Aberto");
    setNewDescription("");
    setNewDescriptionEdited(false);
    setError("");
    setMessage("Nova emissão iniciada. Selecione um aluno cadastrado abaixo.");
    window.requestAnimationFrame(()=>{
      window.requestAnimationFrame(()=>{
        const section=document.getElementById("assistant-new-emission");
        section?.scrollIntoView({behavior:"smooth",block:"start"});
        const input=section?.querySelector("input");
        if(input instanceof HTMLInputElement)input.focus();
      });
    });
  }

  function continueProcess(){
    if(newEmissionOpen){void createPaymentFromStudent();return}
    if(!selected)return;
    if(effectiveCurrent===2&&missing.length){focusAndNavigate("Alunos e Responsáveis");return}
    if(effectiveCurrent===2){void validateSelected();return}
    if(effectiveCurrent===3){void saveDps();return}
    if(effectiveCurrent===4){void approvePreview();return}
    if(effectiveCurrent===5){void generateXmlInAssistant();return}
    if(effectiveCurrent===6){openOfficialHomologation();return}
    if(effectiveCurrent>=8){void sendCurrentDocument();return}
    focusAndNavigate("NFS-e");
  }

  return <div className="issuance-assistant-page">
    <div className="page-heading assistant-heading">
      <div><span className="eyebrow">FLUXO GUIADO</span><h1>Assistente de Emissão</h1><p>Comece pelo aluno cadastrado, crie a mensalidade e siga até a emissão e o envio da nota.</p></div>
      <div className="form-actions">
        <button className="primary" onClick={startNewEmission}><Plus size={17}/>Nova emissão</button>
        <button className="secondary" onClick={()=>void load(true)} disabled={refreshing}><RefreshCw size={17}/>{refreshing?"Atualizando…":"Atualizar"}</button>
      </div>
    </div>

    <div className="notice warning"><ShieldCheck/><div><strong>Implantação segura e não destrutiva</strong><span>As telas atuais de NFS-e e Enviar notas continuam funcionando. O assistente apenas organiza e direciona o processo.</span></div></div>
    {error&&<div className="error-box">{error}</div>}
    {message&&<div className="success-box" role="status">{message}</div>}

    {newEmissionOpen&&<section id="assistant-new-emission" className="panel assistant-new-start">
      <div className="panel-title">
        <div><span className="eyebrow">ETAPAS 1 E 2</span><h2>Aluno cadastrado → Mensalidade</h2><p>Escolha o aluno e crie a cobrança que dará origem à NFS-e.</p></div>
        {payments.length>0&&<button className="secondary" onClick={()=>{setNewEmissionOpen(false);setError("");setMessage("")}}>Continuar emissão existente</button>}
      </div>
      {resumePayment&&<div className="assistant-resume-card">
        <RefreshCw size={20}/>
        <div><span>EMISSÃO EM ANDAMENTO</span><strong>{resumePayment.alunos?.nome||("Aluno #"+resumePayment.aluno_id)}</strong><small>{resumePayment.competencia} · {money(resumePayment.valor_nfse)} · {resumePayment.status_nfse}</small></div>
        <button className="secondary" type="button" onClick={()=>{setSelectedId(resumePayment.id);setNewEmissionOpen(false);setError("");setMessage("")}}>Continuar de onde parei <ChevronRight size={16}/></button>
      </div>}
      <div className="assistant-new-start-grid">
        <div className="assistant-new-students">
          <SweducOperationalPicker onStudentReady={student=>{setNewStudentId(student.id);setStudentQuery("");setNewDescriptionEdited(false);setMessage(`${student.nome} foi carregado da SWeduc. Confira competência e valor para iniciar a nota.`);void load(true)}}/>
          <div className="search-input"><Search/><input value={studentQuery} onChange={e=>setStudentQuery(e.target.value)} placeholder="Buscar aluno, responsável, turma ou CPF"/></div>
          {loading?<div className="assistant-loading">Carregando alunos…</div>:filteredStudents.length===0?<div className="assistant-empty">Nenhum aluno cadastrado encontrado.</div>:<div className="assistant-payment-list">
            {filteredStudents.slice(0,50).map(student=><button key={student.id} className={newStudentId===student.id?"assistant-payment selected":"assistant-payment"} onClick={()=>{setNewStudentId(student.id);setNewDescriptionEdited(false);setNewDescription(defaultServiceDescription(newCompetence,student));setError("");setMessage("")}}>
              <span className="assistant-payment-icon"><GraduationCap size={17}/></span>
              <span><strong>{student.nome}</strong><small>{student.turma||"Sem turma"} · {student.segmento}</small></span>
              <em className="pending">{newStudentId===student.id?"Selecionado":"Selecionar"}</em>
            </button>)}
          </div>}
        </div>
        <div className="assistant-new-form">
          {!selectedStudent?<div className="assistant-empty large"><UsersRound/><strong>Selecione um aluno</strong><span>Depois informe competência, valor e status do pagamento.</span></div>:<>
            <div className="assistant-current-head">
              <div><span>NOVA EMISSÃO</span><h2>{selectedStudent.nome}</h2><p>{selectedStudent.responsavel||"Responsável não informado"} · {selectedStudent.segmento}</p></div>
              <span className="assistant-current-badge active">Etapa 2 de 9</span>
            </div>
            <div className="assistant-dps-editor">
              <div className="assistant-edit-grid">
                <label><span>Competência</span><input type="month" max={currentCompetenceInput()} value={newCompetence} onChange={e=>{const value=e.target.value;setNewCompetence(value);if(!newDescriptionEdited)setNewDescription(defaultServiceDescription(value,selectedStudent))}}/></label>
                <label><span>Valor da mensalidade / NFS-e</span><input type="text" inputMode="decimal" placeholder="Ex.: 1.250,00" value={newValue} onChange={e=>setNewValue(e.target.value.replace(/[^0-9.,]/g,""))}/></label>
              </div>
              <label><span>Status do pagamento</span><select value={newPaymentStatus} onChange={e=>setNewPaymentStatus(e.target.value)}><option value="Aberto">Pendente</option><option value="Pago">Pago</option></select></label>
              <label className="assistant-description-field"><span>Descrição do serviço <em>Editável</em></span><textarea rows={5} maxLength={1000} value={newDescription} onChange={e=>{setNewDescriptionEdited(true);setNewDescription(e.target.value)}}/><small>{newDescription.length}/1000 caracteres</small></label>
              <div className="assistant-protected-data"><strong>Dados vindos do cadastro</strong><div>
                <span>Aluno<b>{selectedStudent.nome}</b></span>
                <span>Responsável<b>{selectedStudent.responsavel||"—"}</b></span>
                <span>CPF/CNPJ<b>{selectedStudent.cpf_cnpj||"—"}</b></span>
                <span>Serviço fiscal<b>{fiscalServiceForSegment(selectedStudent.segmento).code}</b></span>
              </div></div>
            </div>
            {!canCreatePayment&&<div className="notice compact"><ShieldCheck/><span>Seu perfil pode visualizar o Assistente, mas não possui permissão para criar mensalidades.</span></div>}
            <div className="assistant-actions">
              <button className="primary assistant-main-action" onClick={continueProcess} disabled={Boolean(busyAction)||!canCreatePayment}>{busyAction==="create-payment"?"Criando mensalidade…":"Criar mensalidade e iniciar nota"} <ChevronRight size={18}/></button>
              <button className="secondary" onClick={()=>setNewStudentId(null)}>Trocar aluno</button>
            </div>
          </>}
        </div>
      </div>
    </section>}

    <section className="assistant-stepper" aria-label="Etapas da emissão">
      {steps.map((step,index)=><div className={`assistant-step ${step.state}`} key={step.key}>
        <span className="assistant-step-number">{step.state==="done"?<Check size={15}/>:step.short}</span>
        <div><strong>{step.label}</strong><small>{step.description}</small></div>
        {index<steps.length-1&&<ChevronRight className="assistant-step-arrow" size={16}/>}</div>)}
    </section>

    {!newEmissionOpen&&<section className="assistant-grid">
      <article className="panel assistant-selector">
        <div className="panel-title"><div><h2>Continuar emissão</h2><p>Mensalidades e notas já iniciadas aparecem automaticamente.</p></div><span className="assistant-count">{payments.length}</span></div>
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
            <span className={`assistant-current-badge ${missing.length&&effectiveCurrent===2?"warning":"active"}`}>Etapa {effectiveCurrent+1} de 9</span>
          </div>

          <div className="assistant-summary">
            <div><span><WalletCards size={17}/></span><small>Valor NFS-e</small><strong>{money(selected.valor_nfse)}</strong></div>
            <div><span><ReceiptText size={17}/></span><small>Status fiscal</small><strong>{selected.status_nfse}</strong></div>
            <div><span><FileCode2 size={17}/></span><small>XML</small><strong>{progress?.xmlDone?"Pronto":"Aguardando"}</strong></div>
            <div><span><MailCheck size={17}/></span><small>Entrega</small><strong>{delivery?"Enviada":"Aguardando"}</strong></div>
          </div>

          {missing.length>0&&effectiveCurrent<=2&&<div className="assistant-warning-box"><CircleAlert/><div><strong>Cadastro precisa de atenção</strong><span>Complete: {missing.join(", ")}. O assistente não recomenda avançar antes disso.</span></div></div>}


          {selected&&canPrepare&&!selected.chave_nfse_homologacao&&effectiveCurrent>=3&&effectiveCurrent<=4&&<section className="assistant-dps-workspace">
            <div className="assistant-workspace-head">
              <div>
                <span>{effectiveCurrent===3?"EDIÇÃO DA DPS":"PRÉVIA PARA APROVAÇÃO"}</span>
                <h3>{effectiveCurrent===3?"Revise somente o que pode ser alterado":"Confira tudo antes de aprovar"}</h3>
                <p>{effectiveCurrent===3?"Os dados do aluno e do responsável permanecem protegidos no cadastro. Aqui você ajusta competência, valor e descrição do serviço.":"Depois da aprovação, qualquer alteração deve ser feita antes da geração do XML."}</p>
              </div>
              <span className="assistant-safe-tag"><ShieldCheck size={15}/>Sem transmissão</span>
            </div>
            {effectiveCurrent===3?<div className="assistant-dps-editor">
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
                <div><small>Valor do serviço</small><strong>{money(parseMoneyInput(draftValue)||0)}</strong></div>
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

          {effectiveCurrent===6&&selected&&<section className="assistant-sefin-confirm">
            <div className="assistant-workspace-head">
              <div><span>ETAPA 7 · SEFIN</span><h3>Homologação pelo módulo NFS-e</h3><p>Para esta etapa, o Assistente usa o fluxo de homologação já validado do JPI Fiscal, sem criar uma segunda rotina fiscal.</p></div>
              <span className="assistant-safe-tag"><ShieldCheck size={15}/>Fluxo existente</span>
            </div>
            <div className="assistant-sefin-body">
              <div className="assistant-sefin-summary">
                <span><small>Aluno</small><b>{selected.alunos?.nome||"—"}</b></span>
                <span><small>XML</small><b>{selected.dps_xml_id||"—"}</b></span>
                <span><small>Valor</small><b>{money(selected.valor_nfse)}</b></span>
                <span><small>Destino</small><b>NFS-e · Homologação</b></span>
              </div>
              <div className="assistant-backend-ready">
                <ShieldCheck/>
                <div>
                  <strong>Usar homologação que já funciona</strong>
                  <span>Ao continuar, o sistema abrirá a mesma nota no JPI Fiscal oficial, usando o certificado A1 e a senha protegida já configurados no servidor.</span>
                </div>
              </div>
            </div>
          </section>}

          {effectiveCurrent===7&&selected&&selected.chave_nfse_homologacao&&<section className="assistant-sefin-result">
            <Check size={22}/>
            <div><span>HOMOLOGAÇÃO CONCLUÍDA</span><h3>NFS-e de teste confirmada pela SEFIN</h3><p>Chave: <strong>{selected.chave_nfse_homologacao}</strong></p>{selected.homologacao_emitida_em&&<small>Processada em {new Date(selected.homologacao_emitida_em).toLocaleString("pt-BR")}</small>}</div>
          </section>}

          {effectiveCurrent>=7&&selected&&selected.chave_nfse_homologacao&&<section className="assistant-finalization">
            <div className="assistant-workspace-head">
              <div><span>CONCLUSÃO</span><h3>Documento fiscal de homologação</h3><p>A nota foi confirmada pela SEFIN. Confira o documento antes do envio.</p></div>
              <span className="assistant-safe-tag"><Check size={15}/>Concluída</span>
            </div>
            <div className="assistant-finalization-body">
              <div className="assistant-finalization-main">
                <div><small>Aluno</small><strong>{selected.alunos?.nome||"—"}</strong></div>
                <div><small>Competência</small><strong>{selected.competencia}</strong></div>
                <div><small>Valor</small><strong>{money(selected.valor_nfse)}</strong></div>
                <div><small>Chave SEFIN</small><strong className="assistant-key">{selected.chave_nfse_homologacao}</strong></div>
              </div>
              <div className="assistant-document-actions">
                <button className="secondary" onClick={()=>void openCurrentDocument("pdf")} disabled={!activeDocument||Boolean(documentBusy)}><Eye size={16}/>{documentBusy==="pdf"?"Abrindo…":"Visualizar PDF"}</button>
                <button className="secondary" onClick={()=>void openCurrentDocument("xml")} disabled={!activeDocument||Boolean(documentBusy)}><FileCode2 size={16}/>{documentBusy==="xml"?"Abrindo…":"Visualizar XML"}</button>
                {!activeDocument&&<span>Preparando documento ativo…</span>}
              </div>
            </div>
          </section>}

          {effectiveCurrent>=8&&delivery&&selected&&<section className="assistant-complete-card">
            <Check size={28}/>
            <div>
              <span>PROCESSO CONCLUÍDO</span>
              <h3>Nota emitida e envio registrado</h3>
              <p>{selected.alunos?.nome} · {selected.competencia} · {money(selected.valor_nfse)}</p>
              <small>Último canal registrado: {delivery.canal.replace("_"," ")} · {new Date(delivery.created_at).toLocaleString("pt-BR")}</small>
            </div>
            <div className="assistant-complete-actions">
              <button className="primary" type="button" onClick={()=>{setResumePaymentId(null);localStorage.removeItem("jpi-issuance-assistant-payment");startNewEmission()}}><Plus size={16}/>Nova emissão</button>
              <button className="secondary" type="button" onClick={()=>focusAndNavigate("Enviar notas")}>Ver histórico de envios</button>
            </div>
          </section>}

          {effectiveCurrent>=8&&selected&&<section className="assistant-delivery-panel">
            <div className="assistant-workspace-head">
              <div><span>ETAPA 9 · ENVIAR</span><h3>Escolha como entregar a nota</h3><p>Os canais usam as mesmas integrações e o mesmo histórico da tela Enviar notas.</p></div>
              <span className="assistant-safe-tag"><ShieldCheck size={15}/>Histórico ativo</span>
            </div>
            <div className="assistant-delivery-channels">
              <button type="button" className={deliveryChannel==="email"?"active email":"email"} onClick={()=>{setDeliveryChannel("email");setError("");setMessage("")}}>
                <span><Mail size={20}/></span><div><strong>E-mail</strong><small>{canSendEmail?"Disponível":"Sem permissão"}</small></div>
              </button>
              <button type="button" className={deliveryChannel==="whatsapp-manual"?"active whatsapp":"whatsapp"} onClick={()=>{setDeliveryChannel("whatsapp-manual");setError("");setMessage("")}}>
                <span><MessageCircle size={20}/></span><div><strong>WhatsApp</strong><small>{whatsappInfo?.ready?"Manual gratuito":"Configuração necessária"}</small></div>
              </button>
              <button type="button" className={deliveryChannel==="agenda-edu"?"active agenda":"agenda"} onClick={()=>{setDeliveryChannel("agenda-edu");setError("");setMessage("")}}>
                <span><CalendarDays size={20}/></span><div><strong>Agenda Edu</strong><small>{agendaEduInfo?.ready?"Sandbox disponível":"Aguardando Agenda Edu"}</small></div>
              </button>
            </div>

            <div className="assistant-delivery-details">
              <div className="assistant-delivery-recipient">
                <small>DESTINO DE HOMOLOGAÇÃO</small>
                <strong>{deliveryRecipient}</strong>
                <span>{deliveryChannel==="email"?selected.alunos?.email||"E-mail do responsável não informado":deliveryChannel==="whatsapp-manual"?selected.alunos?.whatsapp||"WhatsApp do responsável não informado":selected.alunos?.agenda_edu_student_id?"Aluno vinculado à Agenda Edu":"Aluno ainda sem vínculo da Agenda Edu"}</span>
              </div>

              {deliveryChannel==="whatsapp-manual"&&<>
                {whatsappInfo?.senders?.length?<div className="assistant-sender-list">
                  <small>ESCOLHA O WHATSAPP DA ESCOLA</small>
                  <div>{whatsappInfo.senders.map(sender=><button type="button" key={sender.id} className={manualSenderId===sender.id?"selected":""} onClick={()=>setManualSenderId(sender.id)}><MessageCircle size={16}/><span><strong>{sender.nome}</strong><small>{sender.numero}</small></span>{manualSenderId===sender.id&&<Check size={15}/>}</button>)}</div>
                </div>:<div className="assistant-warning-box"><CircleAlert/><div><strong>Nenhum remetente disponível</strong><span>Cadastre o número da escola em Configurações → Integrações antes de usar o WhatsApp.</span></div></div>}
              </>}

              {deliveryChannel==="agenda-edu"&&!agendaEduInfo?.ready&&<div className="assistant-warning-box"><CircleAlert/><div><strong>Aguardando Agenda Edu</strong><span>{agendaEduInfo?.message||"A integração ainda depende das informações que a Agenda Edu precisa liberar."}</span></div></div>}

              {manualPending&&deliveryChannel==="whatsapp-manual"&&<div className="assistant-manual-confirm">
                <MessageCircle size={22}/>
                <div><strong>Mensagem preparada no WhatsApp</strong><span>Destino de teste: {manualPending.actualRecipient}{manualPending.sender?" · Remetente: "+manualPending.sender.nome:""}</span><small>Depois de clicar em Enviar no WhatsApp, confirme abaixo para registrar o histórico.</small></div>
                <div>
                  {manualPending.whatsappUrl&&<button className="secondary" type="button" onClick={()=>window.open(manualPending.whatsappUrl||"","_blank","noopener,noreferrer")}>Abrir WhatsApp</button>}
                  <button className="primary" type="button" onClick={()=>void finishManualDelivery("confirm")} disabled={deliveryBusy}>Confirmar envio</button>
                  <button className="secondary" type="button" onClick={()=>void finishManualDelivery("cancel")} disabled={deliveryBusy}>Cancelar</button>
                </div>
              </div>}

              {!manualPending&&<div className="assistant-delivery-send-row">
                <div><small>Canal selecionado</small><strong>{deliveryChannel==="email"?"E-mail":deliveryChannel==="whatsapp-manual"?"WhatsApp manual":"Agenda Edu"}</strong><span>{currentDeliveryReady?"Pronto para enviar":"Ainda não está pronto para este envio"}</span></div>
                <button className="primary" type="button" onClick={()=>void sendCurrentDocument()} disabled={!currentDeliveryReady||deliveryBusy}>
                  <Send size={17}/>{deliveryBusy?"Enviando…":deliveryChannel==="whatsapp-manual"?"Preparar WhatsApp":"Enviar agora"}
                </button>
              </div>}
            </div>
          </section>}

          <div className="assistant-next-card">
            {effectiveCurrent===2&&<><ShieldCheck/><div><strong>Validação automática e segura</strong><span>Confira dados do tomador, competência, valor, configuração fiscal e certificado A1 antes de preparar a DPS.</span></div></>}
            {effectiveCurrent===3&&<><FileText/><div><strong>DPS em foco</strong><span>Os campos editáveis estão logo acima. Salve a revisão para avançar automaticamente para a prévia.</span></div></>}
            {effectiveCurrent===4&&<><FileText/><div><strong>Aprovação da prévia</strong><span>Confira o documento ampliado acima. A emissão só continua depois da sua aprovação.</span></div></>}
            {effectiveCurrent===5&&<><FileCode2/><div><strong>Gerar XML</strong><span>O XML será guardado no repositório privado e precisa estar válido antes da transmissão.</span></div></>}
            {effectiveCurrent===6&&<><Send/><div><strong>SEFIN / homologação</strong><span>Enquanto produção não estiver liberada, esta etapa continua protegida como homologação.</span></div></>}
            {effectiveCurrent===7&&<><Check/><div><strong>Conferência final</strong><span>Confira a chave e o documento retornado antes de iniciar a entrega ao responsável.</span></div></>}
            {effectiveCurrent>=8&&<><MailCheck/><div><strong>Enviar nota</strong><span>O assistente leva a mesma nota para os canais de entrega já existentes, preservando o histórico.</span></div></>}
          </div>

          {!canPrepare&&effectiveCurrent>=2&&effectiveCurrent<8&&<div className="notice compact"><ShieldCheck/><span>Seu perfil pode acompanhar o processo, mas não possui permissão para preparar a NFS-e.</span></div>}
          {effectiveCurrent<8&&<div className="assistant-actions">
            <button className="primary assistant-main-action" onClick={continueProcess} disabled={Boolean(busyAction)||(!canPrepare&&effectiveCurrent>=2&&effectiveCurrent<8)}>
              {busyAction==="validate"?"Validando…":busyAction==="save-dps"?"Salvando DPS…":busyAction==="approve"?"Aprovando…":busyAction==="xml"?"Gerando XML…":effectiveCurrent===2&&missing.length?"Corrigir cadastro":effectiveCurrent===2?"Validar nota":effectiveCurrent===3?"Salvar DPS e ver prévia":effectiveCurrent===4?"Aprovar prévia":effectiveCurrent===5?"Gerar e validar XML":effectiveCurrent===6?"Abrir homologação NFS-e":effectiveCurrent>=8?"Ir para envio":"Continuar processo"} <ChevronRight size={18}/>
            </button>
            {effectiveCurrent>2&&effectiveCurrent<8&&<button className="secondary" onClick={()=>effectiveCurrent===6?openOfficialHomologation():focusAndNavigate("NFS-e")}>{effectiveCurrent===6?"Abrir homologação oficial":"Abrir NFS-e atual"}</button>}
            {progress?.finished&&<button className="secondary" onClick={()=>focusAndNavigate("Enviar notas")}>Abrir central de envios</button>}
          </div>}
        </>}
      </article>
    </section>}
  </div>;
}
