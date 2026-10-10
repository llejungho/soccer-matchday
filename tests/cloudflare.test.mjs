import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {scryptSync} from 'node:crypto';
import worker from '../cloudflare/worker.mjs';
import {Database,Conflict} from '../cloudflare/database.mjs';
function bindingFor(sqlite){
  const prepare=(sql,args=[])=>{
    const run=()=>{const stmt=sqlite.prepare(sql);if(stmt.columns().length){const results=stmt.all(...args);return {results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n,last_row_id:sqlite.prepare('SELECT last_insert_rowid() AS n').get().n}};}
      const result=stmt.run(...args);return {results:[],meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}};};
    return {bind:(...values)=>prepare(sql,values),execute:run,first:async()=>run().results[0]||null,all:async()=>run(),run:async()=>run()};
  };
  return {prepare,batch:async(statements)=>{sqlite.exec('BEGIN');try{const results=statements.map(stmt=>stmt.execute());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
test('Cloudflare API preserves legacy login and supports profiles, squads, results, sharing and transfer',async()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/0001_initial.sql','utf8'));
  const binding=bindingFor(sqlite),env={DB:binding,ASSETS:{fetch:async()=>new Response('<html>test</html>',{headers:{'Content-Type':'text/html'}})}};
  const salt='legacy-salt';sqlite.prepare('INSERT INTO users VALUES(1,?,?,?,CURRENT_TIMESTAMP)').run('legacy@example.com',scryptSync('legacy-pass',salt,64).toString('hex'),salt);
  sqlite.exec(readFileSync('migrations/0002_community.sql','utf8'));sqlite.exec(readFileSync('migrations/0003_accounts_boards_tactics.sql','utf8'));sqlite.exec(readFileSync('migrations/0005_account_status.sql','utf8'));
  let cookies={};
  async function call(path,input,who='a'){
    const request=new Request('https://test.pages.dev'+path,{method:input===undefined?'GET':'POST',headers:{origin:'https://test.pages.dev','content-type':'application/json',cookie:cookies[who]||''},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const response=await worker.fetch(request,env);if(response.headers.get('set-cookie'))cookies[who]=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,body:await response.json()};
  }
  try{
    assert.equal((await call('/api/login',{email:'legacy@example.com',password:'legacy-pass'})).status,200);
    assert.equal((await call('/api/signup',{nickname:'감독B',email:'b@example.com',password:'test-pass',confirmPassword:'test-pass'},'b')).status,201);
    assert.equal((await call('/api/signup',{nickname:'감독B',email:'b@example.com',password:'test-pass',confirmPassword:'test-pass'},'c')).status,409);
    assert.equal((await worker.fetch(new Request('https://test.pages.dev/api/login',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'}),env)).status,403);
    const created=await call('/api/teams/create',{name:'Test team',color:'#123456'});assert.equal(created.status,201);
    const teamId=created.body.selectedTeam.id;
    assert.equal((await call('/api/teams/update',{teamId,name:'Stolen',color:'#123456'},'b')).status,404);
    let roster;
    for(let i=0;i<11;i++){const next=await call('/api/teams/players/add',{teamId,name:'Player '+i});assert.equal(next.status,200);roster=next.body.players;}
    const ratings={stamina:5,aggression:4,attack:3,defense:2,overall:4};
    for(const [i,player] of roster.entries()){
      assert.equal((await call('/api/teams/players/update',{teamId,playerId:player.id,name:player.name,positions:[i===10?'GK':'CB'],ratings,comment:'Private comment',chemistry:{good:i===0?[roster[1].id]:[],bad:[]}})).status,200);
    }
    assert.equal((await call('/api/teams/ratings/update',{teamId,builtinKey:'stamina',name:'멘탈'})).status,200);
    const deleted=await call('/api/teams/ratings/delete',{teamId,builtinKey:'aggression'});assert.equal(deleted.status,200);assert.equal(deleted.body.players[0].ratings.aggression,null);
    assert.equal((await call('/api/squads/formations',{teamId,code:'532',action:'add'})).status,200);
    const config={name:'Cloud test',quarters:[{formation:'532',tacticId:null},{formation:'442',tacticId:null}],attendees:roster.map((p,i)=>({playerId:p.id,quota:2,keeper:i===10})),guests:[],mode:'individual'};
    const availabilityConfig={...config,name:'Availability',attendees:config.attendees.map((p,i)=>i===0?{...p,quota:1,availableQuarters:[1]}:p)};
    const availabilityPlan=await call('/api/squads/generate',{teamId,config:availabilityConfig});assert.equal(availabilityPlan.status,200);
    assert.deepEqual((await call('/api/squads/load',{teamId,squadId:availabilityPlan.body.id})).body.config.attendees[0].availableQuarters,[1]);
    assert.ok(!availabilityPlan.body.result.quarters[0].halves.flat().includes('p:'+roster[0].id));
    const unavailableEdit=structuredClone(availabilityPlan.body.result);unavailableEdit.quarters[0].halves[0][0]='p:'+roster[0].id;
    assert.equal((await call('/api/squads/save',{teamId,squadId:availabilityPlan.body.id,config:availabilityConfig,result:unavailableEdit})).status,400);
    const generated=await call('/api/squads/generate',{teamId,config});assert.equal(generated.status,200,JSON.stringify(generated.body));const squadId=generated.body.id;
    assert.equal(generated.body.result.quarters.length,2);
    const designated=structuredClone(generated.body.result),pick=designated.quarters[0].halves.flat().find(Boolean);
    designated.quarters[0].setPieces={corner:[pick,null],freeKick:[null,null],penalty:[pick]};
    assert.equal((await call('/api/squads/save',{teamId,squadId,config,result:designated})).status,200);
    assert.deepEqual((await call('/api/squads/load',{teamId,squadId})).body.result.quarters[0].setPieces.penalty,[pick]);
    assert.equal((await call('/api/squads/outcomes',{teamId,squadId,outcomes:['win','bad']})).status,400);
    assert.equal((await call('/api/squads/load',{teamId,squadId})).body.outcomes.length,0);
    const savedLayout=sqlite.prepare('SELECT config,result FROM squads WHERE id=?').get(squadId);
    assert.equal((await call('/api/squads/outcomes',{teamId,squadId,outcomes:['win','loss']})).status,200);
    assert.deepEqual(sqlite.prepare('SELECT config,result FROM squads WHERE id=?').get(squadId),savedLayout);
    assert.equal(JSON.parse(sqlite.prepare('SELECT snapshot FROM squad_outcomes WHERE squad_id=? LIMIT 1').get(squadId).snapshot).lineups.length,2);
    assert.equal((await call('/api/squads/analysis',{teamId})).body.recordedQuarters,2);
    assert.equal((await call('/api/squads/generate',{teamId,squadId,config})).status,400);
    const shared=await call('/api/squads/share',{teamId,squadId});assert.equal(shared.status,200);
    const snapshot=await call('/api/shared/'+shared.body.path.split('/').at(-1),undefined,'c');assert.equal(snapshot.status,200);assert.ok(!JSON.stringify(snapshot.body).includes('Private comment'));assert.ok(!JSON.stringify(snapshot.body).includes('ratings'));
    await call('/api/squads/unshare',{teamId,squadId});assert.equal((await call('/api/shared/'+shared.body.path.split('/').at(-1),undefined,'c')).status,404);
    await call('/api/teams/transfer/send',{teamId,email:'b@example.com'});
    const incoming=(await call('/api/teams/state',undefined,'b')).body.incoming;
    const accepted=await call('/api/teams/transfer/respond',{transferId:incoming[0].id,decision:'accept'},'b');assert.equal(accepted.status,200);assert.equal(accepted.body.players[0].comment,'');
    assert.equal((await call('/api/squads/load',{teamId,squadId},'a')).status,404);
    const moved=await call('/api/squads/load',{teamId,squadId},'b');assert.equal(moved.body.config.players[0].comment,'');
    const learned=await call('/api/squads/generate',{teamId,config:{...config,mode:'fair',name:'History supported'}},'b');assert.equal(learned.status,200);
    assert.ok(learned.body.result.quarters[0].reason.includes('과거 승률'));
  }finally{sqlite.close();}
});
test('D1 atomic batches roll back and reject stale concurrent ownership changes',async()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/0001_initial.sql','utf8'));const binding=bindingFor(sqlite);
  try{
    const a=await new Database(binding).start(),b=await new Database(binding).start();
    await a.prepare('INSERT INTO users(email,password_hash,salt) VALUES(?,?,?)').run('a@test.com','hash','salt');
    await assert.rejects(()=>b.prepare('INSERT INTO users(email,password_hash,salt) VALUES(?,?,?)').run('b@test.com','hash','salt'),Conflict);
    const c=await new Database(binding).start();
    await assert.rejects(()=>c.transaction(async()=>{await c.prepare('INSERT INTO teams(owner_id,name,color) VALUES(1,?,?)').run('Rollback','#123456');await c.prepare('INSERT INTO players(team_id,name) VALUES(999,?)').run('Invalid');}));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM teams').get().n,0);
  }finally{sqlite.close();}
});

test('Cloudflare nickname uniqueness, boards, comments and remembered quotas enforce server permissions',async()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/0001_initial.sql','utf8'));sqlite.exec(readFileSync('migrations/0002_community.sql','utf8'));sqlite.exec(readFileSync('migrations/0003_accounts_boards_tactics.sql','utf8'));sqlite.exec(readFileSync('migrations/0005_account_status.sql','utf8'));
  const env={DB:bindingFor(sqlite)},cookies={};
  async function call(route,input,who='a'){
    const response=await worker.fetch(new Request('https://test.pages.dev/api/'+route,{method:input===undefined?'GET':'POST',headers:{origin:'https://test.pages.dev','content-type':'application/json',cookie:cookies[who]||''},...(input===undefined?{}:{body:JSON.stringify(input)})}),env);
    if(response.headers.get('set-cookie'))cookies[who]=response.headers.get('set-cookie').split(';')[0];return {status:response.status,body:await response.json()};
  }
  const signup=(email,nickname)=>({email,nickname,password:'test-pass',confirmPassword:'test-pass'});
  try{
    assert.equal((await call('signup',signup('a@test.com',''))).status,400);
    assert.equal((await call('signup',signup('a@test.com','관리자'))).status,400);
    assert.equal((await call('signup',signup('a@test.com','Coach_A'))).status,201);
    assert.equal((await call('signup',signup('b@test.com','ＣOACH_A'),'b')).status,409);
    assert.equal((await call('signup',signup('b@test.com','감독B'),'b')).status,201);
    assert.equal((await call('signup',signup('llee86@naver.com','관리자'),'admin')).status,201);
    assert.equal((await call('me',undefined,'admin')).body.user.isAdmin,true);
    assert.equal((await call('community/nickname-check',{nickname:'coach_a',email:'c@test.com'},'anon')).body.available,false);
    assert.equal((await call('community/post-save',{board:'notices',title:'공지',content:'내용'})).status,403);
    const notice=await call('community/post-save',{board:'notices',title:'공지',content:'운영 안내'},'admin');assert.equal(notice.status,201);assert.equal((await call('community/list',{board:'notices'},'anon')).body.canWrite,false);const publicPost=await call('community/post',{postId:notice.body.postId},'anon');assert.equal(publicPost.status,200);assert.equal(publicPost.body.post.canManage,false);assert.equal((await call('community/comment-save',{postId:notice.body.postId,content:'anonymous'},'anon')).status,401);
    const post=await call('community/post-save',{board:'free',title:'글',content:'내용'});assert.equal(post.status,201);const postId=post.body.postId;
    assert.equal((await call('community/post-save',{postId,title:'다른 회원 수정',content:'내용'},'b')).status,403);
    assert.equal((await call('community/post-delete',{postId},'b')).status,403);
    assert.equal((await call('community/post-save',{postId,title:'관리자 수정',content:'내용'},'admin')).status,200);
    assert.equal((await call('community/comment-save',{postId,content:'댓글'},'b')).status,201);
    const detail=(await call('community/post',{postId})).body;assert.equal(detail.post.nickname,'Coach_A');assert.equal(detail.comments[0].nickname,'감독B');
    const commentId=detail.comments[0].id;assert.equal((await call('community/comment-save',{commentId,content:'변조'})).status,403);
    assert.equal((await call('community/comment-delete',{commentId})).status,403);
    assert.equal((await call('community/comment-save',{commentId,content:'관리자 수정'},'admin')).status,200);
    assert.equal((await call('community/comment-delete',{commentId},'admin')).status,200);
    const team=(await call('teams/create',{name:'기억값 테스트',color:'#123456'})).body.selectedTeam;
    const player=(await call('teams/players/add',{teamId:team.id,name:'선수'})).body.players[0];
    assert.equal((await call('community/quota-default',{playerId:player.id,quota:3},'b')).status,404);
    assert.equal((await call('community/quota-default',{playerId:player.id,quota:3})).status,200);
    assert.equal((await call('teams/state')).body.players[0].rememberedQuota,3);
    assert.equal((await call('community/post-delete',{postId},'admin')).status,200);
  }finally{sqlite.close();}
});
