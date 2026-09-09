(function(){
  'use strict';
  const {strategies,simulate,move:ruleMove,payoff,random}=TrustEngine,$=id=>document.getElementById(id),total=12;
  const YOU={id:'you',name:'You',piece:'\u265A',description:'Decide each round yourself. No rule, no autopilot.',note:'Twelve choices, and nobody deciding them for you.'};
  let selected='tit',opponent=null,seed=0,match=null,round=0,timer=null;
  // live play state (play-yourself mode only)
  let manual=false,rng=null,mine=[],theirs=[],liveRec=[],sA=0,sB=0;
  const byId=id=>id==='you'?YOU:strategies.find(s=>s.id===id);
  const word=m=>m==='C'?'Cooperate':'Defect';
  function announce(text){$('announcement').textContent=text;}
  function pick(id){selected=id;document.querySelectorAll('.strategy').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===id)));$('selection-note').textContent=byId(id).note;}
  strategies.forEach((s,i)=>{
    const button=document.createElement('button');button.className='strategy';button.dataset.id=s.id;button.setAttribute('aria-pressed',String(s.id===selected));
    button.innerHTML=`<span class="number">0${i+1}</span><span class="selected-mark" aria-hidden="true">✓</span><span class="piece" aria-hidden="true">${s.piece}</span><strong>${s.name}</strong><span class="description">${s.description}</span>`;
    button.addEventListener('click',()=>pick(s.id));$('strategies').append(button);
    const option=document.createElement('option');option.value=s.id;option.textContent=s.name;$('alternative').append(option);
  });
  (function(){
    const b=document.createElement('button');b.className='strategy';b.dataset.id=YOU.id;b.setAttribute('aria-pressed','false');
    b.innerHTML=`<span class="number">06</span><span class="selected-mark" aria-hidden="true">\u2713</span><span class="piece" aria-hidden="true">${YOU.piece}</span><strong>${YOU.name}</strong><span class="description">${YOU.description}</span>`;
    b.addEventListener('click',()=>pick(YOU.id));$('strategies').append(b);
  })();
  function stop(){if(timer!==null)clearInterval(timer);timer=null;$('auto').textContent='Auto-play';$('auto').setAttribute('aria-pressed','false');}
  function prepareHistory(){
    $('history').replaceChildren();for(let i=0;i<total;i++){const cell=document.createElement('div');cell.className='round-cell';cell.innerHTML=`<span class="token"></span><span class="token"></span><span class="turn">${String(i+1).padStart(2,'0')}</span>`;cell.setAttribute('aria-label',`Round ${i+1}: not played`);$('history').append(cell);}
  }
  function start(){
    stop();const nums=new Uint32Array(2);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(nums);else{nums[0]=Math.floor(Math.random()*4294967296);nums[1]=Math.floor(Math.random()*4294967296);}
    opponent=strategies[Math.floor((nums[0]/4294967296)*strategies.length)].id;seed=nums[1];round=0;
    manual=selected==='you';
    if(manual){rng=random(seed);mine=[];theirs=[];liveRec=[];sA=sB=0;match={record:liveRec,scoreA:0,scoreB:0};}
    else match=simulate(selected,opponent,seed);
    $('selection').hidden=true;$('match').hidden=false;$('results').hidden=true;
    $('your-name').textContent=byId(selected).name;$('your-piece').textContent=byId(selected).piece;$('opponent-name').textContent='Unknown';$('opponent-piece').textContent='♟';
    ['your','opponent'].forEach(side=>{$(side+'-score').textContent='0';$(side+'-move').textContent='Ready';$(side+'-move').removeAttribute('data-move');});
    $('round-label').textContent='Round 00 / 12';$('match-label').textContent='02 / At the table';$('round-story').textContent='A stranger takes the other seat. What happens when your rules meet theirs?';$('gains').textContent='12 rounds · simultaneous choices';$('exchange').textContent='⇄';prepareHistory();
    $('choice-row').hidden=!manual;$('step').hidden=manual;$('auto').hidden=manual;
    $('your-rule').hidden=true;
    setChoice(true);
    $('step').disabled=false;$('auto').disabled=false;
    if(manual){$('choose-c').focus();announce('Match ready. Choose cooperate or defect each round.');}
    else{$('step').focus();announce('Match ready. Your strategy plays automatically when you advance each round.');}
  }
  function setChoice(on){['choose-c','choose-d'].forEach(id=>{const b=$(id);if(b)b.disabled=!on;});}
  function step(){
    if(!match||round>=total||manual)return;
    paint(match.record[round]);
  }
  // One human round. Consumes two rolls in the engine's order so the same seed
  // produces the same opponent behaviour as simulate() would.
  function manualStep(m){
    if(!manual||round>=total)return;
    rng();const theirRoll=rng();
    const om=ruleMove(opponent,mine,theirRoll),pts=payoff(m,om);
    mine.push(m);theirs.push(om);sA+=pts[0];sB+=pts[1];
    const r={a:m,b:om,points:pts,scoreA:sA,scoreB:sB};
    liveRec.push(r);match.scoreA=sA;match.scoreB=sB;
    paint(r);
  }
  function paint(r){
    round++;
    $('round-label').textContent=`Round ${String(round).padStart(2,'0')} / 12`;
    [['your',r.a,r.scoreA],['opponent',r.b,r.scoreB]].forEach(([side,m,score])=>{$(side+'-score').textContent=score;$(side+'-move').textContent=word(m);$(side+'-move').dataset.move=m;const piece=$(side+'-piece');piece.classList.remove('pulse');void piece.offsetWidth;piece.classList.add('pulse');});
    const stories={CC:'Both contribute. Both benefit.',CD:'You contribute. They take the advantage.',DC:'They contribute. You take the advantage.',DD:'Both hold back. Little is gained.'};
    $('round-story').textContent=stories[r.a+r.b];$('gains').textContent=`You +${r.points[0]} · Opponent +${r.points[1]}`;$('exchange').textContent=r.a===r.b?(r.a==='C'?'⇄':'∥'):(r.a==='D'?'←':'→');
    const cell=$('history').children[round-1];cell.children[0].classList.add(r.a==='C'?'coop':'defect');cell.children[1].classList.add(r.b==='C'?'coop':'defect');cell.setAttribute('aria-label',`Round ${round}: you ${word(r.a)}, opponent ${word(r.b)}. Points ${r.points[0]} and ${r.points[1]}.`);
    announce(`Round ${round}. You ${word(r.a)}, opponent ${word(r.b)}. Score ${r.scoreA} to ${r.scoreB}.`);
    if(round===total)finish();
  }
  function finish(){
    stop();setChoice(false);$('choice-row').hidden=true;$('step').disabled=true;$('auto').disabled=true;$('opponent-name').textContent=byId(opponent).name;$('opponent-piece').textContent=byId(opponent).piece;$('match-label').textContent='02 / Match complete';
    const {scoreA:a,scoreB:b,record}=match,mutual=record.filter(r=>r.a==='C'&&r.b==='C').length;
    $('result-label').textContent=a===b?'Equal scores':a>b?'You scored more':'Opponent scored more';$('reveal-label').textContent=`Your opponent was ${byId(opponent).name}`;
    let title,lesson;
    if(mutual===total){title='Trust paid both of you.';lesson='Neither side had to lose for the other to gain. Repeated cooperation earned 36 points each. Taking advantage once could earn more that round, but a reactive partner may stop cooperating.';}
    else if(selected==='tit'&&opponent==='mean'){title='A boundary, not a victory.';lesson='Tit for Tat offered trust once, then matched every defection. You avoided being exploited repeatedly, but both earned far less than two cooperating players. Tit for Tat does not guarantee a win.';}
    else if(selected==='nice'&&b>a){title='Trust needs a response.';lesson='Your piece kept cooperating even when the other side did not. Cooperation can create shared value, but an unconditional cooperator is vulnerable to exploitation.';}
    else if(selected==='mean'&&opponent==='nice'){title='You won. At their expense.';lesson='Always Nice never retaliated, so each defection earned you 5 points. That advantage depends on a partner who keeps giving. Try Tit for Tat and watch the shared total change.';}
    else if(mutual===0){title='A win can still be costly.';lesson='Not one round ended in mutual cooperation. Compare your total with the 36 each could earn by cooperating throughout. Individual incentives can lead to a worse outcome for both.';}
    else if(selected==='random'||opponent==='random'){title='Patterns meet probability.';lesson='Wildcard makes an independent 50–50 choice each round, not an exact half-and-half split. One match is a small sample. Reactive strategies turn those random choices into a longer pattern of trust or retaliation.';}
    else{title='Your choices echo.';lesson='A move changes more than the current score: it can change how a reactive opponent treats you next. The result depends on both strategies, not simply on being nice or mean.';}
    $('result-title').textContent=title;$('lesson').textContent=lesson;$('math-note').textContent=`Mutual cooperation: ${mutual} of 12 rounds (${Math.round(mutual/total*100)}%). Your average: ${(a/total).toFixed(2)} points per round. Together: ${a+b} points; mutual cooperation throughout would produce 72.`;
    if(manual){
      const fit=classify(),best=fit[0],rest=fit.slice(1,3).map(f=>`${f.s.name} ${f.hit}/12`).join(' \u00b7 ');
      // 6/12 is the coin-flip baseline for a binary choice, so anything near it
      // describes nobody. Say that plainly instead of naming a spurious winner.
      let msg;
      if(best.hit===12) msg=`Every one of your twelve choices matched <strong>${best.s.name}</strong>. You were following a rule you never picked.`;
      else if(best.hit>=9) msg=`Your choices were closest to <strong>${best.s.name}</strong>, matching on ${best.hit} of 12. Not a rule you picked, but close to one. Next: ${rest}.`;
      else msg=`No rule described you. The best fit was <strong>${best.s.name}</strong> at ${best.hit} of 12, and pure coin-flipping would score about 6. Being unpredictable is itself a strategy \u2014 it is the one Wildcard plays, and it is hard for a reactive opponent to build trust with.`;
      $('your-rule').innerHTML=msg;$('your-rule').hidden=false;
    } else $('your-rule').hidden=true;
    $('alternative').value=selected==='tit'?'mean':'tit';$('comparison').textContent='Replay the same opponent with a different rule.';$('results').hidden=false;
    announce(`Match complete. Your opponent was ${byId(opponent).name}. Your score ${a}, opponent ${b}. ${title}`);
  }
  // What would each fixed rule have played, given the opponent moves that actually
  // happened? Compares the human's choices against that, round by round. Wildcard is
  // excluded: agreeing with a coin flip says nothing.
  function classify(){
    const rolls=[],r2=random(seed);
    for(let i=0;i<mine.length;i++){rolls.push(r2());r2();}
    return strategies.filter(s=>s.id!=='random').map(s=>{
      let hit=0;
      for(let i=0;i<mine.length;i++) if(ruleMove(s.id,theirs.slice(0,i),rolls[i])===mine[i])hit++;
      return {s,hit,pct:Math.round(hit/mine.length*100)};
    }).sort((a,b)=>b.hit-a.hit);
  }
  $('choose-c').addEventListener('click',()=>manualStep('C'));
  $('choose-d').addEventListener('click',()=>manualStep('D'));
  $('start').addEventListener('click',start);$('step').addEventListener('click',step);
  $('auto').setAttribute('aria-pressed','false');$('auto').addEventListener('click',()=>{if(timer!==null){stop();return;}if(round>=total)return;$('auto').textContent='Pause';$('auto').setAttribute('aria-pressed','true');timer=setInterval(step,1100);step();});
  $('reset').addEventListener('click',()=>{stop();match=null;$('match').hidden=true;$('results').hidden=true;$('selection').hidden=false;document.querySelector(`[data-id="${selected}"]`).focus();});
  $('again').addEventListener('click',start);
  $('compare').addEventListener('click',()=>{const choice=$('alternative').value,alt=simulate(choice,opponent,seed),delta=alt.scoreA-match.scoreA;$('comparison').textContent=`${byId(choice).name}: ${alt.scoreA} points for you, ${alt.scoreB} for ${byId(opponent).name}. ${delta===0?'The same personal score.':`${Math.abs(delta)} ${delta>0?'more':'fewer'} points for you.`}`+(manual?' That is what the rule would have scored where you chose for yourself.':'');});
  $('comparison').setAttribute('aria-live','polite');
  $('rules-toggle').addEventListener('click',()=>{const show=$('rules').hidden;$('rules').hidden=!show;$('rules-toggle').setAttribute('aria-expanded',String(show));});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
})();
