import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleAccount} from '../account.mjs';
import {handleSocial} from '../social-auth.mjs';
import {Database} from '../cloudflare/database.mjs';
import {asyncDatabase} from '../local-database.mjs';
import worker from '../cloudflare/worker.mjs';
import {migratedDatabase,bindingFor} from './helper-database.mjs';
for(const runtime of ['SQLite','D1'])test(runtime+' withdrawal erases owned data atomically; expulsion blocks existing sessions and SNS',async()=>{
 const sql=migratedDatabase();sql.exec('PRAGMA foreign_keys=ON');const binding=bindingFor(sql);const fresh=async()=>runtime==='D1'?await new Database(binding).start():asyncDatabase(sql);
 sql.exec(`INSERT INTO users(id,email,nickname,nickname_key,password_hash,salt) VALUES(1,'llee86@naver.com','관리자','관리자','',''),(2,'member@example.com','회원둘','회원둘','',''),(3,'other@example.com','회원셋','회원셋','','');INSERT INTO teams(id,owner_id,name,color) VALUES(1,2,'삭제팀','#123456'),(2,3,'유지팀','#123456');INSERT INTO players(id,team_id,name) VALUES(1,1,'선수'),(2,2,'다른선수');INSERT INTO player_profiles(player_id) VALUES(1);INSERT INTO player_quota_defaults VALUES(1,2,3);INSERT INTO squads(id,team_id,name,config,result) VALUES(1,1,'경기','{}','{}');INSERT INTO squad_shares VALUES('share',1,'{}');INSERT INTO squad_outcomes VALUES(1,1,'win','{}');INSERT INTO board_posts(board,author_id,title,content) VALUES('free',2,'남는글','내용'),('notices',1,'공지','안내');INSERT INTO board_comments(post_id,author_id,content) VALUES(1,2,'댓글');INSERT INTO social_identities VALUES('naver','subject',2);`);
 const admin=sql.prepare('SELECT * FROM users WHERE id=1').get(),member=sql.prepare('SELECT * FROM users WHERE id=2').get();const call=async(path,user,input)=>handleAccount(await fresh(),'/api/account/'+path,user,input);
 try{
  assert.equal((await call('admin-status',member,{userId:3,status:'banned'})).status,403);
  assert.equal((await call('admin-status',admin,{userId:1,status:'banned'})).status,403);
  const session='e'.repeat(64);sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),2,Date.now()+60000);
  assert.equal((await call('admin-status',admin,{userId:2,status:'banned'})).status,200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  // A stale session cannot reach protected routes even if reintroduced.
  sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),2,Date.now()+60000);
  assert.equal((await (await worker.fetch(new Request('https://test.pages.dev/api/me',{headers:{cookie:'session='+session}}),{DB:binding})).json()).user,null);
  const token='f'.repeat(64);sql.prepare('INSERT INTO oauth_pending VALUES(?,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'naver','subject',member.email,Date.now()+60000);
  assert.equal((await handleSocial(await fresh(),new Request('https://test.pages.dev/api/social/finish',{headers:{cookie:'oauth_pending='+token}}),{},null,{action:'login'})).status,403);
  assert.equal((await call('admin-status',admin,{userId:2,status:'active'})).status,200);
  assert.equal((await call('withdraw',member,{email:member.email,confirmation:'wrong'})).status,400);
  assert.equal((await call('withdraw',admin,{email:admin.email,confirmation:'회원탈퇴'})).status,403);
  assert.equal((await call('withdraw',member,{email:member.email,confirmation:'회원탈퇴'})).status,200);
  const tombstone=sql.prepare('SELECT * FROM users WHERE id=2').get();assert.equal(tombstone.status,'withdrawn');assert.notEqual(tombstone.email,member.email);assert.equal(tombstone.nickname,'탈퇴회원');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM teams').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM players').get().n,1);
  for(const table of ['squads','squad_shares','squad_outcomes','sessions','social_identities','oauth_pending'])assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM board_posts').get().n,2);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM board_comments').get().n,1);
  assert.equal((await call('admin-users',admin,{})).body.users.length,2);
 }finally{sql.close();}
});
