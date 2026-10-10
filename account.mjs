import {scrypt,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {isAdmin,nicknameError,nicknameKey,publicUser,ADMIN_EMAIL} from './community.mjs';
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
  if(path==='/api/account/withdraw'){
    if(isAdmin(user))return error(403,'운영자 계정은 탈퇴할 수 없습니다.');
    if(input.confirmation!=='회원탈퇴'||input.email!==user.email)return error(400,'이메일과 회원탈퇴 확인 문구를 정확히 입력하세요.');
    const account=await db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if(account.password_hash&&!await verifyPassword(db,account,input.currentPassword))return error(401,'현재 암호를 확인하세요.');
    await db.transaction(async()=>{
      const owned='SELECT id FROM teams WHERE owner_id=?',players='SELECT id FROM players WHERE team_id IN ('+owned+')',squads='SELECT id FROM squads WHERE team_id IN ('+owned+')';
      for(const table of ['squad_shares','squad_outcomes'])await db.prepare(`DELETE FROM ${table} WHERE squad_id IN (${squads})`).run(user.id);
      await db.prepare(`DELETE FROM squads WHERE team_id IN (${owned})`).run(user.id);
      await db.prepare(`DELETE FROM player_chemistry WHERE player_a IN (${players}) OR player_b IN (${players})`).run(user.id,user.id);
      for(const table of ['player_custom_ratings','player_profiles','player_quota_defaults'])await db.prepare(`DELETE FROM ${table} WHERE player_id IN (${players})`).run(user.id);
      await db.prepare('DELETE FROM player_quota_defaults WHERE user_id=?').run(user.id);
      await db.prepare(`DELETE FROM players WHERE team_id IN (${owned})`).run(user.id);
      for(const table of ['team_tactics','team_rating_fields','team_basic_rating_fields','team_formations','team_transfers'])await db.prepare(`DELETE FROM ${table} WHERE team_id IN (${owned})`).run(user.id);
      await db.prepare('DELETE FROM team_transfers WHERE sender_id=? OR recipient_id=?').run(user.id,user.id);
      await db.prepare(`DELETE FROM team_preferences WHERE user_id=? OR team_id IN (${owned})`).run(user.id,user.id);
      await db.prepare('DELETE FROM teams WHERE owner_id=?').run(user.id);
      for(const table of ['sessions','social_identities','account_security_attempts','board_recommendations'])await db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);
      await db.prepare('DELETE FROM board_views WHERE viewer_key=?').run('user:'+user.id);
      await db.prepare('DELETE FROM oauth_pending WHERE email=?').run(user.email);
      await db.prepare("UPDATE users SET status='withdrawn',email=?,nickname='탈퇴회원',nickname_key=?,password_hash='',salt='' WHERE id=?").run('withdrawn-'+user.id+'-'+randomBytes(16).toString('hex')+'@account.invalid','withdrawn:'+user.id,user.id);
    });
    return {status:200,body:{ok:true,signedOut:true}};
  }
  if(path==='/api/account/admin-status'){
    if(!isAdmin(user))return error(403,'관리자만 변경할 수 있습니다.');
    if(!Number.isSafeInteger(input.userId)||!['active','banned'].includes(input.status))return error(400,'회원과 처리 방법을 확인하세요.');
    const target=await db.prepare('SELECT * FROM users WHERE id=?').get(input.userId);
    if(!target||target.status==='withdrawn')return error(404,'처리할 회원이 없습니다.');
    if(target.email===ADMIN_EMAIL)return error(403,'운영자 계정은 강퇴할 수 없습니다.');
    await db.transaction(async()=>{
      await db.prepare('UPDATE users SET status=? WHERE id=?').run(input.status,target.id);
      if(input.status==='banned'){
        await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
        await db.prepare('DELETE FROM oauth_pending WHERE email=?').run(target.email);
      }
    });
    return {status:200,body:{ok:true}};
  }
  if(path==='/api/account/admin-users'){
    if(!isAdmin(user))return error(403,'관리자만 접근할 수 있습니다.');
    return {status:200,body:{users:await db.prepare("SELECT id,email,nickname,status FROM users WHERE status!='withdrawn' ORDER BY id DESC").all()}};
  }
  if(path==='/api/account/profile'){
    const account=await db.prepare('SELECT id,email,nickname,password_hash FROM users WHERE id=?').get(user.id);
    const linked=await db.prepare('SELECT provider FROM social_identities WHERE user_id=? ORDER BY provider').all(user.id);
    const ownedTeams=(await db.prepare('SELECT COUNT(*) AS n FROM teams WHERE owner_id=?').get(user.id)).n;
    return {status:200,body:{user:publicUser(account),hasPassword:!!account.password_hash,linked:linked.map(p=>p.provider),ownedTeams}};
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
