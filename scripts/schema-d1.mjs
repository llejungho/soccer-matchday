import {DatabaseSync} from 'node:sqlite';
import {writeFileSync,mkdirSync} from 'node:fs';
import {initializeTeams} from '../teams.mjs';
import {initializeSquads} from '../squads.mjs';
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);`);
initializeTeams(db);initializeSquads(db);
const statements=db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(row=>row.sql+';');
statements.push('CREATE TABLE IF NOT EXISTS app_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);',
  'INSERT OR IGNORE INTO app_revision VALUES(1,0);',
  'CREATE TABLE IF NOT EXISTS app_write_guard(id INTEGER PRIMARY KEY CHECK(id=1),ok INTEGER NOT NULL CHECK(ok=1));',
  'CREATE TABLE IF NOT EXISTS auth_attempts(ip TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);');
mkdirSync('migrations',{recursive:true});
writeFileSync('migrations/0001_initial.sql',statements.join('\n')+'\n');db.close();
