import {availableQuarters} from './squad-engine.js';
// Preserve remembered amounts first, then fill remaining field places with
// whole quarters in attendee order (e.g. 3,3,...,2,2 for 16 field players).
export function defaultQuotas(people,quarterCount,remembered={}) {
  let remaining=quarterCount*10,adjusted=false;
  const field=people.filter(p=>!p.keeper),unset=[];
  for(const p of people){const limit=availableQuarters(p,quarterCount).length,value=remembered[p.playerId];if(p.keeper){p.quota=Math.min(limit,value??quarterCount);continue;}if(value===undefined||value===null){unset.push(p);continue;}p.quota=Math.min(limit,value,remaining);if(p.quota!==value)adjusted=true;remaining-=p.quota;}
  for(let i=0;i<unset.length;i++){const amount=Math.min(availableQuarters(unset[i],quarterCount).length,Math.floor(remaining/(unset.length-i))+(remaining%(unset.length-i)>=1?1:0));unset[i].quota=amount;remaining-=amount;}
  // A remembered half quarter leaves a half place to fill without exceeding capacity.
  while(remaining>=1){const p=unset.find(p=>p.quota+1<=availableQuarters(p,quarterCount).length);if(!p)break;p.quota++;remaining--;}
  if(remaining>0&&remaining<1){const p=unset.find(p=>p.quota+remaining<=availableQuarters(p,quarterCount).length);if(p){p.quota+=remaining;remaining=0;}}
  return {assigned:field.reduce((sum,p)=>sum+p.quota,0),remaining,adjusted};
}
