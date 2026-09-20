/* Real learned-model/browser regression; no mocked policy or physics. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const url=process.env.QA_URL||'http://127.0.0.1:4173/';
const out=path.resolve('qa-output/conditioning-experiment');
fs.mkdirSync(out,{recursive:true});
const report={url,mode:process.env.QA_OFFLINE?'in-memory artifact (not HTTP)':'HTTP',checks:[],errors:[],widths:[]};
function check(name,condition,detail){assert.ok(condition,`${name}: ${JSON.stringify(detail)}`);report.checks.push(name);}
const nativeSnapshot=page=>page.locator('#plantCard').evaluate(el=>JSON.stringify(el.dataset));
const experiment=page=>page.locator('#conditioningExperimentTools').evaluate(el=>el.dataset.snapshot?JSON.parse(el.dataset.snapshot):null);
async function tab(page,n){await page.locator('.stage-btn').nth(n).click();}
async function setDelta(page,value){await page.locator('#conditioningDelta').fill(String(value));await page.locator('#conditioningDelta').dispatchEvent('input');}
// F2 geometry regression: independently re-derive the expected screen x for a given plan
// index from the SVG's own screen CTM (never a guessed/hardcoded percentage), then compare
// the actual marker line, dots, and HTML label against it. Edge indices (0 and length-1) are
// checked for "not clipped" instead of "centered on x", since the label anchors to its own
// side there by design (see conditioningMarkerTagStyle in control_loop_viz.js).
async function markerGeometry(page,index,length){
  await page.locator('#conditioningAction').selectOption(String(index));
  return page.evaluate(([index,length])=>{
    const svg=document.querySelector('#conditioningCompare .conditioning-chart svg');
    const ctm=svg.getScreenCTM();
    const pt=svg.createSVGPoint();
    const toScreenX=(svgX,svgY)=>{pt.x=svgX;pt.y=svgY;return pt.matrixTransform(ctm).x;};
    const x0=34,plotWidth=692;
    const expectedScreenX=toScreenX(x0+index/(length-1)*plotWidth,10);
    const lr=svg.querySelector('.conditioning-marker-line').getBoundingClientRect();
    const dots=[...svg.querySelectorAll('.conditioning-marker-dot')].map(c=>{const r=c.getBoundingClientRect();return r.x+r.width/2});
    const tag=document.querySelector('#conditioningCompare .conditioning-marker-tag');
    const tr=tag.getBoundingClientRect(),pr=tag.parentElement.getBoundingClientRect();
    return{expectedScreenX,lineX:lr.x+lr.width/2,dots,tagLeft:tr.x,tagRight:tr.right,tagCenter:(tr.x+tr.right)/2,parentLeft:pr.x,parentRight:pr.right};
  },[index,length]);
}
function checkMarkerGeometry(page,check,width,index,length){
  return markerGeometry(page,index,length).then(g=>{
    const tol=2.5;
    check(`${width}px a[${index}]: marker line aligns to the real plot x-coordinate`,Math.abs(g.lineX-g.expectedScreenX)<=tol,g);
    check(`${width}px a[${index}]: both A/B dots align to the real plot x-coordinate`,g.dots.length===2&&g.dots.every(x=>Math.abs(x-g.expectedScreenX)<=tol),g);
    check(`${width}px a[${index}]: label never clips its plotting container`,g.tagLeft>=g.parentLeft-1&&g.tagRight<=g.parentRight+1,g);
    if(index>0&&index<length-1)check(`${width}px a[${index}]: interior label stays centred on the real plot x-coordinate`,Math.abs(g.tagCenter-g.expectedScreenX)<=tol+4,g);
  });
}
(async()=>{
 let browser,page;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>report.errors.push(String(e)));
  if(process.env.QA_OFFLINE){
   const root=path.resolve(__dirname,'..');
   await page.route('**/*',route=>{
    const req=new URL(route.request().url()),file=path.resolve(root,'.'+req.pathname);
    if(req.origin!=='https://cartpole.test'||!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.abort();
    const type=file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'text/plain';
    return route.fulfill({body:fs.readFileSync(file),contentType:type});
   });
   await page.setContent(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="https://cartpole.test/">'),{waitUntil:'networkidle'});
  }else await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.getElementById('modelTag').textContent.startsWith('learned'));
  await page.locator('#guideBtn').click();
  check('Opt-in input experiment is present',await page.locator('#conditioningExperimentTools').count()===1);
  await page.locator('#conditioningExperimentTools > summary').click();
  const before=await nativeSnapshot(page);
  await page.locator('#captureConditioning').click();
  let c=await experiment(page);
  check('Captured observation is the actual frozen plan observation',JSON.stringify(c.obs)===JSON.stringify(JSON.parse(before).planObservation.split(',').map(Number)));
  check('Base plan reproduces the real guide plan',c.base.plan.every((v,i)=>Math.abs(v-c.sourcePlan[i])<1e-12));
  check('Zero change reproduces all sixteen actions',JSON.stringify(c.pair.plusPlan)===JSON.stringify(c.pair.minusPlan));
  check('Exact starting latent is shared',JSON.stringify(c.pair.plusHistory[0].latent)===JSON.stringify(c.pair.minusHistory[0].latent));
  check('Capture never changes native plant, plan identity, cursor',before===await nativeSnapshot(page));
  const fields=['0','1','2','3'];
  for(const field of fields){
   await page.locator('#conditioningField').selectOption(field);
   const zero=await experiment(page);
   check(`Field ${field}: changing field resets delta to zero`,zero.delta===0);
   await setDelta(page,field==='2'?3:0.2);
   c=await experiment(page);
   const changed=c.pair.plusObs.map((v,i)=>v!==c.pair.minusObs[i]?i:null).filter(v=>v!==null);
   check(`Field ${field}: exactly one observation component changes`,JSON.stringify(changed)===JSON.stringify([Number(field)]),changed);
   check(`Field ${field}: base snapshot and noise stay fixed`,JSON.stringify(c.pair.plusHistory[0].latent)===JSON.stringify(c.pair.minusHistory[0].latent));
   check(`Field ${field}: live state unchanged`,before===await nativeSnapshot(page));
   check(`Field ${field}: actual model produces finite plans`,c.pair.minusPlan.length===16&&c.pair.minusPlan.every(Number.isFinite));
   check(`Field ${field}: exactly 19 sampler updates, not physics ticks`,c.pair.minusHistory.length===20&&c.pair.minusHistory[0].t===95&&c.pair.minusHistory.at(-1).t===0);
  }
  await page.locator('#conditioningField').selectOption('2');await setDelta(page,3);
  c=await experiment(page);
  check('Degree slider converts to radians once',Math.abs(c.pair.minusObs[2]-c.obs[2]-3*Math.PI/180)<1e-12);
  check('Nonzero angle change can affect final plan',c.pair.minusPlan.some((v,i)=>Math.abs(v-c.pair.plusPlan[i])>1e-8));
  await page.locator('#conditioningAction').selectOption('7');
  const scale=Number(await page.locator('#conditioningCompare').getAttribute('data-force-scale-n'));
  check('A and B use one shared nonclipping force scale',c.pair.plusPlan.concat(c.pair.minusPlan).every(v=>Math.abs(v)*10<=scale));
  check('Selected future action changes the trace, not the plan',await page.locator('#conditioningCompare').getAttribute('data-action-index')==='7'&&before===await nativeSnapshot(page));
  // F2: native <select> options must never rely on a truncatable time suffix; the full
  // relative plan time lives in a visible sibling element instead.
  check('Action option text is the short index only, not truncatable',await page.locator('#conditioningAction option[value="7"]').innerText()==='a[7]');
  check('Full relative plan time is shown outside the select',(await page.locator('#conditioningActionTime').innerText())==='a[7] = plan 시작 후 +0.14 s');
  check('Action-time readout is real 14px HTML, not a tooltip',await page.locator('#conditioningActionTime').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=14);
  // F2: selected action must be visibly marked on the A/B final-plan chart, by real x-position.
  check('Chart marks the selected action with its own HTML label',await page.locator('#conditioningCompare .conditioning-marker-tag').innerText()==='a[7]');
  check('Chart carries plus/minus marker dots for the selected action',await page.locator('#conditioningCompare .conditioning-marker-dot').count()===2);
  await checkMarkerGeometry(page,check,1440,7,16);
  await checkMarkerGeometry(page,check,1440,0,16);
  await checkMarkerGeometry(page,check,1440,15,16);
  await page.locator('#conditioningAction').selectOption('7');
  // F3: the final-command axis is the physical ±MAXF Newton scale, fixed regardless of delta,
  // never the internal normalized latent axis, and never silently renormalized by an edit.
  check('Default force scale is the fixed physical ±10N axis, not autoscaled',scale===10);
  check('Axis is not flagged as an expanded rescale under normal (in-range) deltas',await page.locator('#conditioningCompare').getAttribute('data-rescaled')==='false');
  for(const delta of [0.5,4,-2]){
    await setDelta(page,delta);
    const afterEdit=await experiment(page);
    check(`Editing delta to ${delta} keeps the shared latent/model invariant`,JSON.stringify(afterEdit.pair.plusHistory[0].latent)===JSON.stringify(afterEdit.pair.minusHistory[0].latent)&&JSON.stringify(afterEdit.initial)===JSON.stringify(c.initial));
    check(`Editing delta to ${delta} does not renormalize the final-command axis`,Number(await page.locator('#conditioningCompare').getAttribute('data-force-scale-n'))===10);
  }
  await page.locator('#conditioningField').selectOption('2');await setDelta(page,3);c=await experiment(page);
  await page.locator('#conditioningAction').selectOption('7');
  check('First noise estimate uses the real denoiser',await page.evaluate(async()=>{const c=JSON.parse(document.getElementById('conditioningExperimentTools').dataset.snapshot),m=await CartPoleTinyDenoiser.load('artifacts/model.json'),p=m.predict(c.initial,95,c.pair.minusObs);return Math.abs(c.pair.firstPredB[7]-p[7])<1e-12}));
  await page.locator('#conditioningZero').click();c=await experiment(page);
  check('Zero button restores identical plans and differences',JSON.stringify(c.pair.plusPlan)===JSON.stringify(c.pair.minusPlan));
  const unchanged=JSON.stringify(c);
  for(const value of ['','6']){await page.locator('#conditioningDelta').fill(value);await page.locator('#conditioningDelta').dispatchEvent('input');check('Invalid or out-of-range input rejected: '+JSON.stringify(value),JSON.stringify(await experiment(page))===unchanged);}
  await setDelta(page,-3);const frozen=(await experiment(page)).pair;
  await tab(page,2);await page.locator('#guideNext').click();
  check('Only explicit native execution advances four ticks',Number(JSON.parse(await nativeSnapshot(page)).currentTick)-(await experiment(page)).tick===4);
  const afterExecution=await nativeSnapshot(page);
  await tab(page,0);
  check('Revisit retains original captured observation and pair',JSON.stringify((await experiment(page)).pair)===JSON.stringify(frozen));
  check('Revisit never re-executes or rewinds physics',afterExecution===await nativeSnapshot(page));
  for(const width of [320,390,768,1024,1440]){
   await page.setViewportSize({width,height:1000});
   await page.locator('#conditioningExperimentTools').scrollIntoViewIfNeeded();
   const geometry=await page.locator('#conditioningExperimentTools').evaluate(el=>{const vis=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);return {overflow:document.documentElement.scrollWidth-innerWidth,controls:[...el.querySelectorAll('button,input,select')].filter(vis).map(e=>{const r=e.getBoundingClientRect();return{height:r.height,width:r.width,left:r.left,right:r.right,font:parseFloat(getComputedStyle(e).fontSize)}}),small:[...el.querySelectorAll('p,label,output')].filter(vis).filter(e=>parseFloat(getComputedStyle(e).fontSize)<14).length}});
   check(`${width}px: no horizontal page overflow`,geometry.overflow<=1,geometry);
   check(`${width}px: all experiment controls fit and have 44px targets`,geometry.controls.every(r=>r.height>=44&&r.left>=0&&r.right<=width+1),geometry);
   check(`${width}px: essential experiment text is readable`,geometry.small===0);
   const plots=await page.locator('#conditioningCompare svg').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));
   check(`${width}px: real comparison plots remain legible`,plots.length===2&&plots.every(h=>h>=120),plots);
   report.widths.push({width,...geometry});
   if(width===320||width===1440){
    await page.locator('#conditioningExperimentTools').screenshot({path:path.join(out,`controls-${width}.png`)});
    await page.locator('#conditioningCompare').screenshot({path:path.join(out,`comparison-${width}.png`)});
    for(const index of [0,7,15])await checkMarkerGeometry(page,check,width,index,16);
    await page.locator('#conditioningAction').selectOption('7');
   }
  }
  await page.locator('#conditioningDelta').focus();await page.waitForTimeout(300);
  check('Idle rendering keeps keyboard focus',await page.evaluate(()=>document.activeElement.id==='conditioningDelta'));
  await tab(page,3);await page.locator('#guideNext').click();
  check('New cycle invalidates captured experiment',await experiment(page)===null);
  await tab(page,0);await page.locator('#captureConditioning').click();await page.locator('#guideExit').click();
  check('Leaving guide invalidates the experiment',await experiment(page)===null);
  check('No uncaught JavaScript errors',report.errors.length===0,report.errors);
  report.passed=true;
 }catch(e){report.passed=false;report.failure=String(e);console.error(e);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failure:report.failure}));}
})();
