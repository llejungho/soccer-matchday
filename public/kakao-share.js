let preparation;
export function kakaoShareMessage(name,url){
  const link=new URL(url);
  if(link.protocol!=='https:')throw new Error('공유 링크를 확인해 주세요.');
  return {objectType:'text',text:`MATCHDAY · ${String(name).slice(0,80)}\n최종 스쿼드와 쿼터별 세트피스 담당자를 확인하세요.`,link:{mobileWebUrl:link.href,webUrl:link.href},buttonTitle:'스쿼드 보기'};
}
export function prepareKakaoShare(request){
  if(preparation)return preparation;
  preparation=(async()=>{
    const config=await request('social/share-config');
    if(!config.javascriptKey)throw new Error('카카오톡 공유 설정을 확인해 주세요. 공유 링크는 사용할 수 있습니다.');
    if(!window.Kakao)await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://t1.kakaocdn.net/kakao_js_sdk/2.8.3/kakao.min.js';script.integrity='sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy';script.crossOrigin='anonymous';script.dataset.kakaoShare='true';
      script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('카카오톡 공유를 불러오지 못했습니다. 연결 상태를 확인해 주세요.'));};document.head.append(script);
    });
    if(!window.Kakao.isInitialized())window.Kakao.init(config.javascriptKey);
    document.querySelector('script[data-kakao-share]')?.setAttribute('data-initialized','true');
  })().catch(error=>{preparation=null;throw error;});return preparation;
}
// Call directly from the user's click, so browsers allow the sharing popup.
export function sendKakaoShare(name,url){
  if(!window.Kakao?.isInitialized())throw new Error('카카오톡 공유를 준비 중입니다. 잠시 후 다시 눌러 주세요.');
  window.Kakao.Share.sendDefault(kakaoShareMessage(name,url));
}
