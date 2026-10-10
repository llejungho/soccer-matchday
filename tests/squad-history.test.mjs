import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generate,slotsFor,totals} from '../public/squad-engine.js';
import {buildHistory,historyAnalysis,historyScore} from '../public/squad-history.js';
const player=(id,pos,quota)=>({id,key:'p:'+id,name:'선수'+id,positions:[pos],keeper:pos==='GK',quota,ratings:{},customRatings:{},chemistry:{good:[],bad:[]}});
test('first two quarters stay full while 2.5 quotas are fulfilled in later quarters',()=>{
  const players=Array.from({length:16},(_,i)=>player(i+1,'CM',2.5));players.push(player(17,'GK',4));
  const plan=generate(players,Array.from({length:4},()=>({formation:'442',tactic:null})),'individual');
  for(const q of plan.quarters.slice(0,2))assert.deepEqual(q.halves[0],q.halves[1]);
  assert.ok(plan.quarters.slice(2).some(q=>q.halves[0].some((p,i)=>p!==q.halves[1][i])));
  for(const p of totals(plan.quarters,players))assert.equal(p.actual,p.quota);
});
test('fair distribution fills all available slots with full early quarters across attendance sizes',()=>{
  for(const count of [10,11,12,16,20,27,40,80])for(const quarterCount of [1,2,3,4,5]){
    const players=Array.from({length:count},(_,i)=>player(i+1,'CM',2));players.push(player(1000,'GK',quarterCount));
    const plan=generate(players,Array.from({length:quarterCount},()=>({formation:'442',tactic:null})),'fair');
    for(const q of plan.quarters.slice(0,2))assert.deepEqual(q.halves[0],q.halves[1]);
    const appearances=totals(plan.quarters,players).filter(p=>!p.keeper).map(p=>p.actual);
    assert.equal(appearances.reduce((sum,n)=>sum+n,0),quarterCount*10,`${count} attendees / ${quarterCount} quarters`);
    assert.ok(Math.max(...appearances)-Math.min(...appearances)<=1,`${count}/${quarterCount} fairness`);
  }
});
test('impossible half-quarter quotas in early-only matches are explicit and do not introduce halves',()=>{
  const plan=generate([player(1,'CF',0.5)],[{formation:'442',tactic:null}],'individual');
  assert.deepEqual(plan.quarters[0].halves[0],plan.quarters[0].halves[1]);assert.ok(plan.warnings.some(w=>w.includes('요청 0.5')));
});
test('recorded contextual wins affect lineup choices, retain sample counts and ignore edited tactics',()=>{
  const press={id:1,name:'압박',concept:'전방압박',traits:'체력'},counter={id:2,name:'역습',concept:'수비후 역습',traits:'수비력'};
  const winners=slotsFor('442').map((slot,i)=>player(i+1,slot.pos,1)),losers=slotsFor('442').map((slot,i)=>player(i+20,slot.pos,1));
  function snapshot(group){const lineups=[0,1].map(()=>group.map((p,i)=>({id:p.id,name:p.name,position:slotsFor('442')[i].pos,weight:0.5})));return {formation:'442',tacticId:1,tacticName:press.name,tacticConcept:press.concept,tacticTraits:press.traits,lineups,players:lineups.flat()};}
  const records=Array.from({length:6},()=>[{outcome:'win',snapshot:JSON.stringify(snapshot(winners))},{outcome:'loss',snapshot:JSON.stringify(snapshot(losers))}]).flat();
  const history=buildHistory(records),quarters=[{formation:'442',tactic:press},{formation:'442',tactic:counter}];
  const plan=generate([...losers,...winners],quarters,'individual',[],[],history);
  assert.ok(plan.quarters[0].halves[0].every(key=>winners.some(p=>p.key===key)));
  assert.ok(plan.quarters[0].reason.includes('100%'));assert.ok(plan.quarters[0].reason.includes('예상 승률은 아닙니다'));
  const stats=historyAnalysis(records);assert.equal(stats.recordedQuarters,12);assert.equal(stats.contexts[0].total,12);assert.equal(stats.lineups[0].total,6);assert.equal(stats.lineups[0].winRate,100);
  const current=historyScore(history,winners[0],'CF',quarters[0]);const edited=historyScore(history,winners[0],'CF',{formation:'442',tactic:{...press,traits:'멘탈'}});assert.ok(current>edited);
  assert.equal(historyScore(buildHistory(records.slice(0,1)),winners[0],'CF',quarters[0]),0);
});
