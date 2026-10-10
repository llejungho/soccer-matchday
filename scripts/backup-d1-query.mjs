// Fallback when the Cloudflare export endpoint rejects the OAuth session.
// All table rows are read in ONE SELECT, so they share a SQLite read snapshot.
// The private output remains under ignored data/backups; never print row data.
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
const candidates=[path.join(homedir(),'.wrangler/config/default.toml'),path.join(homedir(),'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),path.join(homedir(),'.config/.wrangler/config/default.toml')];
const config=candidates.find(existsSync);if(!config)throw new Error('Run wrangler login first');
const token=/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(config,'utf8'))?.[1];if(!token)throw new Error('OAuth session missing');
const endpoint='https://api.cloudflare.com/client/v4/accounts/e9cd400aa7d2e03a4380c5985a08cc8e/d1/database/5a3cf611-fbaa-4033-9d70-8c56c754a02e/query';
async function query(sql){const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params:[]})});const result=await response.json();if(!result.success)throw new Error('Cloudflare backup query failed: '+JSON.stringify(result.errors));if(result.result.some(r=>!r.success))throw new Error('Backup query failed');return result.result[0].results;}
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const schema=await query("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
const definitions=[];
for(const table of schema){const columns=await query('PRAGMA table_info('+identifier(table.name)+')');definitions.push({...table,columns:columns.map(c=>c.name)});}
const parents=['users','teams','players','team_rating_fields','squads','board_posts'];
definitions.sort((a,b)=>(parents.includes(a.name)?parents.indexOf(a.name):100)-(parents.includes(b.name)?parents.indexOf(b.name):100));
const sql='SELECT json_object('+definitions.map(t=>`${literal(t.name)},json((SELECT json_group_array(json_object(${t.columns.map(c=>`${literal(c)},${identifier(c)}`).join(',')})) FROM ${identifier(t.name)}))`).join(',')+') AS snapshot';
const snapshot=JSON.parse((await query(sql))[0].snapshot);
const rows=definitions.flatMap(t=>snapshot[t.name].map(row=>({table_name:t.name,row_data:JSON.stringify(row)})));
const lines=['-- Private consistent D1 snapshot. Restore only into a verified empty database.','PRAGMA defer_foreign_keys=ON;',...schema.map(t=>t.sql+';')];
for(const item of rows){const row=JSON.parse(item.row_data);lines.push(`INSERT INTO ${identifier(item.table_name)} (${Object.keys(row).map(identifier).join(',')}) VALUES (${Object.values(row).map(literal).join(',')});`);}
const indexes=await query("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE '_cf_%'");lines.push(...indexes.map(i=>i.sql+';'));
mkdirSync('data/backups',{recursive:true});const output='data/backups/before-community-'+Date.now()+'.sql';writeFileSync(output,lines.join('\n')+'\n');
console.log(JSON.stringify({file:output,tables:schema.length,rows:rows.length}));
