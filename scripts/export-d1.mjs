// Consistent snapshot of a running SQLite database. Never publish this file.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {initializeTeams} from '../teams.mjs';
import {initializeSquads} from '../squads.mjs';
import {initializeCommunity} from '../community.mjs';
const folder=path.resolve(process.env.DATA_DIR||'data','exports');mkdirSync(folder,{recursive:true});
const snapshot=path.join(folder,'migration-'+Date.now()+'.sqlite');
const source=new DatabaseSync(path.resolve(process.env.DATA_DIR||'data','accounts.sqlite'),{readOnly:true});
try{await backup(source,snapshot);}finally{source.close();}
const db=new DatabaseSync(snapshot);
try{
  initializeTeams(db);initializeSquads(db);initializeCommunity(db);
  const tables=['users','teams','players','player_profiles','team_preferences','team_transfers','player_chemistry','team_tactics','team_rating_fields','player_custom_ratings','team_basic_rating_fields','squads','squad_shares','team_formations','squad_outcomes','board_posts','board_comments','player_quota_defaults'];
  const quote=name=>'"'+name.replaceAll('"','""')+'"';
  const literal=value=>value===null?'NULL':typeof value==='number'||typeof value==='bigint'?String(value):"'"+String(value).replaceAll("'","''")+"'";
  const lines=['-- Private migration. Import only into an EMPTY production database.','PRAGMA defer_foreign_keys=ON;'];
  const counts={};
  for(const table of tables){
    const rows=db.prepare('SELECT * FROM '+quote(table)).all();counts[table]=rows.length;
    for(const row of rows)lines.push(`INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(',')}) VALUES (${Object.values(row).map(literal).join(',')});`);
  }
  // Local sessions are intentionally not migrated. Existing passwords still work.
  const target=path.join(folder,'cloudflare-import.sql');writeFileSync(target,lines.join('\n')+'\n');
  console.log(JSON.stringify({file:target,users:counts.users,teams:counts.teams,players:counts.players}));
}finally{db.close();}
