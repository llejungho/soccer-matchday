// Queue writes during async actions, then execute them synchronously in one
// SQLite transaction. No transaction remains open across event-loop turns.
export function asyncDatabase(sqlite){let pending=null;const adapter={
  prepare(sql){return {get:(...args)=>sqlite.prepare(sql).get(...args),all:(...args)=>sqlite.prepare(sql).all(...args),run:(...args)=>{if(pending){pending.push([sql,args]);return {changes:1};}return sqlite.prepare(sql).run(...args);}};},
  async transaction(action){if(pending)throw new Error('Nested transaction');pending=[];try{const result=await action();const writes=pending;pending=null;if(!result?.status||result.status<400){sqlite.exec('BEGIN');try{for(const [sql,args] of writes)sqlite.prepare(sql).run(...args);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}return result;}finally{pending=null;}},
};return adapter;}
