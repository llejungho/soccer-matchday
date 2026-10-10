import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('account lifecycle, persistence, validation, and session protection', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'matchday-auth-'));
  let child;
  let origin;
  async function launch() {
    child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(50000 + Math.floor(Math.random() * 10000)), DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      child.stdout.on('data', data => { const url = /http:\/\/127\.0\.0\.1:\d+/.exec(String(data))?.[0]; if (url) { clearTimeout(timeout); resolve(url); } });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
    });
  }
  async function stop() { if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); }
  async function post(route, input, cookie, requestOrigin = origin) {
    return fetch(origin + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(input) });
  }
  const credentials = { nickname: '감독QA', email: 'Coach@Example.com', password: 'test-pass-42', confirmPassword: 'test-pass-42' };
  try {
    await launch();
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await post('signup', { ...credentials, email: 'invalid' })).status, 400);
    assert.equal((await post('signup', { ...credentials, password: 'short', confirmPassword: 'short' })).status, 400);
    assert.equal((await post('signup', { ...credentials, confirmPassword: 'wrong-pass' })).status, 400);
    assert.equal((await post('signup', { ...credentials, nickname: '' })).status, 400);
    assert.equal((await post('signup', credentials, null, 'http://untrusted.example')).status, 403);
    const signup = await post('signup', credentials);
    assert.equal(signup.status, 201);
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    assert.match(signup.headers.get('set-cookie'), /HttpOnly/);
    assert.match(signup.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal((await signup.json()).user.email, 'coach@example.com');
    const me = await fetch(origin + '/api/me', { headers: { Cookie: cookie } });
    assert.equal((await me.json()).user.email, 'coach@example.com');
    assert.equal((await post('signup', credentials)).status, 409);
    const duplicateNickname=await post('signup',{...credentials,email:'duplicate-nickname@example.com'});
    assert.equal(duplicateNickname.status,409);assert.equal((await duplicateNickname.json()).field,'nickname');
    assert.equal((await post('login', { ...credentials, password: 'incorrect-pass' })).status, 401);
    const db = new DatabaseSync(path.join(directory, 'accounts.sqlite'));
    const saved = db.prepare('SELECT * FROM users').get();
    assert.notEqual(saved.password_hash, credentials.password);
    assert.equal(saved.password_hash.length, 128);
    db.close();
    assert.equal((await post('logout', {}, cookie)).status, 200);
    assert.equal((await (await fetch(origin + '/api/me', { headers: { Cookie: cookie } })).json()).user, null);
    await stop();
    await launch();
    const login = await post('login', credentials);
    assert.equal(login.status, 200);
    const ownerCookie = login.headers.get('set-cookie').split(';')[0];
    const receiverSignup = await post('signup', { nickname: '받는감독', email: 'receiver@example.com', password: credentials.password, confirmPassword: credentials.password });
    const receiverCookie = receiverSignup.headers.get('set-cookie').split(';')[0];
    const otherSignup = await post('signup', { nickname: '다른감독', email: 'other@example.com', password: credentials.password, confirmPassword: credentials.password });
    const otherCookie = otherSignup.headers.get('set-cookie').split(';')[0];
    const getState = async cookie => (await (await fetch(origin + '/api/teams/state', { headers: { Cookie: cookie } })).json());
    assert.equal((await post('teams/create', { name: 'FC A', color: '#245e45' })).status, 401);
    assert.equal((await post('teams/create', { name: '', color: '#245e45' }, ownerCookie)).status, 400);
    const first = await (await post('teams/create', { name: 'FC A', color: '#245e45' }, ownerCookie)).json();
    const firstId = first.selectedTeam.id;
    assert.equal(first.teams.length, 1);
    assert.equal((await getState(ownerCookie)).selectedTeam.id, firstId);
    const second = await (await post('teams/create', { name: 'FC B', color: '#334455' }, ownerCookie)).json();
    const secondId = second.selectedTeam.id;
    await post('teams/select', { teamId: firstId }, ownerCookie);
    await post('teams/players/add', { teamId: firstId, name: '첫 팀 선수' }, ownerCookie);
    await post('teams/players/add', { teamId: secondId, name: '둘째 팀 선수' }, ownerCookie);
    assert.deepEqual((await getState(ownerCookie)).players.map(player => player.name), ['첫 팀 선수']);
    const initialPlayer = (await getState(ownerCookie)).players[0];
    const emptyRatings = { stamina: null, aggression: null, attack: null, defense: null, overall: null };
    assert.deepEqual(initialPlayer.positions, []);
    assert.deepEqual(initialPlayer.ratings, emptyRatings);
    const ratings = { stamina: 5, aggression: 4, attack: 3, defense: 2, overall: 1 };
    const profile = { teamId: firstId, playerId: initialPlayer.id, name: initialPlayer.name, positions: ['CF', 'LW', 'DM'], ratings };
    assert.equal((await post('teams/players/update', profile, ownerCookie)).status, 200);
    assert.deepEqual((await getState(ownerCookie)).players[0].positions, ['CF', 'LW', 'DM']);
    assert.deepEqual((await getState(ownerCookie)).players[0].ratings, ratings);
    assert.equal((await post('teams/players/update', profile, otherCookie)).status, 404);
    assert.equal((await post('teams/players/update', { ...profile, teamId: secondId }, ownerCookie)).status, 404);
    for (const positions of [['CF', 'CF'], ['CF', 'LW', 'DM', 'GK'], ['INVALID'], 'CF']) {
      assert.equal((await post('teams/players/update', { ...profile, positions }, ownerCookie)).status, 400);
    }
    for (const value of [0, 6, 1.5, '5', undefined]) {
      assert.equal((await post('teams/players/update', { ...profile, ratings: { ...ratings, stamina: value } }, ownerCookie)).status, 400);
    }
    assert.deepEqual((await getState(ownerCookie)).players[0].ratings, ratings);
    await post('teams/select', { teamId: secondId }, ownerCookie);
    const secondPlayer = (await getState(ownerCookie)).players[0];
    await post('teams/players/update', { ...profile, teamId: secondId, playerId: secondPlayer.id, name: secondPlayer.name, positions: ['GK'] }, ownerCookie);
    await post('teams/select', { teamId: firstId }, ownerCookie);
    await post('teams/players/add', { teamId: firstId, name: '같은 팀 추가 선수' }, ownerCookie);
    const addedPlayer = (await getState(ownerCookie)).players.at(-1);
    await post('teams/players/update', { ...profile, playerId: addedPlayer.id, name: addedPlayer.name, positions: ['CB', 'DM'] }, ownerCookie);
    await post('teams/players/update', { ...profile, positions: ['LW', 'DM'], ratings: { ...ratings, attack: null } }, ownerCookie);
    assert.deepEqual((await getState(ownerCookie)).players[0].positions, ['LW', 'DM']);
    assert.equal((await getState(ownerCookie)).players[0].ratings.attack, null);
    await post('teams/players/update', profile, ownerCookie);
    assert.equal((await post('teams/select', { teamId: firstId }, otherCookie)).status, 404);
    assert.equal((await post('teams/players/add', { teamId: firstId, name: '권한 없음' }, otherCookie)).status, 404);
    const updated = await (await post('teams/update', { teamId: firstId, name: 'FC 변경', color: '#abcdef' }, ownerCookie)).json();
    assert.equal(updated.selectedTeam.name, 'FC 변경');
    assert.equal(updated.selectedTeam.color, '#abcdef');
    await stop(); await launch();
    assert.equal((await getState(ownerCookie)).selectedTeam.id, firstId);
    assert.deepEqual((await getState(ownerCookie)).players[0].positions, profile.positions);
    assert.deepEqual((await getState(ownerCookie)).players[0].ratings, ratings);
    assert.equal((await post('teams/transfer/check', { teamId: firstId, email: 'missing@example.com' }, ownerCookie)).status, 404);
    assert.equal((await post('teams/transfer/send', { teamId: firstId, email: credentials.email }, ownerCookie)).status, 400);
    assert.equal((await post('teams/transfer/check', { teamId: firstId, email: 'RECEIVER@example.com' }, ownerCookie)).status, 200);
    await post('teams/transfer/send', { teamId: firstId, email: 'receiver@example.com' }, ownerCookie);
    assert.equal((await getState(ownerCookie)).teams.length, 2);
    assert.deepEqual((await getState(ownerCookie)).players[0].ratings, ratings);
    assert.equal((await getState(receiverCookie)).teams.length, 0);
    assert.equal((await post('teams/transfer/send', { teamId: firstId, email: 'other@example.com' }, ownerCookie)).status, 409);
    const rejectedId = (await getState(receiverCookie)).incoming[0].id;
    assert.equal((await post('teams/transfer/respond', { transferId: rejectedId, decision: 'accept' }, otherCookie)).status, 404);
    await post('teams/transfer/respond', { transferId: rejectedId, decision: 'reject' }, receiverCookie);
    assert.equal((await getState(ownerCookie)).teams.length, 2);
    assert.deepEqual((await getState(ownerCookie)).players[0].positions, profile.positions);
    assert.deepEqual((await getState(ownerCookie)).players[0].ratings, ratings);
    await post('teams/transfer/send', { teamId: firstId, email: 'receiver@example.com' }, ownerCookie);
    const acceptedId = (await getState(receiverCookie)).incoming[0].id;
    const accepted = await (await post('teams/transfer/respond', { transferId: acceptedId, decision: 'accept' }, receiverCookie)).json();
    assert.equal(accepted.selectedTeam.id, firstId);
    assert.deepEqual(accepted.players.map(player => player.name), ['첫 팀 선수', '같은 팀 추가 선수']);
    assert.deepEqual(accepted.players.map(player => player.id), [initialPlayer.id, addedPlayer.id]);
    for (const player of accepted.players) {
      assert.deepEqual(player.positions, []);
      assert.deepEqual(player.ratings, emptyRatings);
    }
    const oldOwner = await getState(ownerCookie);
    assert.equal(oldOwner.teams.length, 1);
    assert.equal(oldOwner.selectedTeam.id, secondId);
    assert.deepEqual(oldOwner.players.map(player => player.name), ['둘째 팀 선수']);
    assert.deepEqual(oldOwner.players[0].positions, ['GK']);
    assert.deepEqual(oldOwner.players[0].ratings, ratings);
    assert.equal((await post('teams/players/update', profile, ownerCookie)).status, 404);
    assert.equal((await post('teams/players/update', profile, receiverCookie)).status, 200);
    assert.equal((await post('teams/update', { teamId: firstId, name: '차단 확인', color: '#123456' }, ownerCookie)).status, 404);
    assert.equal((await post('teams/players/add', { teamId: firstId, name: '차단 확인' }, ownerCookie)).status, 404);
    assert.equal((await post('teams/transfer/respond', { transferId: acceptedId, decision: 'accept' }, receiverCookie)).status, 404);
    let response;
    for (let index = 0; index < 31; index++) response = await post('login', { ...credentials, password: 'incorrect-pass' });
    assert.equal(response.status, 429);
  } finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
});
