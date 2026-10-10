import {buildHistory,historyAnalysis} from '../public/squad-history.js';
import { randomBytes } from 'node:crypto';
import { state } from './teams.mjs';
import { generate, positions, formations, slotsFor } from '../public/squad-engine.js';
const answer=(status,body)=>({status,body});
const fail=message=>{throw new Error(message);};
async function analyze(db,teamId) {
  const records=await db.prepare('SELECT o.* FROM squad_outcomes o JOIN squads s ON s.id=o.squad_id WHERE s.team_id=?').all(teamId);
  return historyAnalysis(records);
}
function normalize(input,teamState,enabled) {
  const {name,quarters,attendees,guests,mode}=input;
  if(typeof name!=='string'||!name.trim()||name.length>80)fail('스쿼드명은 1~80자로 입력해 주세요.');
  if(!Array.isArray(quarters)||quarters.length<1||quarters.length>12)fail('쿼터는 1~12개로 설정해 주세요.');
  const normalizedQuarters=quarters.map(q=>{
    if(!q||!enabled.includes(q.formation))fail('팀에서 사용하는 포메이션을 선택해 주세요.');
    const tactic=q.tacticId===null?null:teamState.tactics.find(t=>t.id===q.tacticId);
    if(q.tacticId!==null&&!tactic)fail('현재 팀의 전술을 선택해 주세요. 삭제된 전술이 있다면 다시 선택하세요.');
    return {formation:q.formation,tacticId:q.tacticId,tactic};
  });
  if(!['fair','individual'].includes(mode))fail('배분 방식을 선택해 주세요.');
  if(!Array.isArray(attendees)||!Array.isArray(guests)||attendees.length+guests.length>100)fail('참석자는 최대 100명입니다.');
  const selected=new Set();
  const validateQuota=p=>{if(typeof p.keeper!=='boolean'||typeof p.quota!=='number'||!Number.isFinite(p.quota)||p.quota<0||p.quota>quarters.length||!Number.isInteger(p.quota*2))fail('출전량은 쿼터 수 이내의 0.5 단위로 선택해 주세요.');};
  const players=attendees.map(p=>{
    validateQuota(p);const member=teamState.players.find(member=>member.id===p.playerId);
    if(!member||selected.has(member.id))fail('현재 팀의 서로 다른 선수를 선택해 주세요.');selected.add(member.id);
    return {...member,key:'p:'+member.id,keeper:member.positions[0]==='GK',quota:p.quota};
  });
  const guestKeys=new Set();
  for(const g of guests){
    validateQuota(g);
    if(typeof g.key!=='string'||!/^g:[a-zA-Z0-9-]{1,50}$/.test(g.key)||guestKeys.has(g.key)||typeof g.name!=='string'||!g.name.trim()||g.name.length>60||!Array.isArray(g.positions)||g.positions.length!==1||!positions.includes(g.positions[0]))fail('용병은 이름과 포지션 한 개를 입력해 주세요.');guestKeys.add(g.key);
    players.push({key:g.key,name:g.name.trim(),positions:g.positions,keeper:g.positions[0]==='GK',quota:g.quota,ratings:{},customRatings:{},chemistry:{good:[],bad:[]},comment:''});
  }
  if(mode==='individual'&&players.filter(p=>!p.keeper).reduce((sum,p)=>sum+p.quota,0)>quarters.length*10)fail(`필드 출전량 합계는 ${quarters.length*10}쿼터를 넘을 수 없습니다.`);
  return {name:name.trim(),quarters:normalizedQuarters,attendees:players.filter(p=>p.key.startsWith('p:')).map(p=>({playerId:p.id,quota:p.quota,keeper:p.keeper})),guests:players.filter(p=>p.key.startsWith('g:')).map(p=>({key:p.key,name:p.name,positions:p.positions,keeper:p.keeper,quota:p.quota})),mode,players};
}
function validResult(result,config) {
  if(!result||!Array.isArray(result.quarters)||result.quarters.length!==config.quarters.length)fail('먼저 스쿼드를 자동 구성해 주세요.');
  const keys=new Set(config.players.map(p=>p.key));
  return {warnings:[],quarters:result.quarters.map((q,i)=>{
    if(!q||!Array.isArray(q.halves)||q.halves.length!==2)fail('쿼터별 전·후반 배치를 확인해 주세요.');
    const halves=q.halves.map(half=>{
      if(!Array.isArray(half)||half.length!==11||half.some(k=>k!==null&&!keys.has(k))||new Set(half.filter(Boolean)).size!==half.filter(Boolean).length)fail('같은 전·후반에 한 선수를 중복 배치할 수 없습니다.');return half;
    });
    return {formation:config.quarters[i].formation,tacticName:config.quarters[i].tactic?.name||'기본 컨셉',halves,reason:typeof q.reason==='string' ? q.reason.slice(0,1000) : '감독이 직접 수정한 배치입니다. 출전량과 포지션을 최종 확인해 주세요.'};
  })};
}
function publicSnapshot(squad) {
  const config=JSON.parse(squad.config),result=JSON.parse(squad.result);
  const people=Object.fromEntries(config.players.map(p=>[p.key,p.name]));
  return {name:squad.name,quarters:result.quarters.map((q,i)=>({formation:q.formation,tacticName:q.tacticName,slots:slotsFor(q.formation),halves:q.halves.map(half=>half.map(key=>key?people[key]:null))}))};
}
export async function sharedSquad(db,token) {
  if(!/^[a-f0-9]{48}$/.test(token))return answer(404,{error:'공유가 종료되었거나 없는 스쿼드입니다.'});
  const row=(await db.prepare('SELECT snapshot FROM squad_shares WHERE token=?').get(token));
  return row?answer(200,JSON.parse(row.snapshot)):answer(404,{error:'공유가 종료되었거나 없는 스쿼드입니다.'});
}
export async function handleSquads(db,route,user,input) {
  if(!user)return answer(401,{error:'로그인이 필요합니다.'});
  if(!input||typeof input!=='object'||Array.isArray(input))return answer(400,{error:'입력을 확인해 주세요.'});
  const team=(await db.prepare('SELECT * FROM teams WHERE id=? AND owner_id=?').get(Number(input.teamId)||0,user.id));
  if(!team)return answer(404,{error:'관리할 수 없는 팀입니다.'});
  const enabled=JSON.parse((await db.prepare('SELECT codes FROM team_formations WHERE team_id=?').get(team.id))?.codes||JSON.stringify(['442','4231','433','343','352','4141']));
  if(route==='/api/squads/list')return answer(200,{formations:enabled,squads:(await db.prepare('SELECT id,name,updated_at FROM squads WHERE team_id=? ORDER BY id DESC').all(team.id))});
  if(route==='/api/squads/formations') {
    try {
      const code=String(input.code||'').replace(/[-\s]/g,'');slotsFor(code);
      if(!['add','remove'].includes(input.action))fail('추가 또는 삭제를 선택하세요.');
      const codes=input.action==='add'?[...new Set([...enabled,code])]:enabled.filter(c=>c!==code);
      if(!codes.length||codes.length>30)fail('포메이션은 1~30개로 관리하세요.');
      (await db.prepare('INSERT INTO team_formations VALUES(?,?) ON CONFLICT(team_id) DO UPDATE SET codes=excluded.codes').run(team.id,JSON.stringify(codes)));
      return answer(200,{formations:codes});
    }catch(error){if(error.code)throw error;return answer(400,{error:error.message});}
  }
  if(route==='/api/squads/analysis')return answer(200,(await analyze(db,team.id)));
  const existing=input.squadId?(await db.prepare('SELECT * FROM squads WHERE id=? AND team_id=?').get(Number(input.squadId)||0,team.id)):null;
  if(input.squadId&&!existing)return answer(404,{error:'이 팀의 스쿼드가 아닙니다.'});
  const outcomes=existing?(await db.prepare('SELECT quarter,outcome FROM squad_outcomes WHERE squad_id=? ORDER BY quarter').all(existing.id)):[];
  if(route==='/api/squads/load')return existing?answer(200,{id:existing.id,config:JSON.parse(existing.config),result:existing.result?JSON.parse(existing.result):null,outcomes}):answer(404,{error:'스쿼드를 선택해 주세요.'});
  if(route==='/api/squads/outcomes') {
    if(!existing?.result||!Array.isArray(input.outcomes)||input.outcomes.length!==JSON.parse(existing.result).quarters.length)return answer(400,{error:'쿼터별 경기 결과를 확인하세요.'});
    const response=await db.transaction(async()=>{
      for(let qi=0;qi<input.outcomes.length;qi++){
        const result=await handleSquads(db,'/api/squads/outcome',user,{teamId:team.id,squadId:existing.id,quarter:qi,outcome:input.outcomes[qi]});
        if(result.status!==200)return result;
      }
      return answer(200,{});
    });
    return response.status===200?answer(200,{outcomes:await db.prepare('SELECT quarter,outcome FROM squad_outcomes WHERE squad_id=? ORDER BY quarter').all(existing.id)}):response;
  }
  if(route==='/api/squads/outcome') {
    if(!existing?.result)return answer(400,{error:'배치 결과를 먼저 저장하세요.'});
    const config=JSON.parse(existing.config),result=JSON.parse(existing.result),qi=input.quarter;
    if(!Number.isInteger(qi)||qi<0||qi>=result.quarters.length||!['win','draw','loss','clear'].includes(input.outcome))return answer(400,{error:'쿼터와 승·무·패를 확인하세요.'});
    if(input.outcome==='clear')(await db.prepare('DELETE FROM squad_outcomes WHERE squad_id=? AND quarter=?').run(existing.id,qi));
    else {
      const q=result.quarters[qi],people=new Map(config.players.map(p=>[p.key,p]));
      const lineups=q.halves.map(half=>half.flatMap((key,i)=>key?[{id:people.get(key).id??null,name:people.get(key).name,position:slotsFor(q.formation)[i].pos,weight:0.5}]:[]));
      const snapshot={formation:q.formation,tacticId:config.quarters[qi].tacticId,tacticName:q.tacticName,tacticConcept:config.quarters[qi].tactic?.concept||'',tacticTraits:config.quarters[qi].tactic?.traits||'',lineups,players:lineups.flat()};
      (await db.prepare('INSERT INTO squad_outcomes VALUES(?,?,?,?) ON CONFLICT(squad_id,quarter) DO UPDATE SET outcome=excluded.outcome,snapshot=excluded.snapshot').run(existing.id,qi,input.outcome,JSON.stringify(snapshot)));
    }
    return answer(200,{outcomes:(await db.prepare('SELECT quarter,outcome FROM squad_outcomes WHERE squad_id=? ORDER BY quarter').all(existing.id))});
  }
  if(route==='/api/squads/share'){
    if(!existing?.result)return answer(400,{error:'배치 결과를 저장한 뒤 공유해 주세요.'});
    const token=randomBytes(24).toString('hex');
    await db.transaction(async()=>{
      await db.prepare('DELETE FROM squad_shares WHERE squad_id=?').run(existing.id);
      await db.prepare('INSERT INTO squad_shares VALUES(?,?,?)').run(token,existing.id,JSON.stringify(publicSnapshot(existing)));
    });
    return answer(200,{path:'/share/'+token});
  }
  if(route==='/api/squads/unshare'){if(existing)(await db.prepare('DELETE FROM squad_shares WHERE squad_id=?').run(existing.id));return answer(200,{ok:true});}
  if(!['/api/squads/save','/api/squads/generate'].includes(route))return answer(404,{error:'찾을 수 없는 요청입니다.'});
  try {
    if(outcomes.length)fail('경기 결과가 기록된 스쿼드는 배치를 변경할 수 없습니다. 각 쿼터의 결과를 미입력으로 되돌린 뒤 수정하세요.');
    const teamState=await state(db,user,team.id);
    const config=normalize(input.config,teamState,enabled);
    if(!config.players.length)fail('참석 선수를 한 명 이상 선택해 주세요.');
    const records=await db.prepare('SELECT o.* FROM squad_outcomes o JOIN squads s ON s.id=o.squad_id WHERE s.team_id=?').all(team.id);
    const history=buildHistory(records);
    const result=route.endsWith('/generate')?generate(config.players,config.quarters,config.mode,teamState.customFields,teamState.basicFields,history.recordedQuarters?history:null):input.result?validResult(input.result,config):null;
    let id=existing?.id;
    if(id)(await db.prepare('UPDATE squads SET name=?,config=?,result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(config.name,JSON.stringify(config),result?JSON.stringify(result):null,id));
    else id=Number((await db.prepare('INSERT INTO squads(team_id,name,config,result) VALUES(?,?,?,?)').run(team.id,config.name,JSON.stringify(config),result?JSON.stringify(result):null)).lastInsertRowid);
    return answer(200,{id,config,result});
  }catch(error){if(error.code)throw error;return answer(400,{error:error.message});}
}
