/* F1/F2 regression: the 3-snapshot latent strip must show raw internal-unit values (no *10,
 * no clip-to-10 flattening), one shared scale computed from the FULL frozen history (stable
 * across which step is selected), a zero baseline, and must pick its middle panel from the
 * real currently-inspected guided step (denoiseStepIndex/denoiseActionIndex) rather than an
 * arbitrary fixed t, defaulting explicitly to the middle history entry only when there is no
 * such selection. Pure Node, no browser: app/control_loop_viz.js touches no DOM globals other
 * than the rootEl object it's handed, so it can be exercised directly.
 */
const assert=require("node:assert/strict");
const path=require("node:path");
require(path.join(__dirname,"..","app","control_loop_viz.js"));
const ControlLoopViz=globalThis.ControlLoopViz;
if(!ControlLoopViz)throw new Error("ControlLoopViz did not attach to globalThis");

function makeHistory(){
  // 5 steps, t descending 95->0, each with a distinct, hand-picked 16-long latent array so
  // the expected shared scale and per-panel values can be independently recomputed here.
  var H=16,steps=[95,79,63,47,32,16,0];
  return steps.map(function(t,si){
    var latent=[];
    for(var i=0;i<H;i++)latent.push(((si+1)*0.31+i*0.02)*(i%2===0?1:-1));
    latent[3]=si===2?2.35:latent[3]; // one deliberately large value, planted at the mid step
    return {t:t,latent:latent};
  });
}
function expectedScale(history){
  var m=0;
  history.forEach(function(s){s.latent.forEach(function(v){m=Math.max(m,Math.abs(v))})});
  return Math.max(1e-6,m*1.08);
}
function extractPanels(html,kind){
  var re=new RegExp('data-qa="sequence-'+kind+'"[\\s\\S]*?<path d="([^"]+)"[\\s\\S]*?class="snapshot-axis">[\\s\\S]*?±([0-9.]+)[\\s\\S]*?snapshot-readout">a\\[(\\d+)\\] = ([^<\\s]+)','g');
  var matches=[];
  var m;
  while((m=re.exec(html)))matches.push({d:m[1],scale:Number(m[2]),actionIndex:Number(m[3]),readout:m[4]});
  return matches;
}

var history=makeHistory();
var expScale=expectedScale(history);
var root={innerHTML:""};

// 1) No explicit guide selection: middle panel must be an EXPLICIT default-middle entry
//    (history[floor((n-1)/2)]), not the fixed old t=45 target, and must say so.
ControlLoopViz.renderStages(root,history,null,null);
var html=root.innerHTML;
assert.ok(!html.includes('class="sequence-title"'),"in-SVG sequence-title text must not reappear (labels belong in HTML)");
assert.ok(!html.includes('class="execute-band"'),"the latent strip must not re-fold the N-scaled execute band into it");
var noise=extractPanels(html,"noise"),mid=extractPanels(html,"mid"),final=extractPanels(html,"final");
assert.equal(noise.length,2,"expected desktop+mobile noise panels (2 occurrences)"); // desktop .sequence-row + mobile .mobile-seq-card
assert.equal(mid.length,2,"expected desktop+mobile mid panels");
assert.equal(final.length,2,"expected desktop+mobile final panels");
var expectedMidIdx=Math.floor((history.length-1)/2);
assert.ok(html.includes("아직 단계를 선택하지 않음"),"default middle must be labelled as not an explicit user selection");
assert.ok(html.includes("t="+history[expectedMidIdx].t),"default middle must be the literal middle history entry, not a fixed t=45");
[...noise,...mid,...final].forEach(function(p){
  assert.ok(Math.abs(p.scale-Number(expScale.toFixed(3)))<1e-9,"every panel must share the SAME axis scale computed from the full history, got "+p.scale+" expected "+expScale.toFixed(3));
  assert.equal(p.actionIndex,0,"default action index readout must be explicit (a[0])");
});
// history[0]/history[last] must be literal, not nearest-to-a-fixed-t picks.
var startY0=history[0].latent[0],finalYlast=history[history.length-1].latent[0];
function firstPointY(d){var m=/M[0-9.]+ ([0-9.]+)/.exec(d);return Number(m[1])}
var y0=8,h=56,expY=function(v){return y0+h/2-(v/expScale)*(h*.42)};
assert.ok(Math.abs(firstPointY(noise[0].d)-expY(startY0))<0.6,"history[0] first-point y must match raw latent/scale formula, no *10/clip");
assert.ok(Math.abs(firstPointY(final[0].d)-expY(finalYlast))<0.6,"history[last] first-point y must match raw latent/scale formula, no *10/clip");

// 2) Explicit guide selection (denoiseStepIndex/denoiseActionIndex) must drive the mid panel,
//    not the separate Advanced-ladder selectedT, and must say it is an explicit selection.
root.innerHTML="";
ControlLoopViz.renderStages(root,history,null,{stepIndex:2,actionIndex:3});
html=root.innerHTML;
mid=extractPanels(html,"mid");
assert.ok(html.includes("현재 보고 있는 단계"),"an explicit guided step must be labelled as the real current selection, not a default");
assert.ok(html.includes("t="+history[2].t),"mid panel must be the real inspected step (history[2]), not an arbitrary fixed t");
mid.forEach(function(p){
  assert.equal(p.actionIndex,3,"selected action index must come from denoiseActionIndex, not a hardcoded 0");
});
// Recompute expected readout text the same way the renderer does (6 sig figs).
var expReadout=Number(history[2].latent[3]).toPrecision(6);
mid.forEach(function(p){assert.equal(p.readout,expReadout,"a[3] readout at the selected step must equal the real history[2].latent[3] value, 6 sig figs, no *10/clip")});

console.log("SNAPSHOT_STRIP_CHECK_OK scale="+expScale.toFixed(4)+" defaultMid=t"+history[expectedMidIdx].t+" explicitMid=t"+history[2].t);
