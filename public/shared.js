import {lineupView} from './squad-view.js';
const root=document.getElementById('shared-view');
fetch('/api/shared/'+location.pathname.split('/').pop()).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);lineupView(data,root);}).catch(e=>{root.textContent=e.message||'스쿼드를 불러올 수 없습니다.';});
