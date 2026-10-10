import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeTeams, handleTeams } from '../teams.mjs';

test('profile migration, comments, mutual chemistry, validation and transfer reset', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);
      INSERT INTO users VALUES(1,'a@example.com'),(2,'b@example.com');
      CREATE TABLE players(id INTEGER PRIMARY KEY,team_id INTEGER,name TEXT);
      CREATE TABLE player_profiles(player_id INTEGER PRIMARY KEY,positions TEXT DEFAULT '[]',stamina INTEGER,aggression INTEGER,attack INTEGER,defense INTEGER,overall INTEGER);
      INSERT INTO players VALUES(1,1,'A');
      INSERT INTO player_profiles VALUES(1,'["CF"]',5,4,3,2,1);`);
    initializeTeams(db); initializeTeams(db);
    db.exec(`INSERT INTO teams(id,owner_id,name,color) VALUES(1,1,'우리 팀','#123456'),(2,1,'다른 팀','#123456');
      INSERT INTO players VALUES(2,1,'B'),(3,1,'C'),(4,2,'D');`);
    const call = (route, input = {}, userId = 1) => handleTeams(db, '/api/teams/' + route, { id: userId }, input);
    const state = () => call('state').body;
    assert.equal(state().players[0].comment, '');
    assert.deepEqual(state().players[0].positions, ['CF']);
    assert.equal(state().players[0].ratings.stamina, 5);
    const profile = { teamId: 1, playerId: 1, name: 'A', positions: ['CF'], ratings: { stamina: 5, aggression: 4, attack: 3, defense: 2, overall: 1 }, comment: '공격적, 개인플레이가 많음\n팀플레이 선수와 조합', chemistry: { good: [2], bad: [3] } };
    assert.equal(call('players/update', profile).status, 200);
    assert.equal(state().players[0].comment, profile.comment);
    assert.deepEqual(state().players[0].chemistry, { good: [2], bad: [3] });
    assert.deepEqual(state().players[1].chemistry, { good: [1], bad: [] });
    assert.deepEqual(state().players[2].chemistry, { good: [], bad: [1] });
    for (const chemistry of [{ good: [1], bad: [] }, { good: [4], bad: [] }, { good: [999], bad: [] }, { good: [2,2], bad: [] }, { good: [2], bad: [2] }, { good: ['2'], bad: [] }, null]) assert.equal(call('players/update', { ...profile, chemistry }).status, 400);
    for (const comment of [null, 2, 'x'.repeat(2001)]) assert.equal(call('players/update', { ...profile, comment }).status, 400);
    assert.equal(call('players/update', profile, 2).status, 404);
    assert.equal(state().players[0].comment, profile.comment);
    // Editing B changes the same pair visible on A, without changing A/C.
    assert.equal(call('players/update', { ...profile, playerId: 2, name: 'B', comment: '', chemistry: { good: [], bad: [1] } }).status, 200);
    assert.deepEqual(state().players[0].chemistry, { good: [], bad: [2,3] });
    call('players/update', { ...profile, playerId: 2, name: 'B', comment: '', chemistry: { good: [], bad: [] } });
    assert.deepEqual(state().players[0].chemistry, { good: [], bad: [3] });
    call('players/update', { ...profile, chemistry: undefined, comment: undefined });
    assert.equal(state().players[0].comment, profile.comment);
    assert.deepEqual(state().players[0].chemistry.bad, [3]);
    call('transfer/send', { teamId: 1, email: 'b@example.com' });
    const transferId = call('state', {}, 2).body.incoming[0].id;
    const accepted = call('transfer/respond', { transferId, decision: 'accept' }, 2);
    for (const player of accepted.body.players) {
      assert.equal(player.comment, '');
      assert.deepEqual(player.chemistry, { good: [], bad: [] });
    }
    assert.equal(call('players/update', profile).status, 404);
  } finally { db.close(); }
});
