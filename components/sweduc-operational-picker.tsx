"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Check,RefreshCw,Search,UserCheck,UsersRound} from "lucide-react";
import {createSupabaseBrowserClient} from "@/lib/supabase";
import {authenticatedFetch} from "@/lib/authenticated-fetch";

type AcademicYear={id:number;year:number};
type SweducResponsible={nome?:string;cpf?:string;cpf_cnpj?:string;documento?:string;responsavel_pedagogico?:boolean;telefones?:Array<{numero?:string}>;emails?:Array<{email?:string}>};
type SweducStudent={matricula_id:number;nome:string;numero_matricula:string|null;status:string|null;unidade:string|null;curso:string|null;serie:string|null;turma:string|null;ano_letivo:string|null;responsaveis:SweducResponsible[];financeiro:Array<{numero_titulo?:string;valor?:string;situacao?:string}>;detalhes_carregados?:boolean};

function responsibleDocument(responsible:SweducResponsible){return responsible.cpf||responsible.cpf_cnpj||responsible.documento||"Documento não informado"}
function responsibleContact(responsible:SweducResponsible){return responsible.telefones?.[0]?.numero||responsible.emails?.[0]?.email||"Contato não informado"}
function normalizeSearchText(value:unknown){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim().toLocaleLowerCase("pt-BR")}
function sameOption(left:unknown,right:unknown){return normalizeSearchText(left)===normalizeSearchText(right)}
function uniqueSortedOptions(values:Array<string|null|undefined>){
  const options=new Map<string,string>();
  for(const value of values){
    const label=String(value||"").replace(/\s+/g," ").trim();
    const key=normalizeSearchText(label);
    if(label&&key&&!options.has(key))options.set(key,label);
  }
  return Array.from(options.values()).sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true,sensitivity:"base"}));
}
function sortStudents(students:SweducStudent[]){
  return [...students].sort((a,b)=>
    String(a.nome||"").localeCompare(String(b.nome||""),"pt-BR",{numeric:true,sensitivity:"base"})||
    String(a.curso||"").localeCompare(String(b.curso||""),"pt-BR",{numeric:true,sensitivity:"base"})||
    String(a.serie||"").localeCompare(String(b.serie||""),"pt-BR",{numeric:true,sensitivity:"base"})||
    String(a.turma||"").localeCompare(String(b.turma||""),"pt-BR",{numeric:true,sensitivity:"base"})
  );
}

export function SweducOperationalPicker({onStudentReady}:{onStudentReady:(student:{id:number;nome:string;turma?:string|null;segmento?:string;responsavel?:string;cpf_cnpj?:string|null;email?:string|null;whatsapp?:string|null;cep?:string|null;logradouro?:string|null;numero?:string|null;cidade?:string|null;uf?:string|null;sweduc_matricula_id?:number|null;sweduc_aluno_id?:number|null;sweduc_ano_letivo?:string|null})=>void}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [years,setYears]=useState<AcademicYear[]>([]);
  const [selectedYear,setSelectedYear]=useState<number|null>(null);
  const [students,setStudents]=useState<SweducStudent[]>([]);
  const [query,setQuery]=useState("");
  const [courseFilter,setCourseFilter]=useState("");
  const [serieFilter,setSerieFilter]=useState("");
  const [turmaFilter,setTurmaFilter]=useState("");
  const [gridPage,setGridPage]=useState(1);
  const [selected,setSelected]=useState<SweducStudent|null>(null);
  const [responsibleIndex,setResponsibleIndex]=useState(0);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [syncProgress,setSyncProgress]=useState(0);
  const loadedYearRef=useRef<number|null>(null);

  const token=useCallback(async()=>{
    if(!supabase)throw new Error("Sessão indisponível. Entre novamente.");
    const {data:{session}}=await supabase.auth.getSession();
    if(!session)throw new Error("Sua sessão expirou. Entre novamente.");
    return session.access_token;
  },[supabase]);

  const loadYears=useCallback(async()=>{
    try{
      const accessToken=await token();
      const response=await authenticatedFetch("/api/integrations/sweduc",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {academicYears?:AcademicYear[];syncYears?:number[];selectedAcademicYear?:number;config?:{credencial_configurada:boolean};error?:string};
      if(!response.ok)throw new Error(data.error||"Não foi possível carregar os anos letivos da SWeduc.");
      const allowedYears=(data.syncYears?.length?data.syncYears:[]).sort((a,b)=>b-a);
      const available=data.academicYears||[];
      const filteredYears=allowedYears.map(year=>available.find(item=>item.year===year)||{id:0,year});
      setYears(filteredYears);
      setSelectedYear(filteredYears[0]?.year||data.selectedAcademicYear||available[0]?.year||null);
      if(!data.config?.credencial_configurada)setMessage("A conexão SWeduc ainda precisa ser configurada pelo Master.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível carregar a SWeduc.")}
  },[token]);

  useEffect(()=>{void loadYears()},[loadYears]);
  const courseOptions=useMemo(()=>uniqueSortedOptions(students.map(student=>student.curso)),[students]);
  const serieOptions=useMemo(()=>uniqueSortedOptions(students.filter(student=>!courseFilter||sameOption(student.curso,courseFilter)).map(student=>student.serie)),[students,courseFilter]);
  const turmaOptions=useMemo(()=>uniqueSortedOptions(students.filter(student=>(!courseFilter||sameOption(student.curso,courseFilter))&&(!serieFilter||sameOption(student.serie,serieFilter))).map(student=>student.turma)),[students,courseFilter,serieFilter]);
  const visible=useMemo(()=>{
    const term=normalizeSearchText(query);
    const source=students.filter(student=>(!courseFilter||sameOption(student.curso,courseFilter))&&(!serieFilter||sameOption(student.serie,serieFilter))&&(!turmaFilter||sameOption(student.turma,turmaFilter)));
    const filtered=!term?source:source.filter(student=>[student.nome,student.numero_matricula,String(student.matricula_id),student.turma,student.serie,student.curso].filter(Boolean).some(value=>normalizeSearchText(value).includes(term)));
    return sortStudents(filtered);
  },[students,query,courseFilter,serieFilter,turmaFilter]);
  const pageSize=25;
  const totalGridPages=Math.max(1,Math.ceil(visible.length/pageSize));
  const safeGridPage=Math.min(gridPage,totalGridPages);
  const pagedVisible=visible.slice((safeGridPage-1)*pageSize,safeGridPage*pageSize);
  const syncingInitial=busy==="consult"&&students.length===0;
  useEffect(()=>{setGridPage(1)},[query,courseFilter,serieFilter,turmaFilter,selectedYear]);

  async function consult(yearOverride?:number){
    const activeYear=yearOverride||selectedYear;
    if(!activeYear)return;
    const term=query.trim();
    setBusy("consult");setError("");setMessage(term?`Buscando "${term}" em ${activeYear} na SWeduc…`:`Consultando alunos de ${activeYear} no espelho SWeduc…`);
    setSyncProgress(8);
    setStudents([]);setSelected(null);setResponsibleIndex(0);setGridPage(1);
    let page=1;let total=0;
    try{
      const accessToken=await token();
      while(page<=1000){
        const response=await authenticatedFetch("/api/integrations/sweduc",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"lookup",page,academicYear:activeYear,search:term,course:yearOverride?"":courseFilter,serie:yearOverride?"":serieFilter,turma:yearOverride?"":turmaFilter}),cache:"no-store"});
        const data=await response.json().catch(()=>({})) as {students?:SweducStudent[];nextPage?:number|null;lastPage?:number;academicYear?:number;error?:string;message?:string};
        if(!response.ok)throw new Error(data.error||"Não foi possível consultar a SWeduc.");
        const loaded=data.students||[];total+=loaded.length;setStudents(current=>sortStudents([...current,...loaded]));
        setSyncProgress(Math.min(96,data.lastPage?Math.round((page/Math.max(1,data.lastPage))*100):Math.min(90,15+(page*8))));
        setMessage(data.nextPage?`Organizando página ${page} de ${data.lastPage||"…"} · ${total} matrícula(s) na tela.`:data.message||`Consulta concluída: ${total} matrícula(s) na tela. Nada foi salvo ainda.`);
        if(!data.nextPage)break;
        page=data.nextPage;
      }
      setSyncProgress(100);
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível consultar a SWeduc.")}finally{setBusy("")}
  }

  async function openResponsibleChoice(student:SweducStudent){
    setBusy(`details-${student.matricula_id}`);setError("");setMessage("");setResponsibleIndex(0);
    try{
      const accessToken=await token();
      const response=await authenticatedFetch("/api/integrations/sweduc",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"details",matriculaId:student.matricula_id,student}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {student?:SweducStudent;responsaveis?:SweducResponsible[];message?:string;error?:string};
      if(!response.ok||!data.student)throw new Error(data.error||"Não foi possível carregar os responsáveis deste aluno.");
      const fullStudent={...data.student,responsaveis:data.responsaveis||data.student.responsaveis||[]};
      setSelected(fullStudent);setStudents(current=>current.map(item=>item.matricula_id===student.matricula_id?fullStudent:item));
      const suggestedIndex=fullStudent.responsaveis.findIndex(responsible=>responsible.responsavel_pedagogico===true);
      setResponsibleIndex(suggestedIndex>=0?suggestedIndex:0);
      setMessage(data.message||"Confira o responsável financeiro antes de carregar para a nota.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível carregar os responsáveis deste aluno.")}finally{setBusy("")}
  }

  async function loadForNote(){
    if(!selected)return;
    setBusy(`import-${selected.matricula_id}`);setError("");setMessage("");
    try{
      const accessToken=await token();
      const response=await authenticatedFetch("/api/integrations/sweduc",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"import",matriculaId:selected.matricula_id,responsibleIndex,student:selected}),cache:"no-store"});
      const data=await response.json().catch(()=>({})) as {student?:{id:number;nome:string};message?:string;error?:string};
      if(!response.ok||!data.student)throw new Error(data.error||"Não foi possível preparar este aluno para a nota.");
      setMessage(data.message||"Aluno carregado para a nota.");setSelected(null);onStudentReady(data.student);
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível preparar este aluno para a nota.")}finally{setBusy("")}
  }

  useEffect(()=>{
    if(!selectedYear||loadedYearRef.current===selectedYear)return;
    loadedYearRef.current=selectedYear;
    void consult(selectedYear);
  },[selectedYear]);

  return <section className="notice compact sweduc-operational-picker"><UsersRound/><div><strong>Buscar aluno na SWeduc</strong><span>Primeiro escolha ano letivo, segmento/curso, série e turma. Depois pesquise o aluno pelo nome; a busca ignora acentos e caracteres especiais. Nada é salvo até confirmar em Carregar para a nota.</span>
    {syncingInitial&&<div className="sweduc-sync-loading" role="status" aria-live="polite"><div><strong>Sincronizando dados SWeduc</strong><small>Estamos preparando ano letivo, segmentos, séries e turmas antes de liberar a busca.</small></div><span>{syncProgress}%</span><i><b style={{width:`${syncProgress}%`}}/></i></div>}
    <div className="sweduc-student-search-panel">
      <div className="sweduc-filter-row">
        <label>Ano letivo<select value={selectedYear||""} disabled={syncingInitial} onChange={event=>{const year=Number(event.target.value);loadedYearRef.current=null;setSelectedYear(year);setStudents([]);setSelected(null);setResponsibleIndex(0);setQuery("");setCourseFilter("");setSerieFilter("");setTurmaFilter("")}}>{years.map(year=><option key={year.year} value={year.year}>{year.year}</option>)}</select></label>
        <label>Segmento / curso<select value={courseFilter} disabled={syncingInitial||Boolean(busy)||!selectedYear||!courseOptions.length} onChange={event=>{setCourseFilter(event.target.value);setSerieFilter("");setTurmaFilter("")}}><option value="">Todos</option>{courseOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
        <label>Série<select value={serieFilter} disabled={syncingInitial||!courseFilter} onChange={event=>{setSerieFilter(event.target.value);setTurmaFilter("")}}><option value="">Todas</option>{serieOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
        <label>Turma<select value={turmaFilter} disabled={syncingInitial||!serieFilter} onChange={event=>setTurmaFilter(event.target.value)}><option value="">Todas</option>{turmaOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
      </div>
      <label className="sweduc-search-row sweduc-search-label">Pesquisar aluno<div className="search-input sweduc-student-name-search"><Search/><input value={query} disabled={syncingInitial} onChange={event=>setQuery(event.target.value.toLocaleUpperCase("pt-BR"))} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void consult()}}} placeholder="BUSCAR ALUNO PELO NOME, MESMO COM ACENTO OU CARACTERES ESPECIAIS"/><button type="button" aria-label="Pesquisar aluno" disabled={Boolean(busy)||!selectedYear} onClick={()=>void consult()}>{busy==="consult"?<RefreshCw size={15}/>:<Search size={16}/>}</button></div></label>
    </div>
    {error&&<span className="agenda-secret-error">{error}</span>}{message&&<small>{message}</small>}
    {visible.length>0&&<div className="table-card"><div className="sweduc-grid-pagination"><span>Página {safeGridPage} de {totalGridPages} · {visible.length} aluno(s) encontrado(s) · 25 por página</span><div><button type="button" className="secondary mini" disabled={safeGridPage<=1} onClick={()=>setGridPage(page=>Math.max(1,page-1))}>Anterior</button><button type="button" className="secondary mini" disabled={safeGridPage>=totalGridPages} onClick={()=>setGridPage(page=>Math.min(totalGridPages,page+1))}>Próxima</button></div></div><table><thead><tr><th>Ano letivo</th><th>Aluno</th><th>Matrícula</th><th>Segmento / curso</th><th>Turma / série</th><th></th></tr></thead><tbody>{pagedVisible.map(student=><tr key={student.matricula_id} className={selected?.matricula_id===student.matricula_id?"selected-row":""} onClick={()=>void openResponsibleChoice(student)}><td>{student.ano_letivo||selectedYear}</td><td><strong>{student.nome}</strong><span className="subcell">{student.unidade||"Unidade não informada"}</span></td><td>{student.numero_matricula||student.matricula_id}</td><td>{student.curso||"—"}</td><td>{[student.turma,student.serie].filter(Boolean).join(" · ")||"—"}</td><td><button type="button" className="primary mini" disabled={Boolean(busy)} onClick={event=>{event.stopPropagation();void openResponsibleChoice(student)}}>{busy===`details-${student.matricula_id}`?"Carregando…":<><UserCheck size={15}/>Selecionar aluno</>}</button></td></tr>)}</tbody></table>{visible.length>pageSize&&<small>Grade em ordem alfabética. Use a paginação ou refine os filtros para localizar mais rápido.</small>}</div>}
    {selected&&<div className="responsible-match-card sweduc-responsible-confirm" role="dialog" aria-label="Confirmar responsável financeiro SWeduc"><div><UserCheck/><span><strong>Confirmar responsável da nota</strong><small>{selected.nome} · matrícula {selected.numero_matricula||selected.matricula_id}</small></span></div>{selected.responsaveis.length>0?<div className="sweduc-responsible-options">{selected.responsaveis.map((responsible,index)=><label key={`${responsible.nome||"responsavel"}-${index}`} className="sweduc-responsible-option"><input type="radio" name={`sweduc-responsible-${selected.matricula_id}`} checked={responsibleIndex===index} onChange={()=>setResponsibleIndex(index)}/><span><strong>{responsible.nome||`Responsável ${index+1}`}{responsible.responsavel_pedagogico===true&&<em className="sweduc-suggested-responsible"><Check size={13}/>Sugerido pela SWeduc</em>}</strong><small>{responsibleDocument(responsible)} · {responsibleContact(responsible)}</small></span></label>)}</div>:<p>A SWeduc não retornou responsável para esta matrícula. Confira com o suporte antes de carregar para a nota.</p>}<div><button type="button" className="secondary" onClick={()=>setSelected(null)}>Cancelar</button><button type="button" className="primary" disabled={Boolean(busy)||selected.responsaveis.length===0} onClick={()=>void loadForNote()}>{busy===`import-${selected.matricula_id}`?"Preparando…":<><Check size={15}/>Preparar para a nota</>}</button></div><small>Nada será gravado agora. O cadastro fiscal só será salvo quando a emissão for confirmada.</small></div>}
  </div></section>;
}
