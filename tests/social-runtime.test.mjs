import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('workerd exchanges SNS tokens and rejects provider redirects without forwarding credentials',async()=>{
  const bundled=await build({stdin:{contents:`
    import {handleSocial} from './social-auth.mjs';
    export default {async fetch(request){
      const db={prepare(sql){return {
        async get(){return sql.includes('oauth_states')?{verifier:'test-verifier'}:null;},
        async run(){return {changes:1};}
      };},async transaction(fn){return await fn();}};
      try {const result=await handleSocial(db,request,{NAVER_CLIENT_ID:'test-client',NAVER_CLIENT_SECRET:'test-secret'},null);
        return Response.json({status:result.status,location:result.headers?.Location});
      }catch(e){return Response.json({error:e.message});}
    }};`,resolveDir:process.cwd()},write:false,bundle:true,format:'esm',platform:'neutral',external:['node:*'],target:'es2022'});
  let redirect=false;const calls=[];
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],outboundService:async request=>{
    const url=new URL(request.url);calls.push(url.hostname);
    if(url.hostname==='nid.naver.com'){
      const body=new URLSearchParams(await request.text());assert.equal(body.get('client_secret'),'test-secret');
      if(redirect)return new Response(null,{status:302,headers:{Location:'https://unexpected.example/token'}});
      return Response.json({access_token:'test-access-token'});
    }
    assert.equal(url.hostname,'openapi.naver.com');assert.equal(request.headers.get('authorization'),'Bearer test-access-token');
    return Response.json({response:{id:'test-subject',email:'runtime@example.com'}});
  }}));
  const state='a'.repeat(64),url='https://service.example/api/social/callback/naver?state='+state+'&code=test-code';
  try{
    const success=await (await mf.dispatchFetch(url,{headers:{cookie:'oauth_state='+state}})).json();
    assert.deepEqual(success,{status:302,location:'/?social=complete'});assert.deepEqual(calls,['nid.naver.com','openapi.naver.com']);
    calls.length=0;redirect=true;
    const failure=await (await mf.dispatchFetch(url,{headers:{cookie:'oauth_state='+state}})).json();
    assert.equal(failure.error,'SNS 인증을 완료하지 못했습니다. 다시 시도해 주세요.');assert.deepEqual(calls,['nid.naver.com']);
  }finally{await mf.dispose();}
});
