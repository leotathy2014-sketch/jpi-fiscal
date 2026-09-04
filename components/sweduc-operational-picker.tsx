"use client";
import {Fragment,useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Check,RefreshCw,Search,UserCheck,UsersRound} from "lucide-react";
import {createSupabaseBrowserClient} from "@/lib/supabase";
import {authenticatedFetch} from "@/lib/authenticated-fetch";

type AcademicYear={id:number;year:number};
type AcademicReference={ano_letivo:number;curso:string|null;serie:string|null;turma:string|null};
type SweducResponsible={nome?:string;cpf?:string;cpf_cnpj?:string;documento?:string;responsavel_pedagogico?:boolean;telefones?:Array<{numero?:string}>;emails?:Array<{email?:string}>};
type SweducFinancial=Record<string,unknown>&{titulo_id?:number|string;numero_titulo?:string;valor?:string|number;situacao?:string;vencimento?:string;descricao?:string};
type SweducStudent={matricula_id:number;nome:string;numero_matricula:string|null;status:string|null;unidade:string|null;curso:string|null;serie:string|null;turma:string|null;ano_letivo:string|null;responsaveis:SweducResponsible[];financeiro:SweducFinancial[];detalhes_carregados?:boolean};

function responsibleDocument(responsible:SweducResponsible){return responsible.cpf||responsible.cpf_cnpj||responsible.documento||"Documento não informado"}
function responsibleContact(responsible:SweducResponsible){return responsible.telefones?.[0]?.numero||responsible.emails?.[0]?.email||"Contato não informado"}
function financialText(item:SweducFinancial,keys:string[]){for(const key of keys){const value=item[key];if(value!==undefined&&value!==null&&String(value).trim())return String(value)}return ""}
function parseFinancialNumber(value:string){const clean=value.replace(/[^\d.,-]/g,"").trim();if(!clean)return NaN;const number=clean.includes(",")?Number(clean.replace(/\./g,"").replace(",",".")):Number(clean);return Number.isFinite(number)?number:NaN}
function findFinancialAmount(item:SweducFinancial,keys:string[]){for(const key of keys){const amount=parseFinancialNumber(financialText(item,[key]));if(Number.isFinite(amount))return amount}return NaN}
function formatFinancialValue(value:number){return Math.abs(value).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function financialValue(item:SweducFinancial){
  const net=findFinancialAmount(item,["valor_liquido","valorLiquido","valor_com_desconto","valorComDesconto","valor_final","valorFinal","saldo","saldo_devedor","valor_a_pagar","valorAPagar","valor_pago"]);
  if(Number.isFinite(net)&&net!==0)return formatFinancialValue(net);
  const gross=findFinancialAmount(item,["valor","Valor","VALOR","valor_titulo","valor_mensalidade","valor_original","vl_titulo","vlr_titulo","total"]);
  const discount=findFinancialAmount(item,["desconto","valor_desconto","valorDesconto","descontos","bolsa","valor_bolsa","valorBolsa"]);
  if(Number.isFinite(gross)&&Number.isFinite(discount)&&discount>0)return `${formatFinancialValue(Math.max(0,gross-Math.abs(discount)))} com desconto`;
  return Number.isFinite(gross)?formatFinancialValue(gross):"Valor não informado";
}
function financialDescription(item:SweducFinancial){
  const direct=financialText(item,["descricao","descrição","descricao_titulo","descricaoTitulo","historico","histórico","categoria","categoria_titulo","tipo","tipo_titulo","titulo","nome_titulo","nome","produto","servico","serviço","plano_conta","plano_contas","grupo_receita","receita","classe"]);
  const itens=Array.isArray(item.itens)?item.itens:[];
  const itemTexts=itens.flatMap(entry=>entry&&typeof entry==="object"?[financialText(entry as SweducFinancial,["descricao","descrição","nome","produto","servico","serviço","categoria","tipo"])]:[]).filter(Boolean);
  return [direct,...itemTexts].filter(Boolean).join(" ");
}
function financialLabel(item:SweducFinancial,index:number){return financialDescription(item)||financialText(item,["numero_titulo","numeroTitulo","titulo_id","tituloId","competencia"])||`Registro financeiro ${index+1}`}
function financialStatus(item:SweducFinancial){return financialText(item,["situacao","status","Situacao","STATUS"])}
function financialDueDate(item:SweducFinancial){return financialText(item,["vencimento","data_vencimento","dataVencimento","vencimento_titulo"])}
function isMonthlyFinancial(item:SweducFinancial){
  const text=normalizeSearchText(financialDescription(item));
  if(!text)return false;
  if(["multidisciplinar","material","apostila","uniforme","taxa","rematricula","matricula","evento","passeio","lanche","cantina"].some(word=>text.includes(word)))return false;
  return text.includes("mensalidade")||text.includes("mensal")||text.includes("parcela escolar")||text.includes("servico educacional")||text.includes("servico escolar");
}
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

export function SweducOperationalPicker({onStudentReady}:{onStudentReady:(student:{id:number;nome:string;turma?:string|null;segmento?:string;responsavel?:string;cpf_cnpj?:string|null;email?:string|null;whatsapp?:string|null;cep?:string|null;logradouro?:string|null;numero?:string|null;cidade?:string|null;uf?:string|null;sweduc_matricula_id?:number|null;sweduc_aluno_id?:number|null;sweduc_ano_letivo?:string|null;valor_mensalidade_sugerido?:string|null})=>void}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const [years,setYears]=useState<AcademicYear[]>([]);
  const [academicReferences,setAcademicReferences]=useState<AcademicReference[]>([]);
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
      const data=await response.json().catch(()=>({})) as {academicYears?:AcademicYear[];syncYears?:number[];selectedAcademicYear?:number;academicReferences?:AcademicReference[];config?:{credencial_configurada:boolean};error?:string};
      if(!response.ok)throw new Error(data.error||"Não foi possível carregar os anos letivos da SWeduc.");
      const allowedYears=(data.syncYears?.length?data.syncYears:[]).sort((a,b)=>b-a);
      const available=data.academicYears||[];
      const filteredYears=allowedYears.map(year=>available.find(item=>item.year===year)||{id:0,year});
      setYears(filteredYears);
      setAcademicReferences(data.academicReferences||[]);
      setSelectedYear(filteredYears[0]?.year||data.selectedAcademicYear||available[0]?.year||null);
      if(!data.config?.credencial_configurada)setMessage("A conexão SWeduc ainda precisa ser configurada pelo Master.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível carregar a SWeduc.")}
  },[token]);

  useEffect(()=>{void loadYears()},[loadYears]);
  const yearReferences=useMemo(()=>academicReferences.filter(reference=>Number(reference.ano_letivo)===Number(selectedYear)),[academicReferences,selectedYear]);
  const courseOptions=useMemo(()=>uniqueSortedOptions([...students.map(student=>student.curso),...yearReferences.map(reference=>reference.curso)]),[students,yearReferences]);
  const serieOptions=useMemo(()=>uniqueSortedOptions([
    ...students.filter(student=>!courseFilter||sameOption(student.curso,courseFilter)).map(student=>student.serie),
    ...yearReferences.filter(reference=>!courseFilter||sameOption(reference.curso,courseFilter)).map(reference=>reference.serie),
  ]),[students,yearReferences,courseFilter]);
  const turmaOptions=useMemo(()=>uniqueSortedOptions([
    ...students.filter(student=>(!courseFilter||sameOption(student.curso,courseFilter))&&(!serieFilter||sameOption(student.serie,serieFilter))).map(student=>student.turma),
    ...yearReferences.filter(reference=>(!courseFilter||sameOption(reference.curso,courseFilter))&&(!serieFilter||sameOption(reference.serie,serieFilter))).map(reference=>reference.turma),
  ]),[students,yearReferences,courseFilter,serieFilter]);
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
  useEffect(()=>{setGridPage(1)},[query,courseFilter,serieFilter,turmaFilter,selectedYear]);

  async function consult(yearOverride?:number){
    const activeYear=yearOverride||selectedYear;
    if(!activeYear)return;
    const term=query.trim();
    setBusy("consult");setError("");setMessage(term?`Buscando "${term}" em ${activeYear} na SWeduc…`:`Consultando alunos de ${activeYear} no espelho SWeduc…`);
    setStudents([]);setSelected(null);setResponsibleIndex(0);setGridPage(1);
    let page=1;let total=0;
    try{
      const accessToken=await token();
      while(page<=1000){
        const response=await authenticatedFetch("/api/integrations/sweduc",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({action:"lookup",page,academicYear:activeYear,search:term,course:yearOverride?"":courseFilter,serie:yearOverride?"":serieFilter,turma:yearOverride?"":turmaFilter}),cache:"no-store"});
        const data=await response.json().catch(()=>({})) as {students?:SweducStudent[];nextPage?:number|null;lastPage?:number;academicYear?:number;totalAvailable?:number;error?:string;message?:string};
        if(!response.ok)throw new Error(data.error||"Não foi possível consultar a SWeduc.");
        const loaded=data.students||[];total+=loaded.length;setStudents(current=>sortStudents([...current,...loaded]));
        setMessage(data.nextPage?`Organizando página ${page} de ${data.lastPage||"…"} · ${total} matrícula(s) na tela.`:"");
        if(!data.nextPage)break;
        page=data.nextPage;
      }
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível consultar a SWeduc.")}finally{setBusy("")}
  }

  async function openResponsibleChoice(student:SweducStudent){
    setSelected(student);setBusy(`details-${student.matricula_id}`);setError("");setMessage("Carregando responsáveis da SWeduc para conferência…");setResponsibleIndex(0);
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

  const responsibleCard=selected?<div className="responsible-match-card sweduc-responsible-confirm" role="dialog" aria-label="Confirmar responsável financeiro SWeduc"><div><UserCheck/><span><strong>Confirmar responsável da nota</strong><small>{selected.nome} · matrícula {selected.numero_matricula||selected.matricula_id}</small></span></div>{busy===`details-${selected.matricula_id}`?<p>Carregando responsáveis vinculados a este aluno…</p>:selected.responsaveis.length>0?<div className="sweduc-responsible-options">{selected.responsaveis.map((responsible,index)=><label key={`${responsible.nome||"responsavel"}-${index}`} className="sweduc-responsible-option"><input type="radio" name={`sweduc-responsible-${selected.matricula_id}`} checked={responsibleIndex===index} onChange={()=>setResponsibleIndex(index)}/><span><strong>{responsible.nome||`Responsável ${index+1}`}{responsible.responsavel_pedagogico===true&&<em className="sweduc-suggested-responsible"><Check size={13}/>Sugerido pela SWeduc</em>}</strong><small>{responsibleDocument(responsible)} · {responsibleContact(responsible)}</small></span></label>)}</div>:<p>A SWeduc não retornou responsável para esta matrícula. Confira com o suporte antes de carregar para a nota.</p>}<div className="sweduc-financial-preview"><strong>Financeiro retornado pela SWeduc</strong>{selected.financeiro?.length?<div>{selected.financeiro.slice(0,5).map((item,index)=><span key={`${financialLabel(item,index)}-${index}`}><small>{financialLabel(item,index)}{isMonthlyFinancial(item)?" · mensalidade":""}{financialStatus(item)?` · ${financialStatus(item)}`:""}{financialDueDate(item)?` · venc. ${financialDueDate(item)}`:""}</small><b>{financialValue(item)}</b></span>)}</div>:<small>Nenhum valor financeiro foi retornado para esta matrícula.</small>}</div><div><button type="button" className="secondary" onClick={()=>setSelected(null)}>Cancelar</button><button type="button" className="primary" disabled={Boolean(busy)||selected.responsaveis.length===0} onClick={()=>void loadForNote()}>{busy===`import-${selected.matricula_id}`?"Preparando…":<><Check size={15}/>Preparar para a nota</>}</button></div><small>Nada será gravado agora. O cadastro fiscal só será salvo quando a emissão for confirmada.</small></div>:null;

  return <section className="notice compact sweduc-operational-picker"><UsersRound/><div><strong>Buscar aluno na SWeduc</strong><span>Filtre por ano, segmento, série e turma. Depois busque o aluno pelo nome para preparar a nota.</span>
    <div className="sweduc-student-search-panel">
      <div className="sweduc-filter-row">
        <label>Ano letivo<select value={selectedYear||""} disabled={!years.length} onChange={event=>{const year=Number(event.target.value);loadedYearRef.current=null;setSelectedYear(year);setStudents([]);setSelected(null);setResponsibleIndex(0);setQuery("");setCourseFilter("");setSerieFilter("");setTurmaFilter("")}}>{years.map(year=><option key={year.year} value={year.year}>{year.year}</option>)}</select></label>
        <label>Segmento / curso<select value={courseFilter} disabled={Boolean(busy)||!selectedYear||!courseOptions.length} onChange={event=>{setCourseFilter(event.target.value);setSerieFilter("");setTurmaFilter("")}}><option value="">Todos</option>{courseOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
        <label>Série<select value={serieFilter} disabled={Boolean(busy)||!courseFilter} onChange={event=>{setSerieFilter(event.target.value);setTurmaFilter("")}}><option value="">Todas</option>{serieOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
        <label>Turma<select value={turmaFilter} disabled={Boolean(busy)||!serieFilter} onChange={event=>setTurmaFilter(event.target.value)}><option value="">Todas</option>{turmaOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
      </div>
      <label className="sweduc-search-row sweduc-search-label">Pesquisar aluno<div className="search-input sweduc-student-name-search"><Search/><input value={query} disabled={Boolean(busy)} onChange={event=>setQuery(event.target.value.toLocaleUpperCase("pt-BR"))} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void consult()}}} placeholder="BUSCAR ALUNO PELO NOME, MESMO COM ACENTO OU CARACTERES ESPECIAIS"/><button type="button" aria-label="Pesquisar aluno" disabled={Boolean(busy)||!selectedYear} onClick={()=>void consult()}>{busy==="consult"?<RefreshCw size={15}/>:<Search size={16}/>}</button></div></label>
    </div>
    {error&&<span className="agenda-secret-error">{error}</span>}{message&&<small>{message}</small>}
    {visible.length>0&&<div className="table-card"><div className="sweduc-grid-pagination"><span>Página {safeGridPage} de {totalGridPages} · {visible.length} aluno(s) encontrado(s) · 25 por página</span><button type="button" className="secondary mini" disabled={safeGridPage<=1} onClick={()=>setGridPage(page=>Math.max(1,page-1))}>Anterior</button><button type="button" className="secondary mini" disabled={safeGridPage>=totalGridPages} onClick={()=>setGridPage(page=>Math.min(totalGridPages,page+1))}>Próxima</button></div><table><thead><tr><th>Ano letivo</th><th>Aluno</th><th>Matrícula</th><th>Segmento / curso</th><th>Turma / série</th><th></th></tr></thead><tbody>{pagedVisible.map(student=><Fragment key={student.matricula_id}><tr className={selected?.matricula_id===student.matricula_id?"selected-row":""} onClick={()=>{if(!busy)void openResponsibleChoice(student)}}><td>{student.ano_letivo||selectedYear}</td><td><strong>{student.nome}</strong><span className="subcell">{student.unidade||"Unidade não informada"}</span></td><td>{student.numero_matricula||student.matricula_id}</td><td>{student.curso||"—"}</td><td>{[student.turma,student.serie].filter(Boolean).join(" · ")||"—"}</td><td><button type="button" className="primary mini sweduc-select-student-button" aria-label={`Selecionar aluno ${student.nome}`} disabled={Boolean(busy)||visible.length<1} onClick={event=>{event.stopPropagation();void openResponsibleChoice(student)}}>{busy===`details-${student.matricula_id}`?"Carregando…":"Selecionar"}</button></td></tr>{selected?.matricula_id===student.matricula_id&&<tr className="sweduc-responsible-row"><td colSpan={6}>{responsibleCard}</td></tr>}</Fragment>)}</tbody></table>{visible.length>pageSize&&<small>Grade em ordem alfabética. Use a paginação ou refine os filtros para localizar mais rápido.</small>}</div>}
  </div></section>;
}
