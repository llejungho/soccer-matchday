// Use Wrangler's local OAuth session; credentials never enter the repository.
import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
const candidates=[path.join(homedir(),'.wrangler/config/default.toml'),path.join(homedir(),'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),path.join(homedir(),'.config/.wrangler/config/default.toml')];
const config=candidates.find(existsSync);if(!config)throw new Error('Run wrangler login first');
const token=/oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(config,'utf8'))?.[1];if(!token)throw new Error('OAuth session missing');
const endpoint='https://api.cloudflare.com/client/v4/accounts/e9cd400aa7d2e03a4380c5985a08cc8e/pages/projects/soccer-matchday';
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const response=await fetch(endpoint,{headers});const existing=await response.json();if(!existing.success)throw new Error(JSON.stringify(existing.errors));
console.log(JSON.stringify({buildCommand:existing.result.build_config.build_command,output:existing.result.build_config.destination_dir,productionBranch:existing.result.production_branch,domains:existing.result.domains}));
if(process.argv.includes('--apply')){
  const update={
    build_config:{...existing.result.build_config,build_command:'npm run build',destination_dir:'dist',root_dir:''},
    deployment_configs:{
      production:{compatibility_date:'2026-10-10',compatibility_flags:['nodejs_compat'],d1_databases:{DB:{id:'5a3cf611-fbaa-4033-9d70-8c56c754a02e'}},env_vars:{NODE_VERSION:{type:'plain_text',value:'24'}}},
      preview:{d1_databases:{}},
    },
    source:{type:existing.result.source.type,config:{...existing.result.source.config,preview_deployment_setting:'none'}},
  };
  const saved=await fetch(endpoint,{method:'PATCH',headers,body:JSON.stringify(update)});const result=await saved.json();if(!result.success)throw new Error(JSON.stringify(result.errors));
  console.log('Pages Git build configured: npm run build → dist');
}
