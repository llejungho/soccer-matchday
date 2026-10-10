ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN nickname_key TEXT;
UPDATE users SET nickname=CASE WHEN email='llee86@naver.com' THEN '관리자' ELSE '회원'||id END,nickname_key=CASE WHEN email='llee86@naver.com' THEN '관리자' ELSE '회원'||id END;

CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_unique ON users(nickname_key);
CREATE TABLE IF NOT EXISTS board_posts(id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL CHECK(board IN ('notices','free')), author_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS board_posts_order ON board_posts(board,id DESC);
CREATE TABLE IF NOT EXISTS board_comments(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS board_comments_post ON board_comments(post_id,id);
CREATE TABLE IF NOT EXISTS player_quota_defaults(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), quota REAL NOT NULL CHECK(quota BETWEEN 0 AND 12 AND quota*2=CAST(quota*2 AS INTEGER)), PRIMARY KEY(player_id,user_id));
