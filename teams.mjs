export function initializeTeams(db) {

  db.exec('CREATE TABLE IF NOT EXISTS player_quota_defaults(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),quota REAL NOT NULL CHECK(quota BETWEEN 0 AND 12 AND quota*2=CAST(quota*2 AS INTEGER)),PRIMARY KEY(player_id,user_id));');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS teams(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id), name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS player_profiles(player_id INTEGER PRIMARY KEY REFERENCES players(id), positions TEXT NOT NULL DEFAULT '[]', stamina INTEGER CHECK(stamina BETWEEN 1 AND 5), aggression INTEGER CHECK(aggression BETWEEN 1 AND 5), attack INTEGER CHECK(attack BETWEEN 1 AND 5), defense INTEGER CHECK(defense BETWEEN 1 AND 5), overall INTEGER CHECK(overall BETWEEN 1 AND 5));
    CREATE TABLE IF NOT EXISTS team_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id), team_id INTEGER REFERENCES teams(id));
    CREATE TABLE IF NOT EXISTS team_transfers(id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id), sender_id INTEGER NOT NULL REFERENCES users(id), recipient_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_transfer ON team_transfers(team_id) WHERE status='pending';`);
  if (!db.prepare('PRAGMA table_info(player_profiles)').all().some(column => column.name === 'comment')) db.exec("ALTER TABLE player_profiles ADD COLUMN comment TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS player_chemistry(
    player_a INTEGER NOT NULL REFERENCES players(id), player_b INTEGER NOT NULL REFERENCES players(id),
    kind TEXT NOT NULL CHECK(kind IN ('good','bad')), PRIMARY KEY(player_a,player_b), CHECK(player_a < player_b));
    CREATE TABLE IF NOT EXISTS team_tactics(id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER NOT NULL REFERENCES teams(id), name TEXT NOT NULL, concept TEXT NOT NULL, traits TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS team_rating_fields(id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER NOT NULL REFERENCES teams(id), name TEXT NOT NULL, UNIQUE(team_id,name));
    CREATE TABLE IF NOT EXISTS player_custom_ratings(player_id INTEGER NOT NULL REFERENCES players(id), field_id INTEGER NOT NULL REFERENCES team_rating_fields(id) ON DELETE CASCADE, score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), PRIMARY KEY(player_id,field_id));`);
  if(!db.prepare('PRAGMA table_info(team_tactics)').all().some(c=>c.name==='rating_fields'))db.exec("ALTER TABLE team_tactics ADD COLUMN rating_fields TEXT NOT NULL DEFAULT '[]'");
  db.exec(`CREATE TABLE IF NOT EXISTS team_basic_rating_fields(team_id INTEGER NOT NULL REFERENCES teams(id),key TEXT NOT NULL,name TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(team_id,key));`);
}
const positionsAllowed = ['CF', 'SS', 'LW', 'RW', 'AM', 'LM', 'CM', 'RM', 'DM', 'LWB', 'RWB', 'CB', 'GK'];
const ratingKeys = ['stamina', 'aggression', 'attack', 'defense', 'overall'];
const defaultRatings = {stamina:'체력',aggression:'적극성',attack:'공격력',defense:'수비력',overall:'전체 실력'};
function basicFields(db,teamId){
  for(const [key,name] of Object.entries(defaultRatings))db.prepare('INSERT OR IGNORE INTO team_basic_rating_fields(team_id,key,name) VALUES(?,?,?)').run(teamId,key,name);
  return db.prepare('SELECT key,name FROM team_basic_rating_fields WHERE team_id=? AND deleted=0 ORDER BY rowid').all(teamId);
}
const response = (status, body) => ({ status, body });
const failure = (status, error) => response(status, { error });
function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = action(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function state(db, user) {
  const teams = db.prepare('SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM players p WHERE p.team_id=t.id) AS playerCount FROM teams t WHERE owner_id=? ORDER BY id').all(user.id);
  const saved = db.prepare('SELECT team_id FROM team_preferences WHERE user_id=?').get(user.id)?.team_id;
  const selected = teams.find(team => team.id === saved) || teams[0] || null;
  const basic = selected ? basicFields(db,selected.id) : [];
  db.prepare('INSERT INTO team_preferences VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id').run(user.id, selected?.id || null);
  const relationships = selected ? db.prepare('SELECT c.* FROM player_chemistry c JOIN players a ON a.id=c.player_a JOIN players b ON b.id=c.player_b WHERE a.team_id=? AND b.team_id=? ORDER BY c.player_a,c.player_b').all(selected.id, selected.id) : [];
  const players = selected ? db.prepare('SELECT p.id, p.name, f.positions, f.stamina, f.aggression, f.attack, f.defense, f.overall, f.comment FROM players p LEFT JOIN player_profiles f ON f.player_id=p.id WHERE p.team_id=? ORDER BY p.id').all(selected.id).map(player => ({ id: player.id, name: player.name, positions: JSON.parse(player.positions || '[]'), ratings: Object.fromEntries(ratingKeys.map(key => [key, player[key]])), comment: player.comment || '', chemistry: Object.fromEntries(['good','bad'].map(kind => [kind, relationships.filter(pair => pair.kind === kind && (pair.player_a === player.id || pair.player_b === player.id)).map(pair => pair.player_a === player.id ? pair.player_b : pair.player_a)])) })) : [];
  const incoming = db.prepare("SELECT x.id, t.name, t.color, u.email AS senderEmail FROM team_transfers x JOIN teams t ON t.id=x.team_id JOIN users u ON u.id=x.sender_id WHERE x.recipient_id=? AND x.status='pending' AND t.owner_id=x.sender_id ORDER BY x.id DESC").all(user.id);
  const outgoing = db.prepare("SELECT x.id, x.team_id AS teamId, t.name, u.email AS recipientEmail FROM team_transfers x JOIN teams t ON t.id=x.team_id JOIN users u ON u.id=x.recipient_id WHERE x.sender_id=? AND x.status='pending' AND t.owner_id=x.sender_id").all(user.id);
  const tactics = selected ? db.prepare('SELECT id,name,concept,traits,rating_fields FROM team_tactics WHERE team_id=? ORDER BY id').all(selected.id) : [];
  for(const tactic of tactics)tactic.ratingFields=JSON.parse(tactic.rating_fields||'[]');
  const customFields = selected ? db.prepare('SELECT id,name FROM team_rating_fields WHERE team_id=? ORDER BY id').all(selected.id) : [];
  const customScores = selected ? db.prepare('SELECT r.* FROM player_custom_ratings r JOIN players p ON p.id=r.player_id JOIN team_rating_fields f ON f.id=r.field_id WHERE p.team_id=? AND f.team_id=?').all(selected.id, selected.id) : [];
  const quotaDefaults=db.prepare('SELECT player_id,quota FROM player_quota_defaults WHERE user_id=?').all(user.id);
  for(const player of players)player.rememberedQuota=quotaDefaults.find(p=>p.player_id===player.id)?.quota??null;
  for (const player of players) player.customRatings = Object.fromEntries(customFields.map(field => [field.id, customScores.find(score => score.player_id === player.id && score.field_id === field.id)?.score ?? null]));
  for(const player of players)for(const key of ratingKeys)if(!basic.some(f=>f.key===key))player.ratings[key]=null;
  return { teams, selectedTeam: selected, players, incoming, outgoing, tactics, customFields, basicFields:basic };
}
export function handleTeams(db, route, user, input) {
  if (!user) return failure(401, '로그인이 필요합니다.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure(400, '입력 내용을 확인해 주세요.');
  for (const field of ['teamId', 'transferId', 'playerId', 'tacticId', 'fieldId']) {
    if (field in input && (!Number.isSafeInteger(Number(input[field])) || Number(input[field]) <= 0)) return failure(400, '올바른 팀 또는 요청을 선택해 주세요.');
  }
  if (route === '/api/teams/state') return response(200, state(db, user));
  if (route === '/api/teams/create' || route === '/api/teams/update') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 60) return failure(400, '팀명은 1~60자로 입력해 주세요.');
    if (typeof input.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(input.color)) return failure(400, '유니폼 색상을 선택해 주세요.');
    if (route.endsWith('/create')) {
      const result = db.prepare('INSERT INTO teams(owner_id,name,color) VALUES (?,?,?)').run(user.id, name, input.color);
      db.prepare('INSERT INTO team_preferences VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id').run(user.id, Number(result.lastInsertRowid));
      return response(201, state(db, user));
    }
  }
  if (route === '/api/teams/transfer/respond') {
    if (!['accept', 'reject'].includes(input.decision)) return failure(400, '승인 또는 거절을 선택해 주세요.');
    return transaction(db, () => {
      const transfer = db.prepare("SELECT x.* FROM team_transfers x JOIN teams t ON t.id=x.team_id WHERE x.id=? AND x.recipient_id=? AND x.status='pending' AND t.owner_id=x.sender_id").get(Number(input.transferId) || 0, user.id);
      if (!transfer) return failure(404, '이미 처리되었거나 받을 수 없는 요청입니다.');
      if (input.decision === 'accept') {
        db.prepare('UPDATE teams SET owner_id=? WHERE id=? AND owner_id=?').run(user.id, transfer.team_id, transfer.sender_id);
        // A new manager starts with their own position preferences and evaluations.
        db.prepare('DELETE FROM player_profiles WHERE player_id IN (SELECT id FROM players WHERE team_id=?)').run(transfer.team_id);
        db.prepare('DELETE FROM player_custom_ratings WHERE player_id IN (SELECT id FROM players WHERE team_id=?)').run(transfer.team_id);
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='squads'").get()) {
          for (const saved of db.prepare('SELECT id,config FROM squads WHERE team_id=?').all(transfer.team_id)) {
            const config = JSON.parse(saved.config);
            for (const player of config.players || []) if (player.key.startsWith('p:')) Object.assign(player,{positions:[],ratings:{},customRatings:{},comment:'',chemistry:{good:[],bad:[]}});
            db.prepare('UPDATE squads SET config=? WHERE id=?').run(JSON.stringify(config),saved.id);
          }
        }
        db.prepare('DELETE FROM player_chemistry WHERE player_a IN (SELECT id FROM players WHERE team_id=?) OR player_b IN (SELECT id FROM players WHERE team_id=?)').run(transfer.team_id, transfer.team_id);
        db.prepare('UPDATE team_preferences SET team_id=NULL WHERE user_id=? AND team_id=?').run(transfer.sender_id, transfer.team_id);
        const preference = db.prepare('SELECT team_id FROM team_preferences WHERE user_id=?').get(user.id);
        if (!preference?.team_id) db.prepare('INSERT INTO team_preferences VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id').run(user.id, transfer.team_id);
      }
      db.prepare('UPDATE team_transfers SET status=? WHERE id=?').run(input.decision === 'accept' ? 'accepted' : 'rejected', transfer.id);
      return response(200, state(db, user));
    });
  }
  const team = db.prepare('SELECT * FROM teams WHERE id=? AND owner_id=?').get(Number(input.teamId) || 0, user.id);
  if (!team) return failure(404, '관리할 수 없는 팀입니다. 팀을 다시 선택해 주세요.');
  const basic=basicFields(db,team.id);
  if(input.builtinKey!==undefined&&!ratingKeys.includes(input.builtinKey))return failure(400,'올바른 평가 항목을 선택해 주세요.');
  if(input.builtinKey!==undefined&&(input.fieldId!==undefined||!['/api/teams/ratings/update','/api/teams/ratings/delete'].includes(route)))return failure(400,'올바른 평가 항목 요청을 선택해 주세요.');
  if (route === '/api/teams/tactics/save') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const concept = typeof input.concept === 'string' ? input.concept.trim() : '';
    const traits = typeof input.traits === 'string' ? input.traits.trim() : '';
    if (!name || name.length > 60 || concept.length > 1000 || (!traits&&(!Array.isArray(input.ratingFields)||!input.ratingFields.length)) || traits.length > 1000) return failure(400, '전술명은 1~60자, 컨셉과 선수 성향은 각각 1,000자 이내로 작성해 주세요. 선수 성향은 필수입니다.');
    const allowed=[...basic.map(f=>f.key),...(db.prepare('SELECT id FROM team_rating_fields WHERE team_id=?').all(team.id)).map(f=>'custom:'+f.id)];
    const ratingFields=input.ratingFields??[];if(!Array.isArray(ratingFields)||new Set(ratingFields).size!==ratingFields.length||ratingFields.some(key=>!allowed.includes(key)))return failure(400,'현재 팀의 평가 항목을 선택하세요.');
    if (input.tacticId !== undefined) {
      if (!db.prepare('SELECT id FROM team_tactics WHERE id=? AND team_id=?').get(input.tacticId, team.id)) return failure(404, '이 팀의 전술이 아닙니다.');
      db.prepare('UPDATE team_tactics SET name=?,concept=?,traits=?,rating_fields=? WHERE id=?').run(name, concept, traits, JSON.stringify(ratingFields), input.tacticId);
    } else db.prepare('INSERT INTO team_tactics(team_id,name,concept,traits,rating_fields) VALUES(?,?,?,?,?)').run(team.id, name, concept, traits, JSON.stringify(ratingFields));
    return response(200, state(db, user));
  }
  if (route === '/api/teams/tactics/delete') {
    if (!db.prepare('DELETE FROM team_tactics WHERE id=? AND team_id=?').run(Number(input.tacticId) || 0, team.id).changes) return failure(404, '이 팀의 전술이 아닙니다.');
    return response(200, state(db, user));
  }
  if (route === '/api/teams/ratings/add' || route === '/api/teams/ratings/update') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 30) return failure(400, '평가 항목명은 1~30자로 입력해 주세요.');
    if (basic.some(f=>f.key!==input.builtinKey&&f.name.replace(/\s/g,'')===name.replace(/\s/g,'')) || db.prepare("SELECT id FROM team_rating_fields WHERE team_id=? AND REPLACE(name,' ','')=? AND id<>?").get(team.id,name.replace(/\s/g,''),route.endsWith('/update')?Number(input.fieldId)||0:0)) return failure(409, '이미 있는 평가 항목입니다.');
    if (route.endsWith('/update')) {
      if(input.builtinKey!==undefined){if(!db.prepare('UPDATE team_basic_rating_fields SET name=? WHERE team_id=? AND key=? AND deleted=0').run(name,team.id,input.builtinKey).changes)return failure(404,'이 팀의 평가 항목이 아닙니다.');return response(200,state(db,user));}
      if (!db.prepare('UPDATE team_rating_fields SET name=? WHERE id=? AND team_id=?').run(name, Number(input.fieldId) || 0, team.id).changes) return failure(404, '이 팀의 평가 항목이 아닙니다.');
      return response(200, state(db, user));
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM team_rating_fields WHERE team_id=?').get(team.id).count >= 30) return failure(400, '추가 평가 항목은 팀마다 최대 30개입니다.');
    db.prepare('INSERT INTO team_rating_fields(team_id,name) VALUES(?,?)').run(team.id, name);
    return response(200, state(db, user));
  }
  if (route === '/api/teams/ratings/delete') {
    if(input.builtinKey!==undefined)return transaction(db,()=>{
      if(!db.prepare('UPDATE team_basic_rating_fields SET deleted=1 WHERE team_id=? AND key=? AND deleted=0').run(team.id,input.builtinKey).changes)return failure(404,'이 팀의 평가 항목이 아닙니다.');
      db.prepare(`UPDATE player_profiles SET ${input.builtinKey}=NULL WHERE player_id IN (SELECT id FROM players WHERE team_id=?)`).run(team.id);
      if(db.prepare("SELECT name FROM sqlite_master WHERE name='squads'").get())for(const saved of db.prepare('SELECT id,config FROM squads WHERE team_id=?').all(team.id)){const config=JSON.parse(saved.config);for(const p of config.players||[])if(p.ratings)delete p.ratings[input.builtinKey];db.prepare('UPDATE squads SET config=? WHERE id=?').run(JSON.stringify(config),saved.id);}
      return response(200,state(db,user));
    });
    if (!db.prepare('DELETE FROM team_rating_fields WHERE id=? AND team_id=?').run(Number(input.fieldId) || 0, team.id).changes) return failure(404, '이 팀의 평가 항목이 아닙니다.');
    return response(200, state(db, user));
  }
  if (route === '/api/teams/update') db.prepare('UPDATE teams SET name=?,color=? WHERE id=?').run(input.name.trim(), input.color, team.id);
  else if (route === '/api/teams/select') db.prepare('INSERT INTO team_preferences VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id').run(user.id, team.id);
  else if (route === '/api/teams/players/add') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 60) return failure(400, '선수 이름은 1~60자로 입력해 주세요.');
    db.prepare('INSERT INTO players(team_id,name) VALUES (?,?)').run(team.id, name);
  } else if (route === '/api/teams/players/update') {
    const player = db.prepare('SELECT id FROM players WHERE id=? AND team_id=?').get(Number(input.playerId) || 0, team.id);
    if (!player) return failure(404, '이 팀의 선수가 아닙니다.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 60) return failure(400, '선수 이름은 1~60자로 입력해 주세요.');
    if (!Array.isArray(input.positions) || input.positions.length > 3 || new Set(input.positions).size !== input.positions.length || input.positions.some(position => !positionsAllowed.includes(position))) return failure(400, '포지션은 서로 다른 항목으로 최대 3순위까지 선택해 주세요.');
    if (!input.ratings || typeof input.ratings !== 'object' || Array.isArray(input.ratings) || ratingKeys.some(key => input.ratings[key] !== null && (!Number.isInteger(input.ratings[key]) || input.ratings[key] < 1 || input.ratings[key] > 5))) return failure(400, '평가 점수는 미설정 또는 1~5점으로 선택해 주세요.');
    if(ratingKeys.some(key=>!basic.some(f=>f.key===key)&&input.ratings[key]!==null))return failure(400,'삭제된 평가 항목이 있습니다. 프로필을 다시 열어 주세요.');
    const existingProfile = db.prepare('SELECT comment FROM player_profiles WHERE player_id=?').get(player.id);
    const comment = input.comment === undefined ? (existingProfile?.comment || '') : input.comment;
    if (typeof comment !== 'string' || comment.length > 2000) return failure(400, '감독 코멘트는 2,000자 이내로 입력해 주세요.');
    if (input.customRatings !== undefined) {
      const fields = db.prepare('SELECT id FROM team_rating_fields WHERE team_id=?').all(team.id).map(field => String(field.id));
      if (!input.customRatings || typeof input.customRatings !== 'object' || Array.isArray(input.customRatings) || Object.entries(input.customRatings).some(([id, score]) => !fields.includes(id) || (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)))) return failure(400, '현재 팀의 추가 항목은 미설정 또는 1~5점으로 평가해 주세요. 삭제된 항목이 있으면 프로필을 다시 열어 주세요.');
    }
    if (input.chemistry !== undefined) {
      const chemistry = input.chemistry;
      if (!chemistry || typeof chemistry !== 'object' || Array.isArray(chemistry) || ['good','bad'].some(kind => !Array.isArray(chemistry[kind]) || new Set(chemistry[kind]).size !== chemistry[kind].length || chemistry[kind].some(id => !Number.isSafeInteger(id) || id === player.id || !db.prepare('SELECT id FROM players WHERE id=? AND team_id=?').get(id, team.id)))) return failure(400, '궁합은 본인을 제외한 현재 팀 선수 중에서 선택해 주세요.');
      if (chemistry.good.some(id => chemistry.bad.includes(id))) return failure(400, '같은 선수를 좋은 궁합과 안 좋은 궁합에 함께 선택할 수 없습니다.');
    }
    return transaction(db, () => {
      db.prepare('UPDATE players SET name=? WHERE id=?').run(name, player.id);
      db.prepare(`INSERT INTO player_profiles(player_id,positions,stamina,aggression,attack,defense,overall,comment) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(player_id) DO UPDATE SET positions=excluded.positions,stamina=excluded.stamina,aggression=excluded.aggression,attack=excluded.attack,defense=excluded.defense,overall=excluded.overall,comment=excluded.comment`).run(player.id, JSON.stringify(input.positions), ...ratingKeys.map(key => input.ratings[key]), comment.trim());
      if (input.chemistry !== undefined) {
        db.prepare('DELETE FROM player_chemistry WHERE player_a=? OR player_b=?').run(player.id, player.id);
        for (const kind of ['good','bad']) for (const otherId of input.chemistry[kind]) db.prepare('INSERT INTO player_chemistry VALUES (?,?,?)').run(Math.min(player.id, otherId), Math.max(player.id, otherId), kind);
      }
      if (input.customRatings !== undefined) {
        for (const [id, score] of Object.entries(input.customRatings)) {
          if (score === null) db.prepare('DELETE FROM player_custom_ratings WHERE player_id=? AND field_id=?').run(player.id, Number(id));
          else db.prepare('INSERT INTO player_custom_ratings VALUES(?,?,?) ON CONFLICT(player_id,field_id) DO UPDATE SET score=excluded.score').run(player.id, Number(id), score);
        }
      }
      return response(200, state(db, user));
    });
  } else if (route === '/api/teams/transfer/check' || route === '/api/teams/transfer/send') {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const recipient = db.prepare('SELECT id,email FROM users WHERE email=?').get(email);
    if (!recipient) return failure(404, '가입되지 않은 이메일입니다. 받는 사람이 먼저 가입해야 합니다.');
    if (recipient.id === user.id) return failure(400, '본인에게 팀을 넘길 수 없습니다.');
    if (route.endsWith('/check')) return response(200, { email: recipient.email });
    if (db.prepare("SELECT id FROM team_transfers WHERE team_id=? AND status='pending'").get(team.id)) return failure(409, '이미 승인 대기 중인 요청이 있습니다.');
    db.prepare('INSERT INTO team_transfers(team_id,sender_id,recipient_id) VALUES (?,?,?)').run(team.id, user.id, recipient.id);
  } else return failure(404, '찾을 수 없는 요청입니다.');
  return response(200, state(db, user));
}
