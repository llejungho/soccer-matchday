import {writeFileSync} from 'node:fs';
import {guideTitle,guideContent,guideImages,guideKey} from '../guide.mjs';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
writeFileSync('migrations/0004_squad_guide.sql',`INSERT INTO board_posts(board,author_id,title,content,images,guide_key) SELECT 'notices',id,${quote(guideTitle)},${quote(guideContent)},${quote(JSON.stringify(guideImages))},${quote(guideKey)} FROM users WHERE email='llee86@naver.com' AND NOT EXISTS(SELECT 1 FROM board_posts WHERE guide_key=${quote(guideKey)});\n`);
