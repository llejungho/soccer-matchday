from pathlib import Path
import html
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from PIL import Image
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('KR', 'C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('KRB', 'C:/Windows/Fonts/malgunbd.ttf'))
W, H = A4
GREEN = colors.HexColor('#153d32')
STYLE = ParagraphStyle('body', fontName='KR', fontSize=10.5, leading=17, wordWrap='CJK', textColor=GREEN)
path = OUT / 'matchday-kakao-service-review.pdf'
c = canvas.Canvas(str(path), pagesize=A4)
c.setTitle('MATCHDAY 서비스 소개 및 카카오 로그인 적용 계획')

def start(title, subtitle, number):
    c.setFillColor(GREEN)
    c.rect(0, H-80, W, 80, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont('KRB', 18)
    c.drawString(38, H-36, title)
    c.setFont('KR', 9)
    c.drawString(38, H-60, subtitle)
    c.setFillColor(GREEN)
    c.setFont('KR', 8)
    c.drawString(38, 22, 'MATCHDAY | 카카오 앱 1603510 | 2026-10-10')
    c.drawRightString(W-38, 22, str(number))
    return H-104

def text(value, y):
    p = Paragraph(html.escape(value).replace('\n', '<br/>'), STYLE)
    _, height = p.wrap(W-76, H)
    p.drawOn(c, 38, y-height)
    return y-height-12

def picture(file, y, max_height):
    im = Image.open(file).convert('RGB')
    scale = min((W-76)/im.width, max_height/im.height)
    width, height = im.width*scale, im.height*scale
    c.drawImage(ImageReader(im), (W-width)/2, y-height, width=width, height=height)
    return y-height-12

y = start('MATCHDAY 서비스 소개', '개인 개발자 운영 스포츠 웹서비스 / 비즈니스 정보 심사 참고 자료', 1)
y = text('서비스 URL: https://soccer-matchday-b16.pages.dev/\n공개 소개: https://soccer-matchday-b16.pages.dev/about.html\n공개 공지사항: https://soccer-matchday-b16.pages.dev/notices.html', y)
y = text('조기축구·동호회 축구 감독을 위한 팀 및 선수 관리 서비스입니다. 참석 선수, 포지션, 출전량, 전술 컨셉과 포메이션을 고려해 쿼터별 스쿼드를 구성하고, 감독이 배치를 수정·공유할 수 있습니다. 경기결과를 기록해 이후 구성의 참고 자료로 활용합니다.', y)
y = picture(ROOT/'artifacts/naver/screenshots/04-service-about.png', y, 350)
y = text('공개 소개와 공지사항은 비회원도 확인할 수 있습니다. 팀·선수 관리에는 회원가입 및 로그인이 필요합니다. 다음 페이지는 가상 팀·선수를 사용해 촬영한 실제 서비스 기능 예시입니다.', y)
c.showPage()

y = start('팀 관리 및 스쿼드 구성 화면', '실제 구현 화면 / 예시 팀·선수 데이터 사용', 2)
y = text('팀별 선수 평가항목과 전술을 설정한 뒤, 선수 프로필·포지션·평가값을 관리합니다.', y)
y = picture(ROOT/'public/guide/player-ratings.png', y, 240)
y = text('스쿼드별 참석자와 쿼터 출전량을 지정하고 자동 배치합니다. 감독은 결과를 직접 수정할 수 있으며, 공유 링크에는 최종 스쿼드 그림이 표시됩니다.', y)
y = picture(ROOT/'public/guide/squad-result.png', y, 295)
c.showPage()

y = start('카카오 로그인 적용 계획', '구현된 서비스 가입 흐름 설명 / 실제 카카오 인증 완료 캡처가 아님', 3)
y = text('적용 상태: 카카오 앱은 개인 개발자 비즈 앱입니다. 카카오 로그인 사용 설정과 이메일 필수 동의 설정을 확인했습니다. 운영 키 연결과 최종 로그인 검증은 준비 중이며, 이 자료는 로그인 완료 증빙으로 제출하는 자료가 아닙니다.', y)
for title, body in [
    ('1. 카카오 인증', '로그인·회원가입 화면에서 카카오 로그인 버튼을 선택하고 카카오 화면에서 본인 인증 및 이메일 제공에 동의합니다.'),
    ('2. 신규 회원가입', '카카오 계정 식별자와 인증된 이메일을 확인합니다. 신규 회원은 게시판에 사용할 닉네임을 입력하고 중복 확인 후 가입합니다. 별도의 MATCHDAY 비밀번호는 만들지 않습니다.'),
    ('3. 기존 회원 계정 연동', '같은 이메일로 가입한 회원이 있으면 연동 안내를 표시합니다. 사용자의 연동 동의와 기존 계정 암호 또는 로그인 세션 확인 후 연결합니다. 이메일 일치만으로 자동 연결하지 않습니다.'),
    ('4. 재로그인 및 데이터 유지', '연결된 카카오 이용자 식별자로 기존 회원 계정을 찾아 같은 팀·선수·스쿼드 데이터를 이용합니다.'),
    ('5. 제공 정보 사용 목적', '카카오 이용자 식별자는 재로그인 계정 식별에 사용합니다. 이메일은 회원 계정 식별, 기존 이메일 회원 연동 및 팀 이관 대상 확인에 사용합니다. 게시판에는 서비스에서 정한 닉네임을 표시합니다.'),
]:
    y = text(title+'\n'+body, y)
y = text('서비스 운영 형태: 사업자등록번호가 없는 개인 개발자가 운영하는 축구 팀 관리 웹서비스입니다. 카카오싱크 간편가입 또는 비즈니스 채널 연결을 요청하는 자료가 아닙니다.', y)
y = text('운영 콜백: https://soccer-matchday-b16.pages.dev/api/social/callback/kakao', y)
c.save()
doc = pdfium.PdfDocument(str(path))
preview = ROOT/'tmp/pdfs/kakao-review'
preview.mkdir(parents=True, exist_ok=True)
for i, page in enumerate(doc):
    page.render(scale=1.4).to_pil().save(preview/f'page-{i+1}.png')
assert len(doc) == 3
assert path.stat().st_size < 20*1024*1024
print(f'Created {path.name}: {len(doc)} pages, {path.stat().st_size} bytes')
