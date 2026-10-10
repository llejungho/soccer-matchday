import {recoverySchema} from './password-recovery.mjs';
import {accountSchema} from './account.mjs';
import {socialSchema} from './social-auth.mjs';
export const enhancementsSchema=`${accountSchema}${socialSchema}${recoverySchema}
CREATE TABLE IF NOT EXISTS board_views(post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,viewer_key TEXT NOT NULL,viewed_at INTEGER NOT NULL,PRIMARY KEY(post_id,viewer_key));
CREATE TABLE IF NOT EXISTS board_recommendations(post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(post_id,user_id));
CREATE UNIQUE INDEX IF NOT EXISTS board_guide_key ON board_posts(guide_key);`;
export function initializeEnhancements(db){
  for(const [table,column,definition] of [['board_posts','views','INTEGER NOT NULL DEFAULT 0'],['board_posts','images',"TEXT NOT NULL DEFAULT '[]'"],['board_posts','guide_key','TEXT'],['team_tactics','rating_fields',"TEXT NOT NULL DEFAULT '[]'"]]){
    if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }db.exec(enhancementsSchema);
}
