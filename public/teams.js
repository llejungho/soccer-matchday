import {showCommunity} from './community.js';
import { updateSquadContext, closeSquads, showSquads } from './squads.js';
const $ = id => document.getElementById(id);
let api;
let state;
let currentPage = 'manage';
let checkedEmail = '';
let operationBusy = false;
let generation = 0;
const positionNames = ['CF', 'SS', 'LW', 'RW', 'AM', 'LM', 'CM', 'RM', 'DM', 'LWB', 'RWB', 'CB', 'GK'];
function playerSubview(view){for(const name of ['roster','add','fields'])$('manage-'+name).hidden=name!==view;for(const b of document.querySelectorAll('[data-player-view]'))b.setAttribute('aria-current',b.dataset.playerView===view?'page':'false');}
for(const b of document.querySelectorAll('[data-player-view]'))b.addEventListener('click',()=>{if(!operationBusy)playerSubview(b.dataset.playerView);});
let profileDraft = null;
let editingTactic = null;
let editingField = null;
function notice(text, error = false) {
  $('dashboard-message').hidden = !text;
  $('dashboard-message').textContent = text;
  $('dashboard-message').classList.toggle('error', error);
}
function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function page(name) {
  closeProfile();
  currentPage = name;
  for (const key of ['create', 'manage', 'select', 'tactics', 'transfer', 'squad', 'notices', 'free']) $('page-' + key).hidden = key !== name;
  document.querySelectorAll('.sidebar [data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page === name); button.setAttribute('aria-current', button.dataset.page === name ? 'page' : 'false'); });
  const titles = { create: ['팀 생성', '함께 뛸 우리 팀을 만들어 보세요.'], manage: ['선수 관리', '평가 항목을 정하고 선수와 프로필을 관리하세요.'], select: ['팀 선택', '오늘 관리할 팀을 선택하세요.'], tactics: ['팀 전술', '쿼터마다 활용할 우리 팀의 전술 컨셉을 준비하세요.'], transfer: ['팀 이관', '팀을 다른 감독에게 넘기거나 받은 요청을 확인하세요.'] };
  titles.notices=['공지사항','서비스 소식과 운영 안내를 확인하세요.']; titles.free=['자유게시판','닉네임으로 이야기를 나누세요.'];
  if(name==='notices'||name==='free')showCommunity(name);
  titles.squad = ['스쿼드', '참석자와 쿼터별 컨셉을 정하고 자동 배치·수정·공유하세요.'];
  $('page-title').textContent = titles[name][0];
  $('page-description').textContent = titles[name][1];
  if(name === 'squad') showSquads();
}
function render(next) {
  if (state?.selectedTeam?.id !== next.selectedTeam?.id) { resetTactic(); resetField(); playerSubview('roster'); }
  if (editingField && !(editingField.builtinKey?next.basicFields.some(f=>f.key===editingField.builtinKey):next.customFields.some(f=>f.id===editingField.fieldId))) resetField();
  if (editingTactic && !next.tactics.some(tactic => tactic.id === editingTactic.id)) resetTactic();
  if (profileDraft && (next.selectedTeam?.id !== profileDraft.teamId || !next.players.some(player => player.id === profileDraft.playerId))) closeProfile();
  state = next;
  updateSquadContext(next, api);
  checkedEmail = '';
  $('recipient-status').textContent = '';
  $('send-transfer').disabled = true;
  const team = state.selectedTeam;
  $('team-details-content').hidden = !team;
  $('transfer-content').hidden = !team;
  $('transfer-empty').hidden = !!team || !!state.incoming.length;
  $('transfer-request-count').hidden = !state.incoming.length;
  $('transfer-request-count').textContent = String(state.incoming.length);
  renderTeamConfig();
  $('current-team-label').textContent = team ? `현재 팀 · ${team.name}` : '팀을 만들어 시작하세요';
  $('manage-empty').hidden = !!team;
  $('manage-content').hidden = !team;
  if (team) {
    $('team-name-heading').textContent = team.name;
    $('team-jersey').style.backgroundColor = team.color;
    $('team-player-count').textContent = `소속 선수 ${state.players.length}명`;
    $('edit-name').value = team.name;
    $('edit-color').value = team.color;
    $('roster-count').textContent = `${state.players.length}명`;
    $('player-list').replaceChildren();
    if (!state.players.length) $('player-list').append(node('p', '아직 등록된 선수가 없습니다. 첫 선수를 추가해 보세요.', 'empty-copy'));
    state.players.forEach((player, index) => {
      const row = node('div', null, 'roster-row');
      const details = node('div', null, 'roster-details');
      details.append(node('strong', player.name));
      const preferences = player.positions.length ? player.positions.map((position, priority) => `${priority + 1}순위 ${position}`).join(' · ') : '포지션 미설정';
      details.append(node('p', preferences, 'roster-positions'));
      const scores = node('div', null, 'roster-scores');
      for (const {key, name:label} of state.basicFields) scores.append(node('span', `${label} ${player.ratings[key] === null ? '—' : player.ratings[key] + '/5'}`));
      for (const field of state.customFields) scores.append(node('span', `${field.name} ${player.customRatings[field.id] === null ? '—' : player.customRatings[field.id] + '/5'}`));
      details.append(scores);
      if (player.comment) details.append(node('p', player.comment, 'roster-comment'));
      for (const [kind, label] of [['good', '좋은 궁합'], ['bad', '안 좋은 궁합']]) {
        const names = state.players.filter(other => player.chemistry[kind].includes(other.id)).map(other => other.name);
        if (names.length) details.append(node('p', `${label} · ${names.join(', ')}`, 'roster-chemistry'));
      }
      const edit = node('button', '프로필 작성 / 수정', 'secondary'); edit.type = 'button';
      edit.addEventListener('click', () => openProfile(player));
      const firstPosition = player.positions[0];
      const group = ['CF','SS','LW','RW'].includes(firstPosition) ? 'attack' : ['AM','LM','CM','RM','DM'].includes(firstPosition) ? 'midfield' : ['LWB','RWB','CB'].includes(firstPosition) ? 'defense' : firstPosition === 'GK' ? 'keeper' : '';
      const number = node('span', String(index + 1).padStart(2, '0'), `roster-number${group ? ' role-' + group : ''}`);
      if (group) number.title = `1순위 ${firstPosition}`;
      row.append(number, details, edit);
      $('player-list').append(row);
    });
    const outgoing = state.outgoing.find(request => request.teamId === team.id);
    $('outgoing-status').hidden = !outgoing;
    $('transfer-form').hidden = !!outgoing;
    $('outgoing-status').textContent = outgoing ? `${outgoing.recipientEmail}님의 승인을 기다리고 있습니다. 승인 전까지는 계속 팀을 관리할 수 있습니다.` : '';
  }
  $('team-count').textContent = `${state.teams.length}개 팀`;
  $('team-list').replaceChildren();
  if (!state.teams.length) $('team-list').append(node('p', '등록된 팀이 없습니다. 팀 생성 메뉴에서 시작하세요.', 'empty-copy'));
  state.teams.forEach(item => {
    const card = node('div', null, 'team-choice');
    const color = node('div', '⚑', 'team-color');
    color.style.backgroundColor = item.color;
    const details = node('div');
    details.append(node('strong', item.name), node('p', `선수 ${item.playerCount}명`, 'small-muted'));
    const selected = item.id === team?.id;
    const button = node('button', selected ? '선택됨 ✓' : '이 팀 선택', 'secondary');
    button.type = 'button'; button.disabled = selected;
    button.addEventListener('click', () => mutate('select', { teamId: item.id }, '팀을 선택했습니다.', () => page('manage')));
    card.append(color, details, button);
    $('team-list').append(card);
  });
  $('incoming-section').hidden = !state.incoming.length;
  $('incoming-list').replaceChildren();
  state.incoming.forEach(request => {
    const row = node('div', null, 'transfer-request');
    const detail = node('div');
    detail.append(node('strong', request.name), node('p', `${request.senderEmail}님이 팀을 넘기려고 합니다.`, 'small-muted'));
    const buttons = node('div', null, 'request-actions');
    for (const [decision, label] of [['accept', '승인'], ['reject', '거절']]) {
      const button = node('button', label, 'secondary'); button.type = 'button';
      button.addEventListener('click', () => mutate('transfer/respond', { transferId: request.id, decision }, decision === 'accept' ? '팀을 받았습니다. 포지션·평가 점수·감독 코멘트·궁합은 초기화되었습니다. 팀 선택에서 확인하세요.' : '팀 넘기기 요청을 거절했습니다.'));
      buttons.append(button);
    }
    row.append(detail, buttons); $('incoming-list').append(row);
  });
}
async function mutate(route, input, success, after) {
  if (operationBusy) return;
  operationBusy = true;
  notice('처리 중입니다…');
  const token = generation;
  document.querySelectorAll('#dashboard-view button, #player-profile-dialog button, #player-profile-dialog input, #player-profile-dialog textarea').forEach(button => button.disabled = true);
  if (profileDraft) { $('profile-message').hidden = false; $('profile-message').textContent = '저장 중입니다…'; }
  try {
    const result = await api('teams/' + route, input);
    if (token !== generation) return;
    render(result); notice(success); after?.();
  } catch (error) {
    if (token !== generation) return;
    notice(error.error || '서버에 연결할 수 없습니다. 다시 시도해 주세요.', true);
    if (profileDraft) { $('profile-message').hidden = false; $('profile-message').textContent = error.error || '저장하지 못했습니다. 다시 시도해 주세요.'; }
    try { render(await api('teams/state')); } catch { /* keep the visible error */ }
  } finally {
    operationBusy = false;
    document.querySelectorAll('#dashboard-view button, #player-profile-dialog button, #player-profile-dialog input, #player-profile-dialog textarea').forEach(button => button.disabled = false);
    $('send-transfer').disabled = !checkedEmail;
    document.querySelectorAll('.team-choice button').forEach((button, index) => button.disabled = state?.teams[index]?.id === state?.selectedTeam?.id);
  }
}
export async function openManager(request, isNew = false) {
  api = request;
  document.body.classList.add('signed-in');
  const token = ++generation;
  notice('팀 정보를 불러오는 중입니다…');
  page('manage');
  try {
    const next = await api('teams/state');
    if (token !== generation) return;
    render(next); page(isNew || !next.teams.length ? 'create' : 'manage'); notice('');
  } catch (error) { notice(error.error || '팀 정보를 불러오지 못했습니다. 새로고침해 주세요.', true); }
}
export function closeManager() {
  closeSquads();
  closeProfile();
  resetTactic();
  resetField();
  ++generation; state = null; checkedEmail = ''; document.body.classList.remove('signed-in');
  $('incoming-list').replaceChildren(); $('team-list').replaceChildren(); $('player-list').replaceChildren();
  document.querySelectorAll('#dashboard-view form').forEach(form => form.reset());
  $('manage-content').hidden = true; $('incoming-section').hidden = true;
}
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', async () => {
  if (operationBusy) return;
  page(button.dataset.page);
  if(button.dataset.playerTarget)playerSubview(button.dataset.playerTarget);
  notice('');
  const token = generation;
  try { const next = await api('teams/state'); if (token === generation) render(next); }
  catch (error) { notice(error.error || '팀 정보를 불러오지 못했습니다.', true); }
}));
$('create-team-form').addEventListener('submit', event => { event.preventDefault(); mutate('create', { name: $('create-name').value, color: $('create-color').value }, '팀을 만들었습니다. 전술 컨셉을 정한 뒤 선수 관리에서 평가 항목과 선수를 등록하세요.', () => { $('create-team-form').reset(); page('tactics'); }); });
$('update-team-form').addEventListener('submit', event => { event.preventDefault(); mutate('update', { teamId: state.selectedTeam.id, name: $('edit-name').value, color: $('edit-color').value }, '팀 정보를 저장했습니다.'); });
$('add-player-form').addEventListener('submit', event => { event.preventDefault(); mutate('players/add', { teamId: state.selectedTeam.id, name: $('player-name').value }, '선수를 추가했습니다. 포지션과 평가를 작성해 주세요.', () => { $('add-player-form').reset(); openProfile(state.players.at(-1)); }); });
$('recipient-email').addEventListener('input', () => { checkedEmail = ''; $('send-transfer').disabled = true; $('recipient-status').textContent = ''; });
$('check-recipient').addEventListener('click', async () => {
  if (!$('recipient-email').reportValidity() || operationBusy) return;
  const email = $('recipient-email').value.trim().toLowerCase();
  const teamId = state.selectedTeam.id;
  const token = generation;
  $('check-recipient').disabled = true;
  try {
    const result = await api('teams/transfer/check', { teamId, email });
    if (token !== generation || state.selectedTeam?.id !== teamId || $('recipient-email').value.trim().toLowerCase() !== email) return;
    checkedEmail = result.email; $('recipient-status').textContent = `${result.email} · 가입된 계정입니다.`; $('send-transfer').disabled = false;
  } catch (error) { checkedEmail = ''; $('send-transfer').disabled = true; $('recipient-status').textContent = error.error || '확인하지 못했습니다. 다시 시도해 주세요.'; }
  finally { $('check-recipient').disabled = false; }
});
$('transfer-form').addEventListener('submit', event => { event.preventDefault(); if (checkedEmail && checkedEmail === $('recipient-email').value.trim().toLowerCase()) mutate('transfer/send', { teamId: state.selectedTeam.id, email: checkedEmail }, '팀 넘기기 요청을 보냈습니다. 받는 사람이 로그인하면 승인 또는 거절할 수 있습니다.'); });
// Refresh permissions and incoming requests when the user returns to this tab.
async function refreshState() {
  if (!state || operationBusy || !document.body.classList.contains('signed-in')) return;
  const token = generation;
  try {
    const next = await api('teams/state');
    if (token === generation && !operationBusy && JSON.stringify(next) !== JSON.stringify(state)) render(next);
  } catch { /* explicit actions report errors */ }
}
window.addEventListener('focus', refreshState);
setInterval(() => { if (document.visibilityState === 'visible') refreshState(); }, 5000);

function closeProfile() {
  $('player-profile-dialog').close();
  profileDraft = null;
  $('player-profile-form').reset();
  $('position-options').replaceChildren(); $('rating-options').replaceChildren();
  $('chemistry-options').replaceChildren();
  $('position-priorities').replaceChildren(); $('profile-message').hidden = true;
}
function openProfile(player) {
  profileDraft = { teamId: state.selectedTeam.id, playerId: player.id, positions: [...player.positions], ratings: { ...player.ratings }, customRatings: { ...player.customRatings }, chemistry: { good: [...player.chemistry.good], bad: [...player.chemistry.bad] } };
  $('profile-name').value = player.name;
  $('profile-comment').value = player.comment;
  $('profile-title').textContent = `${player.name} · 선수 프로필`;
  $('profile-message').hidden = true;
  $('position-message').textContent = '';
  renderPositions();
  renderChemistry();
  $('rating-options').replaceChildren();
  const ratingFields = [...state.basicFields.map(({key,name})=>({key,label:name,custom:false})), ...state.customFields.map(field => ({key: field.id, label: field.name, custom: true}))];
  for (const {key, label, custom} of ratingFields) {
    const ratings = custom ? profileDraft.customRatings : profileDraft.ratings;
    const group = node('fieldset', null, 'rating-group');
    group.append(node('legend', label));
    const choices = node('div', null, 'rating-choices');
    for (const score of [null, 1, 2, 3, 4, 5]) {
      const wrapper = node('label', null, 'rating-choice');
      const input = node('input'); input.type = 'radio'; input.name = `rating-${custom ? 'custom-' : ''}${key}`; input.value = score === null ? '' : String(score);
      input.checked = ratings[key] === score;
      input.addEventListener('change', () => { ratings[key] = score; });
      wrapper.append(input, node('span', score === null ? '미설정' : String(score))); choices.append(wrapper);
    }
    group.append(choices); $('rating-options').append(group);
  }
  $('player-profile-dialog').showModal();
  $('profile-name').focus();
}
function renderPositions() {
  $('position-options').replaceChildren();
  for (const position of positionNames) {
    const priority = profileDraft.positions.indexOf(position);
    const button = node('button', position, 'position-choice'); button.type = 'button';
    button.setAttribute('aria-pressed', String(priority !== -1));
    button.setAttribute('aria-label', priority === -1 ? position : `${position} · ${priority + 1}순위`);
    if (priority !== -1) button.append(node('span', `${priority + 1}`, 'position-rank'));
    button.addEventListener('click', () => {
      $('position-message').textContent = '';
      const existing = profileDraft.positions.indexOf(position);
      if (existing !== -1) profileDraft.positions.splice(existing, 1);
      else if (profileDraft.positions.length < 3) profileDraft.positions.push(position);
      else { $('position-message').textContent = '최대 3순위까지 선택할 수 있습니다. 기존 포지션을 해제한 뒤 선택해 주세요.'; return; }
      renderPositions();
      [...$('position-options').children].find(item => item.textContent.startsWith(position) && item.firstChild.textContent === position)?.focus();
    });
    $('position-options').append(button);
  }
  $('position-priorities').replaceChildren();
  for (let priority = 0; priority < 3; priority++) $('position-priorities').append(node('span', `${priority + 1}순위 ${profileDraft.positions[priority] || '미설정'}`, 'priority-chip'));
}
function renderChemistry() {
  $('chemistry-options').replaceChildren();
  const teammates = state.players.filter(player => player.id !== profileDraft.playerId);
  for (const [kind, title] of [['good', '궁합이 좋은 선수'], ['bad', '궁합이 안 좋은 선수']]) {
    const section = node('details', null, 'chemistry-picker');
    const summary = node('summary', `${title} · ${profileDraft.chemistry[kind].length}명 선택`);
    section.append(summary);
    const selectedNames = teammates.filter(player => profileDraft.chemistry[kind].includes(player.id)).map(player => player.name);
    section.append(node('p', selectedNames.length ? selectedNames.join(', ') : '선택한 선수 없음', 'hint'));
    if (!teammates.length) section.append(node('p', '다른 팀원을 추가하면 선택할 수 있습니다.', 'hint'));
    for (const teammate of teammates) {
      const label = node('label', null, 'chemistry-choice');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = profileDraft.chemistry[kind].includes(teammate.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          profileDraft.chemistry[kind].push(teammate.id);
          const opposite = kind === 'good' ? 'bad' : 'good';
          profileDraft.chemistry[opposite] = profileDraft.chemistry[opposite].filter(id => id !== teammate.id);
        } else profileDraft.chemistry[kind] = profileDraft.chemistry[kind].filter(id => id !== teammate.id);
        const openKinds = [...$('chemistry-options').children].map(item => item.open);
        renderChemistry();
        [...$('chemistry-options').children].forEach((item, index) => item.open = openKinds[index]);
        $('chemistry-options').querySelector(`input[data-kind="${kind}"][data-player="${teammate.id}"]`)?.focus();
      });
      checkbox.dataset.kind = kind; checkbox.dataset.player = teammate.id;
      label.append(checkbox, node('span', `${teammate.name} · #${teammate.id}`)); section.append(label);
    }
    $('chemistry-options').append(section);
  }
}
function resetTactic() {
  editingTactic = null;
  $('tactic-form').reset();
  $('tactic-form-title').textContent = '전술 추가';
  $('save-tactic').textContent = '전술 추가 →';
  $('cancel-tactic').hidden = true;
}
function deleteButton(label, confirmation, action) {
  const button = node('button', label, 'secondary'); button.type = 'button';
  let armed = false;
  button.addEventListener('click', () => {
    if (operationBusy) return;
    if (!armed) { armed = true; button.textContent = confirmation; return; }
    action();
  });
  return button;
}
function renderTeamConfig() {
  $('tactics-empty').hidden = !!state.selectedTeam;
  $('tactics-content').hidden = !state.selectedTeam;
  $('tactics-count').textContent = `${state.tactics.length}개 전술`;
  $('custom-field-count').textContent = `${state.basicFields.length+state.customFields.length}개 항목`;
  $('tactic-list').replaceChildren(); $('custom-field-list').replaceChildren();
  if (!state.tactics.length) $('tactic-list').append(node('p', '아직 등록한 전술이 없습니다. 아래에서 첫 컨셉을 작성하세요.', 'empty-copy'));
  for (const tactic of state.tactics) {
    const card = node('article', null, 'config-card');
    card.append(node('h3', tactic.name));
    if (tactic.concept) card.append(node('p', `컨셉 · ${tactic.concept}`));
    card.append(node('p', `우선 배치할 선수 · ${tactic.traits}`));
    const actions = node('div', null, 'config-actions');
    const edit = node('button', '수정', 'secondary'); edit.type = 'button';
    edit.addEventListener('click', () => {
      editingTactic = { id: tactic.id, teamId: state.selectedTeam.id };
      $('tactic-name').value = tactic.name; $('tactic-concept').value = tactic.concept; $('tactic-traits').value = tactic.traits;
      $('tactic-form-title').textContent = '전술 수정'; $('save-tactic').textContent = '전술 저장 →'; $('cancel-tactic').hidden = false;
      $('tactic-name').focus();
    });
    actions.append(edit, deleteButton('삭제', '전술 삭제 확인', () => mutate('tactics/delete', {teamId: state.selectedTeam.id, tacticId: tactic.id}, '전술을 삭제했습니다.')));
    card.append(actions); $('tactic-list').append(card);
  }
  if (!state.basicFields.length&&!state.customFields.length) $('custom-field-list').append(node('p','등록된 평가 항목이 없습니다. 우리 팀에 필요한 항목을 추가하세요.','empty-copy'));
  for (const field of [...state.basicFields.map(f=>({...f,builtinKey:f.key})),...state.customFields]) {
    const row = node('div', null, 'custom-field-row');
    const actions = node('div', null, 'config-actions');
    const edit = node('button', '수정', 'secondary'); edit.type = 'button';
    edit.addEventListener('click', () => { editingField = field.builtinKey?{builtinKey:field.builtinKey}:{fieldId:field.id}; $('custom-field-name').value = field.name; $('save-custom-field').textContent = '항목 저장'; $('cancel-custom-field').hidden = false; $('custom-field-name').focus(); });
    actions.append(edit, deleteButton('삭제', '항목과 점수 삭제 확인', () => mutate('ratings/delete', {teamId: state.selectedTeam.id, ...(field.builtinKey?{builtinKey:field.builtinKey}:{fieldId:field.id})}, '평가 항목과 해당 선수 점수를 삭제했습니다.')));
    row.append(node('span', field.name), actions);
    $('custom-field-list').append(row);
  }
}
$('tactic-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!state?.selectedTeam) return;
  mutate('tactics/save', { teamId: state.selectedTeam.id, ...(editingTactic ? {tacticId: editingTactic.id} : {}), name: $('tactic-name').value, concept: $('tactic-concept').value, traits: $('tactic-traits').value }, '팀 전술을 저장했습니다.', resetTactic);
});
$('cancel-tactic').addEventListener('click', resetTactic);
$('custom-field-form').addEventListener('submit', event => {
  event.preventDefault();
  if (state?.selectedTeam) mutate(editingField ? 'ratings/update' : 'ratings/add', {teamId: state.selectedTeam.id, ...(editingField || {}), name: $('custom-field-name').value}, editingField ? '평가 항목명을 수정했습니다. 기존 점수는 유지됩니다.' : '평가 항목을 추가했습니다. 선수 프로필에서 점수를 작성하세요.', resetField);
});
function resetField() { editingField = null; $('custom-field-form').reset(); $('save-custom-field').textContent = '항목 추가'; $('cancel-custom-field').hidden = true; }
$('cancel-custom-field').addEventListener('click', resetField);
$('manage-custom-fields').addEventListener('click', () => { if (!operationBusy) { page('manage'); playerSubview('fields'); $('custom-field-name').focus(); } });
$('close-profile').addEventListener('click', () => { if (!operationBusy) closeProfile(); });
$('cancel-profile').addEventListener('click', () => { if (!operationBusy) closeProfile(); });
$('player-profile-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!operationBusy) closeProfile(); });
$('player-profile-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!profileDraft || operationBusy) return;
  mutate('players/update', { ...profileDraft, name: $('profile-name').value, comment: $('profile-comment').value }, '선수 프로필을 저장했습니다.', closeProfile);
});
