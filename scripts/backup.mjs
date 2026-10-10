import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
const dir=process.env.DATA_DIR||path.resolve('data');
const dest=path.join(dir,'backups');mkdirSync(dest,{recursive:true});
const db=new DatabaseSync(path.join(dir,'accounts.sqlite'),{readOnly:true});
try {
  const target=path.join(dest,'accounts-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
  await backup(db,target);console.log(target);
}finally{db.close();}
