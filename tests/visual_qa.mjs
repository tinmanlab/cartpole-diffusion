import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const outDir=path.resolve('qa-output');fs.mkdirSync(outDir,{recursive:true});
const baseURL=process.env.QA_URL||'http://127.0.0.1:4173/';
const report={generatedAt:new Date().toISOString(),baseURL,errors:[],warnings:[],views:{},interactions:{}};
const err=m=>report.errors.push(m),warn=m=>report.warnings.push(m);
const rect=r=>r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)}:null;
async function waitLearned(page){await page.waitForFunction(()=>document.querySelector('#modelTag')?.textContent?.includes('learned'),null,{timeout:15000});}
async function inspect(page,name){
  const d=await page.evaluate(()=>{
    const pick=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const sels=['[data-qa="plant"]','[data-qa="controller"]','[data-qa="observe"]','[data-qa="plan"]','[data-qa="act"]','[data-qa="replan"]'];
    const boxes=Object.fromEntries(sels.map(s=>[s,pick(s)]));
    const core=[...document.querySelectorAll('.topbar strong,.card-head b,.step-head b,.step-head span,.obs-title b,.obs-title span,.obs-values span,.obs-values b,.obs-values small,.policy-plain,.blackbox span,.blackbox b,.sequence-guide b,.sequence-guide span,.sequence-title,.sequence-sub,.sequence-scale,.sequence-down,.sequence-plain,.mobile-seq-head b,.mobile-seq-head span,.mobile-seq-axis,.mobile-seq-arrow,.exec-now span,.exec-now strong,.exec-action span,.exec-action b,.exec-action small,.exec-rest,.loop-back')];
    const fonts=core.filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite);
    const overlap=(a,b)=>{if(!a||!b)return 0;return Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y))};
    const visibleCount=s=>[...document.querySelectorAll(s)].filter(e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden').length;
    return{viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},boxes,minCoreFont:fonts.length?Math.min(...fonts):null,plantControllerOverlap:overlap(boxes[sels[0]],boxes[sels[1]]),sequencePaths:visibleCount('.sequence-svg .sequence-path'),executePoints:visibleCount('.execute-point'),executeBands:visibleCount('.execute-band'),obsValues:document.querySelectorAll('[data-qa="observation-values"]>div').length,execActions:document.querySelectorAll('[data-qa="exec-action"]').length,advancedOpen:document.querySelector('[data-qa="advanced"]')?.open||false,desktopSequenceDisplay:getComputedStyle(document.querySelector('.sequence-svg')).display,mobileSequenceDisplay:getComputedStyle(document.querySelector('[data-qa="mobile-sequence"]')).display,mobileSequencePaths:visibleCount('.mobile-sequence-path')};
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

  const next=page.getByRole('button',{name:'다음'});
  await next.click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('2/6'))err('guided cycle: random-start step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-noise"].guide-focus').count()!==1)err('guided cycle: random sequence not focused');

  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('3/6'))err('guided cycle: denoise step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-mid"].guide-focus').count()!==1)err('guided cycle: mid sequence not focused');

  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('4/6'))err('guided cycle: final-plan step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-final"].guide-focus').count()!==1)err('guided cycle: final sequence not focused');

  await page.getByRole('button',{name:'앞 4개 실제 적용'}).click();await page.waitForTimeout(80);
  const guideAppliedText=await page.locator('#guideStep').innerText();
  const explain=await page.locator('#guideExplain').innerText();
  const doneCount=await page.locator('[data-qa="exec-action"].done').count();
  const activeCount=await page.locator('[data-qa="exec-action"].active').count();
  if(!guideAppliedText.includes('5/6'))err('guided cycle: execution step missing');
  if(doneCount!==3||activeCount!==1)err('guided cycle: first four actions were not represented as 3 done + 1 active');
  if(!explain.includes('0.08 s'))err('guided cycle: physical execution explanation missing');
  if(await page.locator('[data-qa="act"].guide-focus').count()!==1)err('guided cycle: act stage not focused after execution');

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

  await page.getByRole('button',{name:'Live로 돌아가기'}).click();await page.waitForTimeout(260);
  const afterExit0=await page.locator('#elapsed').innerText();await page.waitForTimeout(260);const afterExit1=await page.locator('#elapsed').innerText();
  if(afterExit0===afterExit1)err('guided cycle: live control did not resume after exit');
  report.interactions.guidedCycle={start:guideStart,frozen:frozen0===frozen1,applied:guideAppliedText,reobserved:reobserveText,changedStates,afterState,nextCycle:nextCycleText,newPlan:oldPlanTitle!==newPlanTitle,doneCount,activeCount,resumed:afterExit0!==afterExit1,beforeGuideTime};

  await page.screenshot({path:path.join(outDir,'desktop.jpg'),type:'jpeg',quality:84,fullPage:true});
  await page.getByRole('button',{name:'Pause'}).click();const p0=await page.locator('#elapsed').innerText();await page.waitForTimeout(320);const p1=await page.locator('#elapsed').innerText();if(p0!==p1)err('desktop: Pause did not freeze clock');
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
  if(browserErrors.length)err('mobile browser errors: '+browserErrors.join(' | '));
  report.interactions.mobileConsoleErrors=browserErrors;
  await page.screenshot({path:path.join(outDir,'mobile.jpg'),type:'jpeg',quality:82,fullPage:true});await page.close();
}
let browser;
try{browser=await chromium.launch({headless:true});await desktop(browser);await mobile(browser);}
catch(e){err('unhandled visual QA exception: '+(e?.stack||String(e)));}
finally{if(browser)try{await browser.close()}catch{};fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
if(report.errors.length)process.exitCode=1;
