"use client";

import { FormEvent, useState } from "react";
import { Check, Eye, MessageCircle, Search, ShieldCheck } from "lucide-react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type AgendaChatCandidate={id:string;title:string;studentName:string|null;classroomName:string|null;responsibleNames:string[];score:number};

export function AgendaEduChatPage({accessToken}:{accessToken:string|null}){
  const [turma,setTurma]=useState("");const [aluno,setAluno]=useState("");const [responsavel,setResponsavel]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");const [chats,setChats]=useState<AgendaChatCandidate[]>([]);const [selected,setSelected]=useState<string>("");
  async function search(event?:FormEvent){
    event?.preventDefault();if(!accessToken||busy)return;setBusy(true);setError("");setMessage("");setChats([]);setSelected("");
    try{
      const response=await authenticatedFetch("/api/integrations/communications",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"list-agenda-family-chats",classroomName:turma,studentName:aluno,responsibleName:responsavel}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {ok?:boolean;error?:string;message?:string;chats?:AgendaChatCandidate[]};
      if(!response.ok||!data.ok)throw new Error(data.error||"Não foi possível buscar os chats da Agenda Edu.");
      setChats(data.chats||[]);setMessage(data.message||((data.chats||[]).length?"Chats encontrados.":"Nenhum chat encontrado com esses filtros."));
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível buscar os chats da Agenda Edu.")}
    finally{setBusy(false)}
  }
  function openAgenda(){window.open("https://escola.agendaedu.com/schools/messages","_blank","noopener,noreferrer")}
  return <div className="page"><div className="page-heading"><div><h1>Chat Agenda Edu</h1><p>Localize o chat familiar no canal Secretaria antes de enviar a nota.</p></div><button type="button" className="secondary" onClick={openAgenda}><Eye size={17}/>Abrir Agenda Edu</button></div>
    <section className="agenda-chat-workbench">
      <div className="notice compact"><ShieldCheck/><span>Canal usado: <b>MATRIZ - SECRETARIA</b>. Busque por turma, aluno e responsável. Nada é enviado nesta tela.</span></div>
      <form onSubmit={search} className="agenda-chat-search">
        <label>Turma<input value={turma} onChange={event=>setTurma(event.target.value)} placeholder="Ex.: 601 ou Mat I / Manhã"/></label>
        <label>Aluno<input value={aluno} onChange={event=>setAluno(event.target.value)} placeholder="Nome do aluno"/></label>
        <label>Responsável<input value={responsavel} onChange={event=>setResponsavel(event.target.value)} placeholder="Nome do responsável"/></label>
        <button type="submit" className="primary" disabled={busy||(!turma.trim()&&!aluno.trim()&&!responsavel.trim())}><Search size={17}/>{busy?"Buscando…":"Localizar chat"}</button>
      </form>
      {error&&<div className="error-box">{error}</div>}{message&&<div className="success-box">{message}</div>}
      <div className="agenda-chat-results">
        {chats.length===0&&!busy?<div className="empty-state"><MessageCircle/><strong>Nenhum chat carregado</strong><p>Informe turma, aluno ou responsável e clique em Localizar chat.</p></div>:chats.map(chat=><button type="button" key={chat.id} className={selected===chat.id?"selected":""} onClick={()=>setSelected(chat.id)}>
          <span className="agenda-chat-result-icon">{selected===chat.id?<Check/>:<MessageCircle/>}</span>
          <span><strong>{chat.title}</strong><small>{chat.classroomName||turma||"Turma não informada"} · {chat.studentName||aluno||"Aluno não identificado"}</small><small>{chat.responsibleNames.length?chat.responsibleNames.join(", "):responsavel||"Responsável não identificado"}</small></span>
          <b>{selected===chat.id?"Selecionado":"Selecionar"}</b>
        </button>)}
      </div>
      {selected&&<div className="notice compact success"><Check/><span>Chat selecionado: <b>{selected}</b>. Próximo passo: usar este chat no envio da nota.</span></div>}
    </section>
  </div>;
}
