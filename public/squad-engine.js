import {historyScore,historyPairScore,historyLineupScore,historyReason} from './squad-history.js';
export const positions = ['CF','SS','LW','RW','AM','LM','CM','RM','DM','LWB','RWB','CB','GK'];
const row = (names,y) => names.map((pos,i) => ({pos,x:(i+1)*100/(names.length+1),y}));
export const formations = {
  '442': [...row(['CF','CF'],18),...row(['LM','CM','CM','RM'],43),...row(['LWB','CB','CB','RWB'],72)],
  '4231': [...row(['CF'],15),...row(['LW','AM','RW'],32),...row(['DM','DM'],52),...row(['LWB','CB','CB','RWB'],74)],
  '433': [...row(['LW','CF','RW'],18),...row(['CM','DM','CM'],47),...row(['LWB','CB','CB','RWB'],74)],
  '343': [...row(['LW','CF','RW'],18),...row(['LM','CM','CM','RM'],46),...row(['CB','CB','CB'],74)],
  '352': [...row(['CF','SS'],18),...row(['LWB','CM','DM','CM','RWB'],46),...row(['CB','CB','CB'],74)],
  '4141': [...row(['CF'],15),...row(['LM','CM','CM','RM'],35),...row(['DM'],54),...row(['LWB','CB','CB','RWB'],74)]
};
export function formationSlots(code) {
  if(typeof code!=='string'||! /^[1-5]{3,5}$/.test(code)||[...code].reduce((s,n)=>s+Number(n),0)!==10) throw new Error('포메이션은 각 줄 1~5명, 합계 10명으로 입력하세요. 예: 532, 451');
  const lines=[...code].map(Number).reverse();
  return lines.flatMap((n,i)=>{
    const defense=i===lines.length-1,attack=i===0;
    const names=n===1?[defense?'CB':attack?'CF':'DM']:defense?(n===2?['CB','CB']:n===3?['CB','CB','CB']:n===4?['LWB','CB','CB','RWB']:['LWB','CB','CB','CB','RWB']):attack?(n===2?['CF','SS']:n===3?['LW','CF','RW']:n===4?['LW','CF','SS','RW']:['LW','CF','CF','SS','RW']):n===2?['DM','DM']:n===3?['CM','DM','CM']:n===4?['LM','CM','CM','RM']:['LM','CM','DM','CM','RM'];
    return row(names,18+i*56/(lines.length-1));
  });
}
export const slotsFor = formation => [...(Object.hasOwn(formations,formation)?formations[formation]:formationSlots(formation)),{pos:'GK',x:50,y:91}];
export function quotaSummary(people,quarterCount,mode='individual') {
  const field=people.filter(p=>!p.keeper),assigned=field.reduce((sum,p)=>sum+p.quota,0),capacity=quarterCount*10;
  return {capacity,assigned:mode==='fair'?Math.min(capacity,field.length*quarterCount):assigned,remaining:Math.max(0,capacity-assigned)};
}
export function assignQuota(people,person,requested,quarterCount) {
  const other=people.filter(p=>p!==person&&!p.keeper).reduce((sum,p)=>sum+p.quota,0);
  const quota=Math.max(0,Math.min(requested,quarterCount,person.keeper?quarterCount:quarterCount*10-other));
  person.quota=quota;return {quota,adjusted:quota!==requested};
}
export function clampQuotas(people,quarterCount) {
  let remaining=quarterCount*10,adjusted=false;
  for(const p of people){const before=p.quota;p.quota=Math.min(p.quota,quarterCount,p.keeper?quarterCount:remaining);if(!p.keeper)remaining-=p.quota;adjusted ||= before!==p.quota;}
  return adjusted;
}
const family = pos => ['CF','SS','LW','RW'].includes(pos) ? 'attack' : ['LWB','RWB','CB'].includes(pos) ? 'defense' : pos === 'GK' ? 'keeper' : 'midfield';
function preference(player,pos) {
  const index = player.positions.indexOf(pos);
  if(index>=0) return [120,90,65][index];
  if(!player.positions.length) return 5;
  return player.positions.some(p=>family(p)===family(pos)) ? 25 : -20;
}
const defaultBasicFields=Object.entries({stamina:'체력',aggression:'적극성',attack:'공격력',defense:'수비력',overall:'전체 실력'}).map(([key,name])=>({key,name}));
const scoreKey=field=>field.basicKey||'custom:'+field.id;
const readScore=(player,field)=>field.basicKey?player.ratings?.[field.basicKey]||0:player.customRatings?.[field.id]||0;
export function tacticWeights(tactic,fields=defaultBasicFields.map(f=>({...f,basicKey:f.key}))) {
  const text=(`${tactic?.name||''} ${tactic?.concept||''} ${tactic?.traits||''}`).replace(/\s/g,'');const weights={};
  for(const field of fields){const name=field.name.replace(/\s/g,''),key=scoreKey(field);
    if(text.includes(name)||(/^(공격력|수비력|전체실력)$/.test(name)&&text.includes(name==='전체실력'?'실력':name.slice(0,-1))))weights[key]=2;
    if(/압박/.test(text)&&/체력|적극성/.test(name))weights[key]=2;
    if(/킥.*런/.test(text)&&/롱킥|롱패스|헤딩|제공권|공중볼|스피드|속도/.test(name))weights[key]=2;
    if(/역습/.test(text)){if(/수비|속도|스피드/.test(name))weights[key]=2;else if(/공격/.test(name))weights[key]=1;}
  }return weights;
}
function quality(player,slot,tactic,fields,history,q) {
  let score=preference(player,slot.pos)*10;
  for(const field of fields){const name=field.name.replace(/\s/g,'');if(/^(전체실력|종합실력|기량)$/.test(name)||(family(slot.pos)==='attack'&&name==='공격력')||(family(slot.pos)==='defense'&&name==='수비력'))score+=readScore(player,field)*2;}
  const weights=tacticWeights(tactic,fields);for(const field of fields)score+=readScore(player,field)*(weights[scoreKey(field)]||0)*5;
  const text=`${tactic?.name||''} ${tactic?.concept||''} ${tactic?.traits||''}`;
  const comment=player.comment||'';
  for(const pattern of [/속도|스피드|빠른|달리기/,/롱킥|롱패스|긴패스/,/헤딩|공중볼|제공권/,/수비|태클/,/패스|팀플레이/,/체력|활동량/])if(pattern.test(text)&&pattern.test(comment))score+=15;
  if(/킥.*런/.test(text)&&/롱킥|롱패스|헤딩|공중볼|빠른|스피드/.test(comment))score+=20;
  return score+historyScore(history,player,slot.pos,q);
}
function minCostAssignments(players,quarters,targets,fields,history,full=false,minimum=[]) {
  const graph=[]; const addNode=()=>{graph.push([]);return graph.length-1;};
  const source=addNode(),sink=addNode();
  function edge(a,b,cap,cost) {const f={to:b,rev:graph[b].length,cap,cost};graph[a].push(f);graph[b].push({to:a,rev:graph[a].length-1,cap:0,cost:-cost});return f;}
  const slotNodes=[];
  quarters.forEach((q,qi)=>(full?[0]:[0,1]).forEach(half=>slotsFor(q.formation).forEach((slot,si)=>{const id=addNode();edge(id,sink,1,0);slotNodes.push({id,qi,half,si,slot,q});})));
  const references=[];
  players.forEach((player,pi)=>{
    const id=addNode(),required=Math.min(targets[pi],minimum[pi]||0);edge(source,id,required,-1000000);edge(source,id,targets[pi]-required,0);
    quarters.forEach((q,qi)=>(full?[0]:[0,1]).forEach(half=>{
      const ph=addNode();edge(id,ph,1,0);
      for(const s of slotNodes.filter(s=>s.qi===qi&&s.half===half)) {
        if((s.slot.pos==='GK')!==player.keeper) continue;
        const e=edge(ph,s.id,1,-quality(player,s.slot,q.tactic,fields,history,q)*(full?2:1));references.push({e,pi,...s});
      }
    }));
  });
  // Successive shortest augmenting paths: quotas and one position per half are hard limits.
  while(true) {
    const dist=Array(graph.length).fill(Infinity),prev=Array(graph.length),queued=Array(graph.length).fill(false),queue=[source];dist[source]=0;queued[source]=true;
    for(let i=0;i<queue.length;i++){const a=queue[i];queued[a]=false;graph[a].forEach((e,ei)=>{if(e.cap&&dist[e.to]>dist[a]+e.cost){dist[e.to]=dist[a]+e.cost;prev[e.to]=[a,ei];if(!queued[e.to]){queue.push(e.to);queued[e.to]=true;}}});}
    if(!prev[sink]) break;
    for(let b=sink;b!==source;){const [a,ei]=prev[b];const e=graph[a][ei];e.cap--;graph[b][e.rev].cap++;b=a;}
  }
  const result=quarters.map(q=>({formation:q.formation,tacticName:q.tactic?.name||'기본 컨셉',halves:[Array(11).fill(null),Array(11).fill(null)]}));
  for(const r of references) if(r.e.cap===0) result[r.qi].halves[r.half][r.si]=players[r.pi].key;
  if(full)for(const q of result)q.halves[1]=[...q.halves[0]];
  return result;
}
function pairScore(a,b,sa,sb) {
  if(!a||!b) return 0;
  const distance=Math.hypot(sa.x-sb.x,sa.y-sb.y)/100;
  let score=0;
  if(a.chemistry?.good.includes(b.id)||b.chemistry?.good.includes(a.id)) score+=180*(1-distance);
  if(a.chemistry?.bad.includes(b.id)||b.chemistry?.bad.includes(a.id)) score-=260*(1-distance);
  if((/개인플레이/.test(a.comment||'')&&/팀플레이/.test(b.comment||''))||(/개인플레이/.test(b.comment||'')&&/팀플레이/.test(a.comment||''))) score+=25*(1-distance);
  return score;
}
function optimizePairs(result,players,quarters,fields,history) {
  const byKey=new Map(players.map(p=>[p.key,p]));
  const qualities=quarters.map(q=>new Map(players.flatMap(p=>slotsFor(q.formation).map(s=>[p.key+':'+s.pos,quality(p,s,q.tactic,fields,history,q)]))));
  const pairCache=new Map();
  function value(keys,qi) {const q=quarters[qi],slots=slotsFor(q.formation);let score=0;keys.forEach((key,i)=>{if(key)score+=qualities[qi].get(key+':'+slots[i].pos);for(let j=0;j<i;j++){const cacheKey=JSON.stringify([qi,key,keys[j],i,j]);if(!pairCache.has(cacheKey))pairCache.set(cacheKey,pairScore(byKey.get(key),byKey.get(keys[j]),slots[i],slots[j])+historyPairScore(history,byKey.get(key),byKey.get(keys[j]),q));score+=pairCache.get(cacheKey);}});return score+historyLineupScore(history,keys.map(key=>byKey.get(key)),slots,q);}
  const all=result.flatMap((q,qi)=>(qi<2?[0]:[0,1]).map(half=>({keys:q.halves[half],qi,half,weight:qi<2?2:1})));
  for(let pass=0;pass<3;pass++) {let improved=false;
    for(let ai=0;ai<all.length;ai++) for(let bi=ai;bi<all.length;bi++) {
      const a=all[ai],b=all[bi];
      if(a.weight!==b.weight)continue;
      for(let i=0;i<10;i++)for(let j=0;j<10;j++) {
        if(a===b&&i>=j)continue;
        const ka=a.keys[i],kb=b.keys[j];if(ka===kb)continue;
        if(a!==b&&((kb&&a.keys.includes(kb))||(ka&&b.keys.includes(ka))))continue;
        const before=value(a.keys,a.qi)+(a===b?0:value(b.keys,b.qi));
        a.keys[i]=kb;b.keys[j]=ka;
        const after=value(a.keys,a.qi)+(a===b?0:value(b.keys,b.qi));
        if(after>before+0.1) improved=true;else{a.keys[i]=ka;b.keys[j]=kb;}
      }
    } if(!improved)break;
  }
  for(const q of result.slice(0,2))q.halves[1]=[...q.halves[0]];
}
export function totals(result,players) {return players.map(p=>({...p,actual:result.reduce((sum,q)=>sum+q.halves.flat().filter(key=>key===p.key).length/2,0)}));}
export function generate(players,quarters,mode,fields=[],basicFields=defaultBasicFields,history=null) {
  fields=[...fields,...basicFields.map(f=>({...f,basicKey:f.key}))];
  const halves=quarters.length*2,targets=players.map(p=>mode==='individual'?Math.round(p.quota*2):0);
  if(mode==='fair')for(const keeper of [false,true]) {
    const indices=players.map((p,i)=>p.keeper===keeper?i:-1).filter(i=>i>=0),unit=quarters.length<=2?2:1,capacity=halves*(keeper?1:10)/unit;
    indices.forEach((pi,index)=>targets[pi]=Math.min(halves,(Math.floor(capacity/indices.length)+(index<capacity%indices.length?1:0))*unit));
    const early=Math.min(2,quarters.length),later=halves-early*2,fullCapacity=early*(keeper?1:10);
    // Pair odd half-unit targets when full-quarter constraints require it.
    for(let step=0;step<indices.length;step++){
      const minSum=indices.reduce((sum,i)=>sum+Math.max(0,Math.ceil((targets[i]-later)/2)),0),maxSum=indices.reduce((sum,i)=>sum+Math.min(early,Math.floor(targets[i]/2)),0);
      if(minSum<=fullCapacity&&maxSum>=Math.min(fullCapacity,indices.length*early))break;
      const donor=indices.find(i=>targets[i]%2===1&&(minSum<=fullCapacity||targets[i]>later));
      const recipient=indices.find(i=>i!==donor&&targets[i]%2===1&&targets[i]<halves);
      if(donor===undefined||recipient===undefined)break;targets[donor]--;targets[recipient]++;
    }
  }
  const early=Math.min(2,quarters.length),later=halves-early*2;
  const prefix=minCostAssignments(players,quarters.slice(0,early),targets.map(t=>Math.min(early,Math.floor(t/2))),fields,history,true,targets.map(t=>Math.max(0,Math.ceil((t-later)/2))));
  const used=totals(prefix,players).map(p=>p.actual*2);
  const tail=minCostAssignments(players,quarters.slice(early),targets.map((t,i)=>Math.max(0,t-used[i])),fields,history);
  const result=[...prefix,...tail];optimizePairs(result,players,quarters,fields,history);
  const warnings=[];const empty=result.reduce((sum,q)=>sum+q.halves.flat().filter(k=>!k).length,0);
  if(empty)warnings.push(`인원 또는 출전량 부족으로 ${empty/2}쿼터분 자리가 비어 있습니다. 빈 자리를 직접 보완하거나 출전량을 늘려 주세요.`);
  const unfamiliar = new Set();
  result.forEach(q=>q.halves.forEach(half=>half.forEach((key,i)=>{const p=players.find(p=>p.key===key);if(p&&(!p.positions.length||!p.positions.includes(slotsFor(q.formation)[i].pos)))unfamiliar.add(p.name);}))); 
  if(unfamiliar.size)warnings.push(`선호 포지션 밖의 배치가 포함된 선수: ${[...unfamiliar].join(', ')}. 자리 수와 출전량을 맞추기 위한 배치이므로 직접 확인해 주세요.`);
  for(const [i,p] of totals(result,players).entries())if(p.actual!==targets[i]/2)warnings.push(`${p.name}: 요청 ${targets[i]/2}쿼터, 실제 ${p.actual}쿼터. 1·2쿼터 풀쿼터 조건, 동시 출전 제한과 자리 수 때문에 요청을 모두 충족하지 못했습니다.`);
  for(const [qi,q] of result.entries()) {
    const weights=tacticWeights(quarters[qi].tactic,fields);
    const labels=fields.filter(f=>weights[scoreKey(f)]).map(f=>f.name);
    let preferred=0,count=0;for(const keys of q.halves)keys.forEach((key,i)=>{if(key){count++;if(players.find(p=>p.key===key).positions[0]===slotsFor(q.formation)[i].pos)preferred++;}});
    q.reason=`${q.tacticName}: ${labels.length?labels.join('·')+' 평가를 반영하고 ':''}1순위 포지션 ${preferred}/${count}개 반쿼터 자리에 배치했습니다. 선호 순위·출전량·특징·궁합을 함께 고려했습니다. ${qi<2?'전·후반 동일한 풀쿼터 배치입니다. ':''}`+historyReason(history,q.halves[0],players,{...quarters[qi],slots:slotsFor(q.formation)});
  }
  const fieldTargets=players.flatMap((p,i)=>p.keeper?[]:[targets[i]/2]);
  if(mode==='fair'&&fieldTargets.length&&Math.max(...fieldTargets)-Math.min(...fieldTargets)>0.5)warnings.push('1·2쿼터 풀쿼터 출전을 유지하기 위해 공평 배분에 최대 1쿼터 차이가 생길 수 있습니다. 최종 출전량을 확인하세요.');
  return {quarters:result,warnings};
}
