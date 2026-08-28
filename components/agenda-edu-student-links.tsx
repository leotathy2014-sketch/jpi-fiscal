"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, GraduationCap, Save, Search } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type StudentLink={id:number;nome:string;turma:string|null;responsavel:string;agenda_edu_student_id:string|null;agenda_edu_use_external_id:boolean};

export function AgendaEduStudentLinks(){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);const [students,setStudents]=useState<StudentLink[]>([]);const [query,setQuery]=useState("");const [busy,setBusy]=useState<number|null>(null);const [message,setMessage]=useState("");const [error,setError]=useState("");
  const load=useCallback(async()=>{if(!supabase)return;const result=await supabase.from("alunos").select("id,nome,turma,responsavel,agenda_edu_student_id,agenda_edu_use_external_id").order("nome");if(result.error){setError("A migração local da Agenda Edu ainda não foi aplicada ao banco.");return}setStudents((result.data||[]) as StudentLink[])},[supabase]);
  useEffect(()=>{void load()},[load]);
  const filtered=students.filter(student=>`${student.nome} ${student.responsavel} ${student.turma||""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  function change(id:number,patch:Partial<StudentLink>){setStudents(current=>current.map(student=>student.id===id?{...student,...patch}:student))}
  async function save(student:StudentLink){if(!supabase)return;const agendaId=String(student.agenda_edu_student_id||"").trim();if(agendaId&&!/^[A-Za-z0-9._-]{1,120}$/.test(agendaId)){setError("O ID da Agenda Edu aceita somente letras, números, ponto, hífen e sublinhado.");return}setBusy(student.id);setError("");setMessage("");const result=await supabase.from("alunos").update({agenda_edu_student_id:agendaId||null,agenda_edu_use_external_id:student.agenda_edu_use_external_id}).eq("id",student.id);setBusy(null);if(result.error){setError(result.error.message);return}setMessage(`Vínculo de ${student.nome} salvo.`)}
  return <section className="agenda-student-links"><div className="form-section-heading"><strong><GraduationCap/>Vincular alunos à Agenda Edu</strong><small>O identificador garante que a nota seja entregue somente aos responsáveis ligados ao aluno correto.</small></div><div className="search-input"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar aluno, responsável ou turma"/></div>{error&&<div className="error-box">{error}</div>}{message&&<div className="success-box"><Check/>{message}</div>}<div className="agenda-student-link-list">{filtered.map(student=><article key={student.id}><div><strong>{student.nome}</strong><small>{student.responsavel} · {student.turma||"Sem turma"}</small></div><label>ID do aluno<input value={student.agenda_edu_student_id||""} onChange={event=>change(student.id,{agenda_edu_student_id:event.target.value})} placeholder="ID na Agenda Edu" maxLength={120}/></label><label className="checkbox-line"><input type="checkbox" checked={student.agenda_edu_use_external_id} onChange={event=>change(student.id,{agenda_edu_use_external_id:event.target.checked})}/><span>ID externo</span></label><button type="button" className="secondary" disabled={busy===student.id} onClick={()=>void save(student)}><Save/>{busy===student.id?"Salvando…":"Salvar vínculo"}</button></article>)}</div></section>;
}
