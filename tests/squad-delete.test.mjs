import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleSquads as local,sharedSquad as localShare} from '../squads.mjs';
import {handleSquads as remote,sharedSquad as remoteShare} from '../cloudflare/squads.mjs';
import {Database} from '../cloudflare/database.mjs';
import {migratedDatabase,bindingFor} from './helper-database.mjs';
for(const runtime of ['SQLite','D1'])test(runtime+' deletes owned squad, share and outcomes atomically without touching another squad',async()=>{
 const sqlite=migratedDatabase(),fresh=async()=>runtime==='SQLite'?sqlite:await new Database(bindingFor(sqlite)).start();
 const call=async(route,input={},id=1)=>(runtime==='SQLite'?local:remote)(await fresh(),'/api/squads/'+route,{id},{teamId:1,...input});
 try{
  sqlite.exec("INSERT INTO users(id,email,nickname,nickname_key,password_hash,salt) VALUES(1,'a@test.com','A','a','',''),(2,'b@test.com','B','b','','');INSERT INTO teams(id,owner_id,name,color) VALUES(1,1,'A','#123456'),(2,2,'B','#123456');");
  const config={name:'삭제 대상',quarters:[{formation:'442',tacticId:null}],attendees:[],guests:[{key:'g:test',name:'테스트 용병',positions:['CF'],keeper:false,quota:1}],mode:'fair'};
  const target=await call('generate',{config}),other=await call('generate',{config:{...config,name:'보존 대상'}});assert.equal(target.status,200);
  const id=target.body.id,share=await call('share',{squadId:id}),token=share.body.path.split('/').at(-1);
  assert.equal((await call('outcomes',{squadId:id,outcomes:['win']})).status,200);
  assert.equal((await call('analysis')).body.recordedQuarters,1);
  assert.equal((await call('delete',{squadId:id},2)).status,404);
  assert.equal((await call('delete',{})).status,400);
  sqlite.exec("CREATE TRIGGER prevent_squad_delete BEFORE DELETE ON squads BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  await assert.rejects(()=>call('delete',{squadId:id}),/test rollback/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM squad_shares WHERE squad_id=?').get(id).n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM squad_outcomes WHERE squad_id=?').get(id).n,1);
  sqlite.exec('DROP TRIGGER prevent_squad_delete');
  assert.equal((await call('delete',{squadId:id})).status,200);
  assert.equal((await call('load',{squadId:id})).status,404);
  assert.equal((await (runtime==='SQLite'?localShare:remoteShare)(await fresh(),token)).status,404);
  assert.equal((await call('analysis')).body.recordedQuarters,0);
  assert.equal((await call('load',{squadId:other.body.id})).status,200);
  assert.equal((await call('delete',{squadId:id})).status,404);
 }finally{sqlite.close();}
});
