"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {Check,Link2,RefreshCw,ShieldAlert,Trash2} from "lucide-react";
import {createSupabaseBrowserClient} from "@/lib/supabase";
import {useAccess} from "./access";

type Student={id:number;nome:string;turma:string|null;segmento:string|null;responsavel:string|null;cpf_cnpj:string|null;sweduc_matricula_id:number|null;sweduc_aluno_id:number|null;sweduc_ano_letivo:string|null;sweduc_atualizado_em:string|null};
type MirrorStudent={matricula_id:number;aluno_id:number|null;nome:string;numero_matricula:string|null;curso:string|null;serie:string|null;turma:string|null;ano_letivo:string|null;responsaveis:Array<Record<string,unknown>>|null};
type PaymentCount={aluno_id:number};
type Suggestion={student:Student;mirror:MirrorStudent|null;score:number;reason:string;payments:number;action:"link"|"keep"|"can_delete"};

function normalize(value:unknown){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim().toLocaleLowerCase("pt-BR")}
function digits(value:unknown){return String(value||"").replace(/\D/g,"")}
function same(left:unknown,right:unknown){return normalize(left)===normalize(right)}
function firstResponsibleCpf(student:MirrorStudent){
  const list=Array.isArray(student.responsaveis)?student.responsaveis:[];
  for(const item of list){
    const value=item.cpf||item.cpf_cnpj||item.documento;
    if(digits(value))return digits(value);
  }
  return "";
}
function studentScore(student:Student,mirror:MirrorStudent){
  let score=0;const reasons:string[]=[];
  if(same(student.nome,mirror.nome)){score+=60;reasons.push("mesmo nome")}
  if(student.turma&&mirror.turma&&same(student.turma,mirror.turma)){score+=20;reasons.push("mesma turma")}
  if(student.segmento&&mirror.curso&&same(student.segmento,mirror.curso)){score+=10;reasons.push("mesmo segmento")}
  const cpf=digits(student.cpf_cnpj);const mirrorCpf=firstResponsibleCpf(mirror);
  if(cpf&&mirrorCpf&&cpf===mirrorCpf){score+=30;reasons.push("CPF do responsável igual")}
  return {score,reason:reasons.join(", ")||"cadastro parecido"};
}
function studentLabel(student:MirrorStudent){return [student.turma,student.serie,student.curso].filter(Boolean).join(" · ")||"Turma não informada"}

export function SweducDuplicateReview({onChanged}:{onChanged?:()=>void}){
  const {can}=useAccess();const canEdit=can("students.edit");
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [suggestions,setSuggestions]=useState<Suggestion[]>([]);
  const [busy,setBusy]=useState(false);
  const [linking,setLinking]=useState<number|null>(null);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    if(!supabase)return;setBusy(true);setError("");setMessage("");
    const [studentsResult,mirrorResult,paymentsResult]=await Promise.all([
      supabase.from("alunos").select("id,nome,turma,segmento,responsavel,cpf_cnpj,sweduc_matricula_id,sweduc_aluno_id,sweduc_ano_letivo,sweduc_atualizado_em").order("nome"),
      supabase.from("sweduc_alunos").select("matricula_id,aluno_id,nome,numero_matricula,curso,serie,turma,ano_letivo,responsaveis").order("nome").limit(2000),
      supabase.from("mensalidades").select("aluno_id"),
    ]);
    setBusy(false);
    if(studentsResult.error||mirrorResult.error||paymentsResult.error){setError(studentsResult.error?.message||mirrorResult.error?.message||paymentsResult.error?.message||"Não foi possível conferir duplicados.");return}
    const students=(studentsResult.data||[]) as Student[];
    const mirrors=(mirrorResult.data||[]) as MirrorStudent[];
    const paymentCounts=new Map<number,number>();
    for(const payment of (paymentsResult.data||[]) as PaymentCount[])paymentCounts.set(payment.aluno_id,(paymentCounts.get(payment.aluno_id)||0)+1);
    const linkedMirrorIds=new Set(students.map(student=>student.sweduc_matricula_id).filter(Boolean));
    const rows:Suggestion[]=[];
    for(const student of students){
      if(student.sweduc_matricula_id)continue;
      const ranked=mirrors.filter(mirror=>!linkedMirrorIds.has(mirror.matricula_id)).map(mirror=>({mirror,...studentScore(student,mirror)})).filter(item=>item.score>=60).sort((a,b)=>b.score-a.score);
      const best=ranked[0];
      const payments=paymentCounts.get(student.id)||0;
      if(best)rows.push({student,mirror:best.mirror,score:best.score,reason:best.reason,payments,action:"link"});
      else if(payments===0)rows.push({student,mirror:null,score:0,reason:"manual sem vínculo SWeduc e sem mensalidade",payments,action:"can_delete"});
      else rows.push({student,mirror:null,score:0,reason:"manual com histórico; manter até conferir",payments,action:"keep"});
    }
    setSuggestions(rows.sort((a,b)=>a.action.localeCompare(b.action)||b.score-a.score||a.student.nome.localeCompare(b.student.nome,"pt-BR")));
  },[supabase]);

  useEffect(()=>{void load()},[load]);

  async function linkSuggestion(suggestion:Suggestion){
    if(!supabase||!suggestion.mirror)return;
    setLinking(suggestion.student.id);setError("");setMessage("");
    const now=new Date().toISOString();
    const result=await supabase.from("alunos").update({
      sweduc_matricula_id:suggestion.mirror.matricula_id,
      sweduc_aluno_id:suggestion.mirror.aluno_id,
      sweduc_ano_letivo:suggestion.mirror.ano_letivo,
      sweduc_atualizado_em:now,
      turma:suggestion.student.turma||suggestion.mirror.turma,
      segmento:suggestion.student.segmento||suggestion.mirror.curso,
    }).eq("id",suggestion.student.id);
    setLinking(null);
    if(result.error){setError(`Não foi possível vincular: ${result.error.message}`);return}
    setMessage(`${suggestion.student.nome} foi vinculado à matrícula SWeduc ${suggestion.mirror.numero_matricula||suggestion.mirror.matricula_id}.`);
    await load();onChanged?.();
  }

  const summary=useMemo(()=>({
    link:suggestions.filter(item=>item.action==="link").length,
    keep:suggestions.filter(item=>item.action==="keep").length,
    canDelete:suggestions.filter(item=>item.action==="can_delete").length,
  }),[suggestions]);

  return <section className="panel sweduc-duplicate-review"><div className="panel-title"><div><h2>Conferência de cadastros manuais</h2><p>Antes de excluir, vincule os cadastros manuais aos alunos da SWeduc e preserve mensalidades, notas e histórico.</p></div><button type="button" className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={17}/>{busy?"Conferindo…":"Conferir agora"}</button></div>{error&&<div className="error-box page-error">{error}</div>}{message&&<div className="responsible-lookup-message"><Check/>{message}</div>}<div className="sweduc-review-summary"><span><b>{summary.link}</b> para vincular</span><span><b>{summary.keep}</b> manter por histórico</span><span><b>{summary.canDelete}</b> sem movimentação</span></div>{suggestions.length===0&&!busy?<div className="empty-state"><strong>Nenhum cadastro manual pendente</strong><p>Os alunos cadastrados já estão vinculados ou não há dados suficientes para sugerir limpeza.</p></div>:<div className="sweduc-review-list">{suggestions.slice(0,30).map(item=><article key={item.student.id} className={`sweduc-review-item ${item.action}`}><div className="sweduc-review-icon">{item.action==="link"?<Link2/>:item.action==="can_delete"?<Trash2/>:<ShieldAlert/>}</div><div><strong>{item.student.nome}</strong><small>{item.student.turma||"Turma manual não informada"} · {item.payments} mensalidade(s) vinculada(s)</small>{item.mirror?<p>Encontrado na SWeduc: <b>{item.mirror.nome}</b> · {studentLabel(item.mirror)} · {item.reason}</p>:<p>{item.reason}</p>}</div><div className="sweduc-review-action">{item.action==="link"?<button type="button" className="primary mini" disabled={!canEdit||linking===item.student.id} onClick={()=>void linkSuggestion(item)}>{linking===item.student.id?"Vinculando…":"Vincular"}</button>:item.action==="can_delete"?<span>Pode revisar para excluir depois</span>:<span>Não excluir agora</span>}</div></article>)}</div>}<small>A exclusão direta fica fora desta etapa para evitar perda de mensalidades e documentos fiscais. Primeiro vinculamos o que tem correspondência segura.</small></section>;
}
