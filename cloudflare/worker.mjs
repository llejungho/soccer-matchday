import {handleRecovery} from '../password-recovery.mjs';
import {handleAccount} from '../account.mjs';
import {handleSocial} from '../social-auth.mjs';
import { handleCommunity,nicknameError,nicknameKey,publicUser} from '../community.mjs';
import {randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {Database,Conflict} from './database.mjs';
import {handleTeams} from './teams.mjs';
import {handleSquads,sharedSquad} from './squads.mjs';

const derive=promisify(scrypt);
const digest=value=>createHash('sha256').update(value).digest('hex');
const sessionDuration=7*24*60*60;
const tokenFor=request=>/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1];
const cookie=(request,token,maxAge)=>`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
const headers={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' https://t1.kakaocdn.net https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com; connect-src 'self' https://kapi.kakao.com https://kauth.kakao.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com; frame-src https://kakao.com https://*.kakao.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com; style-src 'self'; img-src 'self' data: https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://sharer.kakao.com",
};
const json=(status,body,extra={})=>Response.json(body,{status,headers:{...headers,'Cache-Control':'no-store',...extra}});
async function userFor(db,request){
  const token=tokenFor(request);
  return token?await db.prepare('SELECT users.id,users.email,users.nickname FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND users.status=\'active\'').get(digest(token),Date.now()):null;
}
async function signIn(db,request,user){
  const token=randomBytes(32).toString('hex');
  await db.transaction(async()=>{
    await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,Date.now()+sessionDuration*1000);
  });
  return cookie(request,token,sessionDuration);
}
async function readBody(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))return null;
  const reader=request.body?.getReader();if(!reader)throw new SyntaxError();
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072){await reader.cancel();throw new SyntaxError();}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const input=JSON.parse(new TextDecoder().decode(bytes));
  if(!input||typeof input!=='object'||Array.isArray(input))throw new SyntaxError();
  return input;
}
async function auth(binding,request,path,input){
  // Persistent rate limiting survives Worker restarts and applies across instances.
  const now=Date.now(),key=digest(request.headers.get('cf-connecting-ip')||'local');
  await binding.prepare('DELETE FROM auth_attempts WHERE until<?').bind(now).run();
  const record=await binding.prepare('INSERT INTO auth_attempts(ip,count,until) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+15*60*1000).first();
  if(record.count>30)return json(429,{error:'요청이 많습니다. 15분 뒤 다시 시도해 주세요.'});
  const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
  const password=typeof input.password==='string'?input.password:'';
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(400,{error:'올바른 이메일 주소를 입력해 주세요.',field:'email'});
  if(password.length<8||password.length>128)return json(400,{error:'암호는 8~128자로 입력해 주세요.',field:'password'});
  if(path==='/api/signup'){
    if(password!==input.confirmPassword)return json(400,{error:'암호가 일치하지 않습니다.',field:'confirmPassword'});
    const nicknameIssue=nicknameError(input.nickname,email);if(nicknameIssue)return json(400,{error:nicknameIssue,field:'nickname'});
    const nickname=input.nickname.normalize('NFKC').trim();
    const salt=randomBytes(16).toString('hex'),hash=(await derive(password,salt,64)).toString('hex');
    const db=await new Database(binding).start();let user;
    try{const result=await db.prepare('INSERT INTO users(email,password_hash,salt,nickname,nickname_key) VALUES(?,?,?,?,?)').run(email,hash,salt,nickname,nicknameKey(nickname));user={id:Number(result.lastInsertRowid),email,nickname};}
    catch(error){if(error.message.includes('UNIQUE'))return json(409,{error:error.message.includes('nickname')?'이미 사용 중인 닉네임입니다.':'이미 가입된 이메일입니다. 로그인해 주세요.',field:error.message.includes('nickname')?'nickname':'email'});throw error;}
    return json(201,{user:publicUser(user)},{'Set-Cookie':await signIn(db,request,user)});
  }
  const user=await binding.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  const hash=await derive(password,user?.salt||'invalid-user-timing-salt',64);
  const stored=Buffer.from(user?.password_hash||'','hex');
  if(!user||user.status!=='active'||stored.length!==hash.length||!timingSafeEqual(hash,stored))return json(401,{error:'이메일 또는 암호를 확인해 주세요.'});
  const db=await new Database(binding).start();
  return json(200,{user:publicUser(user)},{'Set-Cookie':await signIn(db,request,user)});
}
async function domainResponse(db,request,result){const body={...result.body};if(body.signedOut)result.headers={...result.headers,'Set-Cookie':cookie(request,'',0)};const response=new Response(result.body===null?null:JSON.stringify(body),{status:result.status,headers:{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...result.headers}});if(body.signInUser||body.renewSession){const account=body.signInUser?await db.prepare('SELECT id,email,nickname FROM users WHERE id=?').get(body.signInUser):body.user;response.headers.append('Set-Cookie',await signIn(db,request,account));delete body.signInUser;delete body.renewSession;return new Response(JSON.stringify(body),{status:result.status,headers:response.headers});}return response;}
export default {
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    try{
      if(!path.startsWith('/api/')){
        if(!['GET','HEAD'].includes(request.method))return json(405,{error:'허용되지 않은 요청입니다.'});
        const assetUrl=new URL(request.url);if(path.startsWith('/share/'))assetUrl.pathname='/shared.html';
        const response=await env.ASSETS.fetch(new Request(assetUrl,request));
        const result=new Response(response.body,response);
        for(const [key,value] of Object.entries(headers))result.headers.set(key,value);
        result.headers.set('Cache-Control','no-cache');return result;
      }
      if(!env.DB)return json(503,{error:'서버의 데이터베이스 연결이 준비되지 않았습니다. 관리자에게 문의해 주세요.'});
      if(request.method==='POST'){
        if(request.headers.get('origin')!==url.origin)return json(403,{error:'허용되지 않은 요청입니다.'});
        const input=await readBody(request);
        if(!input)return json(415,{error:'JSON 형식이 필요합니다.'});
        if(['/api/signup','/api/login'].includes(path))return await auth(env.DB,request,path,input);
        const db=await new Database(env.DB).start(),user=await userFor(db,request);
        if(path==='/api/logout'){
          const token=tokenFor(request);if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
          return json(200,{ok:true},{'Set-Cookie':cookie(request,'',0)});
        }
        let result;
        if(path.startsWith('/api/recovery/'))result=await handleRecovery(db,request,env,input);
        else if(path.startsWith('/api/account/'))result=await handleAccount(db,path,user,input);
        else if(path.startsWith('/api/social/'))result=await handleSocial(db,request,env,user,input);
        else if(path.startsWith('/api/community/'))result=await handleCommunity(db,path,user,input);
        else if(path.startsWith('/api/teams/'))result=await handleTeams(db,path,user,input);
        else if(path.startsWith('/api/squads/'))result=await handleSquads(db,path,user,input);
        else return json(404,{error:'찾을 수 없는 요청입니다.'});
        await db.verify();return await domainResponse(db,request,result);
      }
      if(request.method==='GET'){
        const db=await new Database(env.DB).start();let result;
        if(path.startsWith('/api/social/'))result=await handleSocial(db,request,env,await userFor(db,request));
        else if(path==='/api/recovery/status')result=await handleRecovery(db,request,env);
        else if(path==='/api/me')result={status:200,body:{user:publicUser(await userFor(db,request))}};
        else if(path==='/api/teams/state')result=await handleTeams(db,path,await userFor(db,request),{});
        else if(path.startsWith('/api/shared/'))result=await sharedSquad(db,path.slice('/api/shared/'.length));
        else return json(404,{error:'찾을 수 없는 요청입니다.'});
        await db.verify();return await domainResponse(db,request,result);
      }
      return json(405,{error:'허용되지 않은 요청입니다.'});
    }catch(error){
      if(error instanceof Conflict)return json(409,{error:error.message});
      if(error.status)return json(error.status,{error:error.message});
      if(error.message.includes('UNIQUE'))return json(409,{error:'닉네임 또는 SNS 계정이 이미 등록되어 있습니다.'});
      if(error.message.startsWith('SNS 인증'))return json(400,{error:error.message});
      if(error instanceof SyntaxError)return json(400,{error:'입력 내용을 확인해 주세요.'});
      console.error('Request failed:',error.code||error.name);
      return json(500,{error:'처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'});
    }
  },
};
