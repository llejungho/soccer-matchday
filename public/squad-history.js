const signature=t=>JSON.stringify([t?.id??t?.tacticId??null,t?.name??t?.tacticName??'기본 컨셉',t?.concept??t?.tacticConcept??'',t?.traits??t?.tacticTraits??'']);
export const contextKey=(formation,tactic)=>JSON.stringify([formation,signature(tactic)]);
const add=(map,key,label,outcome,weight=1)=>{let v=map.get(key);if(!v){v={label,win:0,draw:0,loss:0,total:0};map.set(key,v);}v[outcome]+=weight;v.total+=weight;};
const values=map=>[...map.values()].map(v=>({...v,winRate:Math.round(v.win/v.total*1000)/10})).sort((a,b)=>b.total-a.total||b.winRate-a.winRate);
export function buildHistory(records=[]){
  const groups={formations:new Map(),tactics:new Map(),players:new Map(),combinations:new Map(),contexts:new Map(),pairs:new Map(),lineups:new Map()};
  for(const record of records){
    if(!['win','draw','loss'].includes(record.outcome))continue;
    const s=typeof record.snapshot==='string'?JSON.parse(record.snapshot):record.snapshot;
    const tk=signature(s),ck=contextKey(s.formation,s),label=`${s.formation} · ${s.tacticName}`;
    add(groups.formations,s.formation,s.formation,record.outcome);add(groups.tactics,tk,s.tacticName,record.outcome);add(groups.contexts,ck,label,record.outcome);
    for(const p of s.players)if(p.id!==null){add(groups.players,p.id+':'+p.position,p.name+' · '+p.position,record.outcome,p.weight);add(groups.combinations,JSON.stringify([p.id,p.position,ck]),`${p.name} · ${p.position} · ${label}`,record.outcome,p.weight);}
    // Old snapshots can be reconstructed safely only when both halves have 11 players.
    const lineups=s.lineups||(s.players.length===22?[s.players.slice(0,11),s.players.slice(11)]:[]);
    for(const lineup of lineups){
      const members=lineup.filter(p=>p.id!==null).sort((a,b)=>a.id-b.id);
      if(!members.length)continue;
      add(groups.lineups,JSON.stringify([ck,members.map(p=>[p.id,p.position])]),label+' · '+members.map(p=>p.name).join(', '),record.outcome,0.5);
      for(let i=0;i<members.length;i++)for(let j=0;j<i;j++)add(groups.pairs,JSON.stringify([ck,members[j].id,members[i].id]),members[j].name+' + '+members[i].name,record.outcome,0.5);
    }
  }
  return {recordedQuarters:records.length,...groups};
}
// Smoothed historical evidence is a secondary score, never a predicted win rate.
const evidence=v=>v&&v.total>=2?((v.win+1)/(v.total+2)-0.5)*Math.min(1,v.total/6):0;
export function historyScore(history,player,position,q){
  if(!history||player.id==null)return 0;
  const key=contextKey(q.formation,q.tactic);
  return 100*evidence(history.combinations.get(JSON.stringify([player.id,position,key])))+40*evidence(history.players.get(player.id+':'+position));
}
export function historyPairScore(history,a,b,q){
  if(!history||a?.id==null||b?.id==null)return 0;
  return 35*evidence(history.pairs.get(JSON.stringify([contextKey(q.formation,q.tactic),Math.min(a.id,b.id),Math.max(a.id,b.id)])));
}
export function historyLineupScore(history,people,slots,q){
  if(!history)return 0;
  const members=people.flatMap((p,i)=>p?.id!=null?[[p.id,slots[i].pos]]:[]).sort((a,b)=>a[0]-b[0]);
  return 120*evidence(history.lineups.get(JSON.stringify([contextKey(q.formation,q.tactic),members])));
}
export function historyReason(history,keys,players,q){
  if(!history?.recordedQuarters)return '누적 경기결과가 없어 포지션·평가·전술·궁합을 기준으로 구성했습니다.';
  const context=history.contexts.get(contextKey(q.formation,q.tactic)),notes=[];
  if(context)notes.push(`같은 포메이션·전술의 과거 승률 ${Math.round(context.win/context.total*1000)/10}% (${context.total}쿼터)`);
  const slots=q.slots||[],byKey=new Map(players.map(p=>[p.key,p]));
  const members=keys.flatMap((key,i)=>byKey.get(key)?.id!=null?[[byKey.get(key).id,slots[i]?.pos]]:[]).sort((a,b)=>a[0]-b[0]);
  const lineup=history.lineups.get(JSON.stringify([contextKey(q.formation,q.tactic),members]));
  if(lineup?.total>=2)notes.push(`같은 팀 선수·위치 구성의 과거 승률 ${Math.round(lineup.win/lineup.total*1000)/10}% (${lineup.total}출전 쿼터)`);
  const candidates=keys.flatMap((key,i)=>{const p=byKey.get(key);const v=p?.id!=null?history.combinations.get(JSON.stringify([p.id,slots[i]?.pos,contextKey(q.formation,q.tactic)])):null;return v&&v.total>=2?[v]:[];}).sort((a,b)=>b.win/b.total-a.win/a.total||b.total-a.total);
  if(candidates[0]){const v=candidates[0];notes.push(`${v.label}: 과거 승률 ${Math.round(v.win/v.total*1000)/10}% (${v.total}출전 쿼터)`);}
  return (notes.length?notes.join('. '):'이 구성과 일치하는 경기 기록이 부족하여 선수·위치의 누적 기록을 보조 기준으로 참고했습니다.')+'. 과거 관찰 기록이며 이번 경기의 예상 승률은 아닙니다.';
}
export function historyAnalysis(records){
  const history=buildHistory(records);
  return {recordedQuarters:history.recordedQuarters,...Object.fromEntries(['formations','tactics','players','combinations','contexts','lineups'].map(key=>[key,values(history[key])]))};
}
