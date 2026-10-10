import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function migratedDatabase(){const db=new DatabaseSync(':memory:');for(const file of ['0001_initial.sql','0002_community.sql','0003_accounts_boards_tactics.sql','0005_account_status.sql','0006_password_recovery.sql'])db.exec(readFileSync('migrations/'+file,'utf8'));return db;}
export function bindingFor(sqlite){
  const prepare=(sql,args=[])=>{const run=()=>{const stmt=sqlite.prepare(sql);if(stmt.columns().length){const results=stmt.all(...args);return {results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n,last_row_id:sqlite.prepare('SELECT last_insert_rowid() AS n').get().n}};}const result=stmt.run(...args);return {results:[],meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}};};return {bind:(...values)=>prepare(sql,values),execute:run,first:async()=>run().results[0]||null,all:async()=>run(),run:async()=>run()};};
  return {prepare,batch:async statements=>{sqlite.exec('BEGIN');try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
