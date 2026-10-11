import {EventEmitter} from 'node:events';
import {sendGmailCode} from '../gmail-mailer.mjs';

// Use the Workers socket streams directly instead of the Node TLS event shim.
export function streamSocket(socket){
  const events=new EventEmitter(),reader=socket.readable.getReader(),writer=socket.writable.getWriter();
  let closed=false;
  const close=()=>{if(closed)return;closed=true;reader.cancel().catch(()=>{});socket.close().catch(()=>{});};
  events.write=text=>writer.write(new TextEncoder().encode(text));
  events.destroy=close;
  socket.closed.catch(()=>{if(!closed)events.emit('error',new Error('SMTP socket closed'));});
  setTimeout(async()=>{
    try{while(!closed){const {done,value}=await reader.read();if(done){if(!closed)events.emit('end');break;}events.emit('data',Buffer.from(value));}}
    catch{if(!closed)events.emit('error',new Error('SMTP read failed'));}
  },0);
  return events;
}

export async function sendWorkerGmailCode(env,to,code){
  const {connect}=await import('cloudflare:sockets');
  return sendGmailCode(env,to,code,()=>streamSocket(connect({hostname:'smtp.gmail.com',port:465},{secureTransport:'on'})));
}
