import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync,createHash} from 'node:crypto';
import {handleRecovery,issueResetGrant} from '../password-recovery.mjs';
import {handleSocial} from '../social-auth.mjs';
import {asyncDatabase} from '../local-database.mjs';
import {Database} from '../cloudflare/database.mjs';
import {migratedDatabase,bindingFor} from './helper-database.mjs';
import worker from '../cloudflare/worker.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
for(const runtime of ['SQLite','D1'])test(runtime+' password recovery verifies email/SNS proof, expiry, replay and session revocation',async()=>{
  const sqlite=migratedDatabase(),fresh=async()=>runtime==='SQLite'?asyncDatabase(sqlite):await new Database(bindingFor(sqlite)).start();
  const salt='salt',original=scryptSync('old-password',salt,64).toString('hex');
  sqlite.prepare('INSERT INTO users(id,email,nickname,nickname_key,password_hash,salt) VALUES(1,?,?,?,?,?)').run('a@test.com','회원','회원',original,salt);
  sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session',1,Date.now()+60000);
  const env={RESEND_API_KEY:'test-key',PASSWORD_RESET_FROM:'MATCHDAY <test@example.com>',KAKAO_CLIENT_ID:'k',KAKAO_CLIENT_SECRET:'s'},request=(route,cookie='')=>new Request('https://test.pages.dev/api/'+route,{headers:{cookie,'cf-connecting-ip':'127.0.0.1'}});
  let mail;const sender=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');mail=JSON.parse(options.body);return Response.json({id:'sent'});};
  const call=async(route,input={},cookie='',settings=env,fetcher=sender)=>handleRecovery(await fresh(),request('recovery/'+route,cookie),settings,input,fetcher);
  try{
    assert.equal((await call('request',{email:'a@test.com'},'',{})).status,503);
    assert.equal((await call('request',{email:'a@test.com'})).status,200);assert.deepEqual(mail.to,['a@test.com']);
    const token=/#reset=([a-f0-9]{64})/.exec(mail.text)[1];assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM password_resets').get()).includes(token));
    assert.equal((await call('verify',{token:'bad'})).status,400);
    const verified=await call('verify',{token});assert.equal(verified.status,200);assert.match(verified.headers['Set-Cookie'],/HttpOnly/);
    const cookie=verified.headers['Set-Cookie'].split(';')[0];
    assert.equal((await call('reset',{newPassword:'new-password',confirmPassword:'wrong'},cookie)).status,400);
    assert.equal((await call('reset',{newPassword:'new-password',confirmPassword:'new-password'},cookie)).status,200);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    const account=sqlite.prepare('SELECT * FROM users WHERE id=1').get();assert.equal(account.password_hash,scryptSync('new-password',account.salt,64).toString('hex'));
    assert.equal((await call('verify',{token})).status,400);assert.equal((await call('reset',{newPassword:'next-password',confirmPassword:'next-password'},cookie)).status,400);
    const expired=await issueResetGrant(await fresh(),account);sqlite.exec('UPDATE password_resets SET expires_at=0');assert.equal((await call('verify',{token:expired})).status,400);
    const unknown=await call('request',{email:'unknown@test.com'});assert.equal(unknown.status,200);assert.ok(!JSON.stringify(unknown.body).includes('token'));
    sqlite.prepare('INSERT INTO social_identities VALUES(?,?,?)').run('kakao','linked',1);
    for(const [subject,expected] of [['unlinked',403],['linked',200]]){
      const pending=subject==='linked'?'a'.repeat(64):'b'.repeat(64);sqlite.prepare('INSERT INTO oauth_pending VALUES(?,?,?,?,?)').run(hash(pending),'kakao',subject,'a@test.com',Date.now()+60000);
      const result=await handleSocial(await fresh(),request('social/recover','oauth_pending='+pending),env,null,{});assert.equal(result.status,expected);
      if(expected===200){assert.match(result.headers['Set-Cookie'],/^password_reset=/);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_pending WHERE token_hash=?').get(hash(pending)).n,0);}
    }
    assert.equal((await call('request',{email:'a@test.com'},'',env,async()=>new Response('error',{status:500}))).status,503);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n,0);
  }finally{sqlite.close();}
});
test('Cloudflare recovery routes work without login and preserve social GET routes',async()=>{
  const sqlite=migratedDatabase(),env={DB:bindingFor(sqlite)};
  try{
    const status=await worker.fetch(new Request('https://test.pages.dev/api/recovery/status'),env);assert.equal(status.status,200);assert.deepEqual(await status.json(),{emailEnabled:false});
    assert.equal((await worker.fetch(new Request('https://test.pages.dev/api/social/providers'),env)).status,200);
    const salt='test';sqlite.prepare('INSERT INTO users(id,email,nickname,nickname_key,password_hash,salt) VALUES(1,?,?,?,?,?)').run('test@test.com','회원','회원',scryptSync('old-password',salt,64).toString('hex'),salt);
    const token=await issueResetGrant(await new Database(env.DB).start(),sqlite.prepare('SELECT * FROM users WHERE id=1').get());
    const post=(path,input,cookie='')=>new Request('https://test.pages.dev/api/recovery/'+path,{method:'POST',headers:{origin:'https://test.pages.dev','content-type':'application/json',cookie},body:JSON.stringify(input)});
    const verified=await worker.fetch(post('verify',{token}),env);assert.equal(verified.status,200);
    const reset=await worker.fetch(post('reset',{newPassword:'new-password',confirmPassword:'new-password'},verified.headers.get('set-cookie').split(';')[0]),env);assert.equal(reset.status,200);assert.match(reset.headers.get('set-cookie'),/session=;.*Max-Age=0/);
    assert.equal((await worker.fetch(post('verify',{token}),env)).status,400);
  }finally{sqlite.close();}
});
