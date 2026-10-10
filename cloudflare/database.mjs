// D1 batches are atomic. A revision guard rejects stale reads before any write,
// including a manager editing a team while it is being transferred.
export class Conflict extends Error {
  constructor(){super('다른 변경이 먼저 저장되었습니다. 새로고침한 뒤 다시 시도해 주세요.');this.code='CONFLICT';}
}
export class Database {
  constructor(binding){this.binding=binding;this.revision=null;this.pending=null;}
  async start(){this.revision=(await this.binding.prepare('SELECT revision FROM app_revision WHERE id=1').first()).revision;return this;}
  prepare(sql){
    const statement=(args)=>this.binding.prepare(sql).bind(...args);
    return {
      get:async(...args)=>await statement(args).first(),
      all:async(...args)=>(await statement(args).all()).results,
      run:async(...args)=>{
        const query=statement(args);
        if(this.pending){this.pending.push(query);return {changes:1};}
        const [result]=await this.write([query]);
        return {changes:result.meta.changes,lastInsertRowid:result.meta.last_row_id};
      },
    };
  }
  async write(statements){
    if(!statements.length)return [];
    try{
      const results=await this.binding.batch([
        this.binding.prepare('INSERT INTO app_write_guard(id,ok) VALUES(1,(SELECT revision=? FROM app_revision WHERE id=1)) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok').bind(this.revision),
        ...statements,
        this.binding.prepare('UPDATE app_revision SET revision=revision+1 WHERE id=1'),
      ]);
      this.revision++;
      return results.slice(1,-1);
    }catch(error){if(error.message.includes('CHECK constraint failed'))throw new Conflict();throw error;}
  }
  async verify(){if((await this.binding.prepare('SELECT revision FROM app_revision WHERE id=1').first()).revision!==this.revision)throw new Conflict();}
  async transaction(action){
    if(this.pending)throw new Error('Nested transactions are not supported');
    this.pending=[];
    try{
      const result=await action();
      const statements=this.pending;this.pending=null;
      if(!result?.status||result.status<400)await this.write(statements);
      return result;
    }finally{this.pending=null;}
  }
}
