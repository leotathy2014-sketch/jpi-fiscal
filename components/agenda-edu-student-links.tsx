"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, GraduationCap, Save, Search } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type StudentLink={id:number;nome:string;turma:string|null;segmento:string|null;responsavel:string;sweduc_matricula_id:number|null;agenda_edu_student_id:string|null;agenda_edu_use_external_id:boolean};
type AgendaCandidate={id:string;name:string;className:string|null;grade:string|null;externalId:string|null;score:number};

export function AgendaEduStudentLinks(){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);const [students,setStudents]=useState<StudentLink[]>([]);const [query,setQuery]=useState("");const [busy,setBusy]=useState<number|null>(null);const [locating,setLocating]=useState<number|null>(null);const [candidates,setCandidates]=useState<Record<number,AgendaCandidate[]>>({});const [message,setMessage]=useState("");const [error,setError]=useState("");
  const load=useCallback(async()=>{if(!supabase)return;const result=await supabase.from("alunos").select("id,nome,turma,segmento,responsavel,sweduc_matricula_id,agenda_edu_student_id,agenda_edu_use_external_id").order("nome");if(result.error){setError("A migração local da Agenda Edu ainda não foi aplicada ao banco.");return}setStudents((result.data||[]) as StudentLink[])},[supabase]);
  useEffect(()=>{void load()},[load]);
  const filtered=students.filter(student=>`${student.nome} ${student.responsavel} ${student.turma||""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  function change(id:number,patch:Partial<StudentLink>){setStudents(current=>current.map(student=>student.id===id?{...student,...patch}:student))}
  async function save(student:StudentLink){if(!supabase)return;const agendaId=String(student.agenda_edu_student_id||"").trim();if(agendaId&&!/^[A-Za-z0-9._-]{1,120}$/.test(agendaId)){setError("O ID da Agenda Edu aceita somente letras, números, ponto, hífen e sublinhado.");return}setBusy(student.id);setError("");setMessage("");let request=supabase.from("alunos").update({agenda_edu_student_id:agendaId||null,agenda_edu_use_external_id:student.agenda_edu_use_external_id});request=student.sweduc_matricula_id?request.eq("sweduc_matricula_id",student.sweduc_matricula_id):request.eq("id",student.id);const result=await request;setBusy(null);if(result.error){setError(result.error.message);return}await load();setMessage(student.sweduc_matricula_id?`Vínculo de ${student.nome} salvo para esta matrícula SWeduc.`:`Vínculo de ${student.nome} salvo.`)}
  async function locate(student:StudentLink){
    if(!supabase)return;setLocating(student.id);setError("");setMessage("");setCandidates(current=>({...current,[student.id]:[]}));
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error("Sua sessão expirou. Entre novamente.");
      const response=await authenticatedFetch("/api/integrations/communications",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({action:"find-agenda-student",studentId:student.id}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {message?:string;error?:string;autoLinked?:boolean;candidates?:AgendaCandidate[]};
      if(!response.ok)throw new Error(data.error||"Não foi possível localizar este aluno na Agenda Edu.");
      setMessage(data.message||"Busca concluída.");
      if(data.autoLinked){await load();return}
      setCandidates(current=>({...current,[student.id]:data.candidates||[]}));
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível localizar este aluno na Agenda Edu.")}finally{setLocating(null)}
  }
  function selectCandidate(student:StudentLink,candidate:AgendaCandidate){change(student.id,{agenda_edu_student_id:candidate.id,agenda_edu_use_external_id:false});setMessage(`Candidato selecionado para ${student.nome}. Clique em Salvar vínculo para confirmar.`)}
  return <section className="agenda-student-links"><div className="form-section-heading"><strong><GraduationCap/>Vincular alunos à Agenda Edu</strong><small>Localize pela turma e aluno. Depois salve o vínculo para enviar a nota ao canal familiar correto.</small></div><div className="search-input"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar aluno, responsável ou turma"/></div>{error&&<div className="error-box">{error}</div>}{message&&<div className="success-box"><Check/>{message}</div>}<div className="agenda-student-link-list">{filtered.map(student=><article key={student.id}><div><strong>{student.nome}</strong><small>{student.responsavel} · {student.turma||"Sem turma"} · {student.segmento||"Sem segmento"}</small>{student.sweduc_matricula_id&&<small>Matrícula SWeduc {student.sweduc_matricula_id}</small>}</div><label>ID do aluno<input value={student.agenda_edu_student_id||""} onChange={event=>change(student.id,{agenda_edu_student_id:event.target.value})} placeholder="ID na Agenda Edu" maxLength={120}/></label><label className="checkbox-line"><input type="checkbox" checked={student.agenda_edu_use_external_id} onChange={event=>change(student.id,{agenda_edu_use_external_id:event.target.checked})}/><span>ID externo</span></label><div className="agenda-link-actions"><button type="button" className="secondary" disabled={locating===student.id} onClick={()=>void locate(student)}>{locating===student.id?"Localizando…":"Localizar na Agenda Edu"}</button><button type="button" className="secondary" disabled={busy===student.id} onClick={()=>void save(student)}><Save/>{busy===student.id?"Salvando…":"Salvar vínculo"}</button></div>{candidates[student.id]?.length?<div className="agenda-candidate-list">{candidates[student.id].map(candidate=><button type="button" key={candidate.id} onClick={()=>selectCandidate(student,candidate)}><span><strong>{candidate.name}</strong><small>{candidate.className||"Turma não informada"} · {candidate.grade||"Série não informada"} · confiança {candidate.score}%</small></span><b>ID {candidate.id}</b></button>)}</div>:null}</article>)}</div></section>;
}
