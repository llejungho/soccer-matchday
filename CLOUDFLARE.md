# Cloudflare Pages + D1 배포

서비스 주소: https://soccer-matchday-b16.pages.dev

웹 화면과 로그인·팀·선수·스쿼드 API를 함께 배포합니다. 데이터는 Cloudflare D1에 저장하므로 PC를 꺼도 서비스와 데이터가 유지됩니다. 기존 Node/SQLite 서버도 `npm start`로 계속 실행할 수 있습니다. 두 환경의 데이터는 자동 동기화되지 않습니다.

## GitHub 자동 배포 설정

- 프로젝트: `soccer-matchday`, production branch: `main`
- Framework preset: None
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: 저장소 루트
- `wrangler.toml`에 서버의 `DB` 바인딩과 호환성 설정이 있습니다.
- 생성된 `dist/_worker.js`가 API를 처리하고 `ASSETS`에서 HTML/CSS/JS를 제공합니다. `public`만 배포하면 API가 실행되지 않습니다.

```sh
npm ci
npm test
npm run build
npx wrangler login
npm run cf:deploy
```

새 계정에 배포할 경우 `npx wrangler d1 create matchday-db`로 DB를 만들고 `wrangler.toml`의 database_id를 새 ID로 교체합니다. DB ID는 비밀번호가 아닙니다. 인증 토큰은 저장소에 넣지 않습니다. 현재는 운영 배포만 사용합니다. 미리보기를 사용하려면 별도 테스트 DB를 준비해야 합니다.

## DB 스키마 및 로컬 개발

```sh
npx wrangler d1 migrations apply matchday-db --remote
npx wrangler d1 migrations apply matchday-db --local
npm run build
npm run cf:dev
```

로컬 Cloudflare 테스트 주소는 터미널에 표시됩니다. 운영 DB의 스키마 변경은 새 migration 파일을 추가한 뒤 적용합니다. 배포만으로 DB가 삭제되거나 초기화되지 않습니다.

## 기존 회원·팀·선수 데이터 이전

최초 이전은 빈 운영 DB에 한 번만 실행합니다. 기존 DB에 다시 넣으면 ID와 이메일이 충돌합니다. 운영 중 데이터에 덮어쓰기하지 마세요.

```sh
npm run db:export
npx wrangler d1 execute matchday-db --remote --file data/exports/cloudflare-import.sql
```

`db:export`는 SQLite의 온라인 backup API로 WAL까지 포함한 일관된 스냅샷을 만듭니다. 회원 암호 해시, 팀·선수·평가·전술·스쿼드·경기 결과·공유를 이전합니다. 로컬 로그인 세션은 이전하지 않으므로 홈페이지에서는 기존 이메일과 암호로 다시 로그인합니다.

이전 파일에는 개인정보가 있습니다. `data/`는 Git에서 제외되어 있으며 빌드 출력에도 포함하지 않습니다. DB 파일을 GitHub에 올릴 필요가 없습니다.

## 운영 백업

```sh
mkdir -p data/backups
npx wrangler d1 export matchday-db --remote --output data/backups/cloudflare-backup.sql
```

파일을 비공개로 보관합니다. Cloudflare D1의 Time Travel 기능도 복구에 사용할 수 있으며 보관 기간은 플랜에 따라 다릅니다.

## 접속 오류 확인

- `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`: HTML/API 실행 전 HTTPS 연결 오류입니다. 안정적인 운영 주소로 확인하고, Cloudflare 인증서 상태와 브라우저/네트워크를 확인합니다. 인증서 검증을 끄거나 HTTP로 우회하지 않습니다.
- `404`: Pages 빌드 명령, 출력 `dist`, 최근 배포 상태를 확인합니다.
- API `503`: 해당 배포에 `DB` 바인딩이 없습니다.
- API `500`: DB migration과 Worker 로그를 확인합니다.
- API `409`: 동시 변경으로 이전 상태의 저장이 거절되었습니다. 화면을 새로고침한 뒤 다시 저장합니다. 팀 이관과 프로필 변경 등 여러 SQL 작업은 D1 batch로 원자적으로 저장합니다.

## 사용자 도메인

도메인을 확정한 뒤 Pages → Custom domains에서 연결합니다. Cloudflare가 제공하는 DNS 및 인증서 발급 절차를 따릅니다. `matchday.com`의 구매 가능 여부는 별도로 확인해야 합니다. API는 접속한 홈페이지와 같은 도메인을 사용하므로 도메인 변경 후에도 동작합니다.

공식 문서: [Pages Functions](https://developers.cloudflare.com/pages/functions/advanced-mode/), [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/).
