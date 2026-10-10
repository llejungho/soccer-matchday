import {build} from 'esbuild';
import {mkdirSync,cpSync,readdirSync,writeFileSync} from 'node:fs';
mkdirSync('dist',{recursive:true});
for(const file of readdirSync('public'))cpSync('public/'+file,'dist/'+file,{recursive:true});
await build({entryPoints:['cloudflare/worker.mjs'],outfile:'dist/_worker.js',bundle:true,format:'esm',platform:'neutral',external:['node:*'],target:'es2022'});
writeFileSync('dist/_routes.json',JSON.stringify({version:1,include:['/*'],exclude:[]}));
console.log('Cloudflare Pages: dist/ (assets + API Worker).');
