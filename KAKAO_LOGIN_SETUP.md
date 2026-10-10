# MATCHDAY 카카오 로그인 설정

현재 로그인·가입·기존 이메일 계정 연동 코드는 구현되어 있습니다. 카카오 앱과 실제 키가 없으면 운영 버튼은 준비 중 상태입니다. 아래 설정을 완료해야 활성화됩니다.

## 사업자등록번호가 없는 개인 개발자

사업자가 아니어도 일반 카카오 로그인과 MATCHDAY 회원가입을 제공할 수 있습니다. 카카오 공식 문서에는 개인 개발자도 아래 조건을 충족하면 비즈 앱으로 전환하고 이메일을 필수 동의항목으로 설정할 수 있다고 안내되어 있습니다.

현재 사용할 앱은 `1603510`입니다. 새 앱을 만들지 않고 [기존 앱 설정](https://developers.kakao.com/console/app/1603510/config)을 사용합니다.

1. 앱 소유자 계정으로 로그인합니다.
2. 오른쪽 상단 프로필 → 계정 설정 → 본인인증에서 앱 소유자가 직접 본인인증을 완료합니다.
3. 앱 → 일반 → 비즈니스 정보 → 개인 개발자 비즈 앱으로 이동합니다.
4. 카카오비즈니스 통합 서비스 약관을 직접 확인하고 동의한 뒤 개인 개발자 비즈 앱으로 전환합니다. 사업자등록번호를 임의로 입력할 필요가 없습니다.
5. 카카오 로그인 사용 설정을 켜고, 아래 운영 Redirect URI를 등록합니다.
6. 카카오 로그인 → 동의항목에서 카카오계정(이메일)을 필수 동의로 설정합니다. 수집 목적은 `회원 계정 식별, 기존 이메일 회원 계정 연동 및 팀 이관 대상 확인`입니다.
7. REST API 키와 해당 Client Secret을 Cloudflare에 등록한 뒤 운영 로그인을 확인합니다.

일반 카카오 로그인 후 MATCHDAY에서 닉네임을 입력해 가입을 완료하는 방식입니다. 카카오싱크의 별도 ‘간편가입’ 기능이나 비즈니스 채널 연결은 이 흐름에 필요하지 않습니다. 개인 개발자 비즈 앱은 사업자 정보 없이 비즈니스 채널을 연결할 수 없습니다.

본인인증·약관 동의·실제 앱 설정을 완료하기 전에는 운영 카카오 로그인이 활성화됐다고 볼 수 없습니다. 이메일을 임의 생성하거나 인증 없이 입력한 이메일로 기존 회원을 연결하지 않습니다.

공식 근거: [앱 설정 — 개인 개발자 비즈 앱 전환](https://developers.kakao.com/docs/ko/app-setting/app), [카카오 로그인 설정](https://developers.kakao.com/docs/ko/kakaologin/prerequisite).

## 앱 생성과 로그인 설정

1. https://developers.kakao.com/ 에서 로그인 후 앱을 생성합니다. 앱 이름은 MATCHDAY, 대표 이미지는 MATCHDAY 로고를 사용합니다. 운영자·사업자 정보는 실제 정보를 입력합니다. 약관 동의와 계정 소유자 인증은 직접 진행합니다.
2. 앱의 카카오 로그인 사용 설정을 켭니다.
3. 앱 → 플랫폼 키 → REST API 키에서 아래 Redirect URI를 등록합니다. 앱 관리 메뉴는 계정에 표시되는 최신 이름을 따릅니다.

   `https://soccer-matchday-b16.pages.dev/api/social/callback/kakao`

4. 웹사이트 주소를 요구하는 항목에는 `https://soccer-matchday-b16.pages.dev`를 입력합니다. REST API 방식이므로 JavaScript 키나 Admin 키를 Cloudflare의 CLIENT_ID로 사용하지 않습니다.
5. 카카오 로그인 → 동의항목에서 카카오계정(이메일), `account_email` 권한을 설정합니다. 이메일은 계정 확인·기존 회원 연동·팀 이관에 필요합니다. 설정 권한이 없다면 콘솔에서 안내하는 비즈 앱 전환 또는 추가 권한 신청 조건을 먼저 확인합니다. 사업자 정보를 임의로 입력하지 않습니다. 권한이 승인되기 전까지 이메일 동의를 포함한 실제 가입은 완료할 수 없습니다.
6. REST API 키의 Client Secret을 확인합니다. 현재 공식 문서는 REST API 키에 Client Secret 기능이 활성화되어 생성된다고 안내합니다. 토큰 요청에는 해당 키의 Secret이 필요합니다.

## Cloudflare 등록

Workers & Pages → soccer-matchday → Settings → Variables and Secrets → Production:

| 변수 | 넣을 값 |
|---|---|
| KAKAO_CLIENT_ID | REST API 키 |
| KAKAO_CLIENT_SECRET | 해당 REST API 키의 Client Secret, 암호화 유형 |

저장 후 최신 버전을 다시 배포합니다. 비밀키는 GitHub나 채팅에 보내지 않습니다. 새 도메인을 사용하려면 등록 주소와 서비스의 `SOCIAL_BASE_URL`을 함께 변경해야 합니다.

## 확인할 흐름

- 카카오 로그인 → 이메일 제공 동의 → 닉네임 중복 확인 → 서비스 가입 완료
- 기존 이메일 회원과 이메일이 같으면 연동 안내·동의·기존 계정 본인 확인
- 재로그인 시 동일한 팀과 게시판 계정 표시
- 강퇴 계정은 이메일 및 카카오 로그인이 모두 차단됨
- 취소, 이메일 동의 거절, 인증 만료는 가입을 완료하지 않음

`KOE006`은 Redirect URI 등록값을, `KOE205`는 요청한 동의항목 권한을 확인합니다. Secret과 토큰을 오류 화면·스크린샷에 공개하지 않습니다.

공식 문서: https://developers.kakao.com/docs/ko/kakaologin/prerequisite

# 네이버 207 오류

207은 네이버 Callback URL 오류입니다. 네이버 앱에는 현재 운영 콜백 `https://soccer-matchday-b16.pages.dev/api/social/callback/naver`가 등록되어 있습니다. 기존 코드는 접속한 Cloudflare 개별 배포 주소를 콜백 주소로 사용했습니다. 이제 해당 주소에서 로그인을 시작하면 운영 주소로 먼저 이동하므로 등록되지 않은 배포 주소가 콜백으로 전달되지 않습니다.

항상 https://soccer-matchday-b16.pages.dev/ 에서 로그인을 새로 시작하세요. 이미 오류가 난 인증 요청은 재사용하지 않습니다.

공식 오류 안내: https://help.naver.com/service/23029/contents/20549?lang=ko&osType=COMMONOS
