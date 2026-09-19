import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const outDir=path.resolve('qa-output');fs.mkdirSync(outDir,{recursive:true});
const baseURL=process.env.QA_URL||'http://127.0.0.1:4173/';
const report={generatedAt:new Date().toISOString(),baseURL,errors:[],warnings:[],views:{},interactions:{}};
const err=m=>report.errors.push(m),warn=m=>report.warnings.push(m);
const rect=r=>r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)}:null;
async function waitLearned(page){await page.waitForFunction(()=>document.querySelector('#modelTag')?.textContent?.includes('learned'),null,{timeout:15000});}
async function readAtomicSnapshot(page){
  return page.locator('[data-qa="plant"]').evaluate(el=>{
    const parse=v=>v?String(v).split(',').map(Number):[];
    return{
      tick:Number(el.dataset.currentTick),sim:parse(el.dataset.simState),
      planObservation:parse(el.dataset.planObservation),planNumber:Number(el.dataset.planNumber),
      planStartTick:Number(el.dataset.planStartTick),planAge:Number(el.dataset.planAge),
      cursor:Number(el.dataset.planCursor),nextActionIndex:Number(el.dataset.nextActionIndex),
      policyForce:Number(el.dataset.policyForce),planForce:Number(el.dataset.planForce),
      lastAppliedForce:Number(el.dataset.lastAppliedForce),lastAppliedActionIndex:Number(el.dataset.lastAppliedActionIndex),
      running:el.dataset.running==='true'
    };
  });
}
function arraysClose(a,b,eps=1e-10){return a.length===b.length&&a.every((v,i)=>Number.isFinite(v)&&Number.isFinite(b[i])&&Math.abs(v-b[i])<=eps)}
function close(a,b,eps=1e-9){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=eps}
function verifyAtomicSnapshot(s,label){
  if(s.sim.length!==4||s.planObservation.length!==4)err(label+': state/plan observation width is not 4');
  if(s.tick-s.planStartTick!==s.planAge)err(label+': plan age != current tick - plan start tick');
  if(s.nextActionIndex!==s.cursor)err(label+': next action index != plan cursor');
  if(s.cursor<0||s.cursor>3)err(label+': live cursor outside 0..3: '+s.cursor);
  if(!close(s.policyForce,s.planForce,1e-8))err(label+': displayed next force != current plan[cursor]');
  if(s.planAge===0&&!arraysClose(s.sim,s.planObservation,1e-10))err(label+': fresh plan observation != current plant state');
}
function verifyAtomicTransition(before,after,label){
  if(after.tick!==before.tick+1)err(label+': Step did not advance exactly one 20 ms tick');
  if(!close(after.lastAppliedForce,before.policyForce,1e-8))err(label+': last applied force != previous snapshot next force');
  if(after.lastAppliedActionIndex!==before.cursor)err(label+': last applied action index != previous cursor');
  if(before.cursor<3){
    if(after.planNumber!==before.planNumber)err(label+': plan changed before four-action prefix completed');
    if(after.cursor!==before.cursor+1)err(label+': cursor did not advance by one inside prefix');
    if(after.planStartTick!==before.planStartTick)err(label+': plan start tick changed inside prefix');
    if(!arraysClose(after.planObservation,before.planObservation,1e-12))err(label+': plan observation changed inside prefix');
    if(after.planAge!==before.planAge+1)err(label+': plan age did not increase by one');
    return false;
  }
  if(after.planNumber!==before.planNumber+1)err(label+': fourth action did not trigger immediate replan');
  if(after.cursor!==0)err(label+': replanned snapshot did not reset cursor to a[0]');
  if(after.planStartTick!==after.tick||after.planAge!==0)err(label+': replanned snapshot is not anchored to current tick');
  if(!arraysClose(after.sim,after.planObservation,1e-10))err(label+': replan observation != post-transition plant state');
  return true;
}
async function inspect(page,name){
  const d=await page.evaluate(()=>{
    const pick=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const sels=['[data-qa="plant"]','[data-qa="controller"]','[data-qa="observe"]','[data-qa="plan"]','[data-qa="act"]','[data-qa="replan"]'];
    const boxes=Object.fromEntries(sels.map(s=>[s,pick(s)]));
    const core=[...document.querySelectorAll('.topbar strong,.card-head b,.step-head b,.step-head span,.obs-title b,.obs-title span,.obs-values span,.obs-values b,.obs-values small,.conditioning-head b,.conditioning-head span,.conditioning-head em,.cond-obs span,.cond-obs b,.cond-obs small,.cond-arrow,.conditioning-legend,.conditioning-summary span,.conditioning-summary b,.conditioning-note,.divergence-head b,.divergence-head span,.divergence-head strong,.divergence-legend,.divergence-metrics span,.divergence-metrics b,.sampling-head b,.sampling-head span,.sampling-head em,.sampling-condition span,.sampling-condition b,.sampling-condition small,.sampling-starts,.sampling-legend,.sampling-summary span,.sampling-summary b,.sampling-note,.policy-plain,.blackbox span,.blackbox b,.sequence-guide b,.sequence-guide span,.sequence-title,.sequence-sub,.sequence-scale,.sequence-down,.sequence-plain,.mobile-seq-head b,.mobile-seq-head span,.mobile-seq-axis,.mobile-seq-arrow,.timeline-head b,.timeline-head span,.timeline-status strong,.timeline-status span,.timeline-controls button,.timeline-controls label,.timeline-controls select,.timeline-scale,.timeline-caption,.denoise-update-head b,.denoise-update-head span,.update-card span,.update-card b,.update-card strong,.update-card small,.update-chart-title b,.update-chart-title span,.denoise-update-note,.exec-now span,.exec-now strong,.exec-action span,.exec-action b,.exec-action small,.horizon-head b,.horizon-head span,.horizon-metrics strong,.horizon-metrics em,.horizon-labels,.horizon-groups b,.horizon-groups span,.horizon-note,.loop-back')];
    const fonts=core.filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite);
    const overlap=(a,b)=>{if(!a||!b)return 0;return Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y))};
    const visibleCount=s=>[...document.querySelectorAll(s)].filter(e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden').length;
    const horizon=document.querySelector('[data-qa="horizon"]'),track=horizon?.querySelector('.horizon-track'),marker=horizon?.querySelector('.reobserve-marker');
    const tr=track?.getBoundingClientRect(),mr=marker?.getBoundingClientRect();
    const horizonInfo=horizon?{
      predictionCount:Number(horizon.dataset.predictionCount),
      executeCount:Number(horizon.dataset.executeCount),
      predictionSeconds:Number(horizon.dataset.predictionSeconds),
      executeSeconds:Number(horizon.dataset.executeSeconds),
      slots:horizon.querySelectorAll('.horizon-slot').length,
      executeSlots:horizon.querySelectorAll('.horizon-slot.execute').length,
      plannedSlots:horizon.querySelectorAll('.horizon-slot.planned').length,
      discardedSlots:horizon.querySelectorAll('.horizon-slot.discarded').length,
      markerRatio:tr&&mr?((mr.x+mr.width/2)-tr.x)/tr.width:null
    }:null;
    return{viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},boxes,minCoreFont:fonts.length?Math.min(...fonts):null,plantControllerOverlap:overlap(boxes[sels[0]],boxes[sels[1]]),sequencePaths:visibleCount('.sequence-svg .sequence-path'),executePoints:visibleCount('.execute-point'),executeBands:visibleCount('.execute-band'),obsValues:document.querySelectorAll('[data-qa="observation-values"]>div').length,execActions:document.querySelectorAll('[data-qa="exec-action"]').length,advancedOpen:document.querySelector('[data-qa="advanced"]')?.open||false,desktopSequenceDisplay:getComputedStyle(document.querySelector('.sequence-svg')).display,mobileSequenceDisplay:getComputedStyle(document.querySelector('[data-qa="mobile-sequence"]')).display,mobileSequencePaths:visibleCount('.mobile-sequence-path'),horizon:horizonInfo};
  });
  d.boxes=Object.fromEntries(Object.entries(d.boxes).map(([k,v])=>[k,rect(v)]));report.views[name]=d;
  if(d.document.scrollWidth>d.viewport.width+2)err(name+': page-level horizontal overflow '+d.document.scrollWidth+' > '+d.viewport.width);
  if(d.minCoreFont!==null&&d.minCoreFont<10.5)err(name+': core text too small '+d.minCoreFont+'px');
  if(d.plantControllerOverlap>4)err(name+': plant/controller overlap '+Math.round(d.plantControllerOverlap));
  if(name==='desktop'&&d.sequencePaths!==3)err(name+': expected 3 desktop denoising paths, got '+d.sequencePaths);
  if(name==='mobile'&&d.sequencePaths!==0)err(name+': hidden desktop denoising paths are still visible ('+d.sequencePaths+')');
  if(name==='desktop'&&d.mobileSequencePaths!==0)err(name+': hidden mobile denoising paths are visible ('+d.mobileSequencePaths+')');
  if(name==='mobile'&&d.mobileSequencePaths!==3)err(name+': expected 3 mobile denoising paths, got '+d.mobileSequencePaths);
  if(d.executePoints!==4||d.executeBands!==1)err(name+': execute-region markers incorrect');
  if(d.obsValues!==4)err(name+': observation card count '+d.obsValues);
  if(d.execActions!==4)err(name+': execution card count '+d.execActions);
  if(!d.horizon)err(name+': horizon visualization missing');
  else{
    if(d.horizon.predictionCount!==16||d.horizon.executeCount!==4)err(name+': horizon count contract is not 16/4');
    if(Math.abs(d.horizon.predictionSeconds-.32)>1e-9||Math.abs(d.horizon.executeSeconds-.08)>1e-9)err(name+': horizon timing contract is not 0.32/0.08 s');
    if(d.horizon.slots!==16||d.horizon.executeSlots!==4||d.horizon.plannedSlots!==12)err(name+': horizon slot split incorrect');
    if(d.horizon.markerRatio===null||Math.abs(d.horizon.markerRatio-.25)>.025)err(name+': re-observation marker is not at 25% of horizon');
  }
  return d;
}
async function desktop(browser){
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const browserErrors=[];page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});page.on('pageerror',e=>browserErrors.push(String(e)));
  await page.goto(baseURL,{waitUntil:'networkidle',timeout:30000});await waitLearned(page);await page.waitForTimeout(400);
  const e0=await page.locator('#elapsed').innerText(),o0=await page.locator('[data-qa="observation-title"]').innerText(),seq0=await page.locator('.sequence-svg .sequence-path').first().getAttribute('d');
  await page.waitForTimeout(450);
  const e1=await page.locator('#elapsed').innerText(),o1=await page.locator('[data-qa="observation-title"]').innerText(),seq1=await page.locator('.sequence-svg .sequence-path').first().getAttribute('d');
  report.interactions.live={elapsed0:e0,elapsed1:e1,plan0:o0,plan1:o1,sequenceChanged:seq0!==seq1};
  if(e0===e1)err('desktop: simulation clock did not advance');
  if(o0===o1)err('desktop: plan number did not advance over 450 ms');
  if(seq0===seq1)err('desktop: denoising sequence did not update with replanning');
  await inspect(page,'desktop');
  const readHorizon=()=>page.locator('[data-qa="horizon"]').evaluate(el=>({
    predictionCount:Number(el.dataset.predictionCount),executeCount:Number(el.dataset.executeCount),
    predictionSeconds:Number(el.dataset.predictionSeconds),executeSeconds:Number(el.dataset.executeSeconds),
    slots:el.querySelectorAll('.horizon-slot').length,discarded:el.querySelectorAll('.horizon-slot.discarded').length,
    current:el.querySelectorAll('.horizon-slot.current').length,note:el.querySelector('.horizon-note')?.textContent||'',
    plannedText:el.querySelector('.planned-window b')?.textContent||''
  }));
  // Latest cartpole-transformer v0.6 contract adapted for action chunks:
  // current plant + current plan cursor + next force are one atomic snapshot.
  const pauseAtomic=page.getByRole('button',{name:'Pause'});
  await pauseAtomic.click();await page.waitForTimeout(90);
  const stepAtomic=page.getByRole('button',{name:'Step 20 ms'});
  if(!(await stepAtomic.isEnabled().catch(()=>false)))err('atomic snapshot: Step 20 ms is not enabled while paused');
  let atomicBefore=await readAtomicSnapshot(page);verifyAtomicSnapshot(atomicBefore,'atomic pause');
  const tickLabel0=Number(await page.locator('#tickLabel').innerText());
  if(tickLabel0!==atomicBefore.tick)err('atomic pause: visible tick label != snapshot tick');

  const atomicTransitions=[];
  let replanObserved=false,current=atomicBefore;
  for(let i=0;i<4&&!replanObserved;i++){
    await stepAtomic.click();await page.waitForTimeout(70);
    const after=await readAtomicSnapshot(page);verifyAtomicSnapshot(after,'atomic step '+(i+1));
    const replanned=verifyAtomicTransition(current,after,'atomic transition '+(i+1));
    atomicTransitions.push({before:current,after,replanned});
    replanObserved=replanned;current=after;
  }
  if(!replanObserved)err('atomic snapshot: no replan observed within remaining four-action prefix');
  const tickLabel1=Number(await page.locator('#tickLabel').innerText());
  if(tickLabel1!==current.tick)err('atomic step: visible tick label != snapshot tick');
  report.interactions.atomicTick={before:atomicBefore,after:current,transitions:atomicTransitions,replanObserved};
  await page.screenshot({path:path.join(outDir,'desktop-atomic-step.jpg'),type:'jpeg',quality:84,fullPage:true});

  const runAtomic=page.getByRole('button',{name:'Run'});
  if(!(await runAtomic.isEnabled().catch(()=>false)))err('atomic snapshot: Run not enabled after stepping');
  else await runAtomic.click();
  await page.waitForTimeout(120);

  const x0=await page.locator('#rx').innerText();const push=page.getByRole('button',{name:'Push right'});await push.dispatchEvent('pointerdown');await page.waitForTimeout(260);await push.dispatchEvent('pointerup');await page.waitForTimeout(100);const x1=await page.locator('#rx').innerText();report.interactions.push={before:x0,after:x1,changed:x0!==x1};if(x0===x1)err('desktop: Push right did not change visible cart position');

  // Guided one-cycle walkthrough must freeze live control, expose each semantic stage,
  // apply exactly the first four forces, then resume live control on exit.
  const guide=page.getByRole('button',{name:'한 cycle 설명'});
  const beforeGuideTime=await page.locator('#elapsed').innerText();
  await guide.click();await page.waitForTimeout(120);
  const guideStart=await page.locator('#guideStep').innerText();
  const frozen0=await page.locator('#elapsed').innerText();await page.waitForTimeout(260);const frozen1=await page.locator('#elapsed').innerText();
  if(!guideStart.includes('1/6'))err('guided cycle: did not start at observation');
  if(frozen0!==frozen1)err('guided cycle: live physics did not freeze');
  if(await page.locator('[data-qa="observe"].guide-focus').count()!==1)err('guided cycle: observation is not focused at step 1');

  const conditioning=page.locator('[data-qa="conditioning-compare"]');
  if(!(await conditioning.isVisible()))err('guided conditioning: comparison panel is hidden at 1/6');
  const conditioningData=await conditioning.evaluate(el=>({
    sameNoise:el.dataset.sameNoise==='true',seed:Number(el.dataset.seed),
    plusTheta:Number(el.dataset.plusTheta),minusTheta:Number(el.dataset.minusTheta),
    meanAbsDiffN:Number(el.dataset.meanAbsDiffN),maxAbsDiffN:Number(el.dataset.maxAbsDiffN),
    plusFirstN:Number(el.dataset.plusFirstN),minusFirstN:Number(el.dataset.minusFirstN),
    historyStates:Number(el.dataset.historyStates),initialDelta:Number(el.dataset.initialDelta),
    firstUpdateDelta:Number(el.dataset.firstUpdateDelta),midDelta:Number(el.dataset.midDelta),
    finalDelta:Number(el.dataset.finalDelta),firstAfterT:Number(el.dataset.firstAfterT),
    paths:el.querySelectorAll('.conditioning-plus,.conditioning-minus').length,
    historyPaths:el.querySelectorAll('.conditioning-plus-history,.conditioning-minus-history').length,
    text:el.textContent||''
  }));
  if(!conditioningData.sameNoise||conditioningData.seed!==424242)err('guided conditioning: comparison does not use the fixed same-noise experiment');
  if(Math.abs(conditioningData.plusTheta-5*Math.PI/180)>1e-12||Math.abs(conditioningData.minusTheta+5*Math.PI/180)>1e-12)err('guided conditioning: theta intervention is not ±5 degrees');
  if(![conditioningData.meanAbsDiffN,conditioningData.maxAbsDiffN,conditioningData.plusFirstN,conditioningData.minusFirstN].every(Number.isFinite))err('guided conditioning: non-finite comparison values');
  if(conditioningData.meanAbsDiffN<=1e-4||conditioningData.maxAbsDiffN<=1e-4)err('guided conditioning: final plans did not differ under theta intervention');
  if(conditioningData.paths!==2)err('guided conditioning: expected two final-plan curves');
  if(conditioningData.historyStates!==20||conditioningData.historyPaths!==2)err('guided conditioning: expected two 20-state denoise trajectories');
  if(Math.abs(conditioningData.initialDelta)>1e-12)err('guided conditioning: fixed-noise trajectories do not start identically');
  if(conditioningData.firstAfterT!==90||conditioningData.firstUpdateDelta<=1e-6)err('guided conditioning: trajectories did not diverge after first t=95→90 update');
  if(!Number.isFinite(conditioningData.midDelta)||!Number.isFinite(conditioningData.finalDelta)||conditioningData.finalDelta<=1e-6)err('guided conditioning: divergence metrics invalid');
  if(!conditioningData.text.includes('첫 reverse update'))err('guided conditioning: first-update divergence explanation missing');
  if(!conditioningData.text.includes('condition'))err('guided conditioning: conditioning explanation missing');
  report.interactions.conditioning=conditioningData;

  const sampling=page.locator('[data-qa="sampling-compare"]');
  if(!(await sampling.isVisible()))err('guided sampling: comparison panel is hidden at 1/6');
  const samplingData=await sampling.evaluate(el=>({
    sameObservation:el.dataset.sameObservation==='true',
    observationTheta:Number(el.dataset.observationTheta),
    seedCount:Number(el.dataset.seedCount),
    seeds:(el.dataset.seeds||'').split(',').filter(Boolean).map(Number),
    initialSpread:Number(el.dataset.initialSpread),
    meanPairDiffN:Number(el.dataset.meanPairDiffN),
    maxPairDiffN:Number(el.dataset.maxPairDiffN),
    paths:el.querySelectorAll('.sampling-plan').length,
    text:el.textContent||''
  }));
  if(!samplingData.sameObservation)err('guided sampling: observation was not held fixed');
  if(Math.abs(samplingData.observationTheta-5*Math.PI/180)>1e-12)err('guided sampling: fixed observation theta is not +5 degrees');
  if(samplingData.seedCount!==3||samplingData.seeds.join(',')!=='10101,20202,30303')err('guided sampling: unexpected seed set');
  if(![samplingData.initialSpread,samplingData.meanPairDiffN,samplingData.maxPairDiffN].every(Number.isFinite))err('guided sampling: non-finite diversity metrics');
  if(samplingData.initialSpread<=1e-4||samplingData.meanPairDiffN<=1e-4||samplingData.maxPairDiffN<=1e-4)err('guided sampling: different seeds did not produce visible diversity');
  if(samplingData.paths!==3)err('guided sampling: expected three final-plan curves');
  if(!samplingData.text.includes('sampling diversity'))err('guided sampling: diversity label missing');
  if(!samplingData.text.includes('calibrated uncertainty'))err('guided sampling: uncertainty claim boundary missing');
  report.interactions.samplingDiversity=samplingData;
  await page.screenshot({path:path.join(outDir,'desktop-observation-experiments.jpg'),type:'jpeg',quality:84,fullPage:true});

  const next=page.getByRole('button',{name:'다음'});
  await next.click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('2/6'))err('guided cycle: random-start step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-noise"].guide-focus').count()!==1)err('guided cycle: random sequence not focused');
  if(await conditioning.isVisible())err('guided conditioning: comparison panel should hide after observation step');
  if(await sampling.isVisible())err('guided sampling: comparison panel should hide after observation step');
  if(await page.locator('[data-qa="denoise-timeline"]').isVisible())err('guided cycle: denoise timeline should be hidden at random-start');
  if(await page.locator('[data-qa="denoise-one-step"]').isVisible())err('guided cycle: one-step denoise panel should be hidden at random-start');

  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(100);
  if(!(await page.locator('#guideStep').innerText()).includes('3/6'))err('guided cycle: denoise step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-mid"].guide-focus').count()!==1)err('guided cycle: mid sequence not focused');
  const timeline=page.locator('[data-qa="denoise-timeline"]');
  const oneStep=page.locator('[data-qa="denoise-one-step"]');
  if(!(await timeline.isVisible()))err('guided cycle: 19-step denoise timeline is hidden');
  if(!(await oneStep.isVisible()))err('guided cycle: one-step denoise panel is hidden');

  const readTimeline=()=>timeline.evaluate(el=>({stepIndex:Number(el.dataset.stepIndex),actionIndex:Number(el.dataset.actionIndex),currentT:Number(el.dataset.currentT),nextT:Number(el.dataset.nextT),transitions:Number(el.dataset.transitions),points:el.querySelectorAll('.timeline-point').length,status:el.querySelector('.timeline-status')?.textContent||''}));
  const readOne=()=>oneStep.evaluate(el=>({currentT:Number(el.dataset.currentT),nextT:Number(el.dataset.nextT),actionIndex:Number(el.dataset.actionIndex),before:Number(el.dataset.beforeValue),noise:Number(el.dataset.noiseValue),after:Number(el.dataset.afterValue),paths:el.querySelectorAll('.update-before,.update-after').length,note:el.querySelector('.denoise-update-note')?.textContent||''}));
  const firstTimeline=await readTimeline(),firstOne=await readOne();
  if(firstTimeline.transitions!==19||firstTimeline.points!==20)err('guided denoise: expected 19 transitions and 20 candidate states');
  if(firstTimeline.stepIndex!==0||firstTimeline.currentT!==95||firstTimeline.nextT!==90)err('guided denoise: scrubber should start at t=95→90');
  if(firstOne.currentT!==95||firstOne.nextT!==90||firstOne.actionIndex!==0)err('guided denoise: one-step view is not linked to first scrubber update');

  const slider=timeline.locator('[data-denoise-scrubber]');
  const actionSelect=timeline.locator('[data-denoise-action]');
  const sliderMeta=await slider.evaluate(el=>({min:Number(el.min),max:Number(el.max),value:Number(el.value)}));
  if(sliderMeta.min!==0||sliderMeta.max!==18||sliderMeta.value!==0)err('guided denoise: scrubber range should be 0..18');

  await slider.evaluate(el=>{el.value='9';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(100);
  const midTimeline=await readTimeline(),midOne=await readOne();
  if(midTimeline.stepIndex!==9||midTimeline.currentT!==50||midTimeline.nextT!==45)err('guided denoise: scrubber step 10/19 should be t=50→45');
  if(midOne.currentT!==50||midOne.nextT!==45||midOne.actionIndex!==0)err('guided denoise: one-step view did not follow scrubber to t=50→45');

  await actionSelect.selectOption('3');await page.waitForTimeout(100);
  const actionTimeline=await readTimeline(),actionOne=await readOne();
  if(actionTimeline.actionIndex!==3||actionOne.actionIndex!==3)err('guided denoise: tracked action selection did not propagate to one-step view');
  if(![actionOne.before,actionOne.noise,actionOne.after].every(Number.isFinite))err('guided denoise: selected action contains non-finite values');
  if(Math.abs(actionOne.before-actionOne.after)<1e-12)err('guided denoise: selected action did not change across one update');
  if(actionOne.paths!==2||!actionOne.note.includes('force가 아닙니다'))err('guided denoise: one-step claim boundary or before/after paths missing');

  await slider.evaluate(el=>{el.value='18';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(100);
  const lastTimeline=await readTimeline(),lastOne=await readOne();
  if(lastTimeline.stepIndex!==18||lastTimeline.currentT!==5||lastTimeline.nextT!==0)err('guided denoise: final scrubber update should be t=5→0');
  if(lastOne.currentT!==5||lastOne.nextT!==0||lastOne.actionIndex!==3)err('guided denoise: one-step view did not follow final scrubber update');

  await slider.evaluate(el=>{el.value='9';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(80);
  await page.screenshot({path:path.join(outDir,'desktop-denoise-update.jpg'),type:'jpeg',quality:84,fullPage:true});
  report.interactions.denoiseScrubber={first:firstTimeline,mid:midTimeline,trackedAction:actionTimeline,last:lastTimeline,oneStep:actionOne};

  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('4/6'))err('guided cycle: final-plan step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-final"].guide-focus').count()!==1)err('guided cycle: final sequence not focused');
  if(await timeline.isVisible())err('guided cycle: denoise timeline should hide after denoise step');
  if(await oneStep.isVisible())err('guided cycle: one-step denoise panel should hide after denoise step');
  const horizonBefore=await readHorizon();
  if(horizonBefore.predictionCount!==16||horizonBefore.executeCount!==4||horizonBefore.slots!==16)err('guided horizon: final plan is not 16 actions with 4-action execution window');
  if(horizonBefore.discarded!==0)err('guided horizon: tail should not be discarded before execution');

  await page.getByRole('button',{name:'앞 4개 실제 적용'}).click();await page.waitForTimeout(80);
  const guideAppliedText=await page.locator('#guideStep').innerText();
  const explain=await page.locator('#guideExplain').innerText();
  const doneCount=await page.locator('[data-qa="exec-action"].done').count();
  const activeCount=await page.locator('[data-qa="exec-action"].active').count();
  if(!guideAppliedText.includes('5/6'))err('guided cycle: execution step missing');
  if(doneCount!==3||activeCount!==1)err('guided cycle: first four actions were not represented as 3 done + 1 active');
  if(!explain.includes('0.08 s'))err('guided cycle: physical execution explanation missing');
  if(await page.locator('[data-qa="act"].guide-focus').count()!==1)err('guided cycle: act stage not focused after execution');
  const horizonAfter=await readHorizon();
  if(horizonAfter.discarded!==12)err('guided horizon: old a[4]..a[15] tail should be marked discarded after execution');
  if(!horizonAfter.note.includes('old a[4]~a[15]'))err('guided horizon: discarded-tail explanation missing');
  await page.screenshot({path:path.join(outDir,'desktop-horizon.jpg'),type:'jpeg',quality:84,fullPage:true});

  await page.getByRole('button',{name:'다시 관측'}).click();await page.waitForTimeout(100);
  const reobserveText=await page.locator('#guideStep').innerText();
  if(!reobserveText.includes('6/6'))err('guided cycle: re-observation step missing');
  if(await page.locator('[data-qa="replan"].guide-focus').count()!==1)err('guided cycle: replan stage not focused');
  if(await page.locator('[data-qa="observe"].guide-focus').count()!==1)err('guided cycle: observation not refocused after execution');
  const compare=page.locator('#reobserveCompare');
  if(!(await compare.isVisible()))err('guided cycle: before/after comparison is hidden');
  const cells=compare.locator('.reobserve-cell');
  if(await cells.count()!==4)err('guided cycle: expected four before/after state cells');
  const statePairs=[];
  for(let i=0;i<4;i++){
    const nums=await cells.nth(i).locator('b').allInnerTexts();
    statePairs.push(nums.map(Number));
  }
  const changedStates=statePairs.filter(p=>p.length===2&&Math.abs(p[1]-p[0])>1e-9).length;
  if(changedStates<1)err('guided cycle: executed actions did not change any displayed plant state');

  const afterState=statePairs.map(p=>p[1]);
  const oldPlanTitle=await page.locator('[data-qa="observation-title"] b').innerText();
  await page.getByRole('button',{name:'다음 cycle'}).click();await page.waitForTimeout(120);
  const nextCycleText=await page.locator('#guideStep').innerText();
  const newPlanTitle=await page.locator('[data-qa="observation-title"] b').innerText();
  const nextObs=(await page.locator('[data-qa="observation-values"] b').allInnerTexts()).map(parseFloat);
  if(!nextCycleText.includes('1/6'))err('guided cycle: next cycle did not restart at observation');
  if(oldPlanTitle===newPlanTitle)err('guided cycle: next cycle did not generate a new plan');
  for(let i=0;i<4;i++)if(!Number.isFinite(nextObs[i])||Math.abs(nextObs[i]-afterState[i])>1e-9)err('guided cycle: next observation does not match prior after-state at index '+i);
  const horizonNext=await readHorizon();
  if(horizonNext.discarded!==0)err('guided horizon: next cycle should start with a fresh undiscarded 16-action plan');
  report.interactions.horizon={before:horizonBefore,after:horizonAfter,next:horizonNext};

  await page.getByRole('button',{name:'Live로 돌아가기'}).click();await page.waitForTimeout(260);
  const afterExit0=await page.locator('#elapsed').innerText();await page.waitForTimeout(260);const afterExit1=await page.locator('#elapsed').innerText();
  if(afterExit0===afterExit1)err('guided cycle: live control did not resume after exit');
  report.interactions.guidedCycle={start:guideStart,frozen:frozen0===frozen1,applied:guideAppliedText,reobserved:reobserveText,changedStates,afterState,nextCycle:nextCycleText,newPlan:oldPlanTitle!==newPlanTitle,doneCount,activeCount,resumed:afterExit0!==afterExit1,beforeGuideTime};

  await page.screenshot({path:path.join(outDir,'desktop.jpg'),type:'jpeg',quality:84,fullPage:true});
  await page.getByRole('button',{name:'Pause'}).click();const p0=await page.locator('#elapsed').innerText();await page.waitForTimeout(320);const p1=await page.locator('#elapsed').innerText();if(p0!==p1)err('desktop: Pause did not freeze clock');if(!(await page.getByRole('button',{name:'Step 20 ms'}).isEnabled().catch(()=>false)))err('desktop: Step 20 ms is disabled while paused');
  const adv=page.locator('[data-qa="advanced"] summary');await adv.click();await page.waitForTimeout(120);if(!(await page.locator('[data-qa="advanced"]').evaluate(e=>e.open)))err('desktop: Advanced did not open');
  await page.screenshot({path:path.join(outDir,'desktop-advanced.jpg'),type:'jpeg',quality:82,fullPage:true});
  if(browserErrors.length)err('desktop browser errors: '+browserErrors.join(' | '));report.interactions.consoleErrors=browserErrors;await page.close();
}
async function mobile(browser){
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  const browserErrors=[];page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});page.on('pageerror',e=>browserErrors.push(String(e)));
  await page.goto(baseURL,{waitUntil:'networkidle',timeout:30000});await waitLearned(page);await page.waitForTimeout(350);
  const d=await inspect(page,'mobile');
  const sc=await page.locator('.denoise-stages').evaluate(e=>({clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,overflowX:getComputedStyle(e).overflowX}));
  report.interactions.mobileSequenceScroller=sc;
  if(sc.scrollWidth>sc.clientWidth+2)err('mobile: denoise view still requires horizontal scrolling '+sc.scrollWidth+' > '+sc.clientWidth);
  if(d.mobileSequenceDisplay==='none')err('mobile: vertical denoise cards are hidden');
  if(d.desktopSequenceDisplay!=='none')err('mobile: desktop wide sequence should be hidden');
  if(d.mobileSequencePaths!==3)err('mobile: expected 3 vertical sequence paths, got '+d.mobileSequencePaths);

  await page.getByRole('button',{name:'한 cycle 설명'}).click();await page.waitForTimeout(100);
  const mobileConditioning=await page.locator('[data-qa="conditioning-compare"]').evaluate(el=>{
    const r=el.getBoundingClientRect();
    const fonts=[...el.querySelectorAll('b,span,small,em,p')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite);
    return {
      visible:!el.hidden&&r.width>0&&r.height>0,x:r.x,width:r.width,right:r.right,
      viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      seed:Number(el.dataset.seed),sameNoise:el.dataset.sameNoise==='true',
      meanAbsDiffN:Number(el.dataset.meanAbsDiffN),paths:el.querySelectorAll('.conditioning-plus,.conditioning-minus').length,
      historyStates:Number(el.dataset.historyStates),initialDelta:Number(el.dataset.initialDelta),
      firstUpdateDelta:Number(el.dataset.firstUpdateDelta),firstAfterT:Number(el.dataset.firstAfterT),
      historyPaths:el.querySelectorAll('.conditioning-plus-history,.conditioning-minus-history').length,
      minFont:fonts.length?Math.min(...fonts):null
    };
  });
  report.interactions.mobileConditioning=mobileConditioning;
  const mobileSampling=await page.locator('[data-qa="sampling-compare"]').evaluate(el=>{
    const r=el.getBoundingClientRect();
    const fonts=[...el.querySelectorAll('b,span,small,em,p')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite);
    return {
      visible:!el.hidden&&r.width>0&&r.height>0,x:r.x,width:r.width,right:r.right,
      viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      sameObservation:el.dataset.sameObservation==='true',seedCount:Number(el.dataset.seedCount),
      initialSpread:Number(el.dataset.initialSpread),meanPairDiffN:Number(el.dataset.meanPairDiffN),
      paths:el.querySelectorAll('.sampling-plan').length,minFont:fonts.length?Math.min(...fonts):null,
      text:el.textContent||''
    };
  });
  report.interactions.mobileSampling=mobileSampling;
  if(!mobileConditioning.visible)err('mobile conditioning: panel hidden at 1/6');
  if(!mobileSampling.visible)err('mobile sampling: panel hidden at 1/6');
  if(mobileSampling.scrollWidth>mobileSampling.viewport+2||mobileSampling.right>mobileSampling.viewport+2)err('mobile sampling: panel escapes viewport');
  if(!mobileSampling.sameObservation||mobileSampling.seedCount!==3)err('mobile sampling: fixed-observation/seed-count contract failed');
  if(!Number.isFinite(mobileSampling.initialSpread)||mobileSampling.initialSpread<=1e-4||!Number.isFinite(mobileSampling.meanPairDiffN)||mobileSampling.meanPairDiffN<=1e-4)err('mobile sampling: diversity metrics missing');
  if(mobileSampling.paths!==3)err('mobile sampling: expected three curves');
  if(!mobileSampling.text.includes('calibrated uncertainty'))err('mobile sampling: uncertainty claim boundary missing');
  if(mobileSampling.minFont!==null&&mobileSampling.minFont<10.5)err('mobile sampling: text too small '+mobileSampling.minFont+'px');
  if(mobileConditioning.scrollWidth>mobileConditioning.viewport+2||mobileConditioning.right>mobileConditioning.viewport+2)err('mobile conditioning: panel escapes viewport');
  if(!mobileConditioning.sameNoise||mobileConditioning.seed!==424242)err('mobile conditioning: same-noise contract missing');
  if(!Number.isFinite(mobileConditioning.meanAbsDiffN)||mobileConditioning.meanAbsDiffN<=1e-4)err('mobile conditioning: plan difference missing');
  if(mobileConditioning.paths!==2)err('mobile conditioning: expected two final-plan curves');
  if(mobileConditioning.historyStates!==20||mobileConditioning.historyPaths!==2)err('mobile conditioning: expected two 20-state denoise trajectories');
  if(Math.abs(mobileConditioning.initialDelta)>1e-12||mobileConditioning.firstAfterT!==90||mobileConditioning.firstUpdateDelta<=1e-6)err('mobile conditioning: first-update divergence contract failed');
  if(mobileConditioning.minFont!==null&&mobileConditioning.minFont<10.5)err('mobile conditioning: text too small '+mobileConditioning.minFont+'px');
  await page.screenshot({path:path.join(outDir,'mobile-observation-experiments.jpg'),type:'jpeg',quality:82,fullPage:true});
  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(60);
  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(100);
  const mobileGuideStep=await page.locator('#guideStep').innerText();
  const mobileTimeline=page.locator('[data-qa="denoise-timeline"]');
  const mobileOne=page.locator('[data-qa="denoise-one-step"]');
  if(!mobileGuideStep.includes('3/6'))err('mobile: guided denoise step did not reach 3/6');
  if(!(await mobileTimeline.isVisible()))err('mobile: denoise timeline is hidden');
  if(!(await mobileOne.isVisible()))err('mobile: one-step denoise panel is hidden');
  const mobileGuided=await page.evaluate(()=>{
    const timeline=document.querySelector('[data-qa="denoise-timeline"]'),panel=document.querySelector('[data-qa="denoise-one-step"]'),flow=document.querySelector('.denoise-update-flow');
    const tr=timeline?.getBoundingClientRect(),r=panel?.getBoundingClientRect();
    const minFont=el=>el?Math.min(...[...el.querySelectorAll('b,span,strong,small,p,label,button,select')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite)):null;
    return {
      scrollWidth:document.documentElement.scrollWidth,
      viewport:innerWidth,
      timeline:tr?{x:tr.x,width:tr.width,right:tr.right}:null,
      panel:r?{x:r.x,width:r.width,right:r.right}:null,
      cards:panel?.querySelectorAll('.update-card').length||0,
      gridTemplateColumns:flow?getComputedStyle(flow).gridTemplateColumns:'',
      timelineFont:minFont(timeline),
      panelFont:minFont(panel),
      transitions:Number(timeline?.dataset.transitions),
      points:timeline?.querySelectorAll('.timeline-point').length||0
    };
  });
  report.interactions.mobileGuidedDenoise={step:mobileGuideStep,...mobileGuided};
  if(mobileGuided.scrollWidth>mobileGuided.viewport+2)err('mobile guided denoise: page overflow '+mobileGuided.scrollWidth+' > '+mobileGuided.viewport);
  if(!mobileGuided.timeline||mobileGuided.timeline.right>mobileGuided.viewport+2)err('mobile guided denoise: timeline escapes viewport');
  if(!mobileGuided.panel||mobileGuided.panel.right>mobileGuided.viewport+2)err('mobile guided denoise: one-step panel escapes viewport');
  if(mobileGuided.transitions!==19||mobileGuided.points!==20)err('mobile guided denoise: timeline should show 19 transitions / 20 points');
  if(mobileGuided.cards!==4)err('mobile guided denoise: expected four update cards');
  if(mobileGuided.gridTemplateColumns.trim().split(/\s+/).length!==1)err('mobile guided denoise: update cards are not vertically stacked');
  if(mobileGuided.timelineFont!==null&&mobileGuided.timelineFont<10.5)err('mobile guided denoise: timeline text too small '+mobileGuided.timelineFont+'px');
  if(mobileGuided.panelFont!==null&&mobileGuided.panelFont<10.5)err('mobile guided denoise: panel text too small '+mobileGuided.panelFont+'px');
  const mobileSlider=mobileTimeline.locator('[data-denoise-scrubber]');
  await mobileSlider.evaluate(el=>{el.value='18';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(80);
  const mobileLast=await mobileTimeline.evaluate(el=>({stepIndex:Number(el.dataset.stepIndex),currentT:Number(el.dataset.currentT),nextT:Number(el.dataset.nextT)}));
  if(mobileLast.stepIndex!==18||mobileLast.currentT!==5||mobileLast.nextT!==0)err('mobile guided denoise: scrubber failed to reach final update');
  await page.screenshot({path:path.join(outDir,'mobile-denoise-update.jpg'),type:'jpeg',quality:82,fullPage:true});
  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(60);
  await page.getByRole('button',{name:'앞 4개 실제 적용'}).click();await page.waitForTimeout(90);
  const mobileHorizon=await page.locator('[data-qa="horizon"]').evaluate(el=>{
    const r=el.getBoundingClientRect(),track=el.querySelector('.horizon-track')?.getBoundingClientRect(),marker=el.querySelector('.reobserve-marker')?.getBoundingClientRect();
    const fonts=[...el.querySelectorAll('b,span,strong,em,p')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite);
    return {x:r.x,width:r.width,right:r.right,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      slots:el.querySelectorAll('.horizon-slot').length,discarded:el.querySelectorAll('.horizon-slot.discarded').length,
      markerRatio:track&&marker?((marker.x+marker.width/2)-track.x)/track.width:null,minFont:fonts.length?Math.min(...fonts):null};
  });
  report.interactions.mobileHorizon=mobileHorizon;
  if(mobileHorizon.scrollWidth>mobileHorizon.viewport+2||mobileHorizon.right>mobileHorizon.viewport+2)err('mobile horizon: layout escapes viewport');
  if(mobileHorizon.slots!==16||mobileHorizon.discarded!==12)err('mobile horizon: expected 16 slots and 12 discarded tail slots after execution');
  if(mobileHorizon.markerRatio===null||Math.abs(mobileHorizon.markerRatio-.25)>.025)err('mobile horizon: re-observation marker not at 25%');
  if(mobileHorizon.minFont!==null&&mobileHorizon.minFont<10.5)err('mobile horizon: text too small '+mobileHorizon.minFont+'px');
  await page.screenshot({path:path.join(outDir,'mobile-horizon.jpg'),type:'jpeg',quality:82,fullPage:true});
  await page.getByRole('button',{name:'Live로 돌아가기'}).click();await page.waitForTimeout(80);

  if(browserErrors.length)err('mobile browser errors: '+browserErrors.join(' | '));
  report.interactions.mobileConsoleErrors=browserErrors;
  await page.screenshot({path:path.join(outDir,'mobile.jpg'),type:'jpeg',quality:82,fullPage:true});await page.close();
}
let browser;
try{browser=await chromium.launch({headless:true});await desktop(browser);await mobile(browser);}
catch(e){err('unhandled visual QA exception: '+(e?.stack||String(e)));}
finally{if(browser)try{await browser.close()}catch{};fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
if(report.errors.length)process.exitCode=1;
