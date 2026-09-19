(function(root){
"use strict";
var hoverIndex=null,subscribers=[];
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function mix(a,b,t){return Math.round(a+(b-a)*t)}
function cellColor(v,kind){
  var x=clamp(Math.abs(v)/1.2,0,1),base=[255,255,255],target;
  if(kind==="noise")target=[137,104,202];
  else if(kind==="target")target=[60,154,115];
  else target=v>=0?[84,118,223]:[223,103,103];
  var t=.12+.78*x;
  return "rgb("+mix(base[0],target[0],t)+","+mix(base[1],target[1],t)+","+mix(base[2],target[2],t)+")";
}
function notify(index){
  hoverIndex=index;
  subscribers.forEach(function(fn){fn(index)});
  document.querySelectorAll("[data-action-index]").forEach(function(el){
    var same=index===null||Number(el.dataset.actionIndex)===index;
    el.classList.toggle("linked-dim",!same);
    el.classList.toggle("linked-highlight",index!==null&&same);
  });
}
function wireCell(el,index){
  el.dataset.actionIndex=index;
  el.addEventListener("mouseenter",function(){notify(index)});
  el.addEventListener("mouseleave",function(){notify(null)});
  el.addEventListener("focus",function(){notify(index)});
  el.addEventListener("blur",function(){notify(null)});
}
function vectorHTML(values,kind,compact){
  return '<div class="vector-strip '+(compact?"compact":"")+'">'+values.map(function(v,i){
    return '<button type="button" class="vector-cell" data-action-index="'+i+'" style="background:'+cellColor(v,kind)+'" aria-label="action '+i+' value '+v.toFixed(3)+'" title="a['+i+'] = '+v.toFixed(3)+'"></button>';
  }).join("")+'</div>';
}
function wire(rootEl){rootEl.querySelectorAll("[data-action-index]").forEach(function(el){wireCell(el,Number(el.dataset.actionIndex))})}
function pickStages(history,count){
  if(history.length<=count)return history;
  var out=[],used={};
  for(var i=0;i<count;i++){
    var idx=Math.round(i*(history.length-1)/(count-1));
    if(!used[idx]){out.push(history[idx]);used[idx]=1}
  }
  return out;
}
function renderLadder(rootEl,history,selectedT,onSelect){
  var stages=pickStages(history,5);
  rootEl.innerHTML=stages.map(function(stage,i){
    var active=stage.t===selectedT?" active":"";
    return '<div class="ladder-stage'+active+'" data-stage-t="'+stage.t+'" tabindex="0" role="button" aria-label="inspect diffusion timestep '+stage.t+'">'
      +'<div class="stage-top"><b>'+(stage.t===0?"action":"t = "+stage.t)+'</b><span>'+stage.caption+'</span></div>'
      +vectorHTML(stage.latent,stage.t===0?"target":"latent",true)
      +'</div>'+(i<stages.length-1?'<div class="ladder-arrow" aria-hidden="true"><svg viewBox="0 0 42 18"><path d="M2 9 C14 9 18 9 30 9 M27 5 L32 9 L27 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>':'');
  }).join("");
  wire(rootEl);
  rootEl.querySelectorAll("[data-stage-t]").forEach(function(el){
    var act=function(){onSelect(Number(el.dataset.stageT))};
    el.addEventListener("click",act);
    el.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();act()}});
  });
}
function renderInspector(rootEl,stage){
  if(!stage){rootEl.innerHTML='<div class="empty-inspector">Denoise를 실행하면 각 step 내부가 여기에 보입니다.</div>';return}
  var rows=[
    ["current aₜ",stage.latent,"latent","현재 noisy action"],
    ["predicted ε",stage.pred||new Array(stage.latent.length).fill(0),"noise","모델이 noise라고 판단한 부분"],
    ["estimated a₀",stage.x0||stage.latent,"target","noise를 빼고 추정한 clean action"],
    ["next a",stage.next||stage.latent,"latent",stage.t===0?"최종 action":"다음 timestep으로 이동"]
  ];
  rootEl.innerHTML='<div class="inspector-title"><b>'+(stage.t===0?"Final action":"Inside t = "+stage.t)+'</b><span>셀에 마우스를 올리면 같은 action index가 모든 단계에서 함께 강조됩니다.</span></div>'
    +rows.map(function(r){return '<div class="inspect-row"><div class="inspect-label"><b>'+r[0]+'</b><span>'+r[3]+'</span></div>'+vectorHTML(r[1],r[2],false)+'</div>'}).join("");
  wire(rootEl);
}
function subscribe(fn){subscribers.push(fn);return function(){subscribers=subscribers.filter(function(x){return x!==fn})}}
root.DiffusionViz={renderLadder:renderLadder,renderInspector:renderInspector,subscribe:subscribe,notify:notify};
})(typeof window!=="undefined"?window:globalThis);
