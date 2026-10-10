import {issueResetGrant,resetCookie} from './password-recovery.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {nicknameError,nicknameKey,publicUser,ADMIN_EMAIL} from './community.mjs';
import {verifyPassword} from './account.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('hex');
const providers={
  naver:{name:'네이버',authorize:'https://nid.naver.com/oauth2.0/authorize',token:'https://nid.naver.com/oauth2.0/token',profile:'https://openapi.naver.com/v1/nid/me'},
  kakao:{name:'카카오',authorize:'https://kauth.kakao.com/oauth/authorize',token:'https://kauth.kakao.com/oauth/token',profile:'https://kapi.kakao.com/v2/user/me',scope:'account_email'},
  google:{name:'구글',authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',profile:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid email',pkce:true},
};
export const socialSchema=`CREATE TABLE IF NOT EXISTS social_identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(provider,subject),UNIQUE(user_id,provider));
CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_pending(token_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,subject TEXT NOT NULL,email TEXT NOT NULL,expires_at INTEGER NOT NULL);`;
const settings=(env,p)=>({id:env[p.toUpperCase()+'_CLIENT_ID']?.trim(),secret:env[p.toUpperCase()+'_CLIENT_SECRET']?.trim()});
export const providerStatus=env=>Object.entries(providers).map(([id,p])=>({id,name:p.name,enabled:!!(settings(env,id).id&&settings(env,id).secret)}));
const cookieValue=(request,name)=>new RegExp('(?:^|;\\s*)'+name+'=([a-f0-9]{64})(?:;|$)').exec(request.headers.get('cookie')||'')?.[1];
const setCookie=(request,name,value,maxAge)=>`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
const answer=(status,body,headers={})=>({status,body,headers});
async function fetchJson(fetcher,url,options){
  // workerd supports manual/follow only. Never follow provider redirects:
  // a redirected request could forward the client secret or access token.
  const response=await fetcher(url,{...options,signal:AbortSignal.timeout(15000),redirect:'manual'});
  if(!response.ok)throw new Error('SNS 인증을 완료하지 못했습니다. 다시 시도해 주세요.');
  return await response.json();
}
export async function handleSocial(db,request,env,user,input={},fetcher=fetch){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/social/share-config')return answer(200,{javascriptKey:env.KAKAO_JAVASCRIPT_KEY?.trim()||''});
  if(path==='/api/social/providers')return answer(200,{providers:providerStatus(env)});
  const start=/^\/api\/social\/start\/(naver|kakao|google)$/.exec(path),callback=/^\/api\/social\/callback\/(naver|kakao|google)$/.exec(path);
  const productionHost='soccer-matchday-b16.pages.dev';
  const base=new URL(env.SOCIAL_BASE_URL||((url.hostname===productionHost||url.hostname.endsWith('.'+productionHost))?'https://'+productionHost:url.origin));
  if((start||callback)&&url.origin!==base.origin){
    // Move to the registered service before creating state/cookies. Individual
    // Cloudflare deployment URLs are not registered OAuth callback hosts.
    const destination=new URL(start?path:'/',base);
    if(start&&url.searchParams.get('consent')==='1')destination.searchParams.set('consent','1');
    if(callback)destination.searchParams.set('social','restart');
    return answer(302,null,{Location:destination.href});
  }
  if(start){
    const id=start[1],p=providers[id],config=settings(env,id);if(!config.id||!config.secret)return answer(503,{error:'해당 SNS 로그인은 아직 준비 중입니다. 이메일로 이용해 주세요.'});
    const state=random(),verifier=random();await db.transaction(async()=>{await db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(Date.now());await db.prepare('INSERT INTO oauth_states VALUES(?,?,?,?)').run(hash(state),id,verifier,Date.now()+600000);});
    const destination=new URL(p.authorize);for(const [key,value] of Object.entries({response_type:'code',client_id:config.id,redirect_uri:base.origin+'/api/social/callback/'+id,state,...(p.scope?{scope:p.scope}:{})}))destination.searchParams.set(key,value);
    if(id==='naver'&&url.searchParams.get('consent')==='1')destination.searchParams.set('auth_type','reprompt');
    if(p.pkce){destination.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));destination.searchParams.set('code_challenge_method','S256');}
    return answer(302,null,{Location:destination.href,'Set-Cookie':setCookie(request,'oauth_state',state,600)});
  }
  if(callback){
    const id=callback[1],p=providers[id],state=url.searchParams.get('state'),browserState=cookieValue(request,'oauth_state');
    if(!state||state!==browserState)return answer(400,{error:'SNS 인증 요청을 확인하지 못했습니다. 처음부터 다시 로그인하세요.'});
    const record=await db.prepare('SELECT * FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>?').get(hash(state),id,Date.now());if(!record)return answer(400,{error:'SNS 인증 요청이 만료되었거나 이미 사용되었습니다.'});
    const consumed=await db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash(state));if(!consumed.changes)return answer(400,{error:'이미 사용한 SNS 인증 요청입니다.'});
    if(url.searchParams.has('error'))return answer(302,null,{Location:'/?social=cancelled','Set-Cookie':setCookie(request,'oauth_state','',0)});
    const code=url.searchParams.get('code');if(!code)return answer(400,{error:'SNS 인증 코드가 없습니다.'});
    const config=settings(env,id);if(!config.id||!config.secret)return answer(503,{error:'SNS 로그인 연결을 준비 중입니다.'});
    const values={grant_type:'authorization_code',client_id:config.id,client_secret:config.secret,code,redirect_uri:base.origin+'/api/social/callback/'+id,...(id==='naver'?{state}:{}),...(p.pkce?{code_verifier:record.verifier}:{})};
    const token=await fetchJson(fetcher,p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});if(!token.access_token)throw new Error('SNS 인증을 완료하지 못했습니다.');
    const profile=await fetchJson(fetcher,p.profile,{headers:{Authorization:'Bearer '+token.access_token}});
    // Provider calls may take seconds; all subsequent account reads start from
    // the latest revision after consuming the one-time state.
    if(db.start)await db.start();
    const subject=id==='naver'?profile.response?.id:id==='kakao'?profile.id:profile.sub;
    const email=(id==='naver'?profile.response?.email:id==='kakao'?profile.kakao_account?.email:profile.email)?.trim().toLowerCase();
    if(id==='naver'&&subject&&!email)return answer(302,null,{Location:'/?social=email-required&provider=naver','Set-Cookie':setCookie(request,'oauth_state','',0)});
    if(!subject||!email||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||(id==='google'&&!profile.email_verified)||(id==='kakao'&&(!profile.kakao_account.is_email_valid||!profile.kakao_account.is_email_verified)))return answer(400,{error:'SNS 계정의 이메일 제공 동의와 이메일 인증 상태를 확인해 주세요.'});
    const pending=random();await db.transaction(async()=>{await db.prepare('DELETE FROM oauth_pending WHERE expires_at<=?').run(Date.now());await db.prepare('INSERT INTO oauth_pending VALUES(?,?,?,?,?)').run(hash(pending),id,String(subject),email,Date.now()+600000);});
    return answer(302,null,{Location:'/?social=complete','Set-Cookie':setCookie(request,'oauth_pending',pending,600)});
  }
  const savedToken=cookieValue(request,'oauth_link_pending');
  const saved=savedToken?await db.prepare('SELECT * FROM oauth_pending WHERE token_hash=? AND expires_at>?').get(hash(savedToken),Date.now()):null;
  if(path==='/api/social/resume'){
    if(!saved||!user||user.email!==saved.email)return answer(401,{error:'기존 계정 본인 확인이 완료되지 않았거나 연동 요청이 만료되었습니다.'});
    return answer(200,{ok:true},{'Set-Cookie':setCookie(request,'oauth_pending',savedToken,600)});
  }
  const pendingToken=cookieValue(request,'oauth_pending');const pending=pendingToken?await db.prepare('SELECT * FROM oauth_pending WHERE token_hash=? AND expires_at>?').get(hash(pendingToken),Date.now()):null;
  if(!pending)return answer(400,{error:'SNS 인증이 만료되었습니다. 다시 로그인하세요.'});
  const identity=await db.prepare('SELECT u.* FROM social_identities s JOIN users u ON u.id=s.user_id WHERE s.provider=? AND s.subject=?').get(pending.provider,pending.subject);
  const existing=await db.prepare('SELECT * FROM users WHERE email=?').get(pending.email);
  if((identity&&identity.status!=='active')||(existing&&existing.status!=='active'))return answer(403,{error:'이용이 제한되었거나 탈퇴한 계정입니다.'});
  const linked=existing?await db.prepare('SELECT provider FROM social_identities WHERE user_id=?').all(existing.id):[];
  const verifyWith=linked.filter(row=>row.provider!==pending.provider&&providerStatus(env).some(p=>p.id===row.provider&&p.enabled)).map(row=>({id:row.provider,name:providers[row.provider].name}));
  if(path==='/api/social/recover'){
    if(!identity)return answer(403,{error:'기존 계정에 이미 연동된 SNS로 인증해야 비밀번호를 재설정할 수 있습니다. 이메일만 같다고 본인 확인이 되지는 않습니다.'});
    const token=await issueResetGrant(db,identity);await db.prepare('DELETE FROM oauth_pending WHERE token_hash=?').run(pending.token_hash);
    return answer(200,{ok:true,email:identity.email},{'Set-Cookie':resetCookie(request,token)});
  }
  if(path==='/api/social/pending')return answer(200,{provider:pending.provider,name:providers[pending.provider].name,email:pending.email,kind:identity?'login':existing?'link':'signup',needsPassword:!!existing?.password_hash,canLink:!!user&&user.id===existing?.id,verifyWith});
  if(path==='/api/social/verify'){
    if(identity||!existing||!verifyWith.some(p=>p.id===input.provider))return answer(400,{error:'기존 계정에 연결된 SNS를 선택해 주세요.'});
    return answer(200,{url:'/api/social/start/'+input.provider},{'Set-Cookie':setCookie(request,'oauth_link_pending',pendingToken,600)});
  }
  if(path==='/api/social/cancel'){await db.prepare('DELETE FROM oauth_pending WHERE token_hash=?').run(pending.token_hash);return answer(200,{ok:true},{'Set-Cookie':setCookie(request,'oauth_pending','',0)});}
  if(path!=='/api/social/finish')return answer(404,{error:'찾을 수 없는 요청입니다.'});
  let account=identity;
  if(!identity&&existing){
    if(input.action!=='link')return answer(409,{error:'이미 가입되어 있는 ID입니다. 기존 계정을 확인하고 SNS 연동에 동의해 주세요.'});
    if(user?.id!==existing.id&&!await verifyPassword(db,existing,input.currentPassword))return answer(401,{error:'기존 이메일 계정의 암호를 확인해 주세요.'});
    account=existing;
  }
  if(!account){
    if(input.action!=='signup')return answer(400,{error:'닉네임을 정하고 SNS 회원가입을 완료해 주세요.'});
    if(pending.email===ADMIN_EMAIL)return answer(403,{error:'운영자 계정은 이메일과 암호로 먼저 가입해야 합니다.'});
    const issue=nicknameError(input.nickname,pending.email);if(issue)return answer(400,{error:issue,field:'nickname'});
    const nickname=input.nickname.normalize('NFKC').trim();
    await db.transaction(async()=>{await db.prepare('INSERT INTO users(email,password_hash,salt,nickname,nickname_key) VALUES(?,?,?,?,?)').run(pending.email,'','',nickname,nicknameKey(nickname));await db.prepare('INSERT INTO social_identities(provider,subject,user_id) SELECT ?,?,id FROM users WHERE email=?').run(pending.provider,pending.subject,pending.email);await db.prepare('DELETE FROM oauth_pending WHERE token_hash=?').run(pending.token_hash);});
    account=await db.prepare('SELECT id,email,nickname FROM users WHERE email=?').get(pending.email);
  }else await db.transaction(async()=>{if(!identity)await db.prepare('INSERT INTO social_identities VALUES(?,?,?)').run(pending.provider,pending.subject,account.id);await db.prepare('DELETE FROM oauth_pending WHERE token_hash=?').run(pending.token_hash);});
  return answer(200,{user:publicUser(account),signInUser:account.id,resumeLink:!!saved&&saved.email===account.email&&savedToken!==pendingToken},{'Set-Cookie':setCookie(request,'oauth_pending','',0)});
}
