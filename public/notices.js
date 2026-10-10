import {openCommunity,showCommunity} from './community.js';
const api=async(route,input)=>{const response=await fetch('/api/'+route,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw data;return data;};
openCommunity(api,null);showCommunity('notices');
