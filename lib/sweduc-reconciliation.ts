export function missingSweducEnrollmentIds(existingIds:number[],seenIds:number[],complete:boolean,listedCount:number,expectedTotal:number|null){
 if(!complete||expectedTotal===null||!Number.isSafeInteger(expectedTotal)||expectedTotal<0||listedCount!==expectedTotal)return [];
 const seen=new Set(seenIds);
 return existingIds.filter(id=>Number.isSafeInteger(id)&&id>0&&!seen.has(id));
}
