import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initializeTeams,handleTeams} from '../teams.mjs';
import {generate,slotsFor} from '../public/squad-engine.js';
test('default ratings are editable, deletable, persistent and isolated per team',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO users VALUES(1,'a@example.com'),(2,'b@example.com');");initializeTeams(db);
    db.exec("INSERT INTO teams(id,owner_id,name,color) VALUES(1,1,'A','#123456'),(2,2,'B','#123456');INSERT INTO players VALUES(1,1,'선수');INSERT INTO player_profiles(player_id,stamina,overall) VALUES(1,5,4);");
    const call=(route,input={},userId=1)=>handleTeams(db,'/api/teams/'+route,{id:userId},{teamId:1,...input});
    assert.equal(call('state').body.basicFields.length,5);
    assert.equal(call('ratings/update',{builtinKey:'stamina',name:'멘탈'},2).status,404);
    assert.equal(call('ratings/update',{builtinKey:'stamina',name:'적극성'}).status,409);
    let next=call('ratings/update',{builtinKey:'stamina',name:'멘탈'});assert.equal(next.status,200);assert.equal(next.body.players[0].ratings.stamina,5);
    assert.equal(next.body.basicFields.find(f=>f.key==='stamina').name,'멘탈');
    assert.equal(call('ratings/delete',{builtinKey:'bad'}).status,400);
    assert.equal(call('ratings/update',{builtinKey:'stamina',fieldId:1,name:'잘못된 요청'}).status,400);
    assert.equal(call('ratings/add',{builtinKey:'stamina',name:'잘못된 요청'}).status,400);
    assert.equal(call('ratings/delete',{builtinKey:'stamina'}).status,200);assert.equal(call('state').body.players[0].ratings.stamina,null);
    initializeTeams(db);assert.ok(!call('state').body.basicFields.some(f=>f.key==='stamina'));
    assert.equal(call('state',{},2).body.basicFields.length,5);
    assert.equal(call('ratings/add',{name:'체력'}).status,200);
    assert.equal(call('ratings/delete',{builtinKey:'stamina'}).status,404);
    for(const key of ['aggression','attack','defense','overall'])assert.equal(call('ratings/delete',{builtinKey:key}).status,200);
    assert.equal(call('state').body.basicFields.length,0);
  }finally{db.close();}
});
test('renamed and deleted default criteria follow current team definitions in squad scoring',()=>{
  const base=slotsFor('442').map((s,i)=>({key:'a'+i,name:'A'+i,positions:[s.pos],keeper:s.pos==='GK',quota:1,ratings:{stamina:5,aggression:5,overall:5},chemistry:{good:[],bad:[]}}));
  const other=base.map((p,i)=>({...p,key:'b'+i,name:'B'+i,ratings:{stamina:1,aggression:1,overall:1}}));
  const quarters=[{formation:'442',tactic:{name:'멘탈'}},{formation:'442',tactic:{name:'기본'}}];
  const plan=generate([...other,...base],quarters,'individual',[],[{key:'stamina',name:'멘탈'}]);
  assert.ok(plan.quarters[0].halves.flat().every(key=>key.startsWith('a')));
  const cleared=generate([...other,...base],quarters,'individual',[],[]);
  assert.ok(cleared.quarters[0].halves.flat().every(key=>key.startsWith('b')));
  assert.ok(!cleared.quarters[0].reason.includes('멘탈 평가'));
});
