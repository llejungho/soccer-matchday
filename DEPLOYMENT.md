# MATCHDAY 공개 운영과 도메인 연결

이 자료는 현재 Node.js 24 + SQLite 사이트를 **한 대의 Linux 서버**에서 운영하는 구성입니다. Docker 파일과 Caddy HTTPS 설정을 함께 준비했습니다. 아직 도메인 구매나 서버 배포는 하지 않았습니다.

희망 주소는 `matchday.com`이며 현재 보류 중입니다. 등록 가능 여부를 확인하거나 예약하지 않았습니다. 도메인 확정 전까지 설정 예시는 `example.com`을 유지합니다.

## 등록 전에 정할 내용

| 항목 | 준비 내용 |
|---|---|
| 홈페이지 주소 | 원하는 영문 도메인과 확장자. example.com은 예시이며 사용 가능 여부를 확인한 이름이 아닙니다. |
| 명의와 연락처 | 본인 또는 운영 사업자 명의, 연락 가능한 이메일. 등록업체 계정에서 갱신과 DNS를 관리합니다. |
| 비용 | 도메인 첫해 가격과 갱신 가격, 서버 월 비용을 따로 확인하세요. |
| 서버 | 공인 고정 IP가 있는 Linux 서버와 SSH 접근 권한. 단일 앱 인스턴스로 시작합니다. |
| 운영 담당 | 문의 이메일, 데이터 백업 담당, 도메인 갱신 담당. |

도메인은 등록업체에서 구매한 뒤 해당 계정에서 DNS를 설정합니다. [ICANN 등록자 안내](https://www.icann.org/registrants)를 참고하세요. 실제 결제 전에 원하는 이름과 갱신 조건을 확인해야 합니다.

## 서버와 DNS 설정

1. 서버에 [공식 Docker Engine과 Compose 설치 안내](https://docs.docker.com/engine/install/ubuntu/)대로 설치합니다.
2. 프로젝트를 서버의 `/opt/matchday` 같은 폴더에 올립니다. `.env`와 실제 DB를 공개 저장소에 올리지 마세요.
3. DNS에서 `A` 레코드의 호스트 `@`를 서버 공인 IPv4로 지정합니다. IPv6로 운영할 때만 올바른 `AAAA`도 설정합니다. 사용하지 않는 IPv6 주소는 넣지 마세요.
4. 서버 방화벽과 클라우드 방화벽에서 TCP 80·443을 허용합니다. SSH는 운영자만 접근하도록 설정합니다. 앱의 3000번 포트는 외부에 공개하지 않습니다.
5. `.env.example`을 `.env`로 복사하고 `DOMAIN`과 `ACME_EMAIL`을 실제 값으로 바꿉니다. `DOMAIN`에는 선택한 대표 주소 하나만 입력합니다.

```sh
cp .env.example .env
# .env를 편집한 후 실행
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail=100 app caddy
```

Caddy는 도메인의 DNS가 서버로 연결되고 80·443에 접근할 수 있으면 인증서를 발급·갱신하고 HTTP를 HTTPS로 보냅니다. [공식 HTTPS 안내](https://caddyserver.com/docs/automatic-https). 대표 도메인과 `PUBLIC_ORIGIN`이 일치해야 로그인·저장이 됩니다. `www`를 대표 주소로 쓰려면 `DOMAIN=www.실제도메인`으로 설정하고 DNS도 그 주소를 서버에 연결하세요. 현재 예제는 다른 별칭 도메인의 연결까지 설정하지 않습니다.

## 기존 데이터 옮기기

현재 로컬의 `data/accounts.sqlite`에 회원·팀·선수·스쿼드가 들어 있습니다. 실행 중인 DB 파일만 복사하면 최근 기록이 빠질 수 있으므로 아래 백업 명령으로 일관된 파일을 만듭니다.

```sh
node scripts/backup.mjs
```

출력된 백업 파일을 서버의 프로젝트 폴더에 `initial.sqlite`이라는 이름으로 올린 다음, **서버가 빈 신규 설치일 때만** 다음 명령으로 넣습니다. 이미 가입자가 있는 서버에는 덮어쓰지 마세요.

```sh
docker compose stop app
docker compose run --rm --user root -v "$PWD/initial.sqlite:/import.sqlite:ro" app sh -c 'cp /import.sqlite /data/accounts.sqlite && chown node:node /data/accounts.sqlite'
docker compose up -d
```

이 과정은 초기 설치의 빈 DB에만 사용합니다. 데이터는 Docker의 `app-data` 볼륨에 남습니다. `docker compose down -v`는 데이터를 지우므로 운영 중 사용하지 마세요.

## 백업과 업데이트

```sh
# 실행 중에도 SQLite 백업 API로 안전하게 백업
docker compose exec app node scripts/backup.mjs
# 파일 목록 확인 후 필요한 파일을 서버 외부 저장소로도 보관
docker compose exec app ls /data/backups
docker compose cp app:/data/backups ./backups
# 소스 업데이트 후
docker compose up -d --build
```

매일 백업하고 서버 외부에도 사본을 보관하세요. 백업에는 개인정보가 있으므로 접근 권한을 제한합니다. 복원은 앱을 중지한 뒤 기존 DB·WAL·SHM 파일을 함께 별도 폴더로 보관하고, 백업을 `accounts.sqlite`로 넣은 뒤 재시작하는 방식입니다. 먼저 별도 테스트 환경에서 복원과 로그인을 확인하세요.

## 공개 운영 확인

- HTTPS 접속, 회원가입 → 팀 생성 → 전술 → 선수 등록 → 스쿼드 생성 흐름 확인.
- 로그아웃 상태에서도 공유 링크의 그림만 표시되는지 확인.
- 다른 계정에서 다른 팀의 관리 데이터에 접근하지 못하는지 확인.
- 쿼터 결과 저장 후 분석 통계와 기록 잠금 확인.
- 모바일에서 선수 그림과 입력폼 확인, 백업 복원 확인.

현재 이메일 인증·이메일을 통한 비밀번호 재설정은 연결되어 있지 않습니다. 공개 운영 전에 이메일 서비스와 복구 절차를 연결해야 합니다. 운영자 연락처, 개인정보 처리방침과 이용약관은 실제 운영 주체·수집 목적·보관 기간·탈퇴 정책을 정한 뒤 페이지로 제공해야 합니다. 현재 개인정보 삭제·탈퇴 화면도 추가 작업이 필요합니다.

SQLite와 볼륨은 한 서버의 한 앱 인스턴스를 기준으로 합니다. 여러 서버로 늘릴 때는 공유 데이터베이스와 중앙 요청 제한을 도입해야 합니다. 현재 로그인 요청 제한은 Caddy가 덮어쓴 실제 IP 헤더를 사용하며 앱 포트를 외부에 노출하지 않는 구성을 전제로 합니다.
Cloudflare Pages + D1을 사용하려면 [CLOUDFLARE.md](CLOUDFLARE.md)를 참고하세요. 아래 내용은 별도 서버에서 Docker와 SQLite로 운영하는 방법입니다.

