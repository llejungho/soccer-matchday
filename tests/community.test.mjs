import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleCommunity,initializeCommunity,nicknameError,nicknameKey} from '../community.mjs';
import {defaultQuotas} from '../public/quota-defaults.js';
import {initializeEnhancements} from '../enhancements.mjs';
test('legacy nicknames, reserved admin name, ownership and administrator moderation',async()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001_initial.sql','utf8'));
  const insert=db.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)');insert.run(1,'llee86@naver.com','hash','salt');insert.run(2,'a@test.com','hash','salt');insert.run(3,'b@test.com','hash','salt');
  initializeCommunity(db);initializeCommunity(db);initializeEnhancements(db);
  const admin=db.prepare('SELECT * FROM users WHERE id=1').get(),a=db.prepare('SELECT * FROM users WHERE id=2').get(),b=db.prepare('SELECT * FROM users WHERE id=3').get();assert.equal(admin.nickname,'관리자');assert.equal(a.nickname,'회원2');
  const call=(route,user,input)=>handleCommunity(db,'/api/community/'+route,user,input);
  try {
    assert.equal(nicknameKey(' Ｃoach '),'coach');assert.ok(nicknameError('',a.email));assert.ok(nicknameError('관리자',a.email));
    assert.equal((await call('nickname-check',null,{email:a.email,nickname:'회원2'})).body.available,false);
    assert.equal((await call('post-save',null,{board:'free',title:'글',content:'내용'})).status,401);
    assert.equal((await call('post-save',a,{board:'notices',title:'공지',content:'내용'})).status,403);
    const notice=(await call('post-save',admin,{board:'notices',title:'공지',content:'안내'})).body.postId;
    const id=(await call('post-save',a,{board:'free',title:'제목',content:'<script>alert(1)</script>'})).body.postId;
    assert.equal((await call('post',a,{postId:id,view:true})).body.post.views,1);
    assert.equal((await call('post',a,{postId:id,view:true})).body.post.views,1);
    assert.equal((await call('post',b,{postId:id,view:true})).body.post.views,2);
    assert.equal((await call('recommend',null,{postId:id})).status,401);
    assert.equal((await call('recommend',a,{postId:id})).body.recommendations,1);
    assert.equal((await call('recommend',b,{postId:id})).body.recommendations,2);
    assert.equal((await call('recommend',a,{postId:id})).body.recommendations,1);
    const initial=await call('post',b,{postId:id});assert.equal(initial.body.post.nickname,'회원2');assert.equal(initial.body.post.canManage,false);assert.ok(!JSON.stringify(initial).includes('a@test.com'));
    for(const route of ['post-save','post-delete'])assert.equal((await call(route,b,{postId:id,title:'변조',content:'변조'})).status,403);
    assert.equal((await call('post-save',a,{postId:id,title:'내 글 수정',content:'내용'})).status,200);
    assert.equal((await call('comment-save',b,{postId:notice,content:'공지 댓글'})).status,201);
    assert.equal((await call('comment-save',b,{postId:id,content:'다른 회원 댓글'})).status,201);
    const comment=(await call('post',a,{postId:id})).body.comments[0];assert.equal(comment.canManage,false);
    assert.equal((await call('comment-save',a,{commentId:comment.id,content:'변조'})).status,403);
    assert.equal((await call('comment-delete',a,{commentId:comment.id})).status,403);
    assert.equal((await call('comment-save',b,{commentId:comment.id,content:'내 댓글 수정'})).status,200);
    assert.equal((await call('comment-save',admin,{commentId:comment.id,content:'운영자 수정'})).status,200);
    assert.equal((await call('post-save',admin,{postId:id,title:'관리자 수정',content:'관리자 내용'})).status,200);
    assert.equal((await call('post-delete',admin,{postId:id})).status,200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM board_comments WHERE post_id=?').get(id).n,0);
    assert.equal((await call('post-delete',a,{postId:notice})).status,403);
    db.prepare("INSERT INTO teams(id,owner_id,name,color) VALUES(1,2,'팀','#123456')").run();db.prepare("INSERT INTO players(id,team_id,name) VALUES(1,1,'선수')").run();
    assert.equal((await call('quota-default',b,{playerId:1,quota:3})).status,404);
    assert.equal((await call('quota-default',a,{playerId:1,quota:3.1})).status,400);
    assert.equal((await call('quota-default',a,{playerId:1,quota:3})).status,200);assert.equal(db.prepare('SELECT quota FROM player_quota_defaults').get().quota,3);
    assert.equal((await call('quota-default',a,{playerId:1,quota:null})).status,200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM player_quota_defaults').get().n,0);
  }finally{db.close();}
});
test('integer initial quotas fill capacity and remembered values take priority',()=>{
  const people=Array.from({length:16},(_,i)=>({playerId:i+1,keeper:false,quota:0}));people.push({playerId:17,keeper:true});
  assert.equal(defaultQuotas(people,4).assigned,40);assert.deepEqual(people.slice(0,16).map(p=>p.quota),[3,3,3,3,3,3,3,3,2,2,2,2,2,2,2,2]);assert.equal(people[16].quota,4);
  const result=defaultQuotas(people,4,{16:3,17:2.5});assert.equal(result.assigned,40);assert.equal(people[15].quota,3);assert.equal(people[16].quota,2.5);
  assert.equal(defaultQuotas(people,4,{1:2.5}).assigned,40);
  for(const count of [1,2,3,6,12]){assert.equal(defaultQuotas(people,count).assigned,count*10);assert.ok(people.every(p=>p.quota<=count));}
  assert.equal(defaultQuotas([{playerId:1,keeper:false}],4).remaining,36);
  const overloaded=Array.from({length:16},(_,i)=>({playerId:i+1,keeper:false}));assert.equal(defaultQuotas(overloaded,4,Object.fromEntries(overloaded.map(p=>[p.playerId,4]))).adjusted,true);assert.equal(overloaded.reduce((s,p)=>s+p.quota,0),40);
});
