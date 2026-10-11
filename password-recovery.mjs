import {randomBytes,randomInt,createHash,scrypt} from 'node:crypto';
import {gmailEnabled,sendGmailCode} from './gmail-mailer.mjs';
import {promisify} from 'node:util';
const derive=promisify(scrypt),hash=v=>createHash('sha256').update(v).digest('hex');
export const recoverySchema=`CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,credential_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);`;
const reply=(status,body,headers={})=>({status,body,headers});
export const resetCookie=(request,token,age=900)=>`password_reset=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
export async function issueResetGrant(db,account,token=randomBytes(32).toString('hex'),lifetime=900000){
  await db.transaction(async()=>{await db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(account.id,Date.now());await db.prepare('INSERT INTO password_resets VALUES(?,?,?,?)').run(hash(token),account.id,Date.now()+lifetime,account.password_hash);});
  return token;
}
export async function handleRecovery(db,request,env,input={},fetcher=fetch,gmailSender=sendGmailCode){
  const path=new URL(request.url).pathname,useGmail=gmailEnabled(env),enabled=useGmail||(!!env.RESEND_API_KEY?.trim()&&!!env.PASSWORD_RESET_FROM?.trim());
  if(path==='/api/recovery/status')return reply(200,{emailEnabled:enabled,...(useGmail?{emailMode:'code'}:{})});
  if(path==='/api/recovery/request'){
    const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))return reply(400,{error:'등록한 이메일 주소를 입력하세요.'});
    if(!enabled)return reply(503,{error:'이메일 발송 서비스 연결 전입니다. 계정에 연동한 SNS로 본인 확인을 이용하세요.'});
    const now=Date.now(),keys=['ip:'+hash(request.headers.get('cf-connecting-ip')||'local'),'email:'+hash(email)];
    for(const key of keys){const previous=await db.prepare('SELECT count,until FROM recovery_attempts WHERE key=?').get(key);if(previous?.until>now&&previous.count>=5)return reply(429,{error:'요청이 많습니다. 15분 후 다시 시도하세요.'});}
    await db.transaction(async()=>{await db.prepare('DELETE FROM recovery_attempts WHERE until<=?').run(now);for(const key of keys)await db.prepare('INSERT INTO recovery_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);});
    const account=await db.prepare("SELECT * FROM users WHERE email=? AND status='active'").get(email);
    if(useGmail){
      const challenge=randomBytes(32).toString('hex'),code=String(randomInt(1000000)).padStart(6,'0');
      if(account){
        const token=await issueResetGrant(db,account,challenge+code,600000);
        try{await gmailSender(env,email,code);}
        catch{await db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(hash(token));return reply(503,{error:'인증코드를 보내지 못했습니다. 잠시 후 다시 시도하세요.'});}
      }
      return reply(200,{ok:true,emailMode:'code',message:'등록된 계정이면 인증코드를 보냈습니다. 스팸함도 확인하세요. 코드는 10분 동안 유효합니다.'},{'Set-Cookie':`recovery_challenge=${challenge}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600${new URL(request.url).protocol==='https:'?'; Secure':''}`});
    }
    if(account){
      const token=await issueResetGrant(db,account),base=new URL(env.SOCIAL_BASE_URL||'https://soccer-matchday-b16.pages.dev');
      const link=base.origin+'/#reset='+token;
      try{const sent=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY.trim(),'Content-Type':'application/json'},body:JSON.stringify({from:env.PASSWORD_RESET_FROM.trim(),to:[email],subject:'MATCHDAY 비밀번호 재설정',text:`아래 링크에서 새 비밀번호를 설정하세요. 링크는 15분 동안 한 번만 사용할 수 있습니다.\n${link}\n요청하지 않았다면 이 메일을 무시하세요.`}),signal:AbortSignal.timeout(10000)});if(!sent.ok)throw new Error('delivery failed');}
      catch{await db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(hash(token));return reply(503,{error:'이메일 발송을 완료하지 못했습니다. 잠시 후 다시 시도하세요.'});}
    }
    return reply(200,{ok:true,message:'등록된 계정이면 재설정 메일을 보냈습니다. 스팸함도 확인하세요. 링크는 15분 동안 유효합니다.'});
  }
  if(path==='/api/recovery/verify-code'){
    const challenge=/(?:^|;\s*)recovery_challenge=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1];
    if(!challenge)return reply(400,{error:'먼저 인증코드를 요청하세요. 요청이 만료되었다면 다시 보내세요.'});
    const key='code:'+hash(challenge),attempt=await db.prepare('SELECT count,until FROM recovery_attempts WHERE key=?').get(key);
    if(attempt?.until>Date.now()&&attempt.count>=5)return reply(429,{error:'인증코드를 5회 잘못 입력했습니다. 코드를 다시 요청하세요.'});
    await db.prepare('INSERT INTO recovery_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,Date.now()+600000);
    const code=typeof input.code==='string'?input.code.trim():'';
    const account=/^\d{6}$/.test(code)?await db.prepare("SELECT u.* FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND r.credential_hash=u.password_hash AND u.status='active'").get(hash(challenge+code),Date.now()):null;
    if(!account)return reply(400,{error:'인증코드가 틀렸거나 만료되었습니다. 확인 후 다시 입력하세요.'});
    const grant=await issueResetGrant(db,account);
    return reply(200,{ok:true,email:account.email},{'Set-Cookie':resetCookie(request,grant)});
  }
  const token=path==='/api/recovery/verify'?input.token:/(?:^|;\s*)password_reset=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1];
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return reply(400,{error:'재설정 링크가 없거나 만료되었습니다. 본인 확인을 다시 진행하세요.'});
  const grant=await db.prepare("SELECT r.*,u.email,u.password_hash FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND u.status='active'").get(hash(token),Date.now());
  if(!grant||grant.credential_hash!==grant.password_hash)return reply(400,{error:'만료되었거나 이미 사용한 재설정 요청입니다.'});
  if(path==='/api/recovery/verify')return reply(200,{ok:true,email:grant.email},{'Set-Cookie':resetCookie(request,token)});
  if(path!=='/api/recovery/reset')return reply(404,{error:'찾을 수 없는 요청입니다.'});
  if(typeof input.newPassword!=='string'||input.newPassword.length<8||input.newPassword.length>128)return reply(400,{error:'새 암호는 8~128자로 입력하세요.'});
  if(input.newPassword!==input.confirmPassword)return reply(400,{error:'새 암호와 재확인이 일치하지 않습니다.'});
  const salt=randomBytes(16).toString('hex'),password=(await derive(input.newPassword,salt,64)).toString('hex');
  await db.transaction(async()=>{await db.prepare('UPDATE users SET password_hash=?,salt=? WHERE id=? AND password_hash=? AND EXISTS(SELECT 1 FROM password_resets WHERE token_hash=? AND expires_at>?)').run(password,salt,grant.user_id,grant.credential_hash,hash(token),Date.now());await db.prepare('DELETE FROM sessions WHERE user_id=?').run(grant.user_id);await db.prepare('DELETE FROM password_resets WHERE user_id=?').run(grant.user_id);await db.prepare('DELETE FROM account_security_attempts WHERE user_id=?').run(grant.user_id);});
  if((await db.prepare('SELECT password_hash FROM users WHERE id=?').get(grant.user_id)).password_hash!==password)return reply(400,{error:'이미 사용되었거나 만료된 재설정 요청입니다.'});
  return reply(200,{ok:true,signedOut:true},{'Set-Cookie':resetCookie(request,'',0)});
}
