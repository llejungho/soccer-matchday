import {initializeCommunity, handleCommunity,nicknameError,nicknameKey,publicUser} from './community.mjs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isIP } from 'node:net';
import { initializeTeams, handleTeams } from './teams.mjs';
import { initializeSquads, handleSquads, sharedSquad } from './squads.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'accounts.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);`);
initializeTeams(db);
initializeSquads(db);
initializeCommunity(db);
const derive = promisify(scrypt);
const digest = token => createHash('sha256').update(token).digest('hex');
const attempts = new Map();
const sessionDuration = 7 * 24 * 60 * 60;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function userFor(req) {
  const token = /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  return db.prepare('SELECT users.id, users.email, users.nickname FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?').get(digest(token), Date.now()) || null;
}
function signIn(res, user) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), user.id, Date.now() + sessionDuration * 1000);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDuration}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
async function body(req) {
  let content = '';
  for await (const chunk of req) {
    content += chunk;
    if (Buffer.byteLength(content) > 131072) throw new Error('BODY_LIMIT');
  }
  return JSON.parse(content);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/api/shared/')) {const result=sharedSquad(db,url.pathname.slice('/api/shared/'.length));return json(res,result.status,result.body);}
    if (req.method === 'GET' && url.pathname.startsWith('/share/')) {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(readFileSync(path.join(root,'public','shared.html')));}
    if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { user: publicUser(userFor(req)) });
    if (url.pathname === '/api/teams/state' && req.method === 'GET') {
      const result = handleTeams(db, url.pathname, userFor(req), {});
      return json(res, result.status, result.body);
    }
    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
      const expected = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
      if (req.headers.origin !== expected) return json(res, 403, { error: '허용되지 않은 요청입니다.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'JSON 형식이 필요합니다.' });
      if(url.pathname.startsWith('/api/community/')){const result=await handleCommunity(db,url.pathname,userFor(req),await body(req));return json(res,result.status,result.body);}
      if (url.pathname.startsWith('/api/squads/')) {const result=handleSquads(db,url.pathname,userFor(req),await body(req));return json(res,result.status,result.body);}
      if (url.pathname.startsWith('/api/teams/')) {
        const result = handleTeams(db, url.pathname, userFor(req), await body(req));
        return json(res, result.status, result.body);
      }
      if (url.pathname === '/api/logout') {
        const token = /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
        res.setHeader('Set-Cookie', `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (!['/api/signup', '/api/login'].includes(url.pathname)) return json(res, 404, { error: '찾을 수 없는 요청입니다.' });
      const forwarded=req.headers['x-real-ip'];
      const key = process.env.TRUST_PROXY === '1' && typeof forwarded==='string' && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
      const now = Date.now();
      for (const [ip, record] of attempts) if (record.until < now) attempts.delete(ip);
      const record = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      attempts.set(key, record);
      if (++record.count > 30) return json(res, 429, { error: '요청이 많습니다. 15분 뒤 다시 시도해 주세요.' });
      const input = await body(req);
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: '올바른 이메일 주소를 입력해 주세요.', field: 'email' });
      if (password.length < 8 || password.length > 128) return json(res, 400, { error: '암호는 8~128자로 입력해 주세요.', field: 'password' });
      if (url.pathname === '/api/signup') {
        if (password !== input.confirmPassword) return json(res, 400, { error: '암호가 일치하지 않습니다.', field: 'confirmPassword' });
        const nicknameIssue=nicknameError(input.nickname,email);if(nicknameIssue)return json(res,400,{error:nicknameIssue,field:'nickname'});
        const nickname=input.nickname.normalize('NFKC').trim();
        const salt = randomBytes(16).toString('hex');
        const hash = (await derive(password, salt, 64)).toString('hex');
        let result;
        try { result = db.prepare('INSERT INTO users (email, password_hash, salt, nickname, nickname_key) VALUES (?, ?, ?, ?, ?)').run(email, hash, salt,nickname,nicknameKey(nickname)); }
        catch (error) {
          if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE')) return json(res, 409, { error: error.message.includes('nickname')?'이미 사용 중인 닉네임입니다.':'이미 가입된 이메일입니다. 로그인해 주세요.', field: error.message.includes('nickname')?'nickname':'email' });
          throw error;
        }
        const user = { id: Number(result.lastInsertRowid), email,nickname };
        signIn(res, user);
        return json(res, 201, { user:publicUser(user) });
      }
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const hash = await derive(password, user?.salt || 'invalid-user-timing-salt', 64);
      if (!user || !timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex'))) return json(res, 401, { error: '이메일 또는 암호를 확인해 주세요.' });
      signIn(res, user);
      return json(res, 200, { user: publicUser(user) });
    }
    const files = { '/community.js':['community.js','text/javascript'], '/quota-defaults.js':['quota-defaults.js','text/javascript'], '/squad-history.js': ['squad-history.js','text/javascript'], '/squads.js': ['squads.js', 'text/javascript'], '/squad-engine.js': ['squad-engine.js','text/javascript'], '/squad-view.js': ['squad-view.js','text/javascript'], '/shared.js': ['shared.js','text/javascript'], '/squads.css': ['squads.css','text/css'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/teams.js': ['teams.js', 'text/javascript'], '/teams.css': ['teams.css', 'text/css'], '/profiles.css': ['profiles.css', 'text/css'], '/styles.css': ['styles.css', 'text/css'] };
    if (req.method === 'GET' && files[url.pathname]) {
      const [file, type] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(path.join(root, 'public', file)));
    }
    json(res, 404, { error: '페이지를 찾을 수 없습니다.' });
  } catch (error) {
    if (error instanceof SyntaxError || error.message === 'BODY_LIMIT') return json(res, 400, { error: '입력 내용을 확인해 주세요.' });
    console.error('Request failed:', error.code || error.name);
    json(res, 500, { error: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`MATCHDAY: http://${process.env.HOST || '127.0.0.1'}:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
