# MATCHDAY Google 로그인 설정

프로젝트: `matchday-511214`

## OAuth 클라이언트

| 항목 | 입력값 |
|---|---|
| 애플리케이션 유형 | 웹 애플리케이션 |
| 이름 | MATCHDAY Web |
| 승인된 리디렉션 URI | https://soccer-matchday-b16.pages.dev/api/social/callback/google |
| 승인된 JavaScript 원본 | 현재 서버 OAuth 방식에서는 불필요. 브라우저 SDK를 추가할 경우 https://soccer-matchday-b16.pages.dev |

Google Auth Platform의 브랜딩·대상 설정이 먼저 필요한 경우 앱 이름 MATCHDAY, 실제 운영자 연락처를 사용합니다. 테스트 또는 외부 공개 상태를 확인합니다. 실제 존재하지 않는 개인정보처리방침 주소나 소유권을 확인하지 않은 도메인을 입력하지 않습니다. 공개 게시·브랜드 검증 요구사항은 콘솔에 표시되는 안내를 따릅니다.

현재 앱은 사용자 식별과 인증된 이메일만 필요한 `openid email` 범위를 요청합니다. 닉네임은 MATCHDAY 가입 화면에서 직접 정합니다. Gmail·Drive·Calendar API 권한은 필요하지 않습니다.

## 운영 키 등록

Cloudflare → Workers & Pages → soccer-matchday → Settings → Variables and Secrets → Production:

| 이름 | 값 |
|---|---|
| GOOGLE_CLIENT_ID | 생성한 웹 OAuth 클라이언트 ID, 보통 .apps.googleusercontent.com으로 끝남 |
| GOOGLE_CLIENT_SECRET | 해당 OAuth 클라이언트의 보안 비밀 |

Secret 유형으로 저장하고 재배포합니다. Client Secret은 생성 시 안전하게 확보하며 GitHub·공개 파일에 저장하지 않습니다. 프로젝트 ID·API 키·서비스 계정 키를 OAuth 클라이언트 ID 대신 넣지 않습니다.

## 확인

로그인 버튼 → Google 계정 선택·동의 → 신규 닉네임 가입 또는 기존 이메일 계정 연동 → 재로그인 순서로 확인합니다. 기존 계정은 이메일 일치만으로 연결하지 않으며, 기존 계정 본인 확인이 필요합니다. 연결된 다른 SNS로 먼저 로그인한 상태에서 계정을 연동할 수도 있습니다.

등록 URI는 인증 요청의 redirect_uri와 완전히 일치해야 합니다. 인증 요청은 운영 주소에서 시작합니다. 키 등록만으로 가입·로그인 검증이 완료되는 것은 아닙니다.

공식 안내: https://developers.google.com/identity/protocols/oauth2/web-server
OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
