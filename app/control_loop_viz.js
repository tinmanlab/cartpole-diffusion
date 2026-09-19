(function(root){
"use strict";
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function fmt(x,d){return Number(x).toFixed(d===undefined?2:d)}
function deg(x){return x*180/Math.PI}

function pick(history,target){
  if(!history||!history.length)return null;
  var best=history[0],dist=Math.abs(best.t-target);
  for(var i=1;i<history.length;i++){
    var d=Math.abs(history[i].t-target);
    if(d<dist){best=history[i];dist=d}
  }
  return best;
}
function sequencePath(values,x0,y0,width,height,limit){
  if(!values||!values.length)return "";
  var pts=values.map(function(v,i){
    var x=x0+i/(values.length-1)*width;
    var raw=v*10,shown=clamp(raw,-limit,limit);
    var y=y0+height/2-(shown/limit)*(height*.42);
    return [x,y];
  });
  return pts.map(function(p,i){return (i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)}).join(" ");
}
function stageValues(stage,finalPlan){
  if(!stage)return [];
  if(stage.t===0&&finalPlan&&finalPlan.length)return finalPlan;
  return stage.latent;
}
function rowSvg(stage,finalPlan,rowY,title,subtitle,color,kind){
  if(!stage)return "";
  var x0=170,width=720,height=66,limit=10,values=stageValues(stage,finalPlan);
  var path=sequencePath(values,x0,rowY,width,height,limit);
  var executeBand=kind==="final"
    ? '<rect x="'+x0+'" y="'+rowY+'" width="'+(width*3.5/15).toFixed(1)+'" height="'+height+'" rx="8" class="execute-band"/>'
      +'<text x="'+(x0+8)+'" y="'+(rowY+16)+'" class="execute-label">EXECUTE a[0]–a[3]</text>'
    : '';
  var points=values.map(function(v,i){
    if(kind!=="final"||i>3)return "";
    var x=x0+i/(values.length-1)*width,shown=clamp(v*10,-limit,limit),y=rowY+height/2-(shown/limit)*(height*.42);
    return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="4.2" class="execute-point"/>';
  }).join("");
  var unit=kind==="final"?" N":"";
  return '<g class="sequence-row '+kind+'" data-qa="sequence-'+kind+'">'
    +'<text x="8" y="'+(rowY+20)+'" class="sequence-title">'+title+'</text>'
    +'<text x="8" y="'+(rowY+39)+'" class="sequence-sub">'+subtitle+'</text>'
    +'<line x1="'+x0+'" y1="'+(rowY+height/2)+'" x2="'+(x0+width)+'" y2="'+(rowY+height/2)+'" class="sequence-zero"/>'
    +executeBand
    +'<path d="'+path+'" fill="none" stroke="'+color+'" class="sequence-path"/>'
    +points
    +'<text x="'+(x0+width+12)+'" y="'+(rowY+20)+'" class="sequence-scale">+10'+unit+'</text>'
    +'<text x="'+(x0+width+12)+'" y="'+(rowY+height-8)+'" class="sequence-scale">−10'+unit+'</text>'
    +'</g>';
}
function mobileRow(stage,finalPlan,title,subtitle,color,kind){
  if(!stage)return "";
  var values=stageValues(stage,finalPlan),x0=14,width=302,y0=8,height=70,limit=10;
  var path=sequencePath(values,x0,y0,width,height,limit);
  var band=kind==="final"
    ? '<rect x="'+x0+'" y="'+y0+'" width="'+(width*3.5/15).toFixed(1)+'" height="'+height+'" rx="7" class="execute-band"/>'
    : '';
  var points=values.map(function(v,i){
    if(kind!=="final"||i>3)return "";
    var x=x0+i/(values.length-1)*width,shown=clamp(v*10,-limit,limit),y=y0+height/2-(shown/limit)*(height*.42);
    return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="4.5" class="execute-point"/>';
  }).join("");
  return '<article class="mobile-seq-card '+kind+'" data-qa="sequence-'+kind+'">'
    +'<div class="mobile-seq-head"><b>'+title+'</b><span>'+subtitle+'</span></div>'
    +'<svg viewBox="0 0 330 86" role="img" aria-label="'+title+'">'
    +'<line x1="'+x0+'" y1="'+(y0+height/2)+'" x2="'+(x0+width)+'" y2="'+(y0+height/2)+'" class="sequence-zero"/>'
    +band+'<path d="'+path+'" fill="none" stroke="'+color+'" class="mobile-sequence-path"/>'+points
    +'</svg>'
    +'<div class="mobile-seq-axis"><span>a[0] · 먼저</span><span>a[15] · 나중</span></div>'
    +'</article>';
}
function renderMobileStages(start,mid,final,finalPlan){
  return '<div class="mobile-sequence" data-qa="mobile-sequence">'
    +mobileRow(start,finalPlan,'A · 랜덤 후보','내부 후보 · 아직 실행 안 함','#8968ca','noise')
    +'<div class="mobile-seq-arrow">↓ 관측에 맞게 수정</div>'
    +mobileRow(mid,finalPlan,'B · 정리 중','반복해서 action pattern을 만듦','#5476df','mid')
    +'<div class="mobile-seq-arrow">↓ 최종 계획으로 수렴</div>'
    +mobileRow(final,finalPlan,'C · 최종 force plan','초록 영역 a[0]–a[3]만 먼저 실행','#3c9a73','final')
    +'</div>';
}
function renderStages(rootEl,history,finalPlan){
  var start=pick(history,95),mid=pick(history,45),final=pick(history,0);
  rootEl.innerHTML=
    '<div class="sequence-guide" data-qa="sequence-guide"><b>같은 16개 미래 action 자리</b><span>A/B는 내부 후보값, C만 실제 force(N)입니다. 왼쪽이 먼저 실행될 action입니다.</span></div>'
    +'<svg class="sequence-svg" data-qa="denoise-sequence" viewBox="0 0 980 282" role="img" aria-label="random future-force candidates becoming the final force plan">'
    +rowSvg(start,finalPlan,12,'A · 랜덤 후보','내부 action 후보 · 아직 실행 안 함 · t='+(start?start.t:'—'),'#8968ca','noise')
    +'<text x="530" y="94" class="sequence-down">↓ 관측값을 조건으로 반복 수정</text>'
    +rowSvg(mid,finalPlan,106,'B · 정리 중','관측 상태에 맞게 반복 수정 · t≈'+(mid?mid.t:'—'),'#5476df','mid')
    +'<text x="530" y="188" class="sequence-down">↓ 실행 가능한 action pattern으로 수렴</text>'
    +rowSvg(final,finalPlan,200,'C · 최종 force plan','이제 실행 가능 · t=0','#3c9a73','final')
    +'</svg>'
    +renderMobileStages(start,mid,final,finalPlan)
    +'<div class="sequence-plain"><b>핵심:</b> Diffusion은 16개 force를 한 번에 결정하지 않습니다. 랜덤한 미래 action 후보를 현재 관측에 맞게 여러 번 고친 뒤, 마지막 C만 실제 force plan으로 사용합니다.</div>';
}
function normalizedPath(values,x0,y0,width,height,limit){
  if(!values||!values.length)return "";
  return values.map(function(v,i){
    var x=x0+i/(values.length-1)*width,shown=clamp(v,-limit,limit);
    var y=y0+height/2-(shown/limit)*(height*.42);
    return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);
  }).join(" ");
}
function denoiseTrajectoryPath(history,actionIndex,x0,y0,width,height,limit){
  if(!history||history.length<2)return "";
  return history.map(function(stage,i){
    var x=x0+i/(history.length-1)*width,v=stage.latent[actionIndex],shown=clamp(v,-limit,limit);
    var y=y0+height/2-(shown/limit)*(height*.42);
    return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);
  }).join(" ");
}
function renderDenoiseTimeline(rootEl,history,stepIndex,actionIndex,onSelect){
  if(!rootEl)return;
  if(!history||history.length<2){rootEl.hidden=true;rootEl.innerHTML="";return}
  var transitions=history.length-1;
  stepIndex=clamp(Math.round(stepIndex||0),0,transitions-1);
  actionIndex=clamp(Math.round(actionIndex||0),0,history[0].latent.length-1);
  var current=history[stepIndex],next=history[stepIndex+1];
  var values=history.map(function(s){return s.latent[actionIndex]});
  var limit=Math.max(1,Math.max.apply(null,values.map(function(v){return Math.abs(v)}))*1.08);
  var x0=28,y0=10,width=744,height=116;
  var path=denoiseTrajectoryPath(history,actionIndex,x0,y0,width,height,limit);
  var points=history.map(function(stage,i){
    var x=x0+i/(history.length-1)*width,v=clamp(stage.latent[actionIndex],-limit,limit);
    var y=y0+height/2-(v/limit)*(height*.42),cls=i===0?" start":i===history.length-1?" final":"";
    if(i===stepIndex||i===stepIndex+1)cls+=" selected";
    return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+((i===stepIndex||i===stepIndex+1)?5:2.8)+'" class="timeline-point'+cls+'"/>';
  }).join("");
  var xA=x0+stepIndex/(history.length-1)*width,xB=x0+(stepIndex+1)/(history.length-1)*width;
  var yA=y0+height/2-(clamp(current.latent[actionIndex],-limit,limit)/limit)*(height*.42);
  var yB=y0+height/2-(clamp(next.latent[actionIndex],-limit,limit)/limit)*(height*.42);
  var actionOptions=history[0].latent.map(function(_,i){return '<option value="'+i+'"'+(i===actionIndex?' selected':'')+'>a['+i+']</option>'}).join("");
  rootEl.hidden=false;
  rootEl.dataset.stepIndex=String(stepIndex);rootEl.dataset.actionIndex=String(actionIndex);
  rootEl.dataset.currentT=String(current.t);rootEl.dataset.nextT=String(next.t);rootEl.dataset.transitions=String(transitions);
  rootEl.innerHTML=
    '<div class="timeline-head"><div><b>19번 denoise 전체 경로</b><span>20개 후보 상태 · 현재 update를 scrubber로 선택</span></div>'
    +'<div class="timeline-status"><strong>step '+(stepIndex+1)+'/'+transitions+'</strong><span>t='+current.t+' → '+next.t+'</span></div></div>'
    +'<div class="timeline-controls"><button type="button" data-denoise-nav="prev" aria-label="previous denoise update"'+(stepIndex===0?' disabled':'')+'>← 이전</button>'
    +'<input type="range" min="0" max="'+(transitions-1)+'" step="1" value="'+stepIndex+'" data-denoise-scrubber aria-label="denoise update scrubber">'
    +'<button type="button" data-denoise-nav="next" aria-label="next denoise update"'+(stepIndex===transitions-1?' disabled':'')+'>다음 →</button>'
    +'<label>추적 <select data-denoise-action aria-label="tracked action index">'+actionOptions+'</select></label></div>'
    +'<div class="timeline-scale"><span>t=95 · random</span><span>t≈50</span><span>t=0 · action plan</span></div>'
    +'<svg class="timeline-svg" viewBox="0 0 800 144" role="img" aria-label="selected action value across all denoising steps">'
    +'<line x1="'+x0+'" y1="'+(y0+height/2)+'" x2="'+(x0+width)+'" y2="'+(y0+height/2)+'" class="timeline-zero"/>'
    +'<path d="'+path+'" class="timeline-path" fill="none"/>'
    +'<line x1="'+xA.toFixed(1)+'" y1="'+yA.toFixed(1)+'" x2="'+xB.toFixed(1)+'" y2="'+yB.toFixed(1)+'" class="timeline-selected-segment"/>'
    +points
    +'<text x="'+x0+'" y="141" class="timeline-axis">95</text><text x="'+(x0+width)+'" y="141" text-anchor="end" class="timeline-axis">0</text>'
    +'</svg>'
    +'<div class="timeline-caption"><b>a['+actionIndex+']</b> 내부 candidate 값: <span>'+fmt(current.latent[actionIndex],3)+'</span> → <span>'+fmt(next.latent[actionIndex],3)+'</span><small> · t=0 전까지는 물리 force(N)가 아니라 내부 action-space 값</small></div>';
  var slider=rootEl.querySelector('[data-denoise-scrubber]');
  var select=rootEl.querySelector('[data-denoise-action]');
  var prev=rootEl.querySelector('[data-denoise-nav="prev"]'),nxt=rootEl.querySelector('[data-denoise-nav="next"]');
  if(slider)slider.addEventListener("input",function(){if(onSelect)onSelect(Number(this.value),actionIndex)});
  if(select)select.addEventListener("change",function(){if(onSelect)onSelect(stepIndex,Number(this.value))});
  if(prev)prev.addEventListener("click",function(){if(onSelect)onSelect(Math.max(0,stepIndex-1),actionIndex)});
  if(nxt)nxt.addEventListener("click",function(){if(onSelect)onSelect(Math.min(transitions-1,stepIndex+1),actionIndex)});
}
function renderDenoiseUpdate(rootEl,history,targetT){
  if(!rootEl)return;
  if(targetT===null||targetT===undefined||!history||!history.length){rootEl.hidden=true;rootEl.innerHTML="";return}
  var stage=pick(history,targetT);
  if(!stage||!stage.pred||!stage.next){rootEl.hidden=true;rootEl.innerHTML="";return}
  var idx=history.indexOf(stage),nextT=(idx>=0&&history[idx+1])?history[idx+1].t:Math.max(0,stage.t-5);
  var actionIndex=0,before=stage.latent[actionIndex],noise=stage.pred[actionIndex],after=stage.next[actionIndex];
  var x0=24,y0=8,width=652,height=104,limit=1.6;
  var beforePath=normalizedPath(stage.latent,x0,y0,width,height,limit);
  var afterPath=normalizedPath(stage.next,x0,y0,width,height,limit);
  rootEl.hidden=false;
  rootEl.dataset.currentT=String(stage.t);rootEl.dataset.nextT=String(nextT);
  rootEl.dataset.before0=String(before);rootEl.dataset.noise0=String(noise);rootEl.dataset.after0=String(after);
  rootEl.innerHTML=
    '<div class="denoise-update-head"><div><b>한 번의 denoise update</b><span>실제 plan의 t='+stage.t+' → t='+nextT+'</span></div><em>이 구조를 반복</em></div>'
    +'<div class="denoise-update-flow">'
    +'<div class="update-card before"><span>① 현재 후보</span><b>a'+stage.t+'[0]</b><strong>'+fmt(before,3)+'</strong><small>내부 action 값</small></div>'
    +'<i>→</i>'
    +'<div class="update-card predict"><span>② denoiser 예측</span><b>εθ[0]</b><strong>'+fmt(noise,3)+'</strong><small>noise 예측 · force 아님</small></div>'
    +'<i>→</i>'
    +'<div class="update-card sampler"><span>③ sampler</span><b>DDIM update</b><strong>schedule 사용</strong><small>εθ를 그대로 빼는 것이 아님</small></div>'
    +'<i>→</i>'
    +'<div class="update-card after"><span>④ 다음 후보</span><b>a'+nextT+'[0]</b><strong>'+fmt(after,3)+'</strong><small>다음 denoise 입력</small></div>'
    +'</div>'
    +'<div class="denoise-update-chart"><div class="update-chart-title"><b>16개 전체도 같은 방식으로 조금씩 이동</b><span><i class="before-key"></i>t='+stage.t+' <i class="after-key"></i>t='+nextT+'</span></div>'
    +'<svg viewBox="0 0 700 124" role="img" aria-label="one denoising update across sixteen internal action candidates">'
    +'<line x1="'+x0+'" y1="'+(y0+height/2)+'" x2="'+(x0+width)+'" y2="'+(y0+height/2)+'" class="update-zero"/>'
    +'<path d="'+beforePath+'" class="update-before" fill="none"/>'
    +'<path d="'+afterPath+'" class="update-after" fill="none"/>'
    +'<circle cx="'+x0+'" cy="'+(y0+height/2-(clamp(before,-limit,limit)/limit)*(height*.42)).toFixed(1)+'" r="5" class="update-before-dot"/>'
    +'<circle cx="'+x0+'" cy="'+(y0+height/2-(clamp(after,-limit,limit)/limit)*(height*.42)).toFixed(1)+'" r="5" class="update-after-dot"/>'
    +'<text x="'+x0+'" y="121" class="update-axis">a[0]</text><text x="'+(x0+width)+'" y="121" text-anchor="end" class="update-axis">a[15]</text>'
    +'</svg></div>'
    +'<p class="denoise-update-note"><b>중요:</b> denoiser의 출력 εθ는 cart에 보내는 force가 아닙니다. sampler가 이 noise 예측과 diffusion schedule을 이용해 다음 action 후보를 계산합니다.</p>';
}
function renderObservation(rootEl,obs,planCount){
  if(!obs){rootEl.innerHTML='';return}
  rootEl.innerHTML=
    '<div class="obs-title" data-qa="observation-title"><b>현재 plan #'+planCount+'</b><span>이 4개 상태값으로 현재 plan을 생성했습니다.</span></div>'
    +'<div class="obs-values" data-qa="observation-values">'
    +'<div><span>x</span><b>'+fmt(obs[0],2)+' m</b><small>cart position</small></div>'
    +'<div><span>ẋ</span><b>'+fmt(obs[1],2)+' m/s</b><small>cart velocity</small></div>'
    +'<div><span>θ</span><b>'+fmt(deg(obs[2]),1)+'°</b><small>pole angle</small></div>'
    +'<div><span>θ̇</span><b>'+fmt(deg(obs[3]),0)+'°/s</b><small>pole angular velocity</small></div>'
    +'</div>';
}
function renderExecution(rootEl,plan,cursor,policyForce,guide){
  if(!plan||!plan.length){rootEl.innerHTML='<div class="exec-empty">plan을 기다리는 중…</div>';return}
  var applied=cursor>0;
  if(guide&&guide.enabled)applied=!!guide.applied;
  var active=applied?Math.max(0,Math.min(3,cursor-1)):-1;
  var cards='';
  for(var i=0;i<4;i++){
    var state=i<active?'done':i===active?'active':'future';
    cards+='<div class="exec-action '+state+'" data-qa="exec-action"><span>a['+i+']</span><b>'+(plan[i]>=0?'+':'')+fmt(plan[i]*10,2)+' N</b><small>'+(state==='active'?'현재 적용':state==='done'?'완료':'실행 예정')+'</small></div>';
  }
  var nowText=applied
    ? '<strong>'+(policyForce>=0?'+':'')+fmt(policyForce,2)+' N</strong>'
    : '<strong class="not-applied">아직 적용 안 함</strong>';
  rootEl.innerHTML='<div class="exec-now" data-qa="current-force"><span>현재 cart에 적용되는 force</span>'+nowText+'</div>'
    +'<div class="exec-prefix" data-qa="exec-prefix">'+cards+'</div>'
    +'<div class="exec-rest">a[4] … a[15]는 아직 미래 계획입니다. a[3] 실행 후 다시 관측하고 새 plan을 생성합니다.</div>';
}
function renderStateDelta(rootEl,before,after){
  if(!rootEl)return;
  if(!before||!after){rootEl.hidden=true;rootEl.innerHTML="";return}
  var specs=[
    ["x",before[0],after[0],"m",2],
    ["ẋ",before[1],after[1],"m/s",2],
    ["θ",deg(before[2]),deg(after[2]),"°",1],
    ["θ̇",deg(before[3]),deg(after[3]),"°/s",0]
  ];
  rootEl.hidden=false;
  rootEl.innerHTML='<div class="reobserve-title"><b>실행 전 → 실행 후</b><span>이 오른쪽 값들이 다음 plan의 새 observation이 됩니다.</span></div>'
    +'<div class="reobserve-values">'
    +specs.map(function(s){
      var delta=s[2]-s[1],sign=delta>=0?"+":"";
      return '<div class="reobserve-cell"><span>'+s[0]+'</span><div><b>'+fmt(s[1],s[4])+'</b><i>→</i><b>'+fmt(s[2],s[4])+'</b><small>'+s[3]+'</small></div><em>Δ '+sign+fmt(delta,s[4])+' '+s[3]+'</em></div>';
    }).join("")
    +'</div>';
}
root.ControlLoopViz={renderStages:renderStages,renderDenoiseTimeline:renderDenoiseTimeline,renderDenoiseUpdate:renderDenoiseUpdate,renderObservation:renderObservation,renderExecution:renderExecution,renderStateDelta:renderStateDelta};
})(typeof window!=="undefined"?window:globalThis);
