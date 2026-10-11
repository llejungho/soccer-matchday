import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {scryptSync} from 'node:crypto';
import {handleRecovery} from '../password-recovery.mjs';
import {GMAIL_SENDER,sendGmailCode,gmailEnabled} from '../gmail-mailer.mjs';
import {asyncDatabase} from '../local-database.mjs';
import {Database} from '../cloudflare/database.mjs';
import {migratedDatabase,bindingFor} from './helper-database.mjs';
const env={GMAIL_APP_PASSWORD:'aaaa bbbb cccc dddd'};
for(const runtime of ['SQLite','D1'])test(runtime+' Gmail codes bind browser, expire, rate limit, invalidate resend and revoke sessions',async()=>{
  const sqlite=migratedDatabase(),fresh=async()=>runtime==='SQLite'?asyncDatabase(sqlite):await new Database(bindingFor(sqlite)).start();
  sqlite.prepare('INSERT INTO users(id,email,nickname,nickname_key,password_hash,salt) VALUES(1,?,?,?,?,?)').run('member@example.com','회원','회원',scryptSync('old-password','salt',64).toString('hex'),'salt');
  let delivered,cookie='';
  const sender=async(settings,to,code)=>{assert.equal(settings,env);assert.equal(to,'member@example.com');assert.match(code,/^\d{6}$/);delivered=code;};
  const call=async(route,input={},browserCookie=cookie,mailSender=sender)=>{
    const req=new Request('https://test.pages.dev/api/recovery/'+route,{headers:{cookie:browserCookie,'cf-connecting-ip':'127.0.0.1'}});
    const result=await handleRecovery(await fresh(),req,env,input,fetch,mailSender);return result;
  };
  try{
    assert.deepEqual((await call('status')).body,{emailEnabled:true,emailMode:'code'});
    const request=await call('request',{email:'member@example.com'});assert.equal(request.status,200);cookie=request.headers['Set-Cookie'].split(';')[0];assert.match(request.headers['Set-Cookie'],/HttpOnly; SameSite=Strict;.*Secure/);
    const first=delivered;assert.equal((await call('verify-code',{code:first},'')).status,400);
    assert.equal((await call('verify-code',{code:first},cookie.replace(/[a-f0-9]+$/,'b'.repeat(64)))).status,400);
    const storage=sqlite.prepare('SELECT * FROM password_resets').get();assert.ok(!JSON.stringify(storage).includes(cookie.split('=')[1]));assert.ok(!JSON.stringify(storage).includes(first));
    const verified=await call('verify-code',{code:first});assert.equal(verified.status,200);assert.equal((await call('verify-code',{code:first})).status,400);
    const resetCookie=verified.headers['Set-Cookie'].split(';')[0];sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session',1,Date.now()+60000);
    assert.equal((await call('reset',{newPassword:'new-password',confirmPassword:'new-password'},resetCookie)).status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    const again=await call('request',{email:'member@example.com'});cookie=again.headers['Set-Cookie'].split(';')[0];const second=delivered;
    const resent=await call('request',{email:'member@example.com'});const oldCookie=cookie;cookie=resent.headers['Set-Cookie'].split(';')[0];
    assert.equal((await call('verify-code',{code:second},oldCookie)).status,400);
    for(let i=0;i<5;i++)assert.equal((await call('verify-code',{code:'invalid'})).status,400);
    assert.equal((await call('verify-code',{code:delivered})).status,429);
    const expired=await call('request',{email:'member@example.com'});cookie=expired.headers['Set-Cookie'].split(';')[0];sqlite.exec('UPDATE password_resets SET expires_at=0');assert.equal((await call('verify-code',{code:delivered})).status,400);
    const unknown=await call('request',{email:'unknown@example.com'},'',()=>{throw new Error('must not send');});assert.equal(unknown.status,200);assert.equal(unknown.body.message,request.body.message);assert.equal((await call('verify-code',{code:'000000'},unknown.headers['Set-Cookie'].split(';')[0])).status,400);
    assert.equal((await call('request',{email:'member@example.com'})).status,429);
    sqlite.exec('DELETE FROM recovery_attempts');const failure=await call('request',{email:'member@example.com'},'',()=>{throw new Error('SMTP');});assert.equal(failure.status,503);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n,0);
  }finally{sqlite.close();}
});

test('Gmail SMTP validates TLS, handles split multiline replies and sends UTF-8 code mail',async()=>{
  const commands=[],socket=new EventEmitter();let destroyed=false;
  const emitReply=text=>queueMicrotask(()=>{socket.emit('data',Buffer.from(text.slice(0,5)));socket.emit('data',Buffer.from(text.slice(5)));});
  socket.write=text=>{
    commands.push(text);
    if(text.startsWith('EHLO'))emitReply('250-smtp.gmail.com\r\n250 AUTH PLAIN LOGIN\r\n');
    else if(text.startsWith('AUTH PLAIN'))emitReply('235 2.7.0 Accepted\r\n');
    else if(text.startsWith('MAIL')||text.startsWith('RCPT'))emitReply('250 2.1.0 OK\r\n');
    else if(text==='DATA\r\n')emitReply('354 Continue\r\n');
    else if(text.startsWith('From:'))emitReply('250 2.0.0 Accepted\r\n');
  };
  socket.destroy=()=>{destroyed=true;};
  const connect=options=>{assert.deepEqual(options,{host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',rejectUnauthorized:true});emitReply('220 smtp.gmail.com ESMTP\r\n');return socket;};
  await sendGmailCode(env,'member@example.com','012345',connect);
  assert.equal(Buffer.from(commands[1].split(' ')[2].trim(),'base64').toString(),'\0'+GMAIL_SENDER+'\0aaaabbbbccccdddd');
  const message=commands.find(c=>c.startsWith('From:'));assert.ok(message.includes('MATCHDAY <lleee86@gmail.com>'));assert.match(Buffer.from(message.split('\r\n\r\n')[1].split('\r\n.')[0].replace(/\r\n/g,''),'base64').toString(),/012345/);assert.ok(destroyed);
  assert.equal(gmailEnabled({GMAIL_APP_PASSWORD:'normal-password'}),false);
  await assert.rejects(sendGmailCode(env,'member@example.com\r\nBcc: outsider','012345',connect));
});

test('Gmail SMTP failures do not expose the app password',async()=>{
 const socket=new EventEmitter();socket.destroy=()=>{};socket.write=text=>queueMicrotask(()=>socket.emit('data',Buffer.from(text.startsWith('EHLO')?'250 OK\r\n':'535 rejected\r\n')));
 await assert.rejects(sendGmailCode(env,'member@example.com','123456',()=>{queueMicrotask(()=>socket.emit('data',Buffer.from('220 ready\r\n')));return socket;}),error=>!error.message.includes('aaaabbbbccccdddd')&&error.message.includes('535'));
});
