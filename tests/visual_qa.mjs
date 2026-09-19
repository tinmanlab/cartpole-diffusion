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
    return{viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},boxes,minCoreFont:fonts.length?Math.min(...fonts):null,plantControllerOverlap:overlap(boxes[sels[0]],boxes[sels[1]]),sequencePaths:document.querySelectorAll('.sequence-path').length,executePoints:document.querySelectorAll('.execute-point').length,executeBands:document.querySelectorAll('.execute-band').length,obsValues:document.querySelectorAll('[data-qa="observation-values"]>div').length,execActions:document.querySelectorAll('[data-qa="exec-action"]').length,advancedOpen:document.querySelector('[data-qa="advanced"]')?.open||false,desktopSequenceDisplay:getComputedStyle(document.querySelector('.sequence-svg')).display,mobileSequenceDisplay:getComputedStyle(document.querySelector('[data-qa="mobile-sequence"]')).display,mobileSequencePaths:document.querySelectorAll('.mobile-sequence-path').length};
  });
  d.boxes=Object.fromEntries(Object.entries(d.boxes).map(([k,v])=>[k,rect(v)]));report.views[name]=d;
  if(d.document.scrollWidth>d.viewport.width+2)err(name+': page-level horizontal overflow '+d.document.scrollWidth+' > '+d.viewport.width);
  if(d.minCoreFont!==null&&d.minCoreFont<10.5)err(name+': core text too small '+d.minCoreFont+'px');
  if(d.plantControllerOverlap>4)err(name+': plant/controller overlap '+Math.round(d.plantControllerOverlap));
  if(d.sequencePaths!==3)err(name+': expected 3 denoising sequence paths, got '+d.sequencePaths);
  if(d.executePoints!==4||d.executeBands!==1)err(name+': execute-region markers incorrect');
  if(d.obsValues!==4)err(name+': observation card count '+d.obsValues);
  if(d.execActions!==4)err(name+': execution card count '+d.execActions);
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
