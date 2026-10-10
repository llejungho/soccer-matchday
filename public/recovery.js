const $=id=>document.getElementById(id);
export function openPasswordReset(email){$('password-reset-account').textContent=email+' 계정의 새 비밀번호를 입력하세요. 완료하면 모든 기기의 로그인이 종료됩니다.';$('password-reset-error').textContent='';$('password-reset-form').reset();$('password-reset-dialog').showModal();}
export async function openRecovery(api){
  $('recovery-error').textContent='';$('recovery-email-status').textContent='확인 중…';$('recovery-send').disabled=true;$('password-help-dialog').showModal();
  try{const [status,social]=await Promise.all([api('recovery/status'),api('social/providers')]);$('recovery-send').disabled=!status.emailEnabled;$('recovery-email-status').textContent=status.emailEnabled?'링크는 15분 동안 한 번만 사용할 수 있습니다.':'이메일 발송 연결을 준비 중입니다. 아래 연동된 SNS 본인 확인을 이용하세요.';const root=$('recovery-social-buttons');root.replaceChildren();for(const p of social.providers.filter(p=>p.enabled)){const b=document.createElement('button');b.type='button';b.className='secondary social-'+p.id;b.textContent=p.name+'로 확인';b.addEventListener('click',()=>{sessionStorage.setItem('password-recovery','1');location.href='/api/social/start/'+p.id;});root.append(b);}if(!root.childElementCount)root.textContent='이용 가능한 SNS가 없습니다.';}
  catch(e){$('recovery-error').textContent=e.error||'본인 확인 방법을 불러오지 못했습니다.';}
}
export async function initializeRecovery(api){
  $('close-password-reset').addEventListener('click',()=>{$('password-reset-dialog').close();$('password-reset-form').reset();});
  $('recovery-email-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('recovery-send');b.disabled=true;$('recovery-error').textContent='';try{const data=await api('recovery/request',{email:$('recovery-email').value});$('recovery-email-status').textContent=data.message;}catch(e){$('recovery-error').textContent=e.error||'메일 발송을 완료하지 못했습니다.';}finally{b.disabled=false;}});
  $('password-reset-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{await api('recovery/reset',{newPassword:$('reset-password').value,confirmPassword:$('reset-confirm').value});$('password-reset-form').reset();$('password-reset-dialog').close();location.href='/?password=reset';}catch(e){$('password-reset-error').textContent=e.error||'비밀번호를 변경하지 못했습니다.';}finally{b.disabled=false;}});
  const token=/^#reset=([a-f0-9]{64})$/.exec(location.hash)?.[1];
  if(token){history.replaceState(null,'','/');try{const verified=await api('recovery/verify',{token});openPasswordReset(verified.email);}catch(e){await openRecovery(api);$('recovery-error').textContent=e.error||'재설정 요청이 만료되었습니다.';}}
  if(new URL(location.href).searchParams.get('password')==='reset'){history.replaceState(null,'','/');$('form-message').textContent='비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.';$('form-message').hidden=false;}
}
