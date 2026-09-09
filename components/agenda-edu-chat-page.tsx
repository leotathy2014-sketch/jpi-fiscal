"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, MessageCircle, RefreshCw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type AgendaStudent={id:string;name:string;externalId:string|null;legacyId:string|null;mainClassroomId:string|null;period:string|null;status:string|null;linkedStatus:string|null;dateOfBirth:string|null};
type AgendaResponsible={id:string;name:string;externalId:string|null;legacyId:string|null;email:string|null;phone:string|null;documentNumber:string|null;kinship:string|null;financial:boolean;status:string|null;linkedStatus:string|null};
type AgendaChatCandidate={id:string;title:string;studentName:string|null;classroomName:string|null;responsibleNames:string[];score:number};
const norm=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");

export function AgendaEduChatPage({accessToken}:{accessToken:string|null}){
  const [turma,setTurma]=useState("todas");const [aluno,setAluno]=useState("");const [responsavel,setResponsavel]=useState("");
  const [students,setStudents]=useState<AgendaStudent[]>([]);const [studentPage,setStudentPage]=useState(1);const [nextPage,setNextPage]=useState<number|null>(null);const [studentsAutoLoaded,setStudentsAutoLoaded]=useState(false);const [selectedStudent,setSelectedStudent]=useState<AgendaStudent|null>(null);const [responsibles,setResponsibles]=useState<AgendaResponsible[]>([]);
  const [busy,setBusy]=useState("");const [error,setError]=useState("");const [message,setMessage]=useState("");const [chats,setChats]=useState<AgendaChatCandidate[]>([]);const [selected,setSelected]=useState<string>("");
  const turmas=useMemo(()=>Array.from(new Set(students.map(student=>student.mainClassroomId).filter(Boolean) as string[])).sort((a,b)=>a.localeCompare(b,"pt-BR")),[students]);
  const filteredStudents=useMemo(()=>{const q=norm(aluno.trim());return students.filter(student=>(turma==="todas"||student.mainClassroomId===turma)&&(!q||norm(student.name).includes(q)||norm(student.externalId||"").includes(q)||norm(student.legacyId||"").includes(q))).slice(0,30)},[aluno,students,turma]);
  const loadStudents=useCallback(async(page=studentPage)=>{
    if(!accessToken||busy)return;setBusy("students");setError("");setMessage("");
    try{
      const response=await authenticatedFetch("/api/integrations/communications",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"list-agenda-students",page,perPage:100}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string;message?:string;students?:AgendaStudent[];page?:number;nextPage?:number|null};
      if(!response.ok||!data.ok)throw new Error(data.error||"Não foi possível carregar alunos da Agenda Edu.");
      setStudents(current=>page===1?(data.students||[]):[...current,...(data.students||[]).filter(student=>!current.some(item=>item.id===student.id))]);
      setStudentPage(data.page||page);setNextPage(data.nextPage||null);setMessage(data.message||"Alunos carregados da Agenda Edu.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível carregar alunos da Agenda Edu.")}
    finally{setBusy("")}
  },[accessToken,busy,studentPage]);
  useEffect(()=>{if(!accessToken||studentsAutoLoaded)return;setStudentsAutoLoaded(true);void loadStudents(1)},[accessToken,loadStudents,studentsAutoLoaded]);
  async function chooseStudent(student:AgendaStudent){
    setSelectedStudent(student);setAluno(student.name);setResponsibles([]);setResponsavel("");setChats([]);setSelected("");
    if(!accessToken)return;setBusy(`student-${student.id}`);setError("");
    try{
      const response=await authenticatedFetch("/api/integrations/communications",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"get-agenda-student-details",studentId:student.id}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string;responsibles?:AgendaResponsible[];primaryResponsible?:AgendaResponsible|null};
      if(!response.ok||!data.ok)throw new Error(data.error||"Não foi possível carregar responsáveis do aluno.");
      const list=data.responsibles||[];setResponsibles(list);setResponsavel((data.primaryResponsible||list[0])?.name||"");setMessage(`Aluno selecionado: ${student.name}. Agora confira o responsável.`);
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível carregar responsáveis do aluno.")}
    finally{setBusy("")}
  }
  async function search(event?:FormEvent){
    event?.preventDefault();if(!accessToken||busy)return;setBusy("chats");setError("");setMessage("");setChats([]);setSelected("");
    try{
      const response=await authenticatedFetch("/api/integrations/communications",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"list-agenda-family-chats",classroomName:turma==="todas"?"":turma,studentName:aluno,responsibleName:responsavel}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string;message?:string;chats?:AgendaChatCandidate[]};
      if(!response.ok||!data.ok)throw new Error(data.error||"Não foi possível buscar os chats da Agenda Edu.");
      setChats(data.chats||[]);setMessage(data.message||((data.chats||[]).length?"Chats encontrados.":"Nenhum chat encontrado com esses filtros."));
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível buscar os chats da Agenda Edu.")}
    finally{setBusy("")}
  }
  function openAgenda(){window.open("https://escola.agendaedu.com/schools/messages","_blank","noopener,noreferrer")}
  return <div className="page"><div className="page-heading"><div><h1>Chat Agenda Edu</h1><p>Localize o chat familiar no canal Secretaria usando dados vindos da API.</p></div><button type="button" className="secondary" onClick={openAgenda}><Eye size={17}/>Abrir Agenda Edu</button></div>
    <section className="agenda-chat-workbench">
      <div className="notice compact"><ShieldCheck/><span>Canal usado: <b>MATRIZ - SECRETARIA</b>. Primeiro carregue os alunos da Agenda Edu; depois selecione turma, aluno e responsável. Nada é enviado nesta tela.</span></div>
      <div className="agenda-chat-loadbar"><button type="button" className="primary" onClick={()=>void loadStudents(1)} disabled={Boolean(busy)}><UsersRound size={17}/>{busy==="students"?"Carregando…":"Carregar alunos da API"}</button>{nextPage&&<button type="button" className="secondary" onClick={()=>void loadStudents(nextPage)} disabled={Boolean(busy)}><RefreshCw size={17}/>Carregar mais</button>}<span>{students.length} aluno(s) carregado(s){nextPage?` · próxima página ${nextPage}`:""}</span></div>
      <form onSubmit={search} className="agenda-chat-search">
        <label>Turma<select value={turma} onChange={event=>setTurma(event.target.value)}><option value="todas">Todas as turmas</option>{turmas.map(item=><option key={item} value={item}>Turma {item}</option>)}</select></label>
        <label>Aluno<input value={aluno} onChange={event=>{setAluno(event.target.value);setSelectedStudent(null)}} list="agenda-students-list" placeholder="Digite ou selecione o aluno"/><datalist id="agenda-students-list">{filteredStudents.map(student=><option key={student.id} value={student.name}>{student.mainClassroomId?`Turma ${student.mainClassroomId}`:"Sem turma"} · ID {student.id}</option>)}</datalist></label>
        <label>Responsável<select value={responsavel} onChange={event=>setResponsavel(event.target.value)} disabled={!responsibles.length}><option value="">{responsibles.length?"Selecione o responsável":"Carregue o aluno"}</option>{responsibles.map(item=><option key={item.id} value={item.name}>{item.financial?"Financeiro · ":""}{item.name} {item.kinship?`· ${item.kinship}`:""}</option>)}</select></label>
        <button type="submit" className="primary" disabled={busy==="chats"||(!turma.trim()&&!aluno.trim()&&!responsavel.trim())}><Search size={17}/>{busy==="chats"?"Buscando…":"Localizar chat"}</button>
      </form>
      {filteredStudents.length>0&&!selectedStudent&&<div className="agenda-student-picks">{filteredStudents.slice(0,8).map(student=><button type="button" key={student.id} onClick={()=>void chooseStudent(student)} disabled={Boolean(busy)}><strong>{student.name}</strong><small>ID {student.id} · {student.externalId||student.legacyId||"sem external_id"} · Turma {student.mainClassroomId||"—"}</small></button>)}</div>}
      {error&&<div className="error-box">{error}</div>}{message&&<div className="success-box">{message}</div>}
      <div className="agenda-chat-results">
        {busy==="students"?<div className="empty-state"><RefreshCw/><strong>Carregando alunos da Agenda Edu…</strong><p>Estou montando os filtros de turma, aluno e responsável com dados da API.</p></div>:chats.length===0?<div className="empty-state"><MessageCircle/><strong>Nenhum chat carregado</strong><p>Selecione turma/aluno/responsável e clique em Localizar chat.</p></div>:chats.map(chat=><button type="button" key={chat.id} className={selected===chat.id?"selected":""} onClick={()=>setSelected(chat.id)}>
          <span className="agenda-chat-result-icon">{selected===chat.id?<Check/>:<MessageCircle/>}</span>
          <span><strong>{chat.title}</strong><small>{chat.classroomName||turma||"Turma não informada"} · {chat.studentName||aluno||"Aluno não identificado"}</small><small>{chat.responsibleNames.length?chat.responsibleNames.join(", "):responsavel||"Responsável não identificado"}</small></span>
          <b>{selected===chat.id?"Selecionado":"Selecionar"}</b>
        </button>)}
      </div>
      {selected&&<div className="notice compact success"><Check/><span>Chat selecionado: <b>{selected}</b>. Próximo passo: usar este chat no envio da nota.</span></div>}
    </section>
  </div>;
}
