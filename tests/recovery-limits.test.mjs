import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleRecovery} from '../password-recovery.mjs';
import {asyncDatabase} from '../local-database.mjs';
import {Database} from '../cloudflare/database.mjs';
import {migratedDatabase,bindingFor} from './helper-database.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');

for(const runtime of ['SQLite','D1'])test(runtime+' recovery separates shared IP and email limits and reports remaining wait',async()=>{
  const sqlite=migratedDatabase();
  const call=async(email,ip='192.0.2.1')=>handleRecovery(runtime==='SQLite'?asyncDatabase(sqlite):await new Database(bindingFor(sqlite)).start(),new Request('https://test.pages.dev/api/recovery/request',{headers:{'cf-connecting-ip':ip}}),{GMAIL_APP_PASSWORD:'aaaabbbbccccdddd'},{email},fetch,()=>{throw new Error('Unknown accounts must not send');});
  try{
    sqlite.prepare('INSERT INTO recovery_attempts VALUES(?,5,?)').run('email:'+hash('one@example.com'),Date.now()+900000);
    for(let i=0;i<10;i++)assert.equal((await call('one@example.com')).status,200);
    assert.equal((await call('one@example.com','192.0.2.2')).status,429,'Changing IP must not bypass email limit');
    assert.equal((await call('two@example.com')).status,200,'Other members on shared network remain eligible');
    const emailKey='send-v2:email:'+hash('one@example.com');
    sqlite.prepare('UPDATE recovery_attempts SET until=? WHERE key=?').run(Date.now()+65000,emailKey);
    const blocked=await call('one@example.com');
    assert.equal(blocked.status,429);assert.ok(blocked.body.retryAfterSeconds>=64&&blocked.body.retryAfterSeconds<=65);
    assert.equal(blocked.headers['Retry-After'],String(blocked.body.retryAfterSeconds));assert.match(blocked.body.error,/1분 [45]초/);
    sqlite.prepare('UPDATE recovery_attempts SET until=0 WHERE key=?').run(emailKey);
    assert.equal((await call('one@example.com')).status,200,'Expired email window resets');
    assert.equal(sqlite.prepare('SELECT count,until FROM recovery_attempts WHERE key=?').get(emailKey).count,1);
    sqlite.exec('DELETE FROM recovery_attempts');
    for(let i=0;i<100;i++)assert.equal((await call(`member${i}@example.com`)).status,200);
    assert.equal((await call('next@example.com')).status,429,'Shared IP has a separate higher abuse limit');
    assert.equal((await call('next@example.com','192.0.2.3')).status,200,'Unrelated networks remain eligible');
  }finally{sqlite.close();}
});
