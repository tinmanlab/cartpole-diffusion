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
    +'</svg>'
    +'<div class="chart-axis"><span>95</span><span>0</span></div>'
    +'<div class="timeline-caption"><b>a['+actionIndex+']</b> 내부 candidate 값: <span>'+fmt(current.latent[actionIndex],3)+'</span> → <span>'+fmt(next.latent[actionIndex],3)+'</span><small> · t=0 전까지는 물리 force(N)가 아니라 내부 action-space 값</small></div>';
  var slider=rootEl.querySelector('[data-denoise-scrubber]');
  var select=rootEl.querySelector('[data-denoise-action]');
  var prev=rootEl.querySelector('[data-denoise-nav="prev"]'),nxt=rootEl.querySelector('[data-denoise-nav="next"]');
  if(slider)slider.addEventListener("input",function(){if(onSelect)onSelect(Number(this.value),actionIndex)});
  if(select)select.addEventListener("change",function(){if(onSelect)onSelect(stepIndex,Number(this.value))});
  if(prev)prev.addEventListener("click",function(){if(onSelect)onSelect(Math.max(0,stepIndex-1),actionIndex)});
  if(nxt)nxt.addEventListener("click",function(){if(onSelect)onSelect(Math.min(transitions-1,stepIndex+1),actionIndex)});
}
function renderDenoiseUpdate(rootEl,history,targetT,actionIndex){
  if(!rootEl)return;
  if(targetT===null||targetT===undefined||!history||!history.length){rootEl.hidden=true;rootEl.innerHTML="";return}
  var stage=pick(history,targetT);
  if(!stage||!stage.pred||!stage.next){rootEl.hidden=true;rootEl.innerHTML="";return}
  var idx=history.indexOf(stage),nextT=(idx>=0&&history[idx+1])?history[idx+1].t:Math.max(0,stage.t-5);
  actionIndex=clamp(Math.round(actionIndex||0),0,stage.latent.length-1);
  var before=stage.latent[actionIndex],noise=stage.pred[actionIndex],after=stage.next[actionIndex];
  var x0Raw=stage.x0Raw[actionIndex],x0Clip=stage.x0[actionIndex],coef=stage.coef,clipped=x0Raw!==x0Clip;
  var x0=24,y0=8,width=652,height=104,limit=1.6;
  var beforePath=normalizedPath(stage.latent,x0,y0,width,height,limit);
  var afterPath=normalizedPath(stage.next,x0,y0,width,height,limit);
  rootEl.hidden=false;
  rootEl.dataset.currentT=String(stage.t);rootEl.dataset.nextT=String(nextT);rootEl.dataset.actionIndex=String(actionIndex);
  rootEl.dataset.beforeValue=String(before);rootEl.dataset.noiseValue=String(noise);rootEl.dataset.afterValue=String(after);
  rootEl.dataset.coefAc=String(coef.ac);rootEl.dataset.coefAp=String(coef.ap);rootEl.dataset.coefSc=String(coef.sc);
  rootEl.dataset.coefNc=String(coef.nc);rootEl.dataset.coefSp=String(coef.sp);rootEl.dataset.coefNp=String(coef.np);
  rootEl.dataset.x0Raw=String(x0Raw);rootEl.dataset.x0Clip=String(x0Clip);rootEl.dataset.clipped=String(clipped);
  if(actionIndex===0){rootEl.dataset.before0=String(before);rootEl.dataset.noise0=String(noise);rootEl.dataset.after0=String(after)}else{delete rootEl.dataset.before0;delete rootEl.dataset.noise0;delete rootEl.dataset.after0}
  rootEl.innerHTML=
    '<div class="denoise-update-head"><div><b>한 번의 denoise update</b><span>실제 plan의 t='+stage.t+' → t='+nextT+'</span></div><em>이 구조를 반복</em></div>'
    +'<div class="denoise-update-flow">'
    +'<div class="update-card before"><span>① 현재 후보</span><b>a'+stage.t+'['+actionIndex+']</b><strong>'+fmt(before,3)+'</strong><small>내부 action 값</small></div>'
    +'<i>→</i>'
    +'<div class="update-card predict"><span>② denoiser 예측</span><b>εθ['+actionIndex+']</b><strong>'+fmt(noise,3)+'</strong><small>noise 예측 · force 아님</small></div>'
    +'<i>→</i>'
    +'<div class="update-card sampler"><span>③ sampler</span><b>DDIM update</b><strong>schedule 사용</strong><small>εθ를 그대로 빼는 것이 아님</small></div>'
    +'<i>→</i>'
    +'<div class="update-card after"><span>④ 다음 후보</span><b>a'+nextT+'['+actionIndex+']</b><strong>'+fmt(after,3)+'</strong><small>다음 denoise 입력</small></div>'
    +'</div>'
    +'<div class="denoise-update-chart"><div class="update-chart-title"><b>16개 전체도 같은 방식으로 조금씩 이동</b><span><i class="before-key"></i>t='+stage.t+' <i class="after-key"></i>t='+nextT+'</span></div>'
    +'<svg viewBox="0 0 700 124" role="img" aria-label="one denoising update across sixteen internal action candidates">'
    +'<line x1="'+x0+'" y1="'+(y0+height/2)+'" x2="'+(x0+width)+'" y2="'+(y0+height/2)+'" class="update-zero"/>'
    +'<path d="'+beforePath+'" class="update-before" fill="none"/>'
    +'<path d="'+afterPath+'" class="update-after" fill="none"/>'
    +'<circle cx="'+(x0+actionIndex/(stage.latent.length-1)*width).toFixed(1)+'" cy="'+(y0+height/2-(clamp(before,-limit,limit)/limit)*(height*.42)).toFixed(1)+'" r="5" class="update-before-dot"/>'
    +'<circle cx="'+(x0+actionIndex/(stage.latent.length-1)*width).toFixed(1)+'" cy="'+(y0+height/2-(clamp(after,-limit,limit)/limit)*(height*.42)).toFixed(1)+'" r="5" class="update-after-dot"/>'
    +'</svg>'
    +'<div class="chart-axis"><span>a[0]</span><span>a[15]</span></div></div>'
    +'<div class="denoise-sampler-math">'
    +'<div class="sampler-eq"><b>③-1 clean estimate x̂₀</b><code>('+fmt(before,3)+' − '+fmt(coef.nc,4)+'×'+fmt(noise,3)+') / '+fmt(coef.sc,4)+' = '+fmt(x0Raw,3)+'</code><small>±1.2로 clip → '+fmt(x0Clip,3)+(clipped?' (clipped)':' (clip 없음)')+'</small></div>'
    +'<div class="sampler-eq"><b>③-2 next candidate</b><code>'+fmt(coef.sp,4)+'×'+fmt(x0Clip,3)+' + '+fmt(coef.np,4)+'×'+fmt(noise,3)+' = '+fmt(after,3)+'</code></div>'
    +'<p class="sampler-note">이 중간 ±1.2 clip은 최종 plan의 ±1 clip·×10N 변환과 다른 값입니다 · this intermediate ±1.2 clip is separate from the final plan\'s ±1 clip and its ×10N conversion. x̂₀는 실제 정답이 아니라 추정값이고, ε와 candidate는 아직 Newton이 아닙니다 · x̂₀ is an estimate, not ground truth, and ε/intermediate candidates are not Newtons yet.</p>'
    +'<details class="sampler-details"><summary>schedule 계수 전체 보기 · full schedule coefficients</summary><code>α_cur='+fmt(coef.ac,5)+' · α_prev='+fmt(coef.ap,5)+' · √α_cur='+fmt(coef.sc,4)+' · √(1−α_cur)='+fmt(coef.nc,4)+' · √α_prev='+fmt(coef.sp,4)+' · √(1−α_prev)='+fmt(coef.np,4)+'</code></details>'
    +'</div>'
    +'<p class="denoise-update-note"><b>중요:</b> denoiser의 출력 εθ는 cart에 보내는 force가 아닙니다. sampler가 이 noise 예측과 diffusion schedule을 이용해 다음 action 후보를 계산합니다.</p>';
}
function conditioningPlanPath(values,x0,y0,width,height,limit){
  if(!values||!values.length)return "";
  return values.map(function(v,i){
    var x=x0+i/(values.length-1)*width,shown=clamp(v*10,-limit,limit);
    var y=y0+height/2-(shown/limit)*(height*.42);
    return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);
  }).join(" ");
}
// Marker geometry stays inside the SVG (real x-position); the "a[N]" text is HTML,
// not an in-viewBox <text>, so it never shrinks below readability at narrow widths.
function conditioningMarkerX(actionIndex,length,x0,width){return x0+actionIndex/(length-1)*width}
// Anchor edges to their own side (own left/right edge at 0%/100%) instead of centering, so the
// a[0]/a[15] label text can never clip past the plotting container. The dashed line + dots stay
// pinned at the exact x — this only nudges where the callout *text* sits, presentation only.
function conditioningMarkerTagStyle(actionIndex,length,pct){
  if(actionIndex<=0)return 'left:0;transform:none';
  if(actionIndex>=length-1)return 'left:auto;right:0;transform:none';
  return 'left:'+pct.toFixed(2)+'%;transform:translateX(-50%)';
}
function conditioningActionMarker(plus,minus,actionIndex,x0,y0,width,height,limit){
  var mx=conditioningMarkerX(actionIndex,plus.length,x0,width);
  var yFor=function(v){return y0+height/2-(clamp(v*10,-limit,limit)/limit)*(height*.42)};
  var yPlus=yFor(plus[actionIndex]),yMinus=yFor(minus[actionIndex]);
  return '<line x1="'+mx.toFixed(1)+'" y1="'+y0+'" x2="'+mx.toFixed(1)+'" y2="'+(y0+height)+'" class="conditioning-marker-line"/>'
    +'<circle cx="'+mx.toFixed(1)+'" cy="'+yPlus.toFixed(1)+'" r="5.5" class="conditioning-marker-dot plus"/>'
    +'<circle cx="'+mx.toFixed(1)+'" cy="'+yMinus.toFixed(1)+'" r="5.5" class="conditioning-marker-dot minus"/>';
}
function conditioningHistoryPath(history,actionIndex,x0,y0,width,height,limit){
  if(!history||!history.length)return "";
  return history.map(function(stage,i){
    var x=x0+i/(history.length-1)*width,v=stage.latent[actionIndex],shown=clamp(v,-limit,limit);
    var y=y0+height/2-(shown/limit)*(height*.42);
    return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);
  }).join(" ");
}
function renderConditioningCompare(rootEl,data){
  if(!rootEl)return;
  if(!data){rootEl.hidden=true;rootEl.innerHTML="";return}
  // Final commands are always clamp(v,-1,1)*10 N (see planHistoryFromFixedLatent), so the
  // physical ±MAXF(=10N) axis already covers every possible value here. A stable shared axis
  // — not a per-delta autoscale — is what lets different input sensitivities compare honestly.
  var plus=data.plusPlan,minus=data.minusPlan,x0=34,y0=10,width=692,height=118,limit=10;
  var observedMax=Math.max.apply(null,plus.concat(minus).map(function(v){return Math.abs(v)*10}));
  var rescaled=observedMax>limit;
  if(rescaled)limit=observedMax*1.1;
  var plusPath=conditioningPlanPath(plus,x0,y0,width,height,limit),minusPath=conditioningPlanPath(minus,x0,y0,width,height,limit);
  var diff=0,maxDiff=0;
  for(var i=0;i<plus.length;i++){var d=Math.abs((plus[i]-minus[i])*10);diff+=d;maxDiff=Math.max(maxDiff,d)}
  var meanDiff=diff/plus.length;
  var custom=data.experiment===true,actionIndex=custom?data.actionIndex:0,ph=data.plusHistory||[],mh=data.minusHistory||[];
  var values=[];
  for(var h=0;h<ph.length;h++){values.push(Math.abs(ph[h].latent[actionIndex]));values.push(Math.abs(mh[h].latent[actionIndex]))}
  var histLimit=Math.max(1,Math.max.apply(null,values)*1.08),hx0=34,hy0=10,hwidth=692,hheight=112;
  var plusHist=conditioningHistoryPath(ph,actionIndex,hx0,hy0,hwidth,hheight,histLimit);
  var minusHist=conditioningHistoryPath(mh,actionIndex,hx0,hy0,hwidth,hheight,histLimit);
  var initialDelta=ph.length&&mh.length?Math.abs(ph[0].latent[actionIndex]-mh[0].latent[actionIndex]):NaN;
  var firstDelta=ph.length>1&&mh.length>1?Math.abs(ph[1].latent[actionIndex]-mh[1].latent[actionIndex]):NaN;
  var midIndex=ph.findIndex(function(s){return s.t===50});if(midIndex<0)midIndex=Math.floor(ph.length/2);
  var midDelta=ph.length&&mh.length?Math.abs(ph[midIndex].latent[actionIndex]-mh[midIndex].latent[actionIndex]):NaN;
  var finalDelta=Math.abs(plus[actionIndex]-minus[actionIndex]);
  var firstAfterT=ph.length>1?ph[1].t:null;
  var labelA=custom?"A · 기준 관측":"θ=+5°",labelB=custom?"B · 입력 하나 변경":"θ=−5°";
  var obsText=function(o){return "x "+fmt(o[0],3)+" m · ẋ "+fmt(o[1],3)+" m/s · θ "+fmt(deg(o[2]),3)+"° · θ̇ "+fmt(o[3],3)+" rad/s"};
  var differenceText=custom?data.fieldName+"만 "+(data.delta>=0?"+":"")+fmt(data.delta,2)+" "+data.unit:"θ만 +5° ↔ −5°";
  rootEl.hidden=false;
  rootEl.dataset.experiment=custom?"true":"false";rootEl.dataset.actionIndex=String(actionIndex);rootEl.dataset.forceScaleN=String(limit);rootEl.dataset.rescaled=rescaled?"true":"false";
  rootEl.dataset.sameNoise=data.sameNoise?"true":"false";if(custom)delete rootEl.dataset.seed;else rootEl.dataset.seed=String(data.seed);
  rootEl.dataset.plusTheta=String(data.plusObs[2]);
  rootEl.dataset.minusTheta=String(data.minusObs[2]);
  rootEl.dataset.meanAbsDiffN=String(meanDiff);
  rootEl.dataset.maxAbsDiffN=String(maxDiff);
  rootEl.dataset.plusFirstN=String(plus[0]*10);
  rootEl.dataset.minusFirstN=String(minus[0]*10);
  rootEl.dataset.historyStates=String(ph.length);
  rootEl.dataset.initialDelta=String(initialDelta);
  rootEl.dataset.firstUpdateDelta=String(firstDelta);
  rootEl.dataset.midDelta=String(midDelta);
  rootEl.dataset.finalDelta=String(finalDelta);
  rootEl.dataset.firstAfterT=String(firstAfterT);
  rootEl.innerHTML=
    '<div class="conditioning-head"><div><b>같은 noise, observation만 바꿔보기</b><span>통제 실험: model · initial Gaussian latent · sampler는 동일</span></div><em>'+differenceText+'</em></div>'
    +'<div class="conditioning-observations">'
    +'<div class="cond-obs plus"><span>Observation A</span><b>'+(custom?obsText(data.plusObs):"[0, 0, +5°, 0]")+'</b><small>x, ẋ, θ, θ̇</small></div>'
    +'<div class="cond-arrow">같은 noise →</div>'
    +'<div class="cond-obs minus"><span>Observation B</span><b>'+(custom?obsText(data.minusObs):"[0, 0, −5°, 0]")+'</b><small>'+(custom?differenceText:"오직 θ만 변경")+'</small></div>'
    +'</div>'
    +'<div class="conditioning-divergence">'
    +'<div class="divergence-head"><div><b>같은 a['+actionIndex+'] 후보가 어떻게 달라지나?</b><span>t=95에서는 같은 initial latent · 세로축은 정규화된 내부 후보값, N이 아닙니다</span></div>'
    +'<strong>Δ '+fmt(initialDelta,3)+' → '+fmt(firstDelta,3)+' → '+fmt(finalDelta,3)+'</strong></div>'
    +'<div class="divergence-legend"><span><i class="plus-key"></i>'+labelA+'</span><span><i class="minus-key"></i>'+labelB+'</span></div>'
    +'<svg viewBox="0 0 760 142" preserveAspectRatio="'+(custom?"none":"xMidYMid meet")+'" role="img" aria-label="same initial action candidate diverging across denoising under two observations">'
    +'<line x1="'+hx0+'" y1="'+(hy0+hheight/2)+'" x2="'+(hx0+hwidth)+'" y2="'+(hy0+hheight/2)+'" class="conditioning-zero"/>'
    +'<path d="'+plusHist+'" class="conditioning-plus-history" fill="none"/>'
    +'<path d="'+minusHist+'" class="conditioning-minus-history" fill="none"/>'
    +'<circle cx="'+hx0+'" cy="'+(hy0+hheight/2-(clamp(ph[0].latent[actionIndex],-histLimit,histLimit)/histLimit)*(hheight*.42)).toFixed(1)+'" r="5" class="conditioning-same-start"/>'
    +'</svg>'
    +'<div class="chart-axis"><span>t=95 · same</span><span>'+(custom?"공통 ±"+fmt(histLimit,2):"t≈50")+'</span><span>t=0</span></div>'
    +'<div class="divergence-metrics"><div><span>t=95 시작 차이</span><b>'+fmt(initialDelta,3)+'</b></div><div><span>첫 update 후 t='+firstAfterT+'</span><b>'+fmt(firstDelta,3)+'</b></div><div><span>t≈50 차이</span><b>'+fmt(midDelta,3)+'</b></div><div><span>t=0 차이</span><b>'+fmt(finalDelta,3)+'</b></div></div>'
    +'</div>'
    +'<div class="conditioning-chart"><div class="conditioning-legend"><span><i class="plus-key"></i>'+labelA+' final plan</span><span><i class="minus-key"></i>'+labelB+' final plan</span></div>'
    +'<div class="conditioning-chart-wrap">'
    +'<svg viewBox="0 0 760 146" preserveAspectRatio="'+(custom?"none":"xMidYMid meet")+'" role="img" aria-label="same-noise final action plans under two observations, selected action marked">'
    +'<line x1="'+x0+'" y1="'+(y0+height/2)+'" x2="'+(x0+width)+'" y2="'+(y0+height/2)+'" class="conditioning-zero"/>'
    +'<path d="'+plusPath+'" class="conditioning-plus" fill="none"/>'
    +'<path d="'+minusPath+'" class="conditioning-minus" fill="none"/>'
    +(custom?conditioningActionMarker(plus,minus,actionIndex,x0,y0,width,height,limit):'')
    +'</svg>'
    +(custom?'<span class="conditioning-marker-tag" style="'+conditioningMarkerTagStyle(actionIndex,plus.length,conditioningMarkerX(actionIndex,plus.length,x0,width)/7.6)+'">a['+actionIndex+']</span>':'')
    +'</div>'
    +'<div class="chart-axis'+(custom?' chart-axis-force':'')+'"><span>a[0]</span>'+(custom?"<span>"+(rescaled?"⚠ 확장된 ":"고정 ")+"±"+fmt(limit,2)+" N (최종 force 축)</span>":"")+'<span>a[15]</span></div></div>'
    +'<div class="conditioning-summary"><div><span>'+(custom?'a['+actionIndex+'] force A':'첫 force A')+'</span><b>'+(plus[actionIndex]>=0?"+":"")+fmt(plus[actionIndex]*10,2)+' N</b></div>'
    +'<div><span>'+(custom?'a['+actionIndex+'] force B':'첫 force B')+'</span><b>'+(minus[actionIndex]>=0?"+":"")+fmt(minus[actionIndex]*10,2)+' N</b></div>'
    +(custom?'<div><span>a['+actionIndex+'] 변화 B − A</span><b>'+fmt((minus[actionIndex]-plus[actionIndex])*10,3)+' N</b></div>':'')
    +'<div><span>16개 평균 절대 차이</span><b>'+fmt(meanDiff,2)+' N</b></div></div>'
    +(custom?'<div class="conditioning-estimates"><div><span>첫 denoiser 출력 εθ['+actionIndex+'] · noise estimate, N 아님</span><b>A '+fmt(data.firstPredA[actionIndex],6)+' / B '+fmt(data.firstPredB[actionIndex],6)+'</b></div><div><span>첫 sampler update 후 후보 a['+actionIndex+'] · t=90, N 아님</span><b>A '+fmt(ph[1].latent[actionIndex],6)+' / B '+fmt(mh[1].latent[actionIndex],6)+'</b></div></div>':'')
    +'<p class="conditioning-note"><b>의미:</b> '+(custom?(data.delta===0?'변경량 0: 같은 관측과 같은 시작 잡음이므로 두 계획이 같습니다.':'한 입력만 바꿔 같은 모델을 재계산했습니다. 차이가 작거나 0일 수도 있으며 이 결과만으로 제어 강인성은 판단할 수 없습니다.')+' B는 물리에 적용하지 않는 비교용 계획입니다.':'t=95의 시작 candidate는 완전히 같습니다. 이 고정된 ±5° 예시에서는 observation condition 차이가 첫 reverse update부터 경로 차이로 나타납니다. 임의의 입력 변경에서 항상 차이가 난다는 뜻은 아닙니다.')+'</p>';
}
function renderSamplingCompare(rootEl,data){
  if(!rootEl)return;
  if(!data){rootEl.hidden=true;rootEl.innerHTML="";return}
  var runs=data.runs||[],x0=34,y0=10,width=692,height=118,limit=10;
  var colors=["#5476df","#8968ca","#3c9a73"],paths=[],firstForces=[],initialA0=[];
  for(var r=0;r<runs.length;r++){
    paths.push(conditioningPlanPath(runs[r].plan,x0,y0,width,height,limit));
    firstForces.push(runs[r].plan[0]*10);
    initialA0.push(runs[r].history[0].latent[0]);
  }
  var pairSum=0,pairCount=0,maxPair=0;
  for(var i=0;i<runs.length;i++)for(var j=i+1;j<runs.length;j++){
    for(var k=0;k<runs[i].plan.length;k++){
      var d=Math.abs((runs[i].plan[k]-runs[j].plan[k])*10);
      pairSum+=d;pairCount++;maxPair=Math.max(maxPair,d);
    }
  }
  var meanPair=pairCount?pairSum/pairCount:0;
  var initialSpread=Math.max.apply(null,initialA0)-Math.min.apply(null,initialA0);
  rootEl.hidden=false;
  rootEl.dataset.sameObservation="true";
  rootEl.dataset.observationTheta=String(data.obs[2]);
  rootEl.dataset.seedCount=String(data.seeds.length);
  rootEl.dataset.seeds=data.seeds.join(",");
  rootEl.dataset.initialSpread=String(initialSpread);
  rootEl.dataset.meanPairDiffN=String(meanPair);
  rootEl.dataset.maxPairDiffN=String(maxPair);
  rootEl.innerHTML=
    '<div class="sampling-head"><div><b>같은 observation, noise seed만 바꿔보기</b><span>통제 실험: model · observation · DDIM schedule은 동일</span></div><em>sampling diversity</em></div>'
    +'<div class="sampling-condition"><span>고정 observation</span><b>[0, 0, +5°, 0]</b><small>θ를 포함한 모든 state는 동일</small></div>'
    +'<div class="sampling-starts"><b>t=95 시작부터 다름</b>'
    +runs.map(function(run,i){return '<span><i style="background:'+colors[i]+'"></i>seed '+data.seeds[i]+' · a[0]='+fmt(initialA0[i],3)+'</span>'}).join("")
    +'</div>'
    +'<div class="sampling-chart"><div class="sampling-legend">'
    +runs.map(function(run,i){return '<span><i style="background:'+colors[i]+'"></i>seed '+data.seeds[i]+'</span>'}).join("")
    +'</div><svg viewBox="0 0 760 146" role="img" aria-label="same-observation final action plans from three different noise seeds">'
    +'<line x1="'+x0+'" y1="'+(y0+height/2)+'" x2="'+(x0+width)+'" y2="'+(y0+height/2)+'" class="conditioning-zero"/>'
    +paths.map(function(p,i){return '<path d="'+p+'" class="sampling-plan sampling-plan-'+i+'" stroke="'+colors[i]+'" fill="none"/>'}).join("")
    +'</svg>'
    +'<div class="chart-axis"><span>a[0]</span><span>a[15]</span></div></div>'
    +'<div class="sampling-summary">'
    +firstForces.map(function(v,i){return '<div><span>seed '+data.seeds[i]+' · first force</span><b>'+(v>=0?"+":"")+fmt(v,2)+' N</b></div>'}).join("")
    +'<div><span>pairwise 평균 plan 차이</span><b>'+fmt(meanPair,2)+' N</b></div></div>'
    +'<p class="sampling-note"><b>중요:</b> seed를 바꾸면 같은 observation에서도 서로 다른 sample plan이 나올 수 있습니다. 여기서 보이는 sample spread는 <b>sampling diversity</b>일 뿐, calibrated uncertainty·확률·confidence가 아닙니다.</p>';
}
function renderObservation(rootEl,obs,planCount,meta){
  if(!obs){rootEl.innerHTML='';return}
  meta=meta||{};
  var startTick=Number.isFinite(meta.planStartTick)?meta.planStartTick:null;
  var currentTick=Number.isFinite(meta.currentTick)?meta.currentTick:null;
  var age=startTick!==null&&currentTick!==null?Math.max(0,currentTick-startTick):null;
  var tickText=startTick===null?'이 4개 상태값으로 현재 plan을 생성했습니다.':'plan tick '+startTick+' · current tick '+currentTick+' · age '+age+' tick'+(age===1?'':'s');
  rootEl.innerHTML=
    '<div class="obs-title" data-qa="observation-title"><b>현재 plan #'+planCount+'</b><span>'+tickText+'</span></div>'
    +'<div class="obs-values" data-qa="observation-values">'
    +'<div><span>x</span><b>'+fmt(obs[0],2)+' m</b><small>cart position</small></div>'
    +'<div><span>ẋ</span><b>'+fmt(obs[1],2)+' m/s</b><small>cart velocity</small></div>'
    +'<div><span>θ</span><b>'+fmt(deg(obs[2]),1)+'°</b><small>pole angle</small></div>'
    +'<div><span>θ̇</span><b>'+fmt(deg(obs[3]),0)+'°/s</b><small>pole angular velocity</small></div>'
    +'</div>';
}
function renderHorizon(plan,cursor,guide){
  var executeCount=4,dt=.02,predSeconds=plan.length*dt,execSeconds=executeCount*dt;
  var isGuide=!!(guide&&guide.enabled),guideApplied=isGuide&&!!guide.applied;
  var finished=isGuide?guideApplied&&cursor>=executeCount:cursor>=executeCount;
  var slots=plan.map(function(v,i){
    var cls=i<executeCount?" execute":" planned";
    if(i<executeCount){
      if(isGuide){
        var guideActive=guideApplied?Math.max(0,Math.min(3,cursor-1)):-1;
        if(i<guideActive)cls+=" done";
        else if(i===guideActive)cls+=" current";
        else cls+=" pending";
      }else{
        if(i<cursor)cls+=" done";
        else if(i===cursor&&cursor<executeCount)cls+=" current";
        else cls+=" pending";
      }
    }else if(finished)cls+=" discarded";
    return '<i class="horizon-slot'+cls+'" data-action-index="'+i+'" title="a['+i+'] = '+fmt(v*10,2)+' N"></i>';
  }).join("");
  return '<div class="horizon-panel" data-qa="horizon" data-prediction-count="'+plan.length+'" data-execute-count="'+executeCount+'" data-prediction-seconds="'+predSeconds.toFixed(2)+'" data-execute-seconds="'+execSeconds.toFixed(2)+'">'
    +'<div class="horizon-head"><div><b>왜 16개를 만들고 4개만 실행하나?</b><span>prediction horizon과 execution horizon을 분리한 receding-horizon control</span></div>'
    +'<div class="horizon-metrics"><strong>16 actions · '+predSeconds.toFixed(2)+' s 계획</strong><em>4 actions · '+execSeconds.toFixed(2)+' s 실행</em></div></div>'
    +'<div class="horizon-track-wrap"><div class="horizon-track">'+slots+'</div><i class="reobserve-marker"></i></div>'
    +'<div class="horizon-labels"><span>a[0]</span><span>a[3]</span><b>↑ 여기서 다시 관측</b><span>a[4]</span><span>a[15]</span></div>'
    +'<div class="horizon-groups"><div class="execute-window"><b>실제로 실행</b><span>a[0]~a[3] · '+execSeconds.toFixed(2)+' s</span></div>'
    +'<div class="planned-window '+(finished?'is-discarded':'')+'"><b>'+(finished?'기존 계획은 폐기':'아직 미래 계획')+'</b><span>a[4]~a[15] · '+(predSeconds-execSeconds).toFixed(2)+' s</span></div></div>'
    +'<p class="horizon-note">'+(finished
      ?'<b>재관측 시점:</b> plant가 이미 변했으므로 old a[4]~a[15]를 계속 실행하지 않습니다. 새 x, ẋ, θ, θ̇로 다시 16-action plan을 생성합니다.'
      :'<b>핵심:</b> 0.32 s 전체를 미리 계획하지만 0.08 s만 실행합니다. 그 뒤 실제 plant를 다시 측정하고 남은 old a[4]~a[15] 대신 새 plan으로 교체합니다.')
    +'</p></div>';
}
function renderExecution(rootEl,plan,cursor,policyForce,guide){
  if(!plan||!plan.length){rootEl.innerHTML='<div class="exec-empty">plan을 기다리는 중…</div>';return}
  var isGuide=!!(guide&&guide.enabled),guideApplied=isGuide&&!!guide.applied;
  var cards='';
  for(var i=0;i<4;i++){
    var state,label;
    if(isGuide){
      var guideActive=guideApplied?Math.max(0,Math.min(3,cursor-1)):-1;
      state=i<guideActive?'done':i===guideActive?'active':'future';
      label=state==='active'?'마지막 적용':state==='done'?'완료':'실행 예정';
    }else{
      state=i<cursor?'done':i===cursor&&cursor<4?'active':'future';
      label=state==='active'?'다음 20 ms':state==='done'?'실행됨':'실행 예정';
    }
    cards+='<div class="exec-action '+state+'" data-qa="exec-action" data-action-index="'+i+'"><span>a['+i+']</span><b>'+(plan[i]>=0?'+':'')+fmt(plan[i]*10,2)+' N</b><small>'+label+'</small></div>';
  }
  var nowLabel,nowText;
  if(isGuide){
    nowLabel=guideApplied?'마지막으로 적용한 force':'현재 cart에 적용되는 force';
    nowText=guideApplied?'<strong>'+(policyForce>=0?'+':'')+fmt(policyForce,2)+' N</strong>':'<strong class="not-applied">아직 적용 안 함</strong>';
  }else{
    nowLabel=cursor<4?'현재 snapshot에서 다음 20 ms에 적용할 force':'다음 force';
    nowText=cursor<4?'<strong>'+(policyForce>=0?'+':'')+fmt(policyForce,2)+' N</strong>':'<strong class="not-applied">재계획</strong>';
  }
  rootEl.innerHTML='<div class="exec-now" data-qa="current-force" data-next-action-index="'+(cursor<4?cursor:-1)+'"><span>'+nowLabel+'</span>'+nowText+'</div>'
    +'<div class="exec-prefix" data-qa="exec-prefix">'+cards+'</div>'
    +renderHorizon(plan,cursor,guide);
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
root.ControlLoopViz={renderStages:renderStages,renderDenoiseTimeline:renderDenoiseTimeline,renderDenoiseUpdate:renderDenoiseUpdate,renderConditioningCompare:renderConditioningCompare,renderSamplingCompare:renderSamplingCompare,renderObservation:renderObservation,renderExecution:renderExecution,renderStateDelta:renderStateDelta};
})(typeof window!=="undefined"?window:globalThis);
