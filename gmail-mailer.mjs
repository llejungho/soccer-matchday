import {connect as tlsConnect} from 'node:tls';
import {randomBytes} from 'node:crypto';

export const GMAIL_SENDER='lleee86@gmail.com';
export const gmailEnabled=env=>/^[a-zA-Z0-9]{16}$/.test((env.GMAIL_APP_PASSWORD||'').replace(/\s/g,''));

// Implicit TLS validates smtp.gmail.com's certificate before sending credentials.
// No SMTP responses, credentials or reset codes are written to logs.
export async function sendGmailCode(env,to,code,connect=tlsConnect){
  if(!gmailEnabled(env)||!/^\d{6}$/.test(code)||! /^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/.test(to))throw new Error('Invalid mail configuration');
  const socket=connect({host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',rejectUnauthorized:true});
  let buffer='',waiting=null,failure=null;
  const fail=()=>{failure=new Error('Gmail SMTP connection failed');waiting?.();};
  socket.on('data',data=>{buffer+=data.toString('utf8');if(buffer.length>65536){fail();socket.destroy();}waiting?.();});
  socket.on('error',fail);socket.on('end',fail);
  const deadline=setTimeout(()=>{fail();socket.destroy();},20000);
  async function line(){
    while(!buffer.includes('\r\n')){if(failure)throw failure;await new Promise(resolve=>{waiting=resolve;});waiting=null;}
    const end=buffer.indexOf('\r\n'),text=buffer.slice(0,end);buffer=buffer.slice(end+2);return text;
  }
  async function reply(expected){
    let current;
    do{current=await line();if(!/^\d{3}[ -]/.test(current))throw new Error('Invalid SMTP response');}while(current[3]==='-');
    const status=Number(current.slice(0,3));if(!expected.includes(status))throw new Error('Gmail SMTP rejected request ('+status+')');
  }
  const command=async(text,expected)=>{socket.write(text+'\r\n');await reply(expected);};
  try{
    await reply([220]);await command('EHLO matchday',[250]);
    await command('AUTH PLAIN '+Buffer.from('\0'+GMAIL_SENDER+'\0'+env.GMAIL_APP_PASSWORD.replace(/\s/g,'')).toString('base64'),[235]);
    await command('MAIL FROM:<'+GMAIL_SENDER+'>',[250]);await command('RCPT TO:<'+to+'>',[250,251]);await command('DATA',[354]);
    const text=`MATCHDAY 비밀번호 재설정 인증코드: ${code}\n\n사이트의 비밀번호 찾기 화면에 이 코드를 입력하세요.\n코드는 10분 동안 한 번만 사용할 수 있습니다.\n요청하지 않았다면 이 메일을 무시하세요.`;
    const body=Buffer.from(text,'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
    const message=[`From: MATCHDAY <${GMAIL_SENDER}>`,`To: <${to}>`,'Subject: =?UTF-8?B?'+Buffer.from('MATCHDAY 비밀번호 재설정 인증코드').toString('base64')+'?=', 'Date: '+new Date().toUTCString(),'Message-ID: <'+randomBytes(16).toString('hex')+'@gmail.com>','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',body].join('\r\n');
    await command(message+'\r\n.',[250]);
    socket.write('QUIT\r\n');
  }finally{clearTimeout(deadline);socket.destroy();}
}
