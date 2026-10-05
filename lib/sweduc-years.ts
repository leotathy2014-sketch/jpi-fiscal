export function prioritizeSweducAcademicYears(years:number[],selectedYear?:number|null){
  const normalized=Array.from(new Set(years.map(Number).filter(year=>Number.isSafeInteger(year)&&year>=2020&&year<=2100))).sort((a,b)=>b-a);
  const selected=Number(selectedYear||0);
  if(!Number.isSafeInteger(selected)||selected<2020||selected>2100)return normalized;
  return [selected,...normalized.filter(year=>year!==selected)];
}
