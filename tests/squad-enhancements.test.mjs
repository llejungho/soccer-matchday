import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generate,slotsFor} from '../public/squad-engine.js';
import {eligibleReplacements,validateSetPieces,clearUnavailableSetPieces,namedSetPieces} from '../public/squad-set-pieces.js';
import {kakaoShareMessage} from '../public/kakao-share.js';
import {handleSocial} from '../social-auth.mjs';

test('basic concept is independent of evaluation scores, comments, chemistry and history',()=>{
 const players=slotsFor('442').map((s,i)=>({key:'p:'+i,id:i,name:'선수'+i,positions:[s.pos],quota:4,keeper:s.pos==='GK',ratings:{stamina:1,defense:1},chemistry:{good:[],bad:[]}}));
 const quarters=Array.from({length:4},()=>({formation:'442',tactic:null}));
 const first=generate(players,quarters,'fair');const changed=players.map(p=>({...p,ratings:{stamina:5,defense:5},comment:'개인 플레이 공격 압박',chemistry:{good:[1],bad:[2]}}));
 const second=generate(changed,quarters,'fair');assert.deepEqual(first.quarters.map(q=>q.halves),second.quarters.map(q=>q.halves));assert.ok(second.quarters[0].reason.includes('가중치를 적용하지 않고'));
});
test('manual replacements exclude occupied teammates and unavailable players, retaining current selection',()=>{
 const q={halves:[['a','b'],['c','a']]},players=['a','b','c','d'].map(key=>({key,availableQuarters:key==='d'?[1]:[0,1]}));
 assert.deepEqual(eligibleReplacements(players,q,0,0,0,2).map(p=>p.key),['a','c']);
 assert.deepEqual(eligibleReplacements(players,q,0,0,1,2).map(p=>p.key),['a','c','d']);
});
test('optional set pieces enforce attendance, count and uniqueness and publish names only',()=>{
 const q={halves:[['a','b'],['b','c']],setPieces:{corner:['a','b'],freeKick:['c',null],penalty:['a']}};
 assert.deepEqual(validateSetPieces(q),q.setPieces);assert.deepEqual(namedSetPieces(q,{a:'공격',b:'수비',c:'미드'}).corner,['공격','수비']);
 for(const picks of [{corner:['a','a']},{corner:['a']},{penalty:['outsider']}])assert.throws(()=>validateSetPieces({...q,setPieces:picks}));
 q.halves=[['b'],['c']];clearUnavailableSetPieces(q);assert.deepEqual(q.setPieces.corner,[null,'b']);assert.deepEqual(q.setPieces.penalty,[null]);assert.deepEqual(validateSetPieces({halves:q.halves}),{corner:[null,null],freeKick:[null,null],penalty:[null]});
});
test('Kakao public configuration excludes login secrets and shares a final squad link',async()=>{
 const response=await handleSocial(null,new Request('https://example.com/api/social/share-config'),{KAKAO_JAVASCRIPT_KEY:' js ',KAKAO_CLIENT_SECRET:'secret',KAKAO_CLIENT_ID:'rest'},null);
 assert.deepEqual(response.body,{javascriptKey:'js'});const message=kakaoShareMessage('이름'.repeat(100),'https://example.com/share/123');assert.ok(message.text.length<=200);assert.equal(message.link.mobileWebUrl,message.link.webUrl);assert.throws(()=>kakaoShareMessage('a','http://example.com/'));
});
