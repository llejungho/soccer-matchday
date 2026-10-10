import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initializeTeams,handleTeams} from '../teams.mjs';
import {initializeSquads,handleSquads,sharedSquad} from '../squads.mjs';
import {generate,totals,slotsFor,tacticWeights} from '../public/squad-engine.js';
const quarters=Array.from({length:4},()=>({formation:'442',tactic:null,tacticId:null}));
const player=(id,pos,keeper=false,quota=2.5)=>({id,key:'p:'+id,name:'선수 '+id,positions:[pos],keeper,quota,ratings:{stamina:5,aggression:4},chemistry:{good:[],bad:[]},customRatings:{}});
test('explicit selected criteria retain their priority after renaming and ignore deleted criteria',()=>{
  const fields=[{basicKey:'stamina',name:'활동량'},{id:9,name:'멘탈'}];
  assert.deepEqual(tacticWeights({name:'전방 압박',ratingFields:['stamina','custom:9']},fields),{stamina:4,'custom:9':4});
  assert.deepEqual(tacticWeights({ratingFields:['stamina','custom:9']},fields.slice(0,1)),{stamina:4});
});
test('half-quarter quotas, fair allocation, keeper separation and no simultaneous duplicates',()=>{
  const players=Array.from({length:16},(_,i)=>player(i+1,['CF','CM','CB','LWB','RWB'][i%5]));players.push(player(17,'GK',true,4));
  const plan=generate(players,quarters,'individual');assert.ok(!plan.warnings.some(w=>w.includes('빈')||w.includes('요청')));
  for(const p of totals(plan.quarters,players))assert.equal(p.actual,p.quota);
  for(const q of plan.quarters)for(const half of q.halves){assert.equal(new Set(half).size,11);assert.equal(half[10],'p:17');}
  const fair=generate(players,quarters,'fair');const field=totals(fair.quarters,players).filter(p=>!p.keeper);
  assert.equal(field.reduce((sum,p)=>sum+p.actual,0),40);assert.ok(Math.max(...field.map(p=>p.actual))-Math.min(...field.map(p=>p.actual))<=0.5);
  const insufficient=generate([player(1,'CF',false,2)],quarters,'individual');assert.ok(insufficient.warnings.length);assert.equal(totals(insufficient.quarters,[player(1,'CF')])[0].actual,2);
});
test('exact position preferences and weighted tactic ratings',()=>{
  const players=slotsFor('442').map((s,i)=>player(i+1,s.pos,s.pos==='GK',4));
  const plan=generate(players,quarters,'fair');
  for(const q of plan.quarters)for(const half of q.halves)half.forEach((key,i)=>assert.equal(players.find(p=>p.key===key).positions[0],slotsFor('442')[i].pos));
  const weightedPlayers=[...players.map(p=>({...p,quota:1,ratings:{stamina:5,aggression:5,defense:1}})),...players.map(p=>({...p,id:p.id+11,key:'p:'+(p.id+11),quota:1,ratings:{stamina:1,aggression:1,defense:5}}))];
  const weighted=generate(weightedPlayers,[{formation:'442',tactic:{name:'전방압박',traits:'체력과 적극성'}},{formation:'442',tactic:{name:'수비',traits:'수비력'}}],'individual');
  for(const half of weighted.quarters[0].halves)for(const key of half)assert.ok(Number(key.slice(2))<=11);
  for(const half of weighted.quarters[1].halves)for(const key of half)assert.ok(Number(key.slice(2))>11);
});
test('squad ownership, persistence, manual validation and sanitized share snapshots',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO users VALUES(1,'a@example.com'),(2,'b@example.com');");initializeTeams(db);initializeSquads(db);
    db.exec("INSERT INTO teams(id,owner_id,name,color) VALUES(1,1,'A','#123456'),(2,2,'B','#123456');INSERT INTO players VALUES(1,1,'우리선수'),(2,2,'다른팀');");
    db.exec("INSERT INTO player_profiles(player_id,positions,comment) VALUES(1,'[\"CF\"]','비공개 평가');");
    const config={name:'정기경기',quarters:[{formation:'442',tacticId:null}],attendees:[{playerId:1,quota:1,keeper:false}],guests:[{key:'g:test',name:'용병',positions:['GK'],quota:1,keeper:true}],mode:'fair'};
    const call=(route,input={},userId=1)=>handleSquads(db,'/api/squads/'+route,{id:userId},{teamId:1,...input});
    assert.equal(call('generate',{config},2).status,404);
    assert.equal(call('generate',{config:{...config,attendees:[{playerId:2,quota:1,keeper:false}]}}).status,400);
    assert.equal(call('generate',{config:{...config,quarters:[{formation:'bad',tacticId:null}]}}).status,400);
    const saved=call('generate',{config});assert.equal(saved.status,200);const id=saved.body.id;
    assert.equal(call('load',{squadId:id}).body.config.guests[0].name,'용병');
    assert.equal(call('load',{squadId:id},2).status,404);
    const invalid=structuredClone(saved.body.result);invalid.quarters[0].halves[0][1]='p:1';invalid.quarters[0].halves[0][0]='p:1';
    assert.equal(call('save',{squadId:id,config,result:invalid}).status,400);
    saved.body.result.quarters[0].setPieces={corner:['p:1',null],freeKick:['g:test',null],penalty:['p:1']};
    assert.equal(call('save',{squadId:id,config,result:saved.body.result}).status,200);
    assert.deepEqual(call('load',{squadId:id}).body.result.quarters[0].setPieces.penalty,['p:1']);
    const shared=call('share',{squadId:id});const token=shared.body.path.split('/').pop();const publicData=sharedSquad(db,token);
    assert.equal(publicData.status,200);assert.equal(publicData.body.quarters[0].halves[0][10],'용병');
    assert.deepEqual(publicData.body.quarters[0].setPieces.penalty,['우리선수']);
    assert.ok(!JSON.stringify(publicData.body).includes('ratings'));assert.ok(!JSON.stringify(publicData.body).includes('comment'));assert.ok(!JSON.stringify(publicData.body).includes('chemistry'));
    call('save',{squadId:id,config:{...config,name:'변경'},result:saved.body.result});assert.equal(sharedSquad(db,token).body.name,'정기경기');
    call('unshare',{squadId:id});assert.equal(sharedSquad(db,token).status,404);
    handleTeams(db,'/api/teams/transfer/send',{id:1},{teamId:1,email:'b@example.com'});
    const transferId=handleTeams(db,'/api/teams/state',{id:2},{}).body.incoming[0].id;
    handleTeams(db,'/api/teams/transfer/respond',{id:2},{transferId,decision:'accept'});
    assert.equal(call('load',{squadId:id}).status,404);
    assert.equal(call('load',{squadId:id},2).body.config.players[0].comment,'');
  }finally{db.close();}
});


test('availability excludes late, early, absent and guest keepers in both allocation modes',()=>{
  const players=Array.from({length:14},(_,i)=>player(i+1,['CF','CM','CB'][i%3],false,2));
  players[0].availableQuarters=[2,3];players[1].availableQuarters=[0,1];players[2].availableQuarters=[];players[2].quota=0;
  players.push({...player(20,'GK',true,2),key:'g:early',availableQuarters:[0,1]}, {...player(21,'GK',true,2),key:'g:late',availableQuarters:[2,3]});
  for(const mode of ['individual','fair']){
    const plan=generate(players,quarters,mode);
    plan.quarters.forEach((q,qi)=>q.halves.forEach(half=>half.filter(Boolean).forEach(key=>assert.ok((players.find(p=>p.key===key).availableQuarters??[0,1,2,3]).includes(qi)))));
    assert.equal(totals(plan.quarters,players).find(p=>p.id===3).actual,0);
    for(const q of plan.quarters.slice(0,2))assert.deepEqual(q.halves[0],q.halves[1]);
    for(let qi=0;qi<4;qi++)assert.equal(plan.quarters[qi].halves[0][10],qi<2?'g:early':'g:late');
  }
});

test('API persists availability and rejects unavailable manual assignments and invalid indices',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO users VALUES(1,'test@example.com');");initializeTeams(db);initializeSquads(db);
 db.exec("INSERT INTO teams(id,owner_id,name,color) VALUES(1,1,'A','#123456');INSERT INTO players VALUES(1,1,'선수');INSERT INTO player_profiles(player_id,positions) VALUES(1,'[\"CF\"]');");
 const config={name:'참석 테스트',quarters:quarters.map(q=>({formation:q.formation,tacticId:null})),attendees:[{playerId:1,quota:2,keeper:false,availableQuarters:[2,3]}],guests:[],mode:'individual'};
 const call=(route,input)=>handleSquads(db,'/api/squads/'+route,{id:1},{teamId:1,...input});
 const saved=call('generate',{config});assert.equal(saved.status,200);assert.deepEqual(call('load',{squadId:saved.body.id}).body.config.attendees[0].availableQuarters,[2,3]);
 const bad=structuredClone(saved.body.result);bad.quarters[0].halves[0][0]='p:1';assert.equal(call('save',{squadId:saved.body.id,config,result:bad}).status,400);
 for(const availableQuarters of [[4],[-1],[1,1],['1']])assert.equal(call('generate',{config:{...config,attendees:[{...config.attendees[0],availableQuarters}]}}).status,400);
 }finally{db.close();}
});
