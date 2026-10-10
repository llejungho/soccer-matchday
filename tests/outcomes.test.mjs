import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initializeTeams} from '../teams.mjs';
import {initializeSquads,handleSquads,sharedSquad} from '../squads.mjs';
import {slotsFor,generate} from '../public/squad-engine.js';

test('custom 532 geometry, formation isolation and historical preservation',()=>{
  const slots=slotsFor('532');assert.equal(slots.length,11);assert.equal(slots.filter(s=>s.y===74).length,5);assert.equal(slots.filter(s=>s.pos==='GK').length,1);
  for(const code of ['541','451','4312','4123'])assert.equal(slotsFor(code).length,11);
  for(const code of ['999','__proto__','443','0','123456'])assert.throws(()=>slotsFor(code));
  const players=slots.map((s,i)=>({key:'p:'+i,id:i,name:'선수'+i,positions:[s.pos],keeper:s.pos==='GK',quota:1,ratings:{},chemistry:{good:[],bad:[]}}));
  const plan=generate(players,[{formation:'532',tactic:null}],'fair');assert.equal(plan.warnings.length,0);
  for(const half of plan.quarters[0].halves)half.forEach((key,i)=>assert.equal(players.find(p=>p.key===key).positions[0],slots[i].pos));
});

test('quarter outcomes preserve saved layouts, weighted rates, ownership and privacy',()=>{
  const db=new DatabaseSync(':memory:');try {
    db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO users VALUES(1,'a@example.com'),(2,'b@example.com');");initializeTeams(db);initializeSquads(db);
    db.exec("INSERT INTO teams(id,owner_id,name,color) VALUES(1,1,'A','#123456'),(2,2,'B','#123456');INSERT INTO players VALUES(1,1,'우리선수');");
    const call=(route,input={},userId=1,teamId=1)=>handleSquads(db,'/api/squads/'+route,{id:userId},{teamId,...input});
    assert.equal(call('formations',{action:'add',code:'5-3-2'}).status,200);
    assert.ok(call('list',{},2,2).body.formations.every(c=>c!=='532'));
    assert.equal(call('formations',{action:'add',code:'999'}).status,400);
    const config={name:'통계',mode:'fair',quarters:[{formation:'532',tacticId:null},{formation:'532',tacticId:null}],attendees:[{playerId:1,quota:2,keeper:false}],guests:[{key:'g:test',name:'용병',positions:['GK'],keeper:true,quota:2}]};
    const saved=call('generate',{config});assert.equal(saved.status,200);const squadId=saved.body.id;
    assert.equal(call('outcome',{squadId,quarter:0,outcome:'win'},2).status,404);
    assert.equal(call('outcome',{squadId,quarter:8,outcome:'win'}).status,400);
    assert.equal(call('outcome',{squadId,quarter:0,outcome:'win'}).status,200);
    assert.equal(call('outcome',{squadId,quarter:1,outcome:'draw'}).status,200);
    // Re-recording replaces the outcome rather than adding another observation.
    call('outcome',{squadId,quarter:0,outcome:'loss'});call('outcome',{squadId,quarter:0,outcome:'win'});
    const analysis=call('analysis').body;assert.equal(analysis.recordedQuarters,2);assert.equal(analysis.formations[0].winRate,50);
    assert.equal(analysis.players.reduce((n,p)=>n+p.total,0),2);assert.equal(analysis.combinations.reduce((n,p)=>n+p.total,0),2);assert.ok(analysis.players.every(p=>!p.label.includes('용병')));
    assert.equal(call('analysis',{},2,2).body.recordedQuarters,0);
    assert.equal(call('save',{squadId,config,result:saved.body.result}).status,400);
    assert.equal(call('generate',{squadId,config}).status,400);
    const share=call('share',{squadId});const data=sharedSquad(db,share.body.path.split('/').pop()).body;assert.ok(!JSON.stringify(data).includes('outcome'));
    call('formations',{action:'remove',code:'532'});assert.equal(call('load',{squadId}).body.result.quarters[0].formation,'532');assert.equal(call('analysis').body.recordedQuarters,2);
    call('outcome',{squadId,quarter:0,outcome:'clear'});call('outcome',{squadId,quarter:1,outcome:'clear'});assert.equal(call('analysis').body.recordedQuarters,0);
    assert.equal(call('outcomes',{squadId,outcomes:['win','bad']}).status,400);assert.equal(call('analysis').body.recordedQuarters,0);
    assert.equal(call('outcomes',{squadId,outcomes:['win','loss']}).status,200);assert.equal(call('analysis').body.recordedQuarters,2);
    call('outcomes',{squadId,outcomes:['clear','clear']});
    call('formations',{action:'add',code:'532'});assert.equal(call('save',{squadId,config,result:saved.body.result}).status,200);
  }finally{db.close();}
});
