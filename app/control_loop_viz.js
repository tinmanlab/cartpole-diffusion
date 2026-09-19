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
function forceBar(value,finalStage,index){
  var raw=value*10,shown=clamp(raw,-12,12),mag=Math.max(2,Math.abs(shown)/12*44);
  var bottom=shown>=0?50:50-mag;
  return '<div class="force-col" title="a['+index+'] = '+fmt(raw,2)+(finalStage?' N':' candidate')+'">'
    +'<i class="force-zero"></i>'
    +'<span class="force-bar '+(shown<0?'neg':'')+'" style="height:'+mag+'%;bottom:'+bottom+'%"></span>'
    +'<small>'+(index%4===0||index===15?index:'')+'</small>'
    +'</div>';
}
function stageCard(stage,title,subtitle,kind){
  if(!stage)return '';
  var finalStage=stage.t===0;
  return '<article class="denoise-stage '+kind+'">'
    +'<div class="denoise-head"><b>'+title+'</b><span>'+subtitle+'</span></div>'
    +'<div class="force-bars">'+stage.latent.map(function(v,i){return forceBar(v,finalStage,i)}).join('')+'</div>'
    +'<div class="stage-foot">'+(finalStage?'now this is an executable force plan':'not executed yet · internal action-space candidate')+'</div>'
    +'</article>';
}
function renderStages(rootEl,history){
  var start=pick(history,95),mid=pick(history,45),final=pick(history,0);
  rootEl.innerHTML=
    stageCard(start,'A · Start from random candidates','t = '+(start?start.t:'—'),'noise')
    +'<div class="stage-arrow" aria-hidden="true">→</div>'
    +stageCard(mid,'B · Denoise repeatedly','t ≈ '+(mid?mid.t:'—'),'mid')
    +'<div class="stage-arrow" aria-hidden="true">→</div>'
    +stageCard(final,'C · Final action plan','t = 0','final');
}
function renderObservation(rootEl,obs,planCount){
  if(!obs){rootEl.innerHTML='';return}
  rootEl.innerHTML=
    '<div class="obs-title"><b>Observation used for plan #'+planCount+'</b><span>이 4개 숫자가 현재 toy policy가 보는 전부입니다.</span></div>'
    +'<div class="obs-values">'
    +'<div><span>x</span><b>'+fmt(obs[0],2)+' m</b><small>cart position</small></div>'
    +'<div><span>ẋ</span><b>'+fmt(obs[1],2)+' m/s</b><small>cart velocity</small></div>'
    +'<div><span>θ</span><b>'+fmt(deg(obs[2]),1)+'°</b><small>pole angle</small></div>'
    +'<div><span>θ̇</span><b>'+fmt(deg(obs[3]),0)+'°/s</b><small>pole angular velocity</small></div>'
    +'</div>';
}
function renderExecution(rootEl,plan,cursor,policyForce){
  if(!plan||!plan.length){rootEl.innerHTML='<div class="exec-empty">waiting for a plan…</div>';return}
  var active=Math.max(0,Math.min(3,cursor-1));
  var cards='';
  for(var i=0;i<4;i++){
    var state=i<cursor-1?'done':i===active?'active':'future';
    cards+='<div class="exec-action '+state+'"><span>a['+i+']</span><b>'+(plan[i]>=0?'+':'')+fmt(plan[i]*10,2)+' N</b><small>'+(state==='active'?'applied now':state==='done'?'done':'next')+'</small></div>';
  }
  rootEl.innerHTML='<div class="exec-now"><span>force currently sent to cart</span><strong>'+(policyForce>=0?'+':'')+fmt(policyForce,2)+' N</strong></div>'
    +'<div class="exec-prefix">'+cards+'</div>'
    +'<div class="exec-rest">a[4] … a[15] stay as future plan only. After a[3], observe again and generate a new plan.</div>';
}
root.ControlLoopViz={renderStages:renderStages,renderObservation:renderObservation,renderExecution:renderExecution};
})(typeof window!=="undefined"?window:globalThis);
