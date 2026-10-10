export function element(tag,text,className) {const el=document.createElement(tag);if(text!==undefined&&text!==null)el.textContent=text;if(className)el.className=className;return el;}
export function lineupView(snapshot,root) {
  root.replaceChildren();root.append(element('h2',snapshot.name));
  const grid=element('div',null,'squad-pitches');
  snapshot.quarters.forEach((q,qi)=>{
    const card=element('section',null,'squad-quarter');card.append(element('h3',`${qi+1}쿼터 · ${q.formation}`),element('p',q.tacticName,'hint'));
    const pitch=element('div',null,'squad-pitch');
    q.slots.forEach((slot,i)=>{
      const marker=element('div',null,'squad-marker');marker.style.left=slot.x+'%';marker.style.top=slot.y+'%';
      if(q.slots.filter(s=>s.y===slot.y).length>=5)marker.style.width='16%';
      const a=q.halves[0][i],b=q.halves[1][i];marker.append(element('b',slot.pos),element('span',a===b?(a||'빈자리'):`전 ${a||'빈자리'} / 후 ${b||'빈자리'}`));pitch.append(marker);
    });card.append(pitch);grid.append(card);
  });root.append(grid,element('p','전·후는 해당 쿼터의 전반·후반입니다. 같은 이름이면 한 쿼터 전체 출전입니다.','hint'));
}
export function downloadImage(snapshot) {
  const columns=Math.min(2,snapshot.quarters.length),rows=Math.ceil(snapshot.quarters.length/columns),w=1100,h=100+rows*720;
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');
  c.fillStyle='#f5f7f2';c.fillRect(0,0,w,h);c.fillStyle='#153d32';c.font='bold 32px sans-serif';c.fillText(snapshot.name,32,45);c.font='16px sans-serif';c.fillText('전·후: 쿼터 전반·후반 / 같은 선수는 쿼터 전체 출전',32,78);
  snapshot.quarters.forEach((q,qi)=>{const x=30+(qi%columns)*540,y=115+Math.floor(qi/columns)*720,pw=500,ph=610;c.fillStyle='#153d32';c.font='bold 21px sans-serif';c.fillText(`${qi+1}쿼터 · ${q.formation} · ${q.tacticName}`,x,y,500);c.fillStyle='#246747';c.fillRect(x,y+20,pw,ph);c.strokeStyle='#ffffff70';c.lineWidth=2;c.strokeRect(x+12,y+32,pw-24,ph-24);c.beginPath();c.moveTo(x+12,y+20+ph/2);c.lineTo(x+pw-12,y+20+ph/2);c.stroke();c.beginPath();c.arc(x+pw/2,y+20+ph/2,50,0,Math.PI*2);c.stroke();
    q.slots.forEach((s,i)=>{const sx=x+pw*s.x/100,sy=y+20+ph*s.y/100;c.fillStyle='#d7ed9a';c.beginPath();c.arc(sx,sy-13,16,0,Math.PI*2);c.fill();c.fillStyle='#143c31';c.font='bold 11px sans-serif';c.textAlign='center';c.fillText(s.pos,sx,sy-9);c.fillStyle='#fff';c.font='bold 15px sans-serif';const a=q.halves[0][i]||'빈자리',b=q.halves[1][i]||'빈자리';if(a===b)c.fillText(a,sx,sy+20,110);else{c.fillText('전 '+a,sx,sy+18,110);c.fillText('후 '+b,sx,sy+38,110);}c.textAlign='left';});
  });
  canvas.toBlob(blob=>{const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=snapshot.name.replace(/[\\/:*?"<>|]/g,'_')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
}
