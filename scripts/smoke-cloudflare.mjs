// Explicitly opt in with a URL. Creates disposable records, then writes private
// cleanup SQL for the database administrator. Never edits an existing team.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.argv[2];if(!origin||new URL(origin).origin!==origin)throw new Error('Pass a base URL without a trailing slash');
const key=randomBytes(6).toString('hex'),email=`cloudflare-qa-${key}@example.invalid`,password=randomBytes(24).toString('hex'),teamName='Cloudflare QA '+key;
let cookie='';
async function call(path,input){
  const response=await fetch(origin+path,{method:input===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie},...(input===undefined?{}:{body:JSON.stringify(input)})});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const result=await response.json();assert.ok(response.status<400,`${path}: HTTP ${response.status} ${JSON.stringify(result)}`);return result;
}
const q=value=>"'"+value.replaceAll("'","''")+"'";
const team=`(SELECT id FROM teams WHERE name=${q(teamName)})`,players=`(SELECT id FROM players WHERE team_id IN ${team})`,squads=`(SELECT id FROM squads WHERE team_id IN ${team})`,user=`(SELECT id FROM users WHERE email=${q(email)})`;
const cleanup=[
  `DELETE FROM squad_outcomes WHERE squad_id IN ${squads};`,`DELETE FROM squad_shares WHERE squad_id IN ${squads};`,`DELETE FROM squads WHERE team_id IN ${team};`,
  `DELETE FROM player_custom_ratings WHERE player_id IN ${players};`,`DELETE FROM player_chemistry WHERE player_a IN ${players} OR player_b IN ${players};`,`DELETE FROM player_profiles WHERE player_id IN ${players};`,`DELETE FROM players WHERE team_id IN ${team};`,
  ...['team_tactics','team_rating_fields','team_basic_rating_fields','team_formations','team_transfers'].map(table=>`DELETE FROM ${table} WHERE team_id IN ${team};`),
  `DELETE FROM team_preferences WHERE user_id IN ${user};`,`DELETE FROM teams WHERE id IN ${team};`,`DELETE FROM sessions WHERE user_id IN ${user};`,`DELETE FROM users WHERE id IN ${user};`,
];
mkdirSync('data/exports',{recursive:true});writeFileSync('data/exports/cloudflare-qa-cleanup.sql',cleanup.join('\n'));
await call('/api/signup',{nickname:'QA'+key,email,password,confirmPassword:password});
await call('/api/logout',{});await call('/api/login',{email,password});
const created=await call('/api/teams/create',{name:teamName,color:'#123456'}),teamId=created.selectedTeam.id;
assert.equal(created.basicFields.length,5);
let roster;
for(let i=0;i<11;i++)roster=(await call('/api/teams/players/add',{teamId,name:'QA '+i})).players;
const ratings={stamina:5,aggression:4,attack:3,defense:2,overall:4};
for(const [i,player] of roster.entries())await call('/api/teams/players/update',{teamId,playerId:player.id,name:player.name,positions:[i===10?'GK':'CB'],ratings,comment:'Private QA comment',chemistry:{good:[],bad:[]}});
await call('/api/teams/ratings/delete',{teamId,builtinKey:'aggression'});
await call('/api/teams/tactics/save',{teamId,name:'Press',concept:'Pressing',traits:'체력'});
const state=await call('/api/teams/state');assert.equal(state.players.length,11);assert.equal(state.players[0].ratings.aggression,null);
await call('/api/squads/formations',{teamId,code:'532',action:'add'});
const config={name:'QA squad',quarters:[{formation:'532',tacticId:state.tactics[0].id}],attendees:roster.map((p,i)=>({playerId:p.id,quota:1,keeper:i===10})),guests:[],mode:'individual'};
const generated=await call('/api/squads/generate',{teamId,config});assert.equal(generated.result.quarters.length,1);
await call('/api/squads/outcomes',{teamId,squadId:generated.id,outcomes:['win']});
assert.equal((await call('/api/squads/analysis',{teamId})).recordedQuarters,1);
const share=await call('/api/squads/share',{teamId,squadId:generated.id});
const publicResponse=await fetch(origin+'/api/shared/'+share.path.split('/').at(-1));assert.equal(publicResponse.status,200);const snapshot=await publicResponse.text();assert.ok(!snapshot.includes('Private QA'));assert.ok(!snapshot.includes('ratings'));
await call('/api/squads/unshare',{teamId,squadId:generated.id});
const ended=await fetch(origin+'/api/shared/'+share.path.split('/').at(-1));assert.equal(ended.status,404);
console.log('PASS: endpoint signup, login, team, 11 profiles, editable criteria, tactic, 532, squad, outcomes, analysis, anonymous share, revoke. Cleanup: data/exports/cloudflare-qa-cleanup.sql');
