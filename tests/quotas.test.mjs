import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assignQuota,clampQuotas,quotaSummary} from '../public/squad-engine.js';
import {DatabaseSync} from 'node:sqlite';
import {initializeTeams} from '../teams.mjs';
import {initializeSquads,handleSquads} from '../squads.mjs';

test('changed player gets the remaining quota; GK excluded; half units and variable quarters',()=>{
  const field=Array.from({length:16},(_,i)=>({quota:i<12?2.5:2,keeper:false}));
  assert.equal(quotaSummary(field,4).assigned,38);
  const final={quota:0,keeper:false},gk={quota:4,keeper:true},people=[...field,gk,final];
  assert.deepEqual(assignQuota(people,final,3,4),{quota:2,adjusted:true});assert.equal(quotaSummary(people,4).assigned,40);
  assignQuota(people,field[0],2,4);assert.deepEqual(assignQuota(people,final,3,4),{quota:2.5,adjusted:true});
  assert.equal(gk.quota,4);assert.equal(quotaSummary(people,4).remaining,0);
  assert.equal(clampQuotas(people,3),true);assert.ok(quotaSummary(people,3).assigned<=30);
  const fair=quotaSummary([{quota:0,keeper:false},{quota:4,keeper:true}],4,'fair');assert.equal(fair.assigned,4);
  assert.equal(quotaSummary([{quota:4,keeper:true}],4,'fair').assigned,0);
});

test('backend prevents overbooking and infers GK from authoritative primary position',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO users VALUES(1,'a@example.com');");initializeTeams(db);initializeSquads(db);
    db.exec("INSERT INTO teams(id,owner_id,name,color) VALUES(1,1,'A','#123456');INSERT INTO players VALUES(1,1,'필드'),(2,1,'키퍼');INSERT INTO player_profiles(player_id,positions) VALUES(1,'[\"CF\"]'),(2,'[\"GK\",\"CB\"]');");
    const config={name:'출전량',quarters:[{formation:'442',tacticId:null}],mode:'individual',attendees:[{playerId:1,quota:1,keeper:true},{playerId:2,quota:1,keeper:false}],guests:Array.from({length:10},(_,i)=>({key:'g:'+i,name:'용병'+i,positions:['CF'],quota:1,keeper:true}))};
    const call=config=>handleSquads(db,'/api/squads/generate',{id:1},{teamId:1,config});
    assert.equal(call(config).status,400);config.guests.pop();const saved=call(config);assert.equal(saved.status,200);
    assert.equal(saved.body.config.players[0].keeper,false);assert.equal(saved.body.config.players[1].keeper,true);
    assert.equal(saved.body.config.players.filter(p=>!p.keeper).reduce((n,p)=>n+p.quota,0),10);
  }finally{db.close();}
});
