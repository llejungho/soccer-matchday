import {scrypt,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {isAdmin,nicknameError,nicknameKey,publicUser} from './community.mjs';
const derive=promisify(scrypt);
export const accountSchema=`CREATE TABLE IF NOT EXISTS account_security_attempts(user_id INTEGER PRIMARY KEY REFERENCES users(id),count INTEGER NOT NULL,until INTEGER NOT NULL);`;
export async function verifyPassword(db,user,input){
  const attempt=await db.prepare('SELECT count,until FROM account_security_attempts WHERE user_id=?').get(user.id);
  if(attempt?.until>Date.now()&&attempt.count>=10){const error=new Error('확인 요청이 많습니다. 15분 뒤 다시 시도해 주세요.');error.status=429;throw error;}
  const password=typeof input==='string'&&input.length<=128?input:'';
  const hash=await derive(password,user.salt||'invalid-user-timing-salt',64);
  const stored=Buffer.from(user.password_hash||'','hex');
  const valid=stored.length===hash.length&&timingSafeEqual(hash,stored);
  if(!valid){await db.prepare('INSERT INTO account_security_attempts(user_id,count,until) VALUES(?,1,?) ON CONFLICT(user_id) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END').run(user.id,Date.now()+900000,Date.now(),Date.now());return false;}
  await db.prepare('DELETE FROM account_security_attempts WHERE user_id=?').run(user.id);return true;
}
export async function handleAccount(db,path,user,input={}){
  const error=(status,error,field)=>({status,body:{error,...(field?{field}:{})}});
  if(!user)return error(401,'로그인해 주세요.');
  if(path==='/api/account/admin-users'){
    if(!isAdmin(user))return error(403,'관리자만 접근할 수 있습니다.');
    return {status:200,body:{users:await db.prepare("SELECT email,nickname FROM users ORDER BY id DESC").all()}};
  }
  if(path==='/api/account/profile'){
    const account=await db.prepare('SELECT id,email,nickname,password_hash FROM users WHERE id=?').get(user.id);
    const linked=await db.prepare('SELECT provider FROM social_identities WHERE user_id=? ORDER BY provider').all(user.id);
    return {status:200,body:{user:publicUser(account),hasPassword:!!account.password_hash,linked:linked.map(p=>p.provider)}};
  }
  if(path==='/api/account/nickname'){
    const issue=nicknameError(input.nickname,user.email);if(issue)return error(400,issue,'nickname');
    const nickname=input.nickname.normalize('NFKC').trim();
    try{await db.prepare('UPDATE users SET nickname=?,nickname_key=? WHERE id=?').run(nickname,nicknameKey(nickname),user.id);}
    catch(e){if(e.message.includes('UNIQUE'))return error(409,'이미 사용 중인 닉네임입니다.','nickname');throw e;}
    return {status:200,body:{user:publicUser({...user,nickname})}};
  }
  if(path==='/api/account/password'){
    if(typeof input.newPassword!=='string'||input.newPassword.length<8||input.newPassword.length>128)return error(400,'새 암호는 8~128자로 입력하세요.');
    if(input.newPassword!==input.confirmPassword)return error(400,'새 암호와 재확인이 일치하지 않습니다.');
    const account=await db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if(!account.password_hash)return error(400,'SNS 가입 계정은 연동한 SNS로 로그인해 주세요.');
    if(!await verifyPassword(db,account,input.currentPassword))return error(401,'현재 암호를 확인하세요.');
    const salt=randomBytes(16).toString('hex'),hash=(await derive(input.newPassword,salt,64)).toString('hex');
    // One statement revokes all earlier sessions together with the credential update
    // through the server's transaction wrapper.
    await db.transaction(async()=>{await db.prepare('UPDATE users SET password_hash=?,salt=? WHERE id=?').run(hash,salt,user.id);await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);});
    return {status:200,body:{user:publicUser(account),renewSession:true}};
  }
  return error(404,'찾을 수 없는 요청입니다.');
}
