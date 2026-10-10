from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from PIL import Image
import html

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
SHOTS=ROOT/'artifacts/naver/screenshots'
pdfmetrics.registerFont(TTFont('Korean','C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('KoreanBold','C:/Windows/Fonts/malgunbd.ttf'))
GREEN=colors.HexColor('#153d32'); PALE=colors.HexColor('#eff4e8')
W,H=A4
style=ParagraphStyle('body',fontName='Korean',fontSize=10.5,leading=17,textColor=GREEN,wordWrap='CJK')

def start(c,title,subtitle,page):
    c.setFillColor(GREEN); c.rect(0,H-76,W,76,fill=1,stroke=0)
    c.setFillColor(colors.white); c.setFont('KoreanBold',19); c.drawString(40,H-37,title)
    c.setFont('Korean',9); c.drawString(40,H-59,subtitle)
    c.setFillColor(GREEN);c.setFont('Korean',8);c.drawString(40,23,'MATCHDAY | 네이버 로그인 검수 참고 자료 | 2026-10-10')
    c.drawRightString(W-40,23,str(page));return H-101
def p(c,text,y,bold=False):
    st=ParagraphStyle('p',parent=style,fontName='KoreanBold' if bold else 'Korean')
    item=Paragraph(html.escape(text).replace('\n','<br/>'),st); _,height=item.wrap(W-80,H)
    item.drawOn(c,40,y-height);return y-height-12
def pic(c,file,y,maxheight=350,crop_top=None):
    im=Image.open(file)
    if crop_top: im=im.crop((0,0,im.width,min(im.height,crop_top)))
    ratio=min((W-80)/im.width,maxheight/im.height); iw,ih=im.width*ratio,im.height*ratio
    c.drawImage(ImageReader(im),(W-iw)/2,y-ih,width=iw,height=ih);return y-ih-15
def flow(c,items,y):
    for i,(title,text) in enumerate(items):
        c.setFillColor(PALE);c.roundRect(40,y-64,W-80,64,8,fill=1,stroke=0)
        c.setFillColor(GREEN);c.setFont('KoreanBold',11);c.drawString(54,y-23,f'{i+1}. {title}')
        item=Paragraph(html.escape(text),style);_,h=item.wrap(W-110,40);item.drawOn(c,54,y-30-h)
        y-=78
    return y

c=canvas.Canvas(str(OUT/'01-matchday-service-and-login-plan.pdf'),pagesize=A4)
c.setTitle('MATCHDAY 서비스 소개 및 네이버 로그인 적용 기획서')
y=start(c,'MATCHDAY 서비스 소개','서비스 콘텐츠 확인 / 공개 소개 페이지 및 가상 선수 예시',1)
y=p(c,'서비스 URL: https://soccer-matchday-b16.pages.dev\n공개 소개: https://soccer-matchday-b16.pages.dev/about.html',y)
y=p(c,'조기축구·동호회 축구 감독이 팀과 선수를 관리하고, 참석자·출전량·전술·포메이션에 따라 쿼터별 스쿼드를 구성하는 서비스입니다. 경기결과를 누적해 다음 구성의 보조 기준으로 활용합니다.',y)
y=pic(c,SHOTS/'04-service-about.png',y,380,crop_top=920)
y=p(c,'로그인 없이 서비스 소개를 확인할 수 있습니다. 선수 평가와 감독 코멘트는 소유자의 계정에서 관리하며, 공유 링크에는 최종 배치 그림만 표시합니다.',y)
c.showPage()
y=start(c,'네이버 신규 가입 과정','적용 형태 기획서 - 네이버 실제 인증 화면을 촬영한 자료가 아닙니다.',2)
y=p(c,'서버와 가입 흐름은 구현되어 있습니다. 이 자료의 단계도는 앱 키 등록 전 제출할 수 있는 기획 설명입니다. 실제 네이버 정보제공 동의 화면과 로그인 완료 캡처는 앱 등록자·테스터 계정으로 추가 촬영합니다.',y)
y=flow(c,[('로그인 또는 회원가입 화면','같은 네이버 로그인 버튼으로 시작합니다.'),('네이버 인증·정보제공 동의','네이버 화면에서 인증합니다. 이메일과 기본 이용자 식별자를 사용합니다.'),('SNS 신규 가입 화면','게시판에 사용할 닉네임만 입력하고 중복 확인합니다. 서비스 비밀번호를 받지 않습니다.'),('회원가입 완료','계정을 생성하고 팀 생성 화면으로 이동합니다.'),('재로그인','동일한 네이버 이용자 식별자는 기존 계정으로 로그인합니다.')],y)
y=p(c,'신규 SNS 회원은 별도 서비스 암호를 만들지 않습니다. 네이버의 이름·별명·성별·생일·전화번호·프로필 이미지는 현재 서비스에서 요청할 필요가 없습니다.',y)
c.showPage()
y=start(c,'기존 계정 연동과 동의 거절','실제 구현 동작 설명 / 검수 시 신규 가입 흐름과 구분',3)
y=flow(c,[('이미 연동된 네이버 계정','제공자와 이용자 식별자가 일치하면 기존 팀과 스쿼드를 그대로 불러옵니다.'),('같은 이메일의 기존 회원','이미 가입된 ID임을 알리고 연동 여부를 묻습니다. 이메일 일치만으로 연결하지 않습니다.'),('기존 회원 본인 확인','기존 로그인 세션 또는 기존 이메일 계정 암호로 확인합니다. 새 암호 입력·암호 생성은 없습니다.'),('확인 후 연동','동의를 선택한 경우 동일한 회원 ID에 네이버 계정을 연결합니다. 취소하면 연결하지 않습니다.'),('이메일 제공을 거절한 경우','이메일 사용 목적과 재동의 버튼을 안내합니다. 이메일 회원가입도 선택할 수 있습니다.')],y)
y=p(c,'보안: 브라우저 쿠키와 일회용 state로 요청을 확인하며 인증 만료·재사용을 거절합니다. SNS 접근 토큰은 DB에 저장하지 않습니다. 연동 시 다른 사람의 이메일 계정을 자동으로 연결하지 않습니다.',y)
c.showPage()
y=start(c,'서비스 기능 예시','이 화면들은 가상 팀·선수로 촬영한 실제 서비스 화면입니다.',4)
y=pic(c,ROOT/'public/guide/squad-result.png',y,340)
y=p(c,'쿼터별 전술·포메이션·선수 배치를 정하고 감독이 직접 수정합니다. 출전량 합계와 선수별 최종 배치를 확인한 뒤 공유할 수 있습니다.',y)
y=pic(c,ROOT/'public/guide/player-ratings.png',y,210)
y=p(c,'팀별로 평가 항목을 편집하고, 전술에서 우선 배치할 평가 항목을 선택합니다.',y)
c.save()

c=canvas.Canvas(str(OUT/'02-matchday-email-usage.pdf'),pagesize=A4)
c.setTitle('MATCHDAY 네이버 제공 정보 이메일 활용처')
y=start(c,'제공 정보: 이메일 활용처','기본 이용자 식별자 + 이메일 / 기타 프로필 정보 미사용',1)
y=p(c,'이메일은 회원 계정의 ID로 표시하고, 기존 이메일 회원과의 계정 연동 및 팀 이관 대상 회원 확인에 사용합니다. 네이버 기본 이용자 식별자는 재로그인 시 계정을 식별하는 데 사용합니다.',y)
y=p(c,'확인 경로: 로그인 → 마이페이지 → 내 정보. 아래는 가상의 이메일 가입 계정으로 촬영한 동일한 계정 정보 화면입니다. 네이버 인증을 실제로 거친 계정 화면은 앱 키 등록 후 추가 촬영할 수 있습니다.',y)
y=pic(c,SHOTS/'03-email-usage.png',y,370,crop_top=742)
y=p(c,'SNS 신규 가입에는 별도 비밀번호가 없습니다. 위 캡처는 이메일 가입 예시 계정이므로 비밀번호 변경 메뉴를 이용할 수 있습니다. 실제 SNS 신규 계정에는 해당 입력란 대신 SNS 로그인 안내를 표시합니다.',y)
c.showPage()
y=start(c,'이메일 가입·프로필 활용','일반 회원가입 화면과 제공 정보 사용 설명',2)
y=p(c,'일반 회원가입의 입력 순서는 ID(이메일) → 암호 → 암호 재확인 → 닉네임입니다. 아래 화면은 이메일 회원가입이며, 네이버 SNS 신규 가입은 닉네임만 입력합니다.',y)
y=pic(c,SHOTS/'02-email-signup.png',y,410)
y=p(c,'API 설정 권장 범위: 기본 이용자 식별자, 이메일 주소만 선택. 이메일은 서비스 계정 확인과 기존 회원 연동, 팀 이관 대상 확인에 필요합니다. 게시판에는 회원이 직접 정한 닉네임이 표시됩니다.',y)
y=p(c,'등록할 Callback URL:\nhttps://soccer-matchday-b16.pages.dev/api/social/callback/naver',y)
c.save()
print('Created 2 review PDFs in output/pdf')
