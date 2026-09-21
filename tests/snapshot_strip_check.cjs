/* F1/F2/readability regression: the 3-snapshot latent strip must show raw internal-unit
 * values (no *10, no clip-to-10 flattening), one shared scale computed from the FULL frozen
 * history (stable across which step is selected, stated ONCE in the strip header rather than
 * repeated per panel), a zero baseline, short jargon-free panel titles with the real t under
 * each, and must pick its middle panel from the real currently-inspected guided step
 * (denoiseStepIndex/denoiseActionIndex) rather than an arbitrary fixed t -- history index and
 * explicit-vs-default lineage live in data attributes (data-history-index/data-explicit/
 * data-t), not spelled out in the visible copy. Pure Node, no browser: app/control_loop_viz.js
 * touches no DOM globals other than the rootEl object it's handed, so it can be exercised
 * directly.
 */
const assert=require("node:assert/strict");
const path=require("node:path");
require(path.join(__dirname,"..","app","control_loop_viz.js"));
const ControlLoopViz=globalThis.ControlLoopViz;
if(!ControlLoopViz)throw new Error("ControlLoopViz did not attach to globalThis");

function makeHistory(){
  // 7 steps, t descending 95->0. Deliberately NOT monotonic in si (every step's baseline
  // magnitude is ~0.3-0.5, constant-ish, not growing with si): a per-row-autoscale regression
  // on ANY one panel (noise/mid/final) must be independently detectable, which a fixture
  // where later steps happen to have the largest values by construction would mask -- e.g. if
  // only the FINAL step's own local max happened to equal the true global max, a "final" row
  // recomputing its own local scale instead of using the shared one would silently draw
  // identically and the regression would go uncaught (this was hit and fixed while
  // authoring this check: an earlier version had si-scaled baselines and missed exactly the
  // bug this file exists to catch).
  var H=16,steps=[95,79,63,47,32,16,0];
  return steps.map(function(t,si){
    var latent=[];
    for(var i=0;i<H;i++)latent.push((0.3+i*0.01)*(i%2===0?1:-1));
    latent[3]=si===2?2.35:latent[3]; // one deliberately large value, planted at the mid step only
    return {t:t,latent:latent};
  });
}
function expectedScale(history){
  var m=0;
  history.forEach(function(s){s.latent.forEach(function(v){m=Math.max(m,Math.abs(v))})});
  return Math.max(1e-6,m*1.08);
}
function extractPanels(html,kind){
  var re=new RegExp('data-qa="sequence-'+kind+'" data-history-index="(\\d+)" data-t="(-?\\d+)" data-explicit="(true|false)"[\\s\\S]*?<path d="([^"]+)"[\\s\\S]*?snapshot-readout">a\\[(\\d+)\\] = ([^<\\s]+)<','g');
  var matches=[];
  var m;
  while((m=re.exec(html)))matches.push({historyIndex:Number(m[1]),t:Number(m[2]),explicit:m[3]==="true",d:m[4],actionIndex:Number(m[5]),readout:m[6]});
  return matches;
}
function headerScale(html){
  var m=/data-scale="([^"]+)"/.exec(html);
  return m?Number(m[1]):null;
}

var history=makeHistory();
var expScale=expectedScale(history);
var root={innerHTML:""};

// 1) No explicit guide selection: middle panel must be an EXPLICIT default-middle entry
//    (history[floor((n-1)/2)]), not the fixed old t=45 target, carried via data attrs.
ControlLoopViz.renderStages(root,history,null,null);
var html=root.innerHTML;
assert.ok(!html.includes('class="sequence-title"'),"in-SVG sequence-title text must not reappear (labels belong in HTML)");
assert.ok(!html.includes('class="execute-band"'),"the latent strip must not re-fold the N-scaled execute band into it");
assert.ok(html.includes("관측 4개"),"strip header must give a one-line present-observations-to-execute summary");
var noise=extractPanels(html,"noise"),mid=extractPanels(html,"mid"),final=extractPanels(html,"final");
assert.equal(noise.length,2,"expected desktop+mobile noise panels (2 occurrences)"); // desktop .sequence-row + mobile .mobile-seq-card
assert.equal(mid.length,2,"expected desktop+mobile mid panels");
assert.equal(final.length,2,"expected desktop+mobile final panels");
var expectedMidIdx=Math.floor((history.length-1)/2);
noise.forEach(function(p){assert.equal(p.historyIndex,0,"noise panel must be literal history[0]");assert.equal(p.explicit,false)});
final.forEach(function(p){assert.equal(p.historyIndex,history.length-1,"final panel must be literal history[last]");assert.equal(p.explicit,false)});
mid.forEach(function(p){
  assert.equal(p.historyIndex,expectedMidIdx,"default mid panel must be the literal middle history entry, not a fixed t=45");
  assert.equal(p.t,history[expectedMidIdx].t);
  assert.equal(p.explicit,false,"default middle must be marked data-explicit=false, not implied as a user choice");
});
// Panel titles must be short and jargon-free -- no "history[0]"/"history[last]" in visible copy.
assert.ok(!/history\[/.test(html.replace(/data-history-index="\d+"/g,"")),"history[j] must not appear in visible copy, only in data-history-index");
["초기 후보","선택 단계","최종 후보"].forEach(function(t){assert.ok(html.includes(t),"missing short panel title: "+t)});
// The shared scale/unit text must appear exactly once (header), not once per panel (was 6x).
var scaleOccurrences=(html.match(/internal unit, not N/g)||[]).length;
assert.equal(scaleOccurrences,1,"shared axis/unit text must appear exactly once in the header, found "+scaleOccurrences);
assert.ok(headerScale(html)!==null,"header must carry the real scale in a data-scale attribute");
assert.ok(Math.abs(headerScale(html)-expScale)<1e-6,"header data-scale must equal the true full-history scale, got "+headerScale(html)+" expected "+expScale);
[...noise,...mid,...final].forEach(function(p){
  assert.equal(p.actionIndex,0,"default action index readout must be explicit (a[0])");
  assert.ok(!/\s/.test(p.readout),"readout value must be a single non-wrapping token, got "+JSON.stringify(p.readout));
});
// history[0]/history[last] must be literal, not nearest-to-a-fixed-t picks.
var startY0=history[0].latent[0],finalYlast=history[history.length-1].latent[0];
function firstPointY(d){var m=/M[0-9.]+ ([0-9.]+)/.exec(d);return Number(m[1])}
var y0=8,h=56,expY=function(v){return y0+h/2-(v/expScale)*(h*.42)};
assert.ok(Math.abs(firstPointY(noise[0].d)-expY(startY0))<0.6,"history[0] first-point y must match raw latent/scale formula, no *10/clip");
assert.ok(Math.abs(firstPointY(final[0].d)-expY(finalYlast))<0.6,"history[last] first-point y must match raw latent/scale formula, no *10/clip");

// 2) Explicit guide selection (denoiseStepIndex/denoiseActionIndex) must drive the mid panel,
//    marked data-explicit=true, without ever needing "history[j]" or a prose sentence in copy.
root.innerHTML="";
ControlLoopViz.renderStages(root,history,null,{stepIndex:2,actionIndex:3});
html=root.innerHTML;
mid=extractPanels(html,"mid");
mid.forEach(function(p){
  assert.equal(p.explicit,true,"an explicit guided step must be marked data-explicit=true");
  assert.equal(p.historyIndex,2,"mid panel must be the real inspected step (history[2]), not an arbitrary fixed t");
  assert.equal(p.t,history[2].t);
  assert.equal(p.actionIndex,3,"selected action index must come from denoiseActionIndex, not a hardcoded 0");
});
// Recompute expected readout text the same way the renderer does (6 sig figs).
var expReadout=Number(history[2].latent[3]).toPrecision(6);
mid.forEach(function(p){assert.equal(p.readout,expReadout,"a[3] readout at the selected step must equal the real history[2].latent[3] value, 6 sig figs, no *10/clip")});

console.log("SNAPSHOT_STRIP_CHECK_OK scale="+expScale.toFixed(4)+" defaultMid=t"+history[expectedMidIdx].t+" explicitMid=t"+history[2].t);
