export const setPieceCounts={corner:2,freeKick:2,penalty:1};
export function setPiecesFor(quarter){return Object.fromEntries(Object.entries(setPieceCounts).map(([kind,count])=>[kind,Array.from({length:count},(_,i)=>quarter.setPieces?.[kind]?.[i]??null)]));}
export function validateSetPieces(quarter){
  const values=setPiecesFor(quarter),present=new Set(quarter.halves.flat().filter(Boolean));
  if(quarter.setPieces!==undefined){
    if(!quarter.setPieces||typeof quarter.setPieces!=='object'||Array.isArray(quarter.setPieces))throw new Error('세트피스 담당자를 확인해 주세요.');
    for(const [kind,count] of Object.entries(setPieceCounts)){const picks=quarter.setPieces[kind];if(picks!==undefined&&(!Array.isArray(picks)||picks.length!==count||picks.some(key=>key!==null&&(typeof key!=='string'||!present.has(key)))||new Set(picks.filter(Boolean)).size!==picks.filter(Boolean).length))throw new Error('세트피스 담당자는 해당 쿼터 출전 선수 중 중복 없이 선택해 주세요.');}
  }
  return values;
}
export function clearUnavailableSetPieces(quarter){const present=new Set(quarter.halves.flat().filter(Boolean));quarter.setPieces=Object.fromEntries(Object.entries(setPiecesFor(quarter)).map(([kind,values])=>[kind,values.map(key=>present.has(key)?key:null)]));}
export function namedSetPieces(quarter,names){return Object.fromEntries(Object.entries(setPiecesFor(quarter)).map(([kind,keys])=>[kind,keys.map(key=>key?names[key]??null:null)]));}
export function eligibleReplacements(players,quarter,half,slot,quarterIndex,count){const current=quarter.halves[half][slot],occupied=new Set(quarter.halves[half].filter(Boolean));return players.filter(p=>(p.availableQuarters??Array.from({length:count},(_,i)=>i)).includes(quarterIndex)&&(p.key===current||!occupied.has(p.key)));}
