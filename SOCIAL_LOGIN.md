# 네이버·카카오·구글 로그인 활성화

로그인·회원가입 화면에 세 제공자 버튼이 있고, 서버 OAuth 인증·SNS 닉네임 가입·이메일 계정 연동 기능은 구현되어 있습니다. 운영 환경에 키가 없는 제공자는 준비 중 상태입니다. 실제 키를 등록하면 해당 제공자가 활성화됩니다. 비밀 키는 채팅·GitHub·공개 JavaScript에 넣지 않습니다. 네이버 검수 제출 항목과 자료 사용법은 [NAVER_REVIEW.md](NAVER_REVIEW.md)를 참고하세요.

## 공통 설정

운영 서비스 URL: `https://soccer-matchday-b16.pages.dev`

| 제공자 | 등록할 콜백 / Redirect URI | Cloudflare 암호화 환경변수 |
|---|---|---|
| 네이버 | `https://soccer-matchday-b16.pages.dev/api/social/callback/naver` | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` |
| 카카오 | `https://soccer-matchday-b16.pages.dev/api/social/callback/kakao` | `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` |
| 구글 | `https://soccer-matchday-b16.pages.dev/api/social/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

Cloudflare → Workers & Pages → soccer-matchday → Settings → Variables and Secrets에서 **Production** 환경에 이름과 값을 추가합니다. Client Secret은 Encrypt/Secret 유형을 사용하세요. 키 저장 후 운영 배포를 다시 실행합니다. 앱 약관 동의·사업자/개인 정보 등록·서비스 심사가 필요한 단계는 계정 소유자가 완료합니다.

## 네이버

[네이버 개발자 센터](https://developers.naver.com/apps/#/register)에서 네이버 로그인 앱을 등록합니다. 서비스 환경 Web, 서비스 URL과 위 콜백을 등록하고 **이메일** 제공을 설정합니다. Client ID·Client Secret을 Cloudflare에 등록하세요. 일반 이용자에게 공개할 때 필요한 검수/이용자 범위 설정을 완료합니다. [공식 API 명세](https://developers.naver.com/docs/login/api/api.md), [프로필 명세](https://developers.naver.com/docs/login/profile/profile.md).

## 카카오

처음 앱을 만들 때는 [KAKAO_LOGIN_SETUP.md](KAKAO_LOGIN_SETUP.md)의 입력값과 절차를 따르세요.

[카카오 개발자 콘솔](https://developers.kakao.com/)에서 앱을 만들고 웹 도메인과 Redirect URI를 등록합니다. 카카오 로그인을 활성화하고 이메일(account_email) 동의 항목을 허용합니다. 이 코드의 CLIENT_ID에는 **REST API 키**, CLIENT_SECRET에는 **카카오 로그인 Client Secret**을 사용하며 Client Secret을 활성화합니다. 이메일 동의 항목은 앱 권한/상태에 따라 추가 신청이 필요할 수 있습니다. [공식 REST API 문서](https://developers.kakao.com/docs/ko/kakaologin/rest-api).

## 구글

[Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트와 OAuth 동의 화면을 만들고 웹 애플리케이션 OAuth 클라이언트를 생성합니다. 위 Redirect URI를 정확히 등록하세요. Client ID·Client Secret을 Cloudflare에 저장합니다. 이메일·기본 프로필만 요청합니다. 테스트 상태라면 테스트 사용자에게만 허용되므로 공개 사용을 위한 게시 상태도 확인하세요. [공식 웹 서버 OAuth 문서](https://developers.google.com/identity/protocols/oauth2/web-server).

## 계정 연결과 검증

- 인증 결과의 제공자 고유 ID로 SNS 계정을 구분합니다. 같은 이메일만으로 기존 계정에 로그인하거나 연결하지 않습니다.
- 기존 이메일이 있으면 안내와 연동 확인을 보여 줍니다. 기존 암호 또는 해당 기존 계정의 로그인 세션 확인이 필요합니다. 다른 SNS만 연결된 계정은 기존 SNS로 먼저 로그인해야 합니다.
- 최초 SNS 가입은 닉네임을 필수 입력하며 DB에서 중복 확인합니다. SNS 가입 계정에는 임의 암호를 발급하지 않습니다.
- state는 브라우저 HttpOnly 쿠키와 일회용 DB 기록으로 확인합니다. 만료·재사용·다른 브라우저 콜백은 거절합니다. 구글에는 PKCE도 적용합니다. 토큰은 공개 주소·브라우저 스크립트·로그·DB에 저장하지 않습니다.
- 검증: 세 제공자별 신규 가입 → 재로그인, 같은 이메일의 기존 암호 계정 연동 → 두 로그인 경로에서 동일한 팀 확인, 취소·이메일 동의 거절·만료 → 안내, 다른 사람의 기존 계정 연동 시도 → 거절.

로컬에서는 같은 이름의 환경변수를 사용합니다. Cloudflare 로컬 개발은 Git에서 제외된 `.dev.vars` 파일을 사용할 수 있습니다. 로컬 콜백 주소도 각 콘솔에서 지원하는 방식으로 별도 등록해야 합니다. 사용자 도메인을 확정하면 콜백 주소도 추가하고 해당 도메인에서 테스트하세요.
