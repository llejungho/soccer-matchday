import {test} from 'node:test';
import assert from 'node:assert/strict';
import {streamSocket} from '../cloudflare/gmail-transport.mjs';
import {sendGmailCode} from '../gmail-mailer.mjs';

test('Workers mail transport handles stream replies and waits for asynchronous writes',async()=>{
  let controller,closed=false;const commands=[];
  const send=text=>{controller.enqueue(new TextEncoder().encode(text.slice(0,4)));controller.enqueue(new TextEncoder().encode(text.slice(4)));};
  const socket={readable:new ReadableStream({start(c){controller=c;send('220 ready\r\n');}}),writable:new WritableStream({async write(bytes){
    await new Promise(resolve=>setTimeout(resolve,1));const text=new TextDecoder().decode(bytes);commands.push(text);
    if(text.startsWith('EHLO'))send('250-server\r\n250 AUTH PLAIN\r\n');
    else if(text.startsWith('AUTH'))send('235 Accepted\r\n');
    else if(text==='DATA\r\n')send('354 Continue\r\n');
    else if(text!=='QUIT\r\n')send('250 OK\r\n');
  }}),closed:new Promise(()=>{}),async close(){closed=true;}};
  await sendGmailCode({GMAIL_APP_PASSWORD:'aaaabbbbccccdddd'},'member@example.com','123456',async()=>streamSocket(socket));
  assert.equal(commands.at(-1),'QUIT\r\n');assert.ok(commands.some(c=>c.startsWith('From:')));assert.equal(closed,true);
});

test('Workers stream write failure aborts SMTP before sending the message',async()=>{
  let closed=false;
  const socket={readable:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('220 ready\r\n'));}}),writable:new WritableStream({write(){throw new Error('Transport unavailable');}}),closed:new Promise(()=>{}),async close(){closed=true;}};
  await assert.rejects(sendGmailCode({GMAIL_APP_PASSWORD:'aaaabbbbccccdddd'},'member@example.com','123456',async()=>streamSocket(socket)),/Transport unavailable/);
  assert.equal(closed,true);
});
