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
root.ControlLoopViz={renderStages:renderStages,renderObservation:renderObservation,renderExecution:renderExecution,renderStateDelta:renderStateDelta};
})(typeof window!=="undefined"?window:globalThis);
