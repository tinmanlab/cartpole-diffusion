(function(root){
"use strict";

function setup(canvas){
  var dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  var rect=canvas.getBoundingClientRect();
  var w=Math.max(280,Math.round(rect.width)),h=Math.max(120,Math.round(rect.height));
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  }
  var ctx=canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  return{ctx:ctx,w:w,h:h};
}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function forceSamples(vectors,index){return vectors.map(function(v){return v[index]*10}).filter(Number.isFinite)}
function kde(samples,x,bw){
  if(!samples.length)return 0;
  var inv=1/(samples.length*bw*Math.sqrt(2*Math.PI)),s=0;
  for(var i=0;i<samples.length;i++){var z=(x-samples[i])/bw;s+=Math.exp(-.5*z*z)}
  return s*inv;
}
function drawDistribution(canvas,data,index){
  var s=setup(canvas),ctx=s.ctx,w=s.w,h=s.h,p={l:34,r:10,t:24,b:24},xmin=-14,xmax=14;
  ctx.fillStyle="#fcfcfd";ctx.fillRect(0,0,w,h);
  ctx.strokeStyle="#e4e7ec";ctx.lineWidth=1;
  var zeroY=h-p.b;ctx.beginPath();ctx.moveTo(p.l,zeroY);ctx.lineTo(w-p.r,zeroY);ctx.stroke();
  var sets=[
    {name:"t=95 · noise",values:forceSamples(data.t95||[],index),color:"#8968ca",bw:2.2},
    {name:"t=45",values:forceSamples(data.t45||[],index),color:"#5476df",bw:1.6},
    {name:"t=0 · action",values:forceSamples(data.t0||[],index),color:"#3c9a73",bw:1.15}
  ];
  var curves=[],maxY=1e-6,n=120;
  sets.forEach(function(set){
    var arr=[];
    for(var i=0;i<n;i++){var x=xmin+(xmax-xmin)*i/(n-1),y=kde(set.values,x,set.bw);arr.push([x,y]);maxY=Math.max(maxY,y)}
    curves.push({set:set,arr:arr});
  });
  [-10,0,10].forEach(function(v){
    var x=p.l+(v-xmin)/(xmax-xmin)*(w-p.l-p.r);
    ctx.strokeStyle=v===0?"#cbd1da":"#eef0f3";ctx.beginPath();ctx.moveTo(x,p.t);ctx.lineTo(x,h-p.b);ctx.stroke();
    ctx.fillStyle="#7b8492";ctx.font="9px ui-monospace,monospace";ctx.textAlign="center";ctx.fillText(v+" N",x,h-7);
  });
  curves.forEach(function(curve){
    ctx.strokeStyle=curve.set.color;ctx.lineWidth=2.2;ctx.beginPath();
    curve.arr.forEach(function(pt,i){
      var x=p.l+(pt[0]-xmin)/(xmax-xmin)*(w-p.l-p.r);
      var y=h-p.b-(pt[1]/maxY)*(h-p.t-p.b)*.88;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });ctx.stroke();
  });
  ctx.textAlign="left";ctx.font="10px system-ui";
  var lx=p.l,ly=12;
  sets.forEach(function(set){
    ctx.fillStyle=set.color;ctx.fillRect(lx,ly-6,10,2);ctx.fillStyle="#596273";ctx.fillText(set.name,lx+14,ly);lx+=ctx.measureText(set.name).width+38;
  });
  ctx.fillStyle="#344054";ctx.font="600 10px system-ui";ctx.fillText("action["+index+"] across "+(data.t0||[]).length+" noise seeds",p.l,22);
}
function drawTrace(canvas,history,index){
  var s=setup(canvas),ctx=s.ctx,w=s.w,h=s.h,p={l:34,r:10,t:22,b:24};
  ctx.fillStyle="#fcfcfd";ctx.fillRect(0,0,w,h);
  ctx.strokeStyle="#e4e7ec";ctx.lineWidth=1;
  [-10,0,10].forEach(function(v){
    var y=p.t+(10-v)/20*(h-p.t-p.b);
    ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();
    ctx.fillStyle="#7b8492";ctx.font="8px ui-monospace,monospace";ctx.textAlign="right";ctx.fillText(v,p.l-5,y+3);
  });
  if(!history.length)return;
  ctx.strokeStyle="#5476df";ctx.lineWidth=2;ctx.beginPath();
  history.forEach(function(stage,i){
    var x=p.l+i/(history.length-1)*(w-p.l-p.r),v=clamp(stage.latent[index]*10,-12,12),y=p.t+(10-v)/20*(h-p.t-p.b);
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });ctx.stroke();
  [0,Math.floor((history.length-1)/2),history.length-1].forEach(function(i){
    var stage=history[i],x=p.l+i/(history.length-1)*(w-p.l-p.r),v=clamp(stage.latent[index]*10,-12,12),y=p.t+(10-v)/20*(h-p.t-p.b);
    ctx.fillStyle=i===history.length-1?"#3c9a73":"#5476df";ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#7b8492";ctx.font="8px ui-monospace,monospace";ctx.textAlign="center";ctx.fillText("t"+stage.t,x,h-7);
  });
  ctx.textAlign="left";ctx.fillStyle="#344054";ctx.font="600 10px system-ui";ctx.fillText("one seed · action["+index+"] through denoising",p.l,13);
}
function renderChunk(rootEl,plan,selected,onSelect){
  rootEl.innerHTML="";
  plan.forEach(function(v,i){
    var b=document.createElement("button");b.type="button";b.className="chunk-cell"+(i===selected?" selected":"");b.dataset.actionIndex=i;
    b.setAttribute("aria-label","select action "+i+", "+(v*10).toFixed(2)+" newtons");
    var bar=document.createElement("span");bar.className="chunk-bar";
    var q=clamp(v,-1,1),height=Math.max(2,Math.abs(q)*45);
    bar.style.height=height+"%";bar.style.bottom=q>=0?"50%":(50-height)+"%";bar.classList.toggle("negative",q<0);
    var zero=document.createElement("i");zero.className="chunk-zero";
    var label=document.createElement("small");label.textContent=(i%4===0||i===plan.length-1)?i:"";
    b.appendChild(zero);b.appendChild(bar);b.appendChild(label);
    b.addEventListener("mouseenter",function(){onSelect(i,false)});
    b.addEventListener("focus",function(){onSelect(i,false)});
    b.addEventListener("click",function(){onSelect(i,true)});
    rootEl.appendChild(b);
  });
}
root.BeginnerDiffusionViz={drawDistribution:drawDistribution,drawTrace:drawTrace,renderChunk:renderChunk};
})(typeof window!=="undefined"?window:globalThis);
