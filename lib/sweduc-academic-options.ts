function normalizedText(value:unknown){
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .replace(/\s+/g," ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function withArabicLevel(value:string){
  return value
    .replace(/\bv\b/g,"5")
    .replace(/\biv\b/g,"4")
    .replace(/\biii\b/g,"3")
    .replace(/\bii\b/g,"2")
    .replace(/\bi\b/g,"1");
}

export function sweducInfantLevelKey(value:unknown){
  const normalized=withArabicLevel(normalizedText(value))
    .replace(/\b(manha|tarde|noite)\b/g,"")
    .replace(/\b(m|t|n)\b/g,"")
    .replace(/\s+/g," ")
    .trim();
  const maternal=normalized.match(/\b(?:mat|matenal|maternal)\s*(\d+)\b/);
  if(maternal)return `maternal ${maternal[1]}`;
  const preschool=normalized.match(/\bpre(?:\s+escola)?\s*(\d+)\b/);
  if(preschool)return `pre escola ${preschool[1]}`;
  return "";
}

export function sweducClassOptionKey(value:unknown){
  const normalized=normalizedText(value);
  if(!normalized)return "";
  const tokens=normalized.split(" ");
  const shift=tokens.includes("manha")||tokens.includes("m")?"manha":tokens.includes("tarde")||tokens.includes("t")?"tarde":tokens.includes("noite")||tokens.includes("n")?"noite":"";
  const infantLevel=sweducInfantLevelKey(normalized);
  const base=infantLevel||withArabicLevel(normalized)
    .replace(/\b(manha|tarde|noite)\b/g,"")
    .replace(/\b(m|t|n)\b/g,"")
    .replace(/\s+/g," ")
    .trim();
  return [base,shift].filter(Boolean).join("|");
}

export function sameSweducClassOption(left:unknown,right:unknown){
  const current=sweducClassOptionKey(left);const expected=sweducClassOptionKey(right);
  return !expected||Boolean(current)&&current===expected;
}

export function isSweducClassCompatibleWithSeries(turma:unknown,serie:unknown){
  const turmaLevel=sweducInfantLevelKey(turma);const serieLevel=sweducInfantLevelKey(serie);
  return !turmaLevel||!serieLevel||turmaLevel===serieLevel;
}

function labelScore(label:string){
  const normalized=normalizedText(label);
  const fullShift=/\b(manha|tarde|noite)\b/.test(normalized)?100:0;
  const readableCase=label!==label.toLocaleUpperCase("pt-BR")?10:0;
  return fullShift+readableCase+Math.min(label.length,50)/100;
}

export function uniqueSortedSweducClassOptions(values:Array<string|null|undefined>){
  const options=new Map<string,string>();
  for(const value of values){
    const label=String(value||"").replace(/\s+/g," ").trim();
    if(/^z\s+(?:mat|matenal|maternal)(?:\s|$)/.test(normalizedText(label)))continue;
    const key=sweducClassOptionKey(label);
    if(!label||!key)continue;
    const current=options.get(key);
    if(!current||labelScore(label)>labelScore(current))options.set(key,label);
  }
  return Array.from(options.values()).sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true,sensitivity:"base"}));
}
