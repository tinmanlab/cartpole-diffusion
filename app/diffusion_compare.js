(function(root){
"use strict";
var DT=.02,HORIZON_STEPS=500,EXECUTE=4,MAXF=10;
var INITIAL=Object.freeze({x:0,xDot:0,theta:5*Math.PI/180,thetaDot:0});
var PULSES=Object.freeze([
  {start:80,duration:8,force:4},
  {start:190,duration:8,force:-4},
  {start:300,duration:8,force:4},
  {start:410,duration:8,force:-4}
]);
var CONTROLLERS=Object.freeze([
  {id:"seed-a",label:"Seed 10101",baseSeed:10101},
  {id:"seed-b",label:"Seed 20202",baseSeed:20202},
  {id:"seed-c",label:"Seed 30303",baseSeed:30303}
]);
function clone(s){return{x:s.x,xDot:s.xDot,theta:s.theta,thetaDot:s.thetaDot}}
function arr(s){return[s.x,s.xDot,s.theta,s.thetaDot]}
function disturbanceAtTick(tick){
  for(var i=0;i<PULSES.length;i++){var p=PULSES[i];if(tick>=p.start&&tick<p.start+p.duration)return p.force}
  return 0;
}
function planSeed(base,index){return(base+Math.imul(index,0x9E3779B1))>>>0}
function finitePlan(plan){return Array.isArray(plan)&&plan.length===16&&plan.every(Number.isFinite)}
function makeController(def,core){
  var state=clone(INITIAL);
  var rt={id:def.id,label:def.label,baseSeed:def.baseSeed,state:state,plan:[],cursor:0,planNumber:0,planSeed:0,nextForce:0,lastAppliedForce:0,lastAppliedActionIndex:-1,failed:false,failedAt:null,metrics:{maxAbsTheta:Math.abs(state.theta),maxAbsX:0,sumAbsTheta:Math.abs(state.theta),samples:1,controlEffort:0}};
  refreshPlan(rt,core);
  return rt;
}
function refreshPlan(rt,core){
  var seed=planSeed(rt.baseSeed,rt.planNumber);
  var plan=core.planForSeed(arr(rt.state),seed);
  if(!finitePlan(plan))throw new Error("comparison plan invalid for "+rt.id);
  rt.plan=plan.slice();rt.cursor=0;rt.planSeed=seed;rt.planNumber+=1;rt.nextForce=rt.plan[0]*MAXF;
}
function metricsSnapshot(rt){
  var m=rt.metrics;
  return{maxAbsTheta:m.maxAbsTheta,maxAbsX:m.maxAbsX,meanAbsTheta:m.sumAbsTheta/m.samples,controlEffort:m.controlEffort};
}
function controllerSnapshot(rt,disturbance){
  return{id:rt.id,label:rt.label,baseSeed:rt.baseSeed,state:clone(rt.state),nextForce:rt.nextForce,lastAppliedForce:rt.lastAppliedForce,lastAppliedActionIndex:rt.lastAppliedActionIndex,disturbance:disturbance,planNumber:rt.planNumber,planSeed:rt.planSeed,cursor:rt.cursor,failed:rt.failed,failedAt:rt.failedAt,metrics:metricsSnapshot(rt)};
}
function snapshot(run,disturbance){
  var controllers={};
  for(var i=0;i<CONTROLLERS.length;i++){var id=CONTROLLERS[i].id;controllers[id]=controllerSnapshot(run.controllers[id],disturbance)}
  return{tick:run.tick,time:run.tick*DT,disturbance:disturbance,controllers:controllers};
}
function createRun(model,core){
  if(!model||!core||typeof core.physics!=="function"||typeof core.planForSeed!=="function"||typeof core.terminal!=="function")throw new Error("comparison requires model and live-core callbacks");
  var controllers={};
  for(var i=0;i<CONTROLLERS.length;i++){var d=CONTROLLERS[i];controllers[d.id]=makeController(d,core)}
  var run={model:model,core:core,tick:0,done:false,controllers:controllers,trace:[]};
  run.trace.push(snapshot(run,disturbanceAtTick(0)));
  return run;
}
function stepRun(run){
  if(run.done)return run.trace[run.trace.length-1];
  if(run.tick>=HORIZON_STEPS){run.done=true;return run.trace[run.trace.length-1]}
  var disturbance=disturbanceAtTick(run.tick);
  for(var i=0;i<CONTROLLERS.length;i++){
    var id=CONTROLLERS[i].id,rt=run.controllers[id];
    if(rt.failed){rt.nextForce=0;rt.lastAppliedForce=0;rt.lastAppliedActionIndex=-1;continue}
    var force=rt.nextForce,index=rt.cursor;
    rt.metrics.controlEffort+=Math.abs(force)*DT;
    rt.state=run.core.physics(rt.state,force,disturbance);
    rt.lastAppliedForce=force;rt.lastAppliedActionIndex=index;rt.cursor+=1;
    if(run.core.terminal(rt.state)){rt.failed=true;rt.failedAt=run.tick+1;rt.nextForce=0}
    else if(rt.cursor>=EXECUTE)refreshPlan(rt,run.core);
    else rt.nextForce=rt.plan[rt.cursor]*MAXF;
    var m=rt.metrics;m.maxAbsTheta=Math.max(m.maxAbsTheta,Math.abs(rt.state.theta));m.maxAbsX=Math.max(m.maxAbsX,Math.abs(rt.state.x));m.sumAbsTheta+=Math.abs(rt.state.theta);m.samples+=1;
  }
  run.tick+=1;if(run.tick>=HORIZON_STEPS)run.done=true;
  var snap=snapshot(run,disturbance);run.trace.push(snap);return snap;
}
function runToEnd(model,core){var run=createRun(model,core);while(!run.done)stepRun(run);return run}
function summary(run){
  var out={};
  for(var i=0;i<CONTROLLERS.length;i++){
    var id=CONTROLLERS[i].id,rt=run.controllers[id],m=rt.metrics;
    out[id]={seed:rt.baseSeed,survivalSteps:rt.failedAt===null?HORIZON_STEPS:rt.failedAt,survivalSeconds:(rt.failedAt===null?HORIZON_STEPS:rt.failedAt)*DT,failed:rt.failed,maxAbsTheta:m.maxAbsTheta,maxAbsX:m.maxAbsX,meanAbsTheta:m.sumAbsTheta/m.samples,controlEffort:m.controlEffort};
  }
  return out;
}
root.DiffusionCompare={DT:DT,HORIZON_STEPS:HORIZON_STEPS,INITIAL_STATE:INITIAL,DISTURBANCE_PULSES:PULSES,CONTROLLERS:CONTROLLERS,disturbanceAtTick:disturbanceAtTick,createRun:createRun,stepRun:stepRun,runToEnd:runToEnd,summary:summary};
})(typeof globalThis!=="undefined"?globalThis:this);
