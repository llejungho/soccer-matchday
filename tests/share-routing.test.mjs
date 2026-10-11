import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';

test('shared squads retain their token when Pages canonicalizes HTML assets',async()=>{
  const fetched=[];
  const env={ASSETS:{fetch:async request=>{
    fetched.push(new URL(request.url).pathname);
    if(new URL(request.url).pathname==='/shared.html')return new Response(null,{status:308,headers:{Location:'/shared'}});
    assert.equal(new URL(request.url).pathname,'/shared');
    return new Response(request.method==='HEAD'?null:'<main id="shared-view"></main>',{headers:{'Content-Type':'text/html'}});
  }}};
  for(const method of ['GET','HEAD']){
    const request=new Request('https://test.pages.dev/share/abc123',{method});
    const response=await worker.fetch(request,env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Location'),null);
    assert.equal(new URL(request.url).pathname,'/share/abc123');
    assert.equal(response.headers.get('Cache-Control'),'no-cache');
    if(method==='GET')assert.match(await response.text(),/shared-view/);
  }
  assert.deepEqual(fetched,['/shared','/shared']);
});
