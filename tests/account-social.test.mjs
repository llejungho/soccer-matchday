import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync,createHash} from 'node:crypto';
import {handleAccount} from '../account.mjs';
import {handleSocial} from '../social-auth.mjs';
import {asyncDatabase} from '../local-database.mjs';
import {Database} from '../cloudflare/database.mjs';
import worker from '../cloudflare/worker.mjs';
import {migratedDatabase,bindingFor} from './helper-database.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
for(const runtime of ['SQLite','D1'])test(runtime+' protects nickname, password changes, administrator data and SNS linking',async()=>{
  const sqlite=migratedDatabase(),binding=bindingFor(sqlite);const fresh=async()=>runtime==='SQLite'?asyncDatabase(sqlite):await new Database(binding).start();
  const password='existing-pass',salt='seed-salt';for(const [id,email,nickname] of [[1,'a@test.com','감독A'],[2,'b@test.com','감독B'],[3,'llee86@naver.com','관리자']])sqlite.prepare('INSERT INTO users(id,email,nickname,nickname_key,password_hash,salt) VALUES(?,?,?,?,?,?)').run(id,email,nickname,nickname.toLowerCase(),scryptSync(password,salt,64).toString('hex'),salt);
  const users=sqlite.prepare('SELECT * FROM users').all(),a=users[0],admin=users[2],env={DB:binding,GOOGLE_CLIENT_ID:'test-google-client',GOOGLE_CLIENT_SECRET:'test-secret',NAVER_CLIENT_ID:'naver-client',NAVER_CLIENT_SECRET:'naver-secret',KAKAO_CLIENT_ID:'kakao-client',KAKAO_CLIENT_SECRET:'kakao-secret'};
  const account=async(route,user,input)=>handleAccount(await fresh(),'/api/account/'+route,user,input);
  const social=async(request,input,fetcher)=>handleSocial(await fresh(),request,env,null,input,fetcher);
  const request=(path,cookie='',method='GET')=>new Request('https://test.pages.dev'+path,{method,headers:{cookie}});
  try{
    assert.equal((await account('admin-users',a,{})).status,403);const list=(await account('admin-users',admin,{})).body.users;assert.equal(list.length,3);assert.deepEqual(Object.keys(list[0]).sort(),['email','nickname']);
    assert.equal((await account('nickname',a,{nickname:'감독B'})).status,409);assert.equal((await account('nickname',a,{nickname:'바뀐감독'})).status,200);
    assert.equal((await account('nickname',admin,{nickname:'운영자'})).status,400);
    sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old-session',a.id,Date.now()+60000);
    assert.equal((await account('password',a,{currentPassword:'wrong-pass',newPassword:'new-password',confirmPassword:'new-password'})).status,401);
    assert.equal((await account('password',a,{currentPassword:password,newPassword:'new-password',confirmPassword:'new-password'})).status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    const changed=sqlite.prepare('SELECT * FROM users WHERE id=1').get();assert.equal(changed.password_hash,scryptSync('new-password',changed.salt,64).toString('hex'));
    for(const provider of ['naver','kakao','google']){
      const start=await social(request('/api/social/start/'+provider));assert.equal(start.status,302);const destination=new URL(start.headers.Location),state=destination.searchParams.get('state'),cookie=start.headers['Set-Cookie'].split(';')[0];assert.ok(state);if(provider==='google')assert.ok(destination.searchParams.get('code_challenge'));
      assert.equal((await social(request('/api/social/callback/'+provider+'?state='+state+'&code=code'))).status,400);
      let tokenCalls=0;const fetcher=async(url,options)=>{if(url.includes('/token')){tokenCalls++;assert.equal(new URLSearchParams(options.body).get('client_secret'),env[provider.toUpperCase()+'_CLIENT_SECRET']);return Response.json({access_token:'test-access-token'});}return Response.json(provider==='google'?{sub:'subject-'+provider,email:'a@test.com',email_verified:true}:provider==='naver'?{response:{id:'subject-'+provider,email:'a@test.com'}}:{id:'subject-'+provider,kakao_account:{email:'a@test.com',is_email_valid:true,is_email_verified:true}});};
      const callback=await social(request('/api/social/callback/'+provider+'?state='+state+'&code=code',cookie),{},fetcher);assert.equal(callback.status,302);assert.equal(tokenCalls,1);
      assert.equal((await social(request('/api/social/callback/'+provider+'?state='+state+'&code=code',cookie),{},fetcher)).status,400);
      const pendingCookie=callback.headers['Set-Cookie'].split(';')[0];assert.equal((await social(request('/api/social/pending',pendingCookie))).body.kind,'link');
      assert.equal((await social(request('/api/social/finish',pendingCookie,'POST'),{action:'login'})).status,409);
      assert.equal((await social(request('/api/social/finish',pendingCookie,'POST'),{action:'link',currentPassword:'wrong-pass'})).status,401);
      const finish=await social(request('/api/social/finish',pendingCookie,'POST'),{action:'link',currentPassword:'new-password'});assert.equal(finish.status,200);assert.equal(finish.body.user.id,a.id);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
      assert.equal((await social(request('/api/social/finish',pendingCookie,'POST'),{action:'link',currentPassword:'new-password'})).status,400);
    }
    assert.equal((await account('profile',a,{})).body.linked.length,3);
    const token='c'.repeat(64);sqlite.prepare('INSERT INTO oauth_pending VALUES(?,?,?,?,?)').run(digest(token),'google','new-subject','new@test.com',Date.now()+60000);
    const cookie='oauth_pending='+token;await assert.rejects(()=>social(request('/api/social/finish',cookie,'POST'),{action:'signup',nickname:'감독B'}),/UNIQUE/);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
    const newUser=await social(request('/api/social/finish',cookie,'POST'),{action:'signup',nickname:'새감독'});assert.equal(newUser.status,200);assert.equal(newUser.body.user.nickname,'새감독');assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n,4);
  }finally{sqlite.close();}
});
test('Worker password renewal and SNS signup return session cookies without internal identifiers',async()=>{
  const sqlite=migratedDatabase(),env={DB:bindingFor(sqlite)};const call=async(path,input,cookie='')=>worker.fetch(new Request('https://test.pages.dev/api/'+path,{method:input===undefined?'GET':'POST',headers:{origin:'https://test.pages.dev','content-type':'application/json',cookie},...(input===undefined?{}:{body:JSON.stringify(input)})}),env);
  try{
    const signup=await call('signup',{email:'a@test.com',nickname:'감독A',password:'old-password',confirmPassword:'old-password'});const old=signup.headers.get('set-cookie').split(';')[0];
    const changed=await call('account/password',{currentPassword:'old-password',newPassword:'new-password',confirmPassword:'new-password'},old);assert.equal(changed.status,200);const next=changed.headers.get('set-cookie').split(';')[0];assert.notEqual(next,old);assert.equal((await changed.json()).renewSession,undefined);assert.equal((await (await call('me',undefined,old)).json()).user,null);assert.ok((await (await call('me',undefined,next)).json()).user);
    const token='d'.repeat(64);sqlite.prepare('INSERT INTO oauth_pending VALUES(?,?,?,?,?)').run(digest(token),'google','new-subject','new@test.com',Date.now()+60000);
    const finish=await call('social/finish',{action:'signup',nickname:'새감독'},'oauth_pending='+token);assert.equal(finish.status,200);assert.equal(finish.headers.getSetCookie().length,2);const body=await finish.json();assert.equal(body.user.nickname,'새감독');assert.equal(body.signInUser,undefined);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM social_identities').get().n,1);
  }finally{sqlite.close();}
});
