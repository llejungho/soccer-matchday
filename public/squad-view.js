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
    });card.append(pitch);for(const [kind,label] of [['corner','코너킥'],['freeKick','프리킥'],['penalty','PK']]){const names=q.setPieces?.[kind]?.filter(Boolean)||[];if(names.length)card.append(element('p',label+' · '+names.join(' / '),'set-piece-summary'));}grid.append(card);
  });root.append(grid,element('p','전·후는 해당 쿼터의 전반·후반입니다. 같은 이름이면 한 쿼터 전체 출전입니다.','hint'));
}
