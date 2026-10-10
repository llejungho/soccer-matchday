export const ADMIN_EMAIL = 'llee86@naver.com';
export const isAdmin = user => user?.email === ADMIN_EMAIL;
export const nicknameKey = value => value.normalize('NFKC').trim().toLowerCase();
export function nicknameError(value, email) {
  if(typeof value !== 'string' || !/^[\p{L}\p{N}_]{2,20}$/u.test(value.normalize('NFKC').trim())) return '닉네임은 한글·영문·숫자·밑줄로 2~20자 입력해 주세요.';
  if(nicknameKey(value)==='관리자' && email!==ADMIN_EMAIL) return '관리자는 운영자 전용 닉네임입니다.';
  if(email===ADMIN_EMAIL && nicknameKey(value)!=='관리자') return '운영자 계정의 닉네임은 관리자입니다.';
  return null;
}
export const communitySchema = `
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_unique ON users(nickname_key);
CREATE TABLE IF NOT EXISTS board_posts(id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL CHECK(board IN ('notices','free')), author_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS board_posts_order ON board_posts(board,id DESC);
CREATE TABLE IF NOT EXISTS board_comments(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS board_comments_post ON board_comments(post_id,id);
CREATE TABLE IF NOT EXISTS player_quota_defaults(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), quota REAL NOT NULL CHECK(quota BETWEEN 0 AND 12 AND quota*2=CAST(quota*2 AS INTEGER)), PRIMARY KEY(player_id,user_id));`;
export function initializeCommunity(db) {
  const columns=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
  if(!columns.includes('nickname'))db.exec('ALTER TABLE users ADD COLUMN nickname TEXT');
  if(!columns.includes('nickname_key'))db.exec('ALTER TABLE users ADD COLUMN nickname_key TEXT');
  db.exec("UPDATE users SET nickname=CASE WHEN email='llee86@naver.com' THEN '관리자' ELSE '회원'||id END, nickname_key=CASE WHEN email='llee86@naver.com' THEN '관리자' ELSE '회원'||id END WHERE nickname_key IS NULL;");
  db.exec(communitySchema);
}
export function publicUser(user){return user?{id:user.id,email:user.email,nickname:user.nickname||`회원${user.id}`,isAdmin:isAdmin(user)}:null;}
const fail=(status,error,field)=>({status,body:{error,...(field?{field}:{})}});
const ok=body=>({status:200,body});
const validId=id=>Number.isSafeInteger(id)&&id>0;
export async function handleCommunity(db,path,user,input={}) {
  if(path==='/api/community/nickname-check') {
    const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    const error=nicknameError(input.nickname,email);if(error)return fail(400,error,'nickname');
    const exists=await db.prepare('SELECT id FROM users WHERE nickname_key=?').get(nicknameKey(input.nickname));
    return ok({available:!exists});
  }
  if(path==='/api/community/list') {
    if(!['notices','free'].includes(input.board))return fail(400,'게시판을 선택하세요.');
    const page=Number.isSafeInteger(input.page)&&input.page>0?Math.min(input.page,100000):1;
    const posts=await db.prepare("SELECT p.id,p.title,p.created_at AS createdAt,p.updated_at AS updatedAt,COALESCE(u.nickname,'회원'||u.id) AS nickname,(SELECT COUNT(*) FROM board_comments c WHERE c.post_id=p.id) AS commentCount FROM board_posts p JOIN users u ON u.id=p.author_id WHERE p.board=? ORDER BY p.id DESC LIMIT 20 OFFSET ?").all(input.board,(page-1)*20);
    const total=(await db.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE board=?').get(input.board)).n;
    return ok({posts,total,page,canWrite:!!user&&(input.board==='free'||isAdmin(user))});
  }
  if(path==='/api/community/post') {
    if(!validId(input.postId))return fail(400,'글을 선택하세요.');
    const post=await db.prepare("SELECT p.id,p.board,p.author_id AS authorId,p.title,p.content,p.created_at AS createdAt,p.updated_at AS updatedAt,COALESCE(u.nickname,'회원'||u.id) AS nickname FROM board_posts p JOIN users u ON u.id=p.author_id WHERE p.id=?").get(input.postId);
    if(!post)return fail(404,'삭제되었거나 없는 글입니다.');
    const comments=await db.prepare("SELECT c.id,c.author_id AS authorId,c.content,c.created_at AS createdAt,c.updated_at AS updatedAt,COALESCE(u.nickname,'회원'||u.id) AS nickname FROM board_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? ORDER BY c.id").all(post.id);
    const permission=item=>({...item,canManage:!!user&&(isAdmin(user)||item.authorId===user.id)});
    return ok({post:permission(post),comments:comments.map(permission)});
  }
  if(!user)return fail(401,'로그인한 뒤 작성해 주세요.');
  if(path==='/api/community/quota-default') {
    if(!validId(input.playerId))return fail(400,'선수를 선택하세요.');
    const player=await db.prepare('SELECT p.id FROM players p JOIN teams t ON t.id=p.team_id WHERE p.id=? AND t.owner_id=?').get(input.playerId,user.id);
    if(!player)return fail(404,'관리할 수 없는 선수입니다.');
    if(input.quota===null)await db.prepare('DELETE FROM player_quota_defaults WHERE player_id=? AND user_id=?').run(player.id,user.id);
    else {
      if(typeof input.quota!=='number'||!Number.isFinite(input.quota)||input.quota<0||input.quota>12||!Number.isInteger(input.quota*2))return fail(400,'쿼터 수는 0~12 사이의 0.5 단위로 입력하세요.');
      await db.prepare('INSERT INTO player_quota_defaults(player_id,user_id,quota) VALUES(?,?,?) ON CONFLICT(player_id,user_id) DO UPDATE SET quota=excluded.quota').run(player.id,user.id,input.quota);
    }
    return ok({quota:input.quota});
  }
  if(path==='/api/community/post-save') {
    const title=typeof input.title==='string'?input.title.trim():'',content=typeof input.content==='string'?input.content.trim():'';
    if(!title||title.length>120||!content||content.length>10000)return fail(400,'제목 1~120자, 내용 1~10,000자를 입력하세요.');
    if(input.postId!==undefined) {
      if(!validId(input.postId))return fail(400,'글을 선택하세요.');
      const post=await db.prepare('SELECT * FROM board_posts WHERE id=?').get(input.postId);if(!post)return fail(404,'없는 글입니다.');
      if(!isAdmin(user)&&(post.author_id!==user.id||post.board==='notices'))return fail(403,'작성자 또는 관리자만 수정할 수 있습니다.');
      await db.prepare('UPDATE board_posts SET title=?,content=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title,content,post.id);return ok({postId:post.id});
    }
    if(!['notices','free'].includes(input.board))return fail(400,'게시판을 선택하세요.');
    if(input.board==='notices'&&!isAdmin(user))return fail(403,'관리자만 공지사항을 작성할 수 있습니다.');
    const result=await db.prepare('INSERT INTO board_posts(board,author_id,title,content) VALUES(?,?,?,?)').run(input.board,user.id,title,content);
    return {status:201,body:{postId:Number(result.lastInsertRowid)}};
  }
  if(path==='/api/community/post-delete') {
    if(!validId(input.postId))return fail(400,'글을 선택하세요.');
    const post=await db.prepare('SELECT * FROM board_posts WHERE id=?').get(input.postId);if(!post)return fail(404,'없는 글입니다.');
    if(!isAdmin(user)&&(post.author_id!==user.id||post.board==='notices'))return fail(403,'작성자 또는 관리자만 삭제할 수 있습니다.');
    // Explicit cleanup also covers local databases without foreign_keys enabled.
    const action=async()=>{await db.prepare('DELETE FROM board_comments WHERE post_id=?').run(post.id);await db.prepare('DELETE FROM board_posts WHERE id=?').run(post.id);return ok({ok:true});};
    if(db.transaction)return await db.transaction(action);
    db.exec('BEGIN');try{db.prepare('DELETE FROM board_comments WHERE post_id=?').run(post.id);db.prepare('DELETE FROM board_posts WHERE id=?').run(post.id);db.exec('COMMIT');return ok({ok:true});}catch(e){db.exec('ROLLBACK');throw e;}
  }
  if(path==='/api/community/comment-save'||path==='/api/community/comment-delete') {
    if(input.commentId!==undefined) {
      if(!validId(input.commentId))return fail(400,'댓글을 선택하세요.');
      const comment=await db.prepare('SELECT * FROM board_comments WHERE id=?').get(input.commentId);if(!comment)return fail(404,'없는 댓글입니다.');
      if(!isAdmin(user)&&comment.author_id!==user.id)return fail(403,'작성자 또는 관리자만 댓글을 변경할 수 있습니다.');
      if(path.endsWith('delete')){await db.prepare('DELETE FROM board_comments WHERE id=?').run(comment.id);return ok({postId:comment.post_id});}
      if(typeof input.content!=='string'||!input.content.trim()||input.content.trim().length>2000)return fail(400,'댓글은 1~2,000자로 입력하세요.');
      await db.prepare('UPDATE board_comments SET content=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.content.trim(),comment.id);return ok({postId:comment.post_id});
    }
    if(path.endsWith('delete'))return fail(400,'댓글을 선택하세요.');
    if(!validId(input.postId)||typeof input.content!=='string'||!input.content.trim()||input.content.trim().length>2000)return fail(400,'글을 선택하고 댓글을 1~2,000자로 입력하세요.');
    if(!await db.prepare('SELECT id FROM board_posts WHERE id=?').get(input.postId))return fail(404,'없는 글입니다.');
    await db.prepare('INSERT INTO board_comments(post_id,author_id,content) VALUES(?,?,?)').run(input.postId,user.id,input.content.trim());return {status:201,body:{postId:input.postId}};
  }
  return fail(404,'찾을 수 없는 요청입니다.');
}
