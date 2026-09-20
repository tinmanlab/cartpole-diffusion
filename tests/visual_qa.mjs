import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const nodeRequire=createRequire(import.meta.url);
const outDir=path.resolve('qa-output');fs.mkdirSync(outDir,{recursive:true});
const baseURL=process.env.QA_URL||'http://127.0.0.1:4173/';
const report={generatedAt:new Date().toISOString(),baseURL,errors:[],warnings:[],views:{},interactions:{}};
const err=m=>report.errors.push(m),warn=m=>report.warnings.push(m);
const rect=r=>r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)}:null;
async function waitLearned(page){await page.waitForFunction(()=>document.querySelector('#modelTag')?.textContent?.includes('learned'),null,{timeout:15000});}
// In-SVG <text> font-size is expressed in viewBox units, so a width:100% SVG shrinks its
// labels by (rendered width / viewBox width). getComputedStyle cannot see that; only the
// screen CTM can. Same 10.5px floor the HTML minCoreFont check uses.
const SVG_TEXT_MIN=10.5;
async function svgTextSizes(page){
  return page.evaluate(()=>[...document.querySelectorAll('svg text')].filter(t=>t.getClientRects().length).map(t=>{
    const m=t.getScreenCTM(),s=m?Math.sqrt(Math.abs(m.a*m.d-m.b*m.c)):1,css=parseFloat(getComputedStyle(t).fontSize);
    return{label:t.getAttribute('class')||t.id||'svg-text',css,scale:s,effective:css*s,text:(t.textContent||'').slice(0,24)};
  }).filter(r=>Number.isFinite(r.effective)));
}
function checkSvgText(list,label){
  const bad=list.filter(r=>r.effective<SVG_TEXT_MIN);
  if(bad.length)err(label+': in-SVG text renders below '+SVG_TEXT_MIN+'px effective — '+bad.map(b=>b.label+' '+b.effective.toFixed(2)+'px ("'+b.text+'")').join('; '));
  return{measured:list.length,minEffective:list.length?Math.min(...list.map(r=>r.effective)):null,offenders:bad.map(b=>({label:b.label,css:b.css,scale:Number(b.scale.toFixed(3)),effective:Number(b.effective.toFixed(2))}))};
}
async function checkPageWidth(page,label){
  const d=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
  if(d.scrollWidth>d.viewport+2)err(label+': page-level horizontal overflow '+d.scrollWidth+' > '+d.viewport);
  return d;
}
// The five contract widths, each walked through the guided states that mount the
// timeline / one-step / conditioning SVGs, since those only exist inside guided mode.
async function responsiveSweep(browser){
  const out={};
  for(const width of [320,390,768,1024,1440]){
    // reducedMotion:'reduce' makes the app's own reducedMotion() check use an instant
    // (behavior:"auto") scrollIntoView instead of "smooth", so geometry reads right after
    // an explicit nav click observe the settled layout instead of a mid-animation frame.
    const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
    const browserErrors=[];page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});page.on('pageerror',e=>browserErrors.push(String(e)));
    await page.goto(baseURL,{waitUntil:'networkidle',timeout:30000});await waitLearned(page);await page.waitForTimeout(350);
    const stages={};
    stages.live={...await checkPageWidth(page,'responsive '+width+' live'),svgText:checkSvgText(await svgTextSizes(page),'responsive '+width+' live')};
    await page.getByRole('button',{name:'한 cycle 설명'}).click();await page.waitForTimeout(180);
    stages.observe={...await checkPageWidth(page,'responsive '+width+' guided 1/6'),svgText:checkSvgText(await svgTextSizes(page),'responsive '+width+' guided 1/6')};
    const stageBtnHeights=await page.locator('.stage-btn').evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().height)));
    if(stageBtnHeights.some(h=>h<44))err('responsive '+width+': stage-nav button below 44px touch height ('+stageBtnHeights.join(',')+')');
    // Essential guide copy/explanation, stage labels, and the frozen-plan identity readout
    // must stay >=14px effective at every width, never shrink to fit.
    const guideTextSizes=await page.evaluate(()=>[...document.querySelectorAll('.guide-copy b,.guide-copy span,.guide-shared-label,.stage-btn,.stage-btn span,.guide-identity')]
      .filter(e=>e.getClientRects().length).map(e=>({sel:e.className||e.tagName,px:parseFloat(getComputedStyle(e).fontSize)})));
    const smallGuideText=guideTextSizes.filter(r=>r.px<13.9);
    if(smallGuideText.length)err('responsive '+width+': essential guide text below 14px effective — '+smallGuideText.map(r=>r.sel+' '+r.px+'px').join('; '));
    if(width<=760){
      const narrowGeometry=await page.evaluate(()=>{
        // Only the active .loop step / .loop-back is "guidebar-directed content" for the
        // ordering/overlap measurement — the plant card sits above the guide bar with its
        // own valid position and also carries guide-focus, so it must not be selected here.
        var bar=document.querySelector('[data-qa="guide-bar"]'),focus=document.querySelector('.loop .step.guide-focus,.loop-back.guide-focus');
        var br=bar?bar.getBoundingClientRect():null,fr=focus?focus.getBoundingClientRect():null;
        var stageBtns=[...document.querySelectorAll('.stage-btn')];
        var stageRects=stageBtns.map(function(e){var r=e.getBoundingClientRect();
          var cx=r.left+r.width/2,cy=r.top+r.height/2,hit=document.elementFromPoint(cx,cy);
          return{left:Math.round(r.left),right:Math.round(r.right),hitOk:!!hit&&e.contains(hit)};
        });
        var identity=document.querySelector('[data-qa="guide-identity"]'),ir=identity?identity.getBoundingClientRect():null;
        return{viewport:innerWidth,barPresent:!!bar,focusPresent:!!focus,barBottom:br?Math.round(br.bottom):null,focusTop:fr?Math.round(fr.top):null,stageRects:stageRects,identityRight:ir?Math.round(ir.right):null,identityLeft:ir?Math.round(ir.left):null};
      });
      if(!narrowGeometry.barPresent)err('responsive '+width+': guide bar not found for ordering/overlap measurement');
      if(!narrowGeometry.focusPresent)err('responsive '+width+': no active .loop step / .loop-back guide-focus target found');
      if(narrowGeometry.stageRects.some(r=>r.right>narrowGeometry.viewport+2||r.left<-2))err('responsive '+width+': a stage-nav button is squeezed outside the viewport bounds');
      if(narrowGeometry.stageRects.some(r=>!r.hitOk))err('responsive '+width+': a stage-nav button center is covered by another element (elementFromPoint mismatch)');
      if(narrowGeometry.identityRight!==null&&(narrowGeometry.identityRight>narrowGeometry.viewport+2||narrowGeometry.identityLeft<-2))err('responsive '+width+': guide-identity readout is squeezed outside the viewport bounds');
      if(narrowGeometry.barBottom!==null&&narrowGeometry.focusTop!==null){
        var narrowGap=narrowGeometry.focusTop-narrowGeometry.barBottom;
        if(narrowGap<0)err('responsive '+width+': guide bar overlaps the focused panel (gap '+narrowGap+'px)');
        if(narrowGap>60)err('responsive '+width+': giant blank gap between guide bar and focused panel ('+narrowGap+'px)');
      }
      if(width===320||width===390){
        // F1: the guide bar (copy + controls + stage nav + identity) must stay compact at
        // Calculation, the densest guided stage, well under the pre-fix ~539px it used to take.
        await page.locator('.stage-btn').nth(1).click();await page.waitForTimeout(120);
        const barHeight=await page.evaluate(()=>{
          const bar=document.querySelector('[data-qa="guide-bar"]');
          return bar?Math.round(bar.getBoundingClientRect().height):null;
        });
        if(barHeight===null)err('responsive '+width+' Calculation: guide bar not found for height measurement');
        else if(barHeight>440)err('responsive '+width+' Calculation: guide bar height '+barHeight+'px exceeds the 440px budget');
        if(width===320){
          // Viewport-truth screenshot at the narrowest contract width. Result requires a
          // real four-action apply, which mobile() already screenshots/geometry-checks at
          // 390 against the identical <=760px layout rule; duplicating that full apply
          // flow here would add cost without new coverage.
          await page.screenshot({path:path.join(outDir,'responsive-320-guide-calculation-viewport.jpg'),type:'jpeg',quality:84});
        }
        await page.locator('.stage-btn').nth(0).click();await page.waitForTimeout(80);
      }
    }
    await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(80);
    await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(180);
    if(!(await page.locator('#guideStep').innerText()).includes('3/6'))err('responsive '+width+': guided denoise step not reached');
    stages.denoise={...await checkPageWidth(page,'responsive '+width+' guided 3/6'),svgText:checkSvgText(await svgTextSizes(page),'responsive '+width+' guided 3/6')};

    // F1: the sampler-arithmetic recipe (.sampler-eq/.sampler-note/.sampler-details) has
    // scoped CSS -- verify actual computed geometry, not just that the elements exist.
    // Essential code/caveat text must stay >=14px effective, no clipping overflow, and the
    // recipe must read right after the sampler flow (before the optional 16-dim chart).
    const samplerGeom=await page.evaluate(()=>{
      const one=document.querySelector('[data-qa="denoise-one-step"]');
      if(!one)return null;
      const codes=[...one.querySelectorAll('.sampler-eq code')].map(c=>({fs:parseFloat(getComputedStyle(c).fontSize),overflow:getComputedStyle(c).overflow,lines:(()=>{const r=document.createRange();r.selectNodeContents(c);return r.getClientRects().length})(),clientW:c.clientWidth,scrollW:c.scrollWidth}));
      const headers=[...one.querySelectorAll('.sampler-eq b')].map(b=>parseFloat(getComputedStyle(b).fontSize));
      const clips=[...one.querySelectorAll('.sampler-clip')].map(p=>parseFloat(getComputedStyle(p).fontSize));
      const note=one.querySelector('.sampler-note');
      const math=one.querySelector('.denoise-sampler-math'),chart=one.querySelector('.denoise-update-chart');
      const order=math&&chart?(math.compareDocumentPosition(chart)&Node.DOCUMENT_POSITION_FOLLOWING?'math-before-chart':'chart-before-math'):'missing';
      return{codes,headers,clips,noteFs:note?parseFloat(getComputedStyle(note).fontSize):null,noteOverflow:note?getComputedStyle(note).overflow:null,order};
    });
    if(!samplerGeom)err('responsive '+width+': sampler-arithmetic recipe not found at the Denoise stage');
    else{
      if(samplerGeom.codes.some(c=>c.fs<13.9))err('responsive '+width+': sampler equation code below 14px effective — '+JSON.stringify(samplerGeom.codes));
      if(samplerGeom.codes.some(c=>c.overflow==='hidden'||c.scrollW>c.clientW+1))err('responsive '+width+': sampler equation text is clipped/overflow-hidden instead of wrapping — '+JSON.stringify(samplerGeom.codes));
      if(samplerGeom.headers.some(fs=>fs<13.9))err('responsive '+width+': sampler equation header below 14px effective — '+JSON.stringify(samplerGeom.headers));
      if(samplerGeom.clips.some(fs=>fs<13.9))err('responsive '+width+': sampler clip/result readout below 14px effective — '+JSON.stringify(samplerGeom.clips));
      if(samplerGeom.noteFs===null||samplerGeom.noteFs<13.9)err('responsive '+width+': sampler caveat note below 14px effective ('+samplerGeom.noteFs+'px)');
      if(samplerGeom.noteOverflow==='hidden')err('responsive '+width+': sampler caveat note is overflow-hidden');
      if(samplerGeom.order!=='math-before-chart')err('responsive '+width+': sampler recipe does not read right after the sampler flow, before the 16-dim chart ('+samplerGeom.order+')');
    }
    if(width===320||width===1440){
      const mathEl=page.locator('[data-qa="denoise-one-step"] .denoise-sampler-math');
      if(await mathEl.count()){
        const compactPath=path.join(outDir,'responsive-'+width+'-sampler-recipe-compact.jpg');
        await mathEl.screenshot({path:compactPath,type:'jpeg',quality:88});
        await mathEl.locator('.sampler-details summary').click();await page.waitForTimeout(60);
        const expandedPath=path.join(outDir,'responsive-'+width+'-sampler-recipe-expanded.jpg');
        await mathEl.screenshot({path:expandedPath,type:'jpeg',quality:88});
        (report.samplerRecipeScreenshots=report.samplerRecipeScreenshots||{})[width]={compact:compactPath,expanded:expandedPath};
      }
    }

    if(browserErrors.length)err('responsive '+width+' browser errors: '+browserErrors.join(' | '));
    out[width]=stages;await page.close();
  }
  report.responsive=out;
}
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
// Shared 14px/44px reference-disclosure contract check, used for the three closed-by-default
// <details> reference summaries (plan-explainer, sampling-compare, denoise-stages-details).
// Only valid while the target is actually rendered (not [hidden]) -- callers must check at
// the point in the flow where that disclosure is present.
async function checkDisclosureSummary(page,selector,label){
  const box=await page.locator(selector+'>summary').evaluate(el=>{const r=el.getBoundingClientRect();return{height:r.height,fontSize:parseFloat(getComputedStyle(el).fontSize)}});
  if(box.fontSize<14)err(label+': disclosure summary font-size below 14px ('+box.fontSize+'px)');
  if(box.height<44)err(label+': disclosure summary touch target below 44px ('+box.height+'px)');
  return box;
}
// Independent oracle for the diffusion schedule (T=100, S=.008 -- the same constants
// index.html declares), used only to crosscheck the app's own displayed coefficients;
// this never replaces or duplicates the app's real computation for rendering.
function alphaBarOracle(t,T=100,S=.008){const x=(t/T+S)/(1+S),f=Math.cos(x*Math.PI/2),f0=Math.cos((S/(1+S))*Math.PI/2);return Math.max(1e-5,Math.min(1,f*f/(f0*f0)))}
function fixedGaussian16Oracle(seed){
  let local=seed>>>0,sp=null,out=[];
  const rnd=()=>{local+=0x6D2B79F5;let a=local;a=Math.imul(a^a>>>15,a|1);a^=a+Math.imul(a^a>>>7,a|61);return((a^a>>>14)>>>0)/4294967296};
  while(out.length<16){
    if(sp!==null){out.push(sp);sp=null;continue}
    let u=0,v=0;while(!u)u=rnd();while(!v)v=rnd();
    const m=Math.sqrt(-2*Math.log(u));out.push(m*Math.cos(2*Math.PI*v));sp=m*Math.sin(2*Math.PI*v);
  }
  return out;
}
// Independent DDIM oracle -- never invoked by the app, only used to crosscheck the
// real in-page ddim() (window.__qaDiffusion.ddim, see index.html) from outside.
function ddimOracle(x,cur,prev,pred){
  const ac=alphaBarOracle(cur),ap=alphaBarOracle(prev),sc=Math.sqrt(ac),nc=Math.sqrt(1-ac),sp=Math.sqrt(ap),np=Math.sqrt(1-ap);
  const x0Raw=x.map((v,i)=>(v-nc*pred[i])/sc);
  const x0=x0Raw.map(v=>Math.max(-1.2,Math.min(1.2,v)));
  const next=x0.map((v,i)=>sp*v+np*pred[i]);
  return{x0,x0Raw,next,coef:{ac,ap,sc,nc,sp,np}};
}
// F3: displayed atoms are toPrecision(6), which switches to e-notation for very small/
// large magnitudes -- the parser must accept signed decimals and e+/-exponents, not just
// plain digits. Regression proves it against a synthetic string before it's trusted below.
const ATOM_RE=/-?\d+\.?\d*(?:[eE][+-]?\d+)?/g;
function parseAtoms(s){return[...s.matchAll(ATOM_RE)].map(m=>Number(m[0]))}
(function atomParserRegression(){
  const sample='≈ (-0.123456 − 0.997654×1.23456e-7) / 7.80213e-2 ≈ -1.23e+2';
  const expected=[-0.123456,0.997654,1.23456e-7,7.80213e-2,-1.23e+2];
  const got=parseAtoms(sample);
  if(got.length!==expected.length||!got.every((v,i)=>Math.abs(v-expected[i])<1e-12))
    err('atom-parser regression: signed-decimal/e-notation atom parsing failed — '+JSON.stringify({got,expected}));
})();
// F3: exercise the sampler recipe over all 19 real recorded denoising steps and the
// three sampled tracked actions (0/7/15), independently crosschecking every displayed
// coefficient/operand against the schedule oracle and the full scalar formula -- not
// just self-consistency within the page. Also confirms scrubbing/inspecting the guide,
// and opening/closing the full-coefficient details, never mutate the frozen plan/tick
// identity (read-only), and separately verifies every component of the actual recorded
// planHistory (not just the 3 tracked/displayed actions) against the independent oracle.
async function verifySamplerAllSteps(browser){
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const browserErrors=[];page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});page.on('pageerror',e=>browserErrors.push(String(e)));
  await page.goto(baseURL,{waitUntil:'networkidle',timeout:30000});await waitLearned(page);
  await page.getByRole('button',{name:'한 cycle 설명'}).click();await page.waitForTimeout(150);
  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(80);
  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(150);
  if(!(await page.locator('#guideStep').innerText()).includes('3/6'))err('sampler-all-steps: guided denoise step not reached');

  const slider=page.locator('[data-denoise-scrubber]');
  const actionSelect=page.locator('[data-denoise-action]');
  const oneStep=page.locator('[data-qa="denoise-one-step"]');
  const readOne=()=>oneStep.evaluate(el=>({
    currentT:Number(el.dataset.currentT),nextT:Number(el.dataset.nextT),
    before:Number(el.dataset.beforeValue),noise:Number(el.dataset.noiseValue),after:Number(el.dataset.afterValue),
    ac:Number(el.dataset.coefAc),ap:Number(el.dataset.coefAp),sc:Number(el.dataset.coefSc),
    nc:Number(el.dataset.coefNc),sp:Number(el.dataset.coefSp),np:Number(el.dataset.coefNp),
    x0Raw:Number(el.dataset.x0Raw),x0Clip:Number(el.dataset.x0Clip),clipped:el.dataset.clipped==='true',
    valuesText:[...el.querySelectorAll('.sampler-eq .sampler-values')].map(c=>c.textContent)
  }));
  const sig6=v=>Number(Number(v).toPrecision(6));

  const before=await readAtomicSnapshot(page);
  let anyClipped=false,combos=0;
  for(let step=0;step<19;step++){
    await slider.evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}))},step);
    await page.waitForTimeout(25);
    for(const actionIndex of [0,7,15]){
      await actionSelect.selectOption(String(actionIndex));
      await page.waitForTimeout(25);
      const d=await readOne();
      combos++;
      const label='sampler-all-steps step='+step+' action='+actionIndex;
      const acExp=alphaBarOracle(d.currentT),apExp=alphaBarOracle(d.nextT);
      if(!close(d.ac,acExp,1e-9)||!close(d.ap,apExp,1e-9))err(label+': displayed alpha_cur/alpha_prev does not match the independent schedule oracle — '+JSON.stringify({shown:{ac:d.ac,ap:d.ap},expected:{ac:acExp,ap:apExp}}));
      if(!close(d.sc,Math.sqrt(acExp),1e-9)||!close(d.nc,Math.sqrt(1-acExp),1e-9)||!close(d.sp,Math.sqrt(apExp),1e-9)||!close(d.np,Math.sqrt(1-apExp),1e-9))
        err(label+': displayed sqrt(alpha)/sqrt(1-alpha) coefficients do not match the independent schedule oracle');
      const x0RawExp=(d.before-d.nc*d.noise)/d.sc,x0ClipExp=Math.max(-1.2,Math.min(1.2,x0RawExp)),afterExp=d.sp*x0ClipExp+d.np*d.noise;
      if(!close(d.x0Raw,x0RawExp,1e-6))err(label+': clean estimate does not match the full scalar formula');
      if(!close(d.x0Clip,x0ClipExp,1e-9))err(label+': clipped estimate does not match clamp(clean estimate,-1.2,1.2)');
      if(!close(d.after,afterExp,1e-6))err(label+': next candidate does not match the full scalar formula');
      if(d.clipped)anyClipped=true;
      // F2/F3 atom-level check, extended to every step/action, not just one sample.
      const atomsEq1=parseAtoms(d.valuesText[0]),atomsEq2=parseAtoms(d.valuesText[1]);
      const expectEq1=[d.before,d.nc,d.noise,d.sc,d.x0Raw].map(sig6);
      const expectEq2=[d.sp,d.x0Clip,d.np,d.noise,d.after].map(sig6);
      if(atomsEq1.length!==5||!atomsEq1.every((v,i)=>Math.abs(v-expectEq1[i])<1e-9))err(label+': clean-estimate row atoms do not match source at 6 significant figures');
      if(atomsEq2.length!==5||!atomsEq2.every((v,i)=>Math.abs(v-expectEq2[i])<1e-9))err(label+': next-candidate row atoms do not match source at 6 significant figures');
    }
  }
  const after=await readAtomicSnapshot(page);
  if(after.tick!==before.tick||after.planNumber!==before.planNumber||after.planStartTick!==before.planStartTick||after.cursor!==before.cursor)
    err('sampler-all-steps: scrubbing/inspecting the denoise timeline changed the frozen plan/tick identity — '+JSON.stringify({before,after}));
  report.samplerAllSteps={combos,anyClippedInRealPlan:anyClipped};
  if(!anyClipped)warn('sampler-all-steps: the real captured plan has no clipped case across all 19 steps x 3 tracked actions (0/7/15) -- see samplerDeterministicRegression for a labelled synthetic clipped case');

  // F1: verify the actual recorded planHistory (produced by the real in-page ddim(), not
  // a copy) across ALL 19 denoise transitions x all 16 latent components -- not just the
  // 3 tracked actions sampled through the UI above.
  const fullHistory=await page.evaluate(()=>window.__qaDiffusion.getHistory().map(s=>({t:s.t,latent:s.latent,pred:s.pred,x0:s.x0,next:s.next})));
  if(fullHistory.length!==20)err('sampler-full-history: recorded planHistory does not have the expected 20 states (19 transitions + final plan), got '+fullHistory.length);
  else{
    let mismatches=0;
    for(let i=0;i<19;i++){
      const s=fullHistory[i],nextT=fullHistory[i+1].t,oracle=ddimOracle(s.latent,s.t,nextT,s.pred);
      for(let k=0;k<16;k++){
        if(!close(s.x0[k],oracle.x0[k],1e-9))mismatches++;
        if(!close(s.next[k],oracle.next[k],1e-9))mismatches++;
      }
    }
    if(mismatches)err('sampler-full-history: '+mismatches+' of 608 real recorded planHistory x0/next components (19 steps x 16 components x 2) diverge from the independent DDIM oracle');
    report.samplerFullHistoryCheck={steps:19,components:16,mismatches};
  }

  // F3: opening/closing the full-coefficient <details> is a pure display toggle and must
  // never change the frozen plan/tick identity; opened coefficient text must stay >=14px.
  const beforeDetails=await readAtomicSnapshot(page);
  const detailsSummary=oneStep.locator('.sampler-details summary'),details=oneStep.locator('.sampler-details');
  await detailsSummary.click();await page.waitForTimeout(60);
  if(!(await details.evaluate(el=>el.open)))err('sampler-details: clicking summary did not open the coefficient details');
  const detailsFont=await oneStep.locator('.sampler-details code').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  if(!(detailsFont>=13.9))err('sampler-details: opened coefficient text below 14px effective ('+detailsFont+'px)');
  const afterOpenSnapshot=await readAtomicSnapshot(page);
  if(JSON.stringify(beforeDetails)!==JSON.stringify(afterOpenSnapshot))err('sampler-details: opening coefficient details changed the frozen plan/tick snapshot');
  await detailsSummary.click();await page.waitForTimeout(60);
  if(await details.evaluate(el=>el.open))err('sampler-details: clicking summary again did not close the coefficient details');
  const afterCloseSnapshot=await readAtomicSnapshot(page);
  if(JSON.stringify(beforeDetails)!==JSON.stringify(afterCloseSnapshot))err('sampler-details: closing coefficient details changed the frozen plan/tick snapshot');

  if(browserErrors.length)err('sampler-all-steps browser errors: '+browserErrors.join(' | '));
  await page.close();
}
// F1: deterministic, clearly-labelled regression (NOT a physical rollout outcome) that
// calls the ACTUAL loaded page's ddim()/fixedGaussian16()/model.predict() (exposed
// read-only via window.__qaDiffusion in index.html) on fixed seeded noise -- one seed
// that naturally clips at t=95 and one that doesn't -- and compares the real result to
// the independent Node-side DDIM oracle, never to a hand-copied reimplementation.
async function verifySamplerDeterministicRegression(browser){
  const page=await browser.newPage({viewport:{width:800,height:600}});
  const browserErrors=[];page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});page.on('pageerror',e=>browserErrors.push(String(e)));
  await page.goto(baseURL,{waitUntil:'networkidle',timeout:30000});await waitLearned(page);
  nodeRequire('../app/tiny_denoiser.js');
  const nodeModel=await globalThis.CartPoleTinyDenoiser.load(baseURL+'artifacts/model.json');
  const obs=[0.1,-0.2,0.05,0.3];
  const cases=[{seed:11,label:'clipped'},{seed:30303,label:'unclipped'}];
  const regression=[];
  for(const c of cases){
    const real=await page.evaluate(({seed,obs})=>{
      const q=window.__qaDiffusion,x=q.fixedGaussian16(seed),pred=q.getModel().predict(x,95,obs),s=q.ddim(x,95,90,pred);
      return{x0:s.x0,x0Raw:s.x0Raw,next:s.next};
    },{seed:c.seed,obs});
    const x=fixedGaussian16Oracle(c.seed),pred=nodeModel.predict(x,95,obs),oracle=ddimOracle(x,95,90,pred);
    const isClipped=real.x0Raw.some(v=>Math.abs(v)>1.2);
    const x0Match=real.x0.every((v,i)=>close(v,oracle.x0[i],1e-9)),nextMatch=real.next.every((v,i)=>close(v,oracle.next[i],1e-9));
    if(c.label==='clipped'&&!isClipped)err('sampler-deterministic-regression ['+c.label+']: expected seed '+c.seed+' at t=95 to actually clip, it did not');
    if(c.label==='unclipped'&&isClipped)err('sampler-deterministic-regression ['+c.label+']: expected seed '+c.seed+' at t=95 to stay unclipped, it clipped');
    if(!x0Match||!nextMatch)err('sampler-deterministic-regression ['+c.label+', synthetic case, not a physical rollout]: the real in-page ddim()/fixedGaussian16()/model.predict() x0/next do not match the independent DDIM oracle for seed '+c.seed);
    regression.push({label:c.label,seed:c.seed,isClipped,x0Match,nextMatch});
    if(c.label==='clipped'&&isClipped){
      // Render the synthetic clipped case through the ACTUAL renderer (ControlLoopViz.
      // renderDenoiseUpdate) on a disposable scratch element -- removed after the shot,
      // never touching the live page's own plan/history -- clearly labelled synthetic.
      const clippedIndex=real.x0Raw.findIndex(v=>Math.abs(v)>1.2);
      await page.evaluate(({seed,obs,clippedIndex})=>{
        const q=window.__qaDiffusion,x=q.fixedGaussian16(seed),pred=q.getModel().predict(x,95,obs),s=q.ddim(x,95,90,pred);
        const synthetic=[
          {t:95,latent:x,pred:pred,x0:s.x0,x0Raw:s.x0Raw,coef:s.coef,next:s.next,caption:'synthetic regression'},
          {t:90,latent:s.next,pred:null,x0:s.next,next:s.next,caption:'synthetic regression next'}
        ];
        let scratch=document.getElementById('__qaScratchOneStep');
        if(!scratch){scratch=document.createElement('div');scratch.id='__qaScratchOneStep';scratch.className='denoise-one-step';document.body.appendChild(scratch)}
        window.ControlLoopViz.renderDenoiseUpdate(scratch,synthetic,95,clippedIndex);
        // The real renderer's own header says "실제 plan의" (the real plan's) regardless of
        // input -- true for the live app, false here, so label this synthetic shot loudly.
        const banner=document.createElement('div');
        banner.textContent='SYNTHETIC REGRESSION (seed '+seed+', fixed noise -- NOT the live captured plan)';
        banner.style.cssText='background:#fee2e2;color:#991b1b;font-weight:700;font-size:13px;padding:6px 10px;border-radius:6px;margin-bottom:8px;';
        scratch.insertBefore(banner,scratch.firstChild);
      },{seed:c.seed,obs,clippedIndex});
      const clippedShotPath=path.join(outDir,'sampler-deterministic-clipped-synthetic-regression.jpg');
      await page.locator('#__qaScratchOneStep').screenshot({path:clippedShotPath,type:'jpeg',quality:88});
      await page.evaluate(()=>{const el=document.getElementById('__qaScratchOneStep');if(el)el.remove()});
      regression[regression.length-1].screenshot=clippedShotPath;
    }
  }
  report.samplerDeterministicRegression={note:'real in-page ddim()/fixedGaussian16()/model.predict() on fixed seeded noise, checked against an independent Node-side DDIM oracle -- not a physical rollout outcome',cases:regression};
  if(browserErrors.length)err('sampler-deterministic-regression browser errors: '+browserErrors.join(' | '));
  await page.close();
}
// F1 test-sensitivity proof: inject a deliberate bug into the real in-page ddim() (in a
// disposable page scope only, restored in finally) and confirm the real-vs-oracle
// comparison above would actually catch it -- so a copied-oracle false-green can't recur.
async function verifySamplerMutationSensitivity(browser){
  const page=await browser.newPage({viewport:{width:800,height:600}});
  try{
    await page.goto(baseURL,{waitUntil:'networkidle',timeout:30000});await waitLearned(page);
    const obs=[0.1,-0.2,0.05,0.3],seed=11;
    const run=()=>page.evaluate(({seed,obs})=>{
      const q=window.__qaDiffusion,x=q.fixedGaussian16(seed),pred=q.getModel().predict(x,95,obs),s=q.ddim(x,95,90,pred);
      return{x0:s.x0,next:s.next};
    },{seed,obs});
    nodeRequire('../app/tiny_denoiser.js');
    const nodeModel=await globalThis.CartPoleTinyDenoiser.load(baseURL+'artifacts/model.json');
    const x=fixedGaussian16Oracle(seed),pred=nodeModel.predict(x,95,obs),oracle=ddimOracle(x,95,90,pred);

    const clean=await run();
    const cleanOk=clean.x0.every((v,i)=>close(v,oracle.x0[i],1e-9));
    if(!cleanOk)err('sampler-mutation-sensitivity: baseline real-vs-oracle comparison failed before any mutation was injected');

    await page.evaluate(()=>{
      const q=window.__qaDiffusion;
      q.__originalDdim=q.ddim;
      q.ddim=function(x,cur,prev,pred){const r=q.__originalDdim(x,cur,prev,pred);return Object.assign({},r,{x0:r.x0.map(function(v){return v+1})})};
    });
    let caught=false;
    try{
      const mutated=await run();
      caught=!mutated.x0.every((v,i)=>close(v,oracle.x0[i],1e-9));
    }finally{
      await page.evaluate(()=>{const q=window.__qaDiffusion;q.ddim=q.__originalDdim;delete q.__originalDdim});
    }
    if(!caught)err('sampler-mutation-sensitivity: an injected ddim() bug (x0+1) was NOT caught by the real-vs-oracle comparison -- the check has no teeth');
    report.samplerMutationSensitivity={cleanOk,caught};
  } finally { await page.close(); }
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
  d.boxes=Object.fromEntries(Object.entries(d.boxes).map(([k,v])=>[k,rect(v)]));
  d.svgText=checkSvgText(await svgTextSizes(page),name);
  report.views[name]=d;
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
  await checkDisclosureSummary(page,'[data-qa="plan-explainer"]','plan-explainer summary');
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

  // The repeated policy-plain/blackbox explanatory recap is a native closed-by-default
  // reference; opening/closing it (via the real summary click, not evaluate-open) must
  // never touch the atomic plant/plan snapshot. This must run while genuinely paused --
  // checking it during live running mode let the wait straddle the ~80ms replan boundary,
  // a test-precondition defect (not a product bug) that produced a false failure.
  const explainer=page.locator('[data-qa="plan-explainer"]'),explainerSummary=explainer.locator('summary');
  if(await explainer.evaluate(el=>el.open))err('desktop: policy-plain/blackbox recap should default to closed');
  const atomicBeforeExplainer=await readAtomicSnapshot(page);
  await explainerSummary.click();await page.waitForTimeout(60);
  if(!(await explainer.evaluate(el=>el.open)))err('desktop: clicking the recap summary did not open it');
  if(JSON.stringify(await readAtomicSnapshot(page))!==JSON.stringify(atomicBeforeExplainer))err('desktop: opening the policy-plain/blackbox recap changed the paused atomic snapshot');
  await explainerSummary.click();await page.waitForTimeout(60);
  if(await explainer.evaluate(el=>el.open))err('desktop: clicking the recap summary again did not close it');
  if(JSON.stringify(await readAtomicSnapshot(page))!==JSON.stringify(atomicBeforeExplainer))err('desktop: closing the policy-plain/blackbox recap changed the paused atomic snapshot');

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

  const pushBefore=await readAtomicSnapshot(page);const push=page.getByRole('button',{name:'Push right'});await push.dispatchEvent('pointerdown');await page.waitForTimeout(260);await push.dispatchEvent('pointerup');await page.waitForTimeout(100);const pushAfter=await readAtomicSnapshot(page);const pushDelta=Math.max(...pushAfter.sim.map((v,i)=>Math.abs(v-pushBefore.sim[i])));report.interactions.push={before:pushBefore.sim,after:pushAfter.sim,maxStateDelta:pushDelta,changed:pushDelta>1e-6};if(!(pushDelta>1e-6))err('desktop: Push right did not change full-precision plant state');

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

  // Common-stage nav (Input/Calculation/Action/Result) is a display-only overlay over the
  // real six-step engine: jumping stages must never advance physics or apply the prefix.
  const stageNav=page.locator('[data-qa="stage-nav"]'),guideIdentity=page.locator('[data-qa="guide-identity"]');
  if(!(await stageNav.isVisible()))err('stage nav: hidden at guided entry');
  if(!(await guideIdentity.isVisible())||!/tick/.test(await guideIdentity.innerText()))err('stage nav: identity readout missing plan/tick info');
  const stageBtn=i=>page.locator('.stage-btn').nth(i);
  if(!(await stageBtn(0).evaluate(el=>el.classList.contains('active'))))err('stage nav: Input stage not active at 1/6');
  if(!(await stageBtn(3).isDisabled()))err('stage nav: Result stage should be disabled before four actions execute');
  const tickAtStart=await page.locator('#tickLabel').innerText();
  await stageBtn(1).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('2/6'))err('stage nav: Calculation stage did not jump to 2/6');
  if((await page.locator('#tickLabel').innerText())!==tickAtStart)err('stage nav: Calculation stage jump advanced physics tick');
  await stageBtn(0).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('1/6'))err('stage nav: Input stage did not return to 1/6');
  if((await page.locator('#tickLabel').innerText())!==tickAtStart)err('stage nav: Input stage jump advanced physics tick');

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

  const sampling=page.locator('[data-qa="sampling-compare"]'),samplingSummary=sampling.locator('summary');
  if(!(await sampling.isVisible()))err('guided sampling: comparison panel is hidden at 1/6');
  await checkDisclosureSummary(page,'[data-qa="sampling-compare"]','sampling-compare summary');
  // Sampling diversity is now a native <details> reference: it must default closed, and
  // opening it (via the real summary click -- guide mode is paused here, so this is safe)
  // must never re-roll or otherwise change the underlying fixed-seed experiment. Close/reopen
  // round-trips and survives an unrelated idle wait (no periodic re-render silently resets it).
  if(await sampling.evaluate(el=>el.open))err('guided sampling: reference disclosure should default to closed at 1/6');
  const samplingIdentityBefore=await sampling.evaluate(el=>el.dataset.seeds+'|'+el.dataset.observationTheta);
  await samplingSummary.click();await page.waitForTimeout(60);
  if(!(await sampling.evaluate(el=>el.open)))err('guided sampling: clicking the summary did not open the disclosure');
  const samplingIdentityAfter=await sampling.evaluate(el=>el.dataset.seeds+'|'+el.dataset.observationTheta);
  if(samplingIdentityBefore!==samplingIdentityAfter)err('guided sampling: opening the closed reference changed the experiment identity');
  await page.waitForTimeout(150);
  if(!(await sampling.evaluate(el=>el.open)))err('guided sampling: disclosure did not stay open across an idle wait (persistence)');
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
  await samplingSummary.click();await page.waitForTimeout(60);
  if(await sampling.evaluate(el=>el.open))err('guided sampling: clicking the summary again did not close the disclosure');
  await samplingSummary.click();await page.waitForTimeout(60);
  if(!(await sampling.evaluate(el=>el.open)))err('guided sampling: reopening after close did not restore the disclosure');
  await page.screenshot({path:path.join(outDir,'desktop-observation-experiments.jpg'),type:'jpeg',quality:84,fullPage:true});

  const next=page.getByRole('button',{name:'다음'});
  await next.click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('2/6'))err('guided cycle: random-start step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-noise"].guide-focus').count()!==1)err('guided cycle: random sequence not focused');
  if(await conditioning.isVisible())err('guided conditioning: comparison panel should hide after observation step');
  if(await sampling.isVisible())err('guided sampling: comparison panel should hide after observation step');
  if(await page.locator('[data-qa="denoise-timeline"]').isVisible())err('guided cycle: denoise timeline should be hidden at random-start');
  if(await page.locator('[data-qa="denoise-one-step"]').isVisible())err('guided cycle: one-step denoise panel should be hidden at random-start');
  const stagesFolded=()=>page.evaluate(()=>{var d=document.querySelector('[data-qa="denoise-stages-details"]'),s=document.getElementById('denoiseStages');return{hidden:d?d.hidden:null,nested:!!(d&&d.contains(s))}});
  if((await stagesFolded()).nested)err('guided cycle: full 16-action stages should stay directly visible (not folded) at random-start');

  await page.getByRole('button',{name:'다음'}).click();await page.waitForTimeout(100);
  if(!(await page.locator('#guideStep').innerText()).includes('3/6'))err('guided cycle: denoise step missing');
  if(await page.locator('.sequence-svg [data-qa="sequence-mid"].guide-focus').count()!==1)err('guided cycle: mid sequence not focused');
  const timeline=page.locator('[data-qa="denoise-timeline"]');
  const oneStep=page.locator('[data-qa="denoise-one-step"]');
  if(!(await timeline.isVisible()))err('guided cycle: 19-step denoise timeline is hidden');
  if(!(await oneStep.isVisible()))err('guided cycle: one-step denoise panel is hidden');

  // While the single-update recipe/timeline is the focused view, the full 16-action stage
  // diagram becomes an optional native disclosure below it: default closed, and reopening it
  // must reveal the exact same live #denoiseStages node (never a second cloned renderer).
  const stagesCheck=await page.evaluate(()=>{
    var details=document.querySelector('[data-qa="denoise-stages-details"]');
    var stages=document.getElementById('denoiseStages');
    var insideBefore=!!(details&&details.contains(stages));
    var openBefore=details?details.open:null,hiddenBefore=details?details.hidden:null;
    var pathBefore=stages.querySelector('[data-qa="sequence-final"] .sequence-path')?.getAttribute('d')||null;
    if(details)details.open=true;
    var insideAfter=!!(details&&details.contains(stages));
    var pathAfter=stages.querySelector('[data-qa="sequence-final"] .sequence-path')?.getAttribute('d')||null;
    return{insideBefore,openBefore,hiddenBefore,pathBefore,insideAfter,pathAfter};
  });
  if(stagesCheck.hiddenBefore!==false)err('guided denoise: 16-action stages disclosure should be present (not hidden) while the recipe is active');
  if(stagesCheck.openBefore!==false)err('guided denoise: 16-action stages disclosure should default to closed while the recipe is active');
  if(!stagesCheck.insideBefore||!stagesCheck.insideAfter)err('guided denoise: #denoiseStages is not nested below the recipe inside its disclosure');
  if(!stagesCheck.pathBefore||stagesCheck.pathBefore!==stagesCheck.pathAfter)err('guided denoise: reopening the stages disclosure did not reveal the identical live plan node');
  await checkDisclosureSummary(page,'[data-qa="denoise-stages-details"]','denoise-stages-details summary');
  const stagesDetails=page.locator('[data-qa="denoise-stages-details"]'),stagesSummary=stagesDetails.locator('summary');
  await stagesSummary.click();await page.waitForTimeout(60);
  if(await stagesDetails.evaluate(el=>el.open))err('guided denoise: clicking the stages summary did not close the reopened disclosure');
  await stagesSummary.click();await page.waitForTimeout(60);
  if(!(await stagesDetails.evaluate(el=>el.open)))err('guided denoise: clicking the stages summary again did not reopen it');

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

  // Real DDIM sampler arithmetic: clean estimate = (candidate - sqrt(1-alpha_cur)*epsilon)
  // / sqrt(alpha_cur), clipped to +/-1.2; next = sqrt(alpha_prev)*clipped_estimate +
  // sqrt(1-alpha_prev)*epsilon. Read from the same native ddim() coefficients/unclipped
  // estimate recorded once in makePlan's history -- never a second sampler computed here.
  const readSampler=()=>oneStep.evaluate(el=>({
    currentT:Number(el.dataset.currentT),nextT:Number(el.dataset.nextT),
    ac:Number(el.dataset.coefAc),ap:Number(el.dataset.coefAp),sc:Number(el.dataset.coefSc),
    nc:Number(el.dataset.coefNc),sp:Number(el.dataset.coefSp),np:Number(el.dataset.coefNp),
    x0Raw:Number(el.dataset.x0Raw),x0Clip:Number(el.dataset.x0Clip),clipped:el.dataset.clipped,
    formulaCount:el.querySelectorAll('.sampler-eq .sampler-formula').length,
    formulaText:[...el.querySelectorAll('.sampler-eq .sampler-formula')].map(c=>c.textContent),
    valuesText:[...el.querySelectorAll('.sampler-eq .sampler-values')].map(c=>c.textContent),
    detailsOpen:el.querySelector('.sampler-details')?.open ?? null,
    text:el.textContent||''
  }));
  const sampler=await readSampler();
  // F2: cumulative schedule notation (ᾱ, not per-step α), the actual recorded t/t' (not
  // an adjacent t/t-1 fiction -- the real stride is 5), and the next formula explicitly
  // consuming the clipped estimate (x̂₀_clip), not an ambiguous raw x̂₀.
  if(!sampler.formulaText[0]?.includes('ᾱ_{'+sampler.currentT+'}'))err('guided denoise: clean-estimate formula does not label ᾱ with the actual current t='+sampler.currentT);
  if(!sampler.formulaText[1]?.includes('ᾱ_{'+sampler.nextT+'}')||!sampler.formulaText[1]?.includes('a_{'+sampler.nextT+'}'))err('guided denoise: next-candidate formula does not use the actual next t='+sampler.nextT+' (real stride, not an adjacent t-1 fiction)');
  if(!sampler.formulaText[1]?.includes('x̂₀_clip'))err('guided denoise: next-candidate formula does not explicitly consume the clipped clean estimate (x̂₀_clip)');
  if(![sampler.ac,sampler.ap,sampler.sc,sampler.nc,sampler.sp,sampler.np,sampler.x0Raw,sampler.x0Clip].every(Number.isFinite))
    err('guided denoise: sampler coefficients/unclipped estimate are not all finite numbers');
  if(Math.abs((actionOne.before-sampler.nc*actionOne.noise)/sampler.sc-sampler.x0Raw)>1e-6)
    err('guided denoise: displayed clean estimate does not match (candidate - sqrt(1-alpha_cur)*epsilon)/sqrt(alpha_cur)');
  if(Math.abs(Math.max(-1.2,Math.min(1.2,sampler.x0Raw))-sampler.x0Clip)>1e-9)
    err('guided denoise: displayed clipped estimate does not match clamp(clean estimate, -1.2, 1.2)');
  if(Math.abs(sampler.sp*sampler.x0Clip+sampler.np*actionOne.noise-actionOne.after)>1e-6)
    err('guided denoise: displayed next-candidate arithmetic does not reproduce sqrt(alpha_prev)*clipped_estimate + sqrt(1-alpha_prev)*epsilon');
  if(sampler.formulaCount!==2||sampler.valuesText.length!==2)err('guided denoise: sampler arithmetic (clean estimate and next-candidate equations) is not visibly shown as a symbolic identity plus a rounded-substitution row');
  if(sampler.detailsOpen!==false)err('guided denoise: full schedule-coefficient details is not a closed-by-default native <details>');
  if(!sampler.text.includes('±1.2')||!sampler.text.includes('±1')) err('guided denoise: intermediate +/-1.2 clip is not explicitly distinguished from the final plan +/-1 clip');
  if(!sampler.text.toLowerCase().includes('newton')) err('guided denoise: missing explicit note that epsilon/intermediate candidates are not Newtons');

  // F2: coefficients/operands are shown at 6 significant figures with '≈', not '=' --
  // at small sqrt(alpha_cur) (near t=95) a fixed-decimal rounding of the numerator can
  // move the displayed quotient far more than any single term's own rounding suggests.
  // No invented tolerance: each displayed atom is checked against its own true source
  // value rounded to the same 6 significant figures the app itself displays with.
  const sig6=v=>Number(Number(v).toPrecision(6));
  const atomsEq1=parseAtoms(sampler.valuesText[0]),atomsEq2=parseAtoms(sampler.valuesText[1]);
  const expectEq1=[actionOne.before,sampler.nc,actionOne.noise,sampler.sc,sampler.x0Raw].map(sig6);
  const expectEq2=[sampler.sp,sampler.x0Clip,sampler.np,actionOne.noise,actionOne.after].map(sig6);
  if(atomsEq1.length!==5||!atomsEq1.every((v,i)=>Math.abs(v-expectEq1[i])<1e-9))
    err('guided denoise: clean-estimate row atoms do not each match their source value at 6 significant figures — '+JSON.stringify({shown:atomsEq1,expected:expectEq1}));
  if(atomsEq2.length!==5||!atomsEq2.every((v,i)=>Math.abs(v-expectEq2[i])<1e-9))
    err('guided denoise: next-candidate row atoms do not each match their source value at 6 significant figures — '+JSON.stringify({shown:atomsEq2,expected:expectEq2}));

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
  if((await stagesFolded()).nested)err('guided cycle: full 16-action stages should return to directly visible (not folded) at final-plan');
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

  // Once the four actions are real, revisiting earlier common stages must not rewind
  // state or silently re-apply — physics only ever advances via the one explicit apply.
  const tickAfterApply=await page.locator('#tickLabel').innerText();
  if(await stageBtn(3).isDisabled())err('stage nav: Result stage still disabled after four actions executed');
  await stageBtn(1).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('2/6'))err('stage nav: post-apply Calculation jump did not reach 2/6');
  if((await page.locator('#tickLabel').innerText())!==tickAfterApply)err('stage nav: revisiting Calculation after apply rewound or re-advanced the tick');
  await stageBtn(3).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('6/6'))err('stage nav: Result stage did not reach 6/6');
  if((await page.locator('#tickLabel').innerText())!==tickAfterApply)err('stage nav: Result stage jump changed the physics tick');
  await stageBtn(2).click();await page.waitForTimeout(80);
  if(!(await page.locator('#guideStep').innerText()).includes('5/6'))err('stage nav: Action stage did not return to the post-apply 5/6 view');
  if((await page.locator('#tickLabel').innerText())!==tickAfterApply)err('stage nav: revisiting Action after apply re-executed the prefix');
  if((await page.locator('[data-qa="exec-action"].done').count())!==3)err('stage nav: revisiting Action lost the already-executed prefix state');

  // F1 regression: neither the old granular 이전/다음 stepper nor the new stage buttons
  // may rewind or re-apply the executed prefix once it is real. Walk Result -> oldPrev
  // -> oldPrev -> oldNext -> oldNext and require the exact atomic snapshot to be identical
  // at every stop.
  const preWalkSnapshot=await readAtomicSnapshot(page);
  await stageBtn(3).click();await page.waitForTimeout(60);
  if(!(await page.locator('#guideStep').innerText()).includes('6/6'))err('stage nav walk: Result step not reached before old Prev/Next walk');
  const guidePrevBtn=page.locator('#guidePrev'),guideNextBtn=page.locator('#guideNext');
  await guidePrevBtn.click();await page.waitForTimeout(60);
  await guidePrevBtn.click();await page.waitForTimeout(60);
  if(!(await page.locator('#guideStep').innerText()).includes('4/6'))err('stage nav walk: old Prev twice from 6/6 should land on 4/6');
  const afterOldPrev=await readAtomicSnapshot(page);
  if((await page.locator('[data-qa="exec-action"].done').count())!==3)err('stage nav walk: old Prev lost the already-executed prefix state');
  await guideNextBtn.click();await page.waitForTimeout(60);
  await guideNextBtn.click();await page.waitForTimeout(60);
  if(!(await page.locator('#guideStep').innerText()).includes('6/6'))err('stage nav walk: old Next twice from 4/6 should return to 6/6');
  const afterOldNext=await readAtomicSnapshot(page);
  const snapshotsMatch=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(!snapshotsMatch(preWalkSnapshot,afterOldPrev))err('stage nav walk: old Prev changed the atomic plant/plan snapshot (tick/state/applied prefix)');
  if(!snapshotsMatch(preWalkSnapshot,afterOldNext))err('stage nav walk: old Next changed the atomic plant/plan snapshot (tick/state/applied prefix)');
  await stageBtn(2).click();await page.waitForTimeout(60);
  const afterStageBack=await readAtomicSnapshot(page);
  if(!snapshotsMatch(preWalkSnapshot,afterStageBack))err('stage nav walk: stage-button navigation after the old-button walk changed the atomic snapshot');
  await stageBtn(3).click();await page.waitForTimeout(60);
  if(!(await page.locator('#guideStep').innerText()).includes('6/6'))err('stage nav walk: Result stage unreachable after old-button walk');
  if(!snapshotsMatch(preWalkSnapshot,await readAtomicSnapshot(page)))err('stage nav walk: final Result stage jump changed the atomic snapshot');
  await stageBtn(2).click();await page.waitForTimeout(60);

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

  // Deterministic side-by-side replay adapted from latest cartpole-transformer Compare mode.
  await page.locator('#replayModeBtn').click();await page.waitForTimeout(160);
  const replayLab=page.locator('[data-qa="replay-lab"]');
  if(!(await replayLab.isVisible()))err('replay: lab did not open');
  const visibleLearn=await page.locator('.learn-only').evaluateAll(els=>els.filter(el=>el.getClientRects().length>0&&getComputedStyle(el).display!=='none').length);
  if(visibleLearn!==0)err('replay: Learn content still visible in Replay mode ('+visibleLearn+')');
  const replayCards=page.locator('.replay-card');
  if(await replayCards.count()!==3)err('replay: expected three seed-stream cards');
  await page.locator('#replayRunBtn').click();await page.waitForTimeout(60);
  const replayTickLive=Number(await replayLab.getAttribute('data-current-tick'));
  if(!(replayTickLive>0&&replayTickLive<100))warn('replay: auto replay did not advance into early trace, got '+replayTickLive);

  const replaySlider=page.locator('#replaySlider');
  await replaySlider.evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(60);
  const initialReplay=await replayCards.evaluateAll(els=>els.map(el=>({state:el.dataset.state,seed:Number(el.dataset.baseSeed),disturbance:Number(el.dataset.disturbance)})));
  if(new Set(initialReplay.map(x=>x.state)).size!==1)err('replay: initial states are not identical');
  if(new Set(initialReplay.map(x=>x.seed)).size!==3)err('replay: base seed streams are not distinct');
  if(initialReplay.some(x=>x.disturbance!==0))err('replay: initial shared disturbance is not zero');

  await replaySlider.evaluate(el=>{el.value='81';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(60);
  const pulseReplay=await replayCards.evaluateAll(els=>els.map(el=>Number(el.dataset.disturbance)));
  if(pulseReplay.some(v=>v!==4))err('replay: tick 81 does not show shared +4 N disturbance: '+pulseReplay.join(','));

  await replaySlider.evaluate(el=>{el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(60);
  const splitReplay=await replayCards.evaluateAll(els=>els.map(el=>el.dataset.state));
  if(new Set(splitReplay).size<2)err('replay: seed streams have not diverged by tick 120');

  await page.locator('#replayEndBtn').click();await page.waitForTimeout(60);
  const finalTick=Number(await replayLab.getAttribute('data-current-tick'));
  const traceLength=Number(await replayLab.getAttribute('data-trace-length'));
  const finalMetrics=await replayCards.locator('.replay-metrics').allInnerTexts();
  const replayNote=await page.locator('.replay-note').innerText();
  if(finalTick!==500||traceLength!==501)err('replay: final tick/trace length contract failed '+finalTick+'/'+traceLength);
  if(finalMetrics.length!==3)err('replay: final raw metrics missing');
  if(!replayNote.includes('winner'))err('replay: no-ranking claim boundary missing');
  await page.screenshot({path:path.join(outDir,'desktop-seed-replay-final.jpg'),type:'jpeg',quality:84,fullPage:true});

  const replayButtonText=await page.locator('#replayRunBtn').innerText();
  if(replayButtonText!=='Replay')err('replay: completed trace does not expose Replay');
  await page.locator('#replayRunBtn').click();await page.waitForTimeout(140);
  await page.locator('#replayRunBtn').click();await page.waitForTimeout(50);
  const replayRestartTick=Number(await replayLab.getAttribute('data-current-tick'));
  if(!(replayRestartTick>0&&replayRestartTick<100))err('replay: Replay did not restart from tick 0');
  report.interactions.seedReplay={cards:await replayCards.count(),initialReplay,pulseTick:81,pulseReplay,divergenceTick:120,splitStates:splitReplay,finalTick,traceLength,replayRestartTick};

  await page.locator('#learnModeBtn').click();await page.waitForTimeout(80);
  if(await replayLab.isVisible())err('replay: Learn mode did not hide replay lab');
  const visibleLearnAfter=await page.locator('.learn-only').evaluateAll(els=>els.filter(el=>el.getClientRects().length>0&&getComputedStyle(el).display!=='none').length);
  if(visibleLearnAfter<1)err('replay: Learn mode did not restore Learn content');

  if(browserErrors.length)err('desktop browser errors: '+browserErrors.join(' | '));report.interactions.consoleErrors=browserErrors;await page.close();
}
async function mobile(browser){
  // Same determinism rationale as responsiveSweep: settle the guide-bar scroll
  // instantly so the geometry reads right after a nav click are never mid-animation.
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce'});
  const browserErrors=[];page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});page.on('pageerror',e=>browserErrors.push(String(e)));
  await page.goto(baseURL,{waitUntil:'networkidle',timeout:30000});await waitLearned(page);await page.waitForTimeout(350);
  if((await page.evaluate(()=>scrollY))!==0)err('mobile: page auto-scrolled on plain render before any explicit guide interaction');
  const d=await inspect(page,'mobile');
  const sc=await page.locator('.denoise-stages').evaluate(e=>({clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,overflowX:getComputedStyle(e).overflowX}));
  report.interactions.mobileSequenceScroller=sc;
  if(sc.scrollWidth>sc.clientWidth+2)err('mobile: denoise view still requires horizontal scrolling '+sc.scrollWidth+' > '+sc.clientWidth);
  if(d.mobileSequenceDisplay==='none')err('mobile: vertical denoise cards are hidden');
  if(d.desktopSequenceDisplay!=='none')err('mobile: desktop wide sequence should be hidden');
  if(d.mobileSequencePaths!==3)err('mobile: expected 3 vertical sequence paths, got '+d.mobileSequencePaths);

  await page.getByRole('button',{name:'한 cycle 설명'}).click();await page.waitForTimeout(180);
  // F3: on narrow width, the focused panel must be readable and the guide controls
  // reachable without scrolling through hundreds of px of dimmed prior sections; dimmed
  // sections are removed from layout (not merely faded), and the after-state/result
  // values are never among them since only guide-dim panels are hidden. Geometry, not
  // mere viewport intersection, since a clipped/overflowed element still "intersects".
  const readMobileGuideGeometry=()=>page.evaluate(()=>{
    var bar=document.querySelector('[data-qa="guide-bar"]');
    // Only the active .loop step / .loop-back is "guidebar-directed content" for the
    // ordering/overlap measurement — the plant card sits above the guide bar with its own
    // valid position and also carries guide-focus, so it must not be selected here.
    var focus=document.querySelector('.loop .step.guide-focus,.loop-back.guide-focus');
    var nav=document.querySelector('[data-qa="stage-nav"]');
    var br=bar?bar.getBoundingClientRect():null,fr=focus?focus.getBoundingClientRect():null,nr=nav?nav.getBoundingClientRect():null;
    var stageBtns=[...document.querySelectorAll('.stage-btn')];
    var stageRects=stageBtns.map(function(e){var r=e.getBoundingClientRect();
      var cx=r.left+r.width/2,cy=r.top+r.height/2,hit=document.elementFromPoint(cx,cy);
      return{h:Math.round(r.height),left:Math.round(r.left),right:Math.round(r.right),hitOk:!!hit&&e.contains(hit)};
    });
    var identity=document.querySelector('[data-qa="guide-identity"]'),ir=identity?identity.getBoundingClientRect():null;
    var dimmedVisible=[...document.querySelectorAll('.step.guide-dim,.loop-back.guide-dim')].filter(function(e){return e.getClientRects().length>0}).length;
    return{
      viewport:innerWidth,
      barPresent:!!bar,
      focusPresent:!!focus,
      barBottom:br?Math.round(br.bottom):null,
      focusTop:fr?Math.round(fr.top):null,
      focusInViewport:!!fr&&fr.top<innerHeight&&fr.bottom>0,
      navInViewport:!!nr&&nr.top<innerHeight&&nr.bottom>0,
      stageRects:stageRects,
      identityRight:ir?Math.round(ir.right):null,
      identityLeft:ir?Math.round(ir.left):null,
      dimmedVisible:dimmedVisible,
      scrollY:scrollY
    };
  });
  const mobileGuideFocus=await readMobileGuideGeometry();
  report.interactions.mobileGuideFocus=mobileGuideFocus;
  if(!mobileGuideFocus.barPresent)err('mobile: guide bar not found for ordering/overlap measurement');
  if(!mobileGuideFocus.focusPresent)err('mobile: no active .loop step / .loop-back guide-focus target found after guided entry');
  if(!mobileGuideFocus.focusInViewport)err('mobile: focused guide panel is not visible near the top of the viewport after guided entry');
  if(!mobileGuideFocus.navInViewport)err('mobile: stage nav / guide controls not reachable in viewport after guided entry');
  if(mobileGuideFocus.dimmedVisible!==0)err('mobile: dimmed (irrelevant) guide sections are still taking layout space instead of being hidden');
  if(mobileGuideFocus.stageRects.some(r=>r.right>mobileGuideFocus.viewport+2||r.left<-2))err('mobile: a stage-nav button is squeezed outside the viewport bounds');
  if(mobileGuideFocus.stageRects.some(r=>r.h<44))err('mobile: a stage-nav button is below the 44px touch height');
  if(mobileGuideFocus.stageRects.some(r=>!r.hitOk))err('mobile: a stage-nav button center is covered by another element (elementFromPoint mismatch)');
  if(mobileGuideFocus.identityRight!==null&&(mobileGuideFocus.identityRight>mobileGuideFocus.viewport+2||mobileGuideFocus.identityLeft<-2))err('mobile: guide-identity readout is squeezed outside the viewport bounds');
  if(mobileGuideFocus.barBottom!==null&&mobileGuideFocus.focusTop!==null){
    var gap=mobileGuideFocus.focusTop-mobileGuideFocus.barBottom;
    if(gap<0)err('mobile: guide bar overlaps/covers the focused panel (gap '+gap+'px)');
    if(gap>60)err('mobile: giant blank gap between guide bar and focused panel ('+gap+'px)');
  }
  await page.screenshot({path:path.join(outDir,'mobile-guide-entry-viewport.jpg'),type:'jpeg',quality:84});

  const mobileStageBtn=i=>page.locator('.stage-btn').nth(i);
  await mobileStageBtn(1).click();await page.waitForTimeout(120);
  if(!(await page.locator('#guideStep').innerText()).includes('2/6'))err('mobile: Calculation stage did not jump to 2/6');
  const mobileCalcGeometry=await readMobileGuideGeometry();
  report.interactions.mobileCalcGeometry=mobileCalcGeometry;
  if(!mobileCalcGeometry.barPresent||!mobileCalcGeometry.focusPresent)err('mobile Calculation stage: guide bar or active .loop step target missing');
  if(mobileCalcGeometry.stageRects.some(r=>r.right>mobileCalcGeometry.viewport+2||r.left<-2))err('mobile Calculation stage: a stage-nav button is squeezed outside the viewport bounds');
  if(mobileCalcGeometry.stageRects.some(r=>!r.hitOk))err('mobile Calculation stage: a stage-nav button center is covered by another element');
  if(mobileCalcGeometry.barBottom!==null&&mobileCalcGeometry.focusTop!==null){
    var calcGap=mobileCalcGeometry.focusTop-mobileCalcGeometry.barBottom;
    if(calcGap<0||calcGap>60)err('mobile Calculation stage: guide bar / focused panel gap out of range ('+calcGap+'px)');
  }
  await page.screenshot({path:path.join(outDir,'mobile-guide-calculation-viewport.jpg'),type:'jpeg',quality:84});
  await page.screenshot({path:path.join(outDir,'mobile-guide-calculation-full.jpg'),type:'jpeg',quality:84,fullPage:true});
  await mobileStageBtn(0).click();await page.waitForTimeout(80);
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
  // Sampling diversity is a native <details> reference on mobile too: confirm the default
  // fold, then open it explicitly -- collapsed content has no client rects, so the font-size
  // and layout checks below would otherwise silently no-op against an empty measurement.
  const samplingClosedByDefault=await page.locator('[data-qa="sampling-compare"]').evaluate(el=>el.tagName==='DETAILS'&&!el.open);
  if(!samplingClosedByDefault)err('mobile sampling: reference disclosure should default to closed at 1/6');
  await page.locator('[data-qa="sampling-compare"]').evaluate(el=>{el.open=true});await page.waitForTimeout(60);
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

  await mobileStageBtn(3).click();await page.waitForTimeout(120);
  if(!(await page.locator('#guideStep').innerText()).includes('6/6'))err('mobile: Result stage did not reach 6/6 after execution');
  const mobileResultGeometry=await readMobileGuideGeometry();
  report.interactions.mobileResultGeometry=mobileResultGeometry;
  if(!mobileResultGeometry.barPresent||!mobileResultGeometry.focusPresent)err('mobile Result stage: guide bar or active .loop step target missing');
  if(mobileResultGeometry.stageRects.some(r=>r.right>mobileResultGeometry.viewport+2||r.left<-2))err('mobile Result stage: a stage-nav button is squeezed outside the viewport bounds');
  if(mobileResultGeometry.stageRects.some(r=>!r.hitOk))err('mobile Result stage: a stage-nav button center is covered by another element');
  if(mobileResultGeometry.identityRight!==null&&(mobileResultGeometry.identityRight>mobileResultGeometry.viewport+2||mobileResultGeometry.identityLeft<-2))err('mobile Result stage: guide-identity readout squeezed outside the viewport bounds');
  if(mobileResultGeometry.barBottom!==null&&mobileResultGeometry.focusTop!==null){
    var resultGap=mobileResultGeometry.focusTop-mobileResultGeometry.barBottom;
    if(resultGap<0||resultGap>60)err('mobile Result stage: guide bar / focused panel gap out of range ('+resultGap+'px)');
  }
  await page.screenshot({path:path.join(outDir,'mobile-guide-result-viewport.jpg'),type:'jpeg',quality:84});
  await page.screenshot({path:path.join(outDir,'mobile-guide-result-full.jpg'),type:'jpeg',quality:84,fullPage:true});

  await page.getByRole('button',{name:'Live로 돌아가기'}).click();await page.waitForTimeout(80);
  if((await page.locator('[data-qa="observe"],[data-qa="plan"],[data-qa="act"],[data-qa="replan"]').evaluateAll(els=>els.filter(e=>e.getClientRects().length>0).length))!==4)err('mobile: not all control-loop panels returned to layout after exiting guided mode');

  await page.locator('#replayModeBtn').click();await page.waitForTimeout(140);
  const mobileReplay=page.locator('[data-qa="replay-lab"]'),mobileCards=page.locator('.replay-card');
  if(!(await mobileReplay.isVisible()))err('mobile replay: lab hidden');
  const mobileVisibleLearn=await page.locator('.learn-only').evaluateAll(els=>els.filter(el=>el.getClientRects().length>0&&getComputedStyle(el).display!=='none').length);
  if(mobileVisibleLearn!==0)err('mobile replay: Learn content still visible in Replay mode ('+mobileVisibleLearn+')');
  if(await mobileCards.count()!==3)err('mobile replay: expected three cards');
  const mobileReplayLayout=await page.evaluate(()=>{
    const lab=document.querySelector('[data-qa="replay-lab"]'),grid=document.querySelector('.replay-grid'),r=lab?.getBoundingClientRect();
    const fonts=lab?[...lab.querySelectorAll('b,span,strong,p,button')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Number.isFinite):[];
    return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,right:r?.right||0,columns:grid?getComputedStyle(grid).gridTemplateColumns:'',minFont:fonts.length?Math.min(...fonts):null};
  });
  if(mobileReplayLayout.scrollWidth>mobileReplayLayout.viewport+2||mobileReplayLayout.right>mobileReplayLayout.viewport+2)err('mobile replay: layout escapes viewport');
  if(mobileReplayLayout.columns.trim().split(/\s+/).length!==1)err('mobile replay: controller cards are not vertically stacked');
  if(mobileReplayLayout.minFont!==null&&mobileReplayLayout.minFont<10.5)err('mobile replay: text too small '+mobileReplayLayout.minFont+'px');
  await page.locator('#replayRunBtn').click();await page.waitForTimeout(40);
  const mobileReplaySlider=page.locator('#replaySlider');
  await mobileReplaySlider.evaluate(el=>{el.value='81';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(60);
  const mobilePulse=await mobileCards.evaluateAll(els=>els.map(el=>Number(el.dataset.disturbance)));
  if(mobilePulse.some(v=>v!==4))err('mobile replay: tick 81 shared disturbance mismatch '+mobilePulse.join(','));
  report.interactions.mobileSeedReplay={...mobileReplayLayout,cards:await mobileCards.count(),pulseTick:81,pulseDisturbances:mobilePulse};
  await page.screenshot({path:path.join(outDir,'mobile-seed-replay.jpg'),type:'jpeg',quality:82,fullPage:true});
  await page.locator('#learnModeBtn').click();await page.waitForTimeout(60);

  if(browserErrors.length)err('mobile browser errors: '+browserErrors.join(' | '));
  report.interactions.mobileConsoleErrors=browserErrors;
  await page.screenshot({path:path.join(outDir,'mobile.jpg'),type:'jpeg',quality:82,fullPage:true});await page.close();
}
let browser;
try{browser=await chromium.launch({headless:true});await desktop(browser);await mobile(browser);await responsiveSweep(browser);await verifySamplerAllSteps(browser);await verifySamplerDeterministicRegression(browser);await verifySamplerMutationSensitivity(browser);}
catch(e){err('unhandled visual QA exception: '+(e?.stack||String(e)));}
finally{if(browser)try{await browser.close()}catch{};fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
if(report.errors.length)process.exitCode=1;
