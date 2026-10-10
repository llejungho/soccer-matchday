import {initializeRecovery,openRecovery} from './recovery.js';
import {openAccount,closeAccount} from './account.js';
import {initializeSocial} from './social.js';
import {openCommunity,closeCommunity} from './community.js';
import { openManager, closeManager } from './teams.js';
const $ = id => document.getElementById(id);
let mode = 'login';
let busy = false,checkedNickname='';
$('nickname').addEventListener('input',()=>{checkedNickname='';$('nickname-status').textContent='중복 확인이 필요합니다.';});
$('email').addEventListener('input',()=>{checkedNickname='';});
$('nickname-check').addEventListener('click',async()=>{const nickname=$('nickname').value.trim(),email=$('email').value.trim();$('nickname-check').disabled=true;try{const data=await api('community/nickname-check',{nickname,email});if(nickname!==$('nickname').value.trim()||email!==$('email').value.trim())return;checkedNickname=data.available?nickname:'';$('nickname-status').textContent=data.available?'사용할 수 있는 닉네임입니다.':'이미 사용 중인 닉네임입니다.';}catch(e){$('nickname-status').textContent=e.error||'중복 확인을 하지 못했습니다.';}finally{$('nickname-check').disabled=false;}});
function message(text, field) {
  $('form-message').textContent = text;
  $('form-message').hidden = !text;
  document.querySelectorAll('input').forEach(input => input.removeAttribute('aria-invalid'));
  if (field) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
}
function switchMode(next) {
  if (busy) return;
  mode = next;$('auth-home').hidden=true;$('auth-fields').hidden=false;
  $('account-form').reset();
  message('');
  document.querySelectorAll('.reveal').forEach(button => { $(button.dataset.target).type = 'password'; button.textContent = '보기'; button.setAttribute('aria-pressed', 'false'); });
  const signup = mode === 'signup';
  $('confirm-field').hidden = !signup;
  $('nickname-field').hidden=!signup;$('nickname').required=signup;checkedNickname='';$('nickname-status').textContent='한글·영문·숫자·밑줄로 2~20자 입력하세요.';
  $('confirmPassword').required = signup;
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('form-title').textContent = signup ? '우리 팀을 위한 첫걸음' : '다시 만나 반가워요';
  $('form-subtitle').textContent = signup ? '이메일로 가입하고 팀 관리를 시작하세요.' : '이메일과 암호로 내 계정에 로그인하세요.';
  $('submit-button').firstElementChild.textContent = signup ? '회원가입' : '로그인';
  $('switch-copy').firstChild.textContent = signup ? '이미 계정이 있으신가요? ' : '아직 계정이 없으신가요? ';
  $('switch-mode').textContent = signup ? '로그인' : '회원가입';
}
function dashboard(user, isNew = false) {
  $('auth-view').hidden = true;
  $('dashboard-view').hidden = false;
  $('account-email').textContent = `${user.nickname} · ${user.email}`;
  openCommunity(api,user);openAccount(api,user,updated=>{$('account-email').textContent=`${updated.nickname} · ${updated.email}`;openCommunity(api,updated);});
  $('account-form').reset();
  openManager(api, isNew);
}
async function api(route, input) {
  const response = await fetch('/api/' + route, input === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw result;
  return result;
}
$('switch-mode').addEventListener('click', () => switchMode(mode === 'signup' ? 'login' : 'signup'));
$('auth-back').addEventListener('click',()=>{if(busy)return;switchMode('login');$('auth-fields').hidden=true;$('auth-home').hidden=false;});
$('home-login').addEventListener('click',()=>switchMode('login'));
$('home-signup').addEventListener('click',()=>switchMode('signup'));
$('forgot-password').addEventListener('click', () => openRecovery(api));
$('close-password-help').addEventListener('click', () => $('password-help-dialog').close());
document.querySelectorAll('.reveal').forEach(button => button.addEventListener('click', () => {
  const input = $(button.dataset.target);
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.textContent = visible ? '숨기기' : '보기';
  button.setAttribute('aria-pressed', String(visible));
}));
$('confirmPassword').addEventListener('input', () => $('confirmPassword').setCustomValidity(''));
$('account-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  message('');
  const input = { email: $('email').value.trim(), password: $('password').value, confirmPassword: $('confirmPassword').value, nickname: $('nickname').value.trim() };
  if (mode === 'signup' && input.password !== input.confirmPassword) return message('암호가 일치하지 않습니다. 다시 확인해 주세요.', 'confirmPassword');
  if(mode==='signup'&&checkedNickname!==input.nickname)return message('닉네임 중복 확인을 완료해 주세요.','nickname');
  busy = true;
  const button = $('submit-button');
  button.disabled = true;
  button.firstElementChild.textContent = mode === 'signup' ? '가입 중…' : '로그인 중…';
  try { const result = await api(mode, input); dashboard(result.user, mode === 'signup'); }
  catch (error) { message(error.error || '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', error.field); }
  finally { busy = false; button.disabled = false; button.firstElementChild.textContent = mode === 'signup' ? '회원가입' : '로그인'; }
});
$('logout-button').addEventListener('click', async () => {
  $('logout-button').disabled = true;
  $('dashboard-message').hidden = true;
  try {
    await api('logout', {});
    closeManager();closeCommunity();closeAccount();
    $('dashboard-view').hidden = true;
    $('auth-view').hidden = false;
    $('account-email').textContent = '';
    switchMode('login');
  } catch { $('dashboard-message').textContent = '로그아웃하지 못했습니다. 다시 시도해 주세요.'; $('dashboard-message').hidden = false; }
  finally { $('logout-button').disabled = false; }
});
switchMode('login');
initializeRecovery(api);
initializeSocial(api,dashboard);
api('me').then(({ user }) => { if (user) dashboard(user); }).catch(() => message('서버에 연결할 수 없습니다. 새로고침해 주세요.'));
