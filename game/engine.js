/* Independent, deterministic game engine. No UI or network dependencies. */
(function (root) {
  'use strict';
  const strategies = [
    { id:'tit', name:'Tit for Tat', piece:'♘', description:'Cooperate first. Then copy their last move.', note:'Start with trust. Then return what you receive.' },
    { id:'nice', name:'Always Nice', piece:'♙', description:'Cooperate every time, no matter what.', note:'Give freely. Even when the other side does not.' },
    { id:'mean', name:'Always Mean', piece:'♜', description:'Defect every time. Take every opening.', note:'Take the short-term advantage. See what it costs later.' },
    { id:'grudge', name:'Grudger', piece:'♕', description:'Cooperate until betrayed. Never forgive.', note:'Trust is yours to lose. One betrayal changes everything.' },
    { id:'random', name:'Wildcard', piece:'♗', description:'A 50–50 choice each round. No memory.', note:'No pattern. No promises. Just probability.' }
  ];
  function random(seed) { let s=seed>>>0; return function(){s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}; }
  function move(id, otherHistory, roll) {
    switch(id){case 'tit':return otherHistory.length?otherHistory[otherHistory.length-1]:'C';case 'nice':return 'C';case 'mean':return 'D';case 'grudge':return otherHistory.includes('D')?'D':'C';case 'random':return roll<.5?'C':'D';default:throw new Error('Unknown strategy');}
  }
  function payoff(a,b){return a==='C'?(b==='C'?[3,3]:[0,5]):(b==='C'?[5,0]:[1,1]);}
  function simulate(a,b,seed,rounds=12){
    const rng=random(seed), ah=[],bh=[],record=[];let scoreA=0,scoreB=0;
    for(let i=0;i<rounds;i++){
      // Consume exactly two independent rolls every round, even for deterministic rules.
      // Both decisions see ONLY completed rounds, never the other current move.
      const ma=move(a,bh,rng()),mb=move(b,ah,rng()),points=payoff(ma,mb);
      ah.push(ma);bh.push(mb);scoreA+=points[0];scoreB+=points[1];
      record.push({a:ma,b:mb,points,scoreA,scoreB});
    }return {record,scoreA,scoreB};
  }
  const api={strategies,random,move,payoff,simulate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.TrustEngine=api;
})(globalThis);
