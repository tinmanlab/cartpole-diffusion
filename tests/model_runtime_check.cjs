const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split("?")[0]);
  const p=path.join(root,url==="/"?"/index.html":url);
  fs.readFile(p,(e,d)=>{if(e){res.statusCode=404;return res.end("not found")}res.end(d)});
});
function assert(ok,msg){if(!ok)throw new Error(msg)}
function maxDiff(a,b){let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m}
function meanAbsDiff(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function alphaBar(t,T=100,S=.008){const x=(t/T+S)/(1+S),f=Math.cos(x*Math.PI/2),f0=Math.cos((S/(1+S))*Math.PI/2);return clamp(f*f/(f0*f0),1e-5,1)}
function ddim(x,cur,prev,pred){
  const ac=alphaBar(cur),ap=alphaBar(prev),sc=Math.sqrt(ac),nc=Math.sqrt(1-ac),sp=Math.sqrt(ap),np=Math.sqrt(1-ap);
  const x0=x.map((v,i)=>clamp((v-nc*pred[i])/sc,-1.2,1.2));
  return x0.map((v,i)=>sp*v+np*pred[i]);
}
function fixedGaussian16(seed){
  let local=seed>>>0,sp=null,out=[];
  const rnd=()=>{local+=0x6D2B79F5;let a=local;a=Math.imul(a^a>>>15,a|1);a^=a+Math.imul(a^a>>>7,a|61);return((a^a>>>14)>>>0)/4294967296};
  while(out.length<16){
    if(sp!==null){out.push(sp);sp=null;continue}
    let u=0,v=0;while(!u)u=rnd();while(!v)v=rnd();
    const m=Math.sqrt(-2*Math.log(u));out.push(m*Math.cos(2*Math.PI*v));sp=m*Math.sin(2*Math.PI*v);
  }
  return out;
}
function planHistoryFromFixedLatent(model,obs,initial){
  let x=initial.slice(),cur=95,history=[{t:cur,latent:x.slice()}];
  while(cur>0){
    const prev=Math.max(0,cur-5),pred=model.predict(x,cur,obs);
    x=ddim(x,cur,prev,pred);cur=prev;history.push({t:cur,latent:x.slice()});
  }
  const plan=x.map(v=>clamp(v,-1,1));
  history[history.length-1]={t:0,latent:plan.slice()};
  return {plan,history};
}
server.listen(8130,"127.0.0.1",async()=>{
  try{
    require(path.join(root,"app/tiny_denoiser.js"));
    const model=await globalThis.CartPoleTinyDenoiser.load("http://127.0.0.1:8130/artifacts/model.json");
    const m=model.metadata;
    assert(m.format==="cartpole-diffusion-tiny-mlp-int16-v1","bad model format");
    assert(m.architecture.input_dim===36&&m.architecture.output_dim===16,"bad architecture dimensions");
    assert(m.diffusion.timesteps===100&&m.diffusion.reverse_stride===5,"bad diffusion contract");
    assert(m.normalization.state_scale.length===4,"bad state scale");
    const noisy=Array(16).fill(0),state=[0.1,-0.2,0.05,0.3];
    const f=model.features(noisy,50,state);
    assert(f.length===36&&f.every(Number.isFinite),"bad feature vector");
    const a=model.predict(noisy,50,state),b=model.predict(noisy,50,state);
    assert(a.length===16&&a.every(Number.isFinite),"bad prediction");
    assert(maxDiff(a,b)<1e-12,"inference is not deterministic");
    const byState=model.predict(noisy,50,[0.1,-0.2,-0.05,0.3]);
    const byTime=model.predict(noisy,80,state);
    assert(maxDiff(a,byState)>1e-4,"state conditioning has no visible effect");
    assert(maxDiff(a,byTime)>1e-4,"timestep conditioning has no visible effect");

    const seed=424242,initial=fixedGaussian16(seed),initialCopy=initial.slice();
    assert(maxDiff(initial,initialCopy)===0,"fixed-latent comparison must start from identical noise");
    const plusObs=[0,0,5*Math.PI/180,0],minusObs=[0,0,-5*Math.PI/180,0];
    const plus=planHistoryFromFixedLatent(model,plusObs,initial),minus=planHistoryFromFixedLatent(model,minusObs,initial);
    const plusPlan=plus.plan,minusPlan=minus.plan;
    const conditionMax=maxDiff(plusPlan,minusPlan),conditionMean=meanAbsDiff(plusPlan,minusPlan);
    assert(plus.history.length===20&&minus.history.length===20,"conditioning histories must contain 20 candidate states");
    assert(plus.history[0].t===95&&minus.history[0].t===95&&plus.history.at(-1).t===0&&minus.history.at(-1).t===0,"conditioning history timestep endpoints incorrect");
    const initialHistoryDelta=maxDiff(plus.history[0].latent,minus.history[0].latent);
    const firstHistoryDelta=maxDiff(plus.history[1].latent,minus.history[1].latent);
    const midHistoryDelta=maxDiff(plus.history[9].latent,minus.history[9].latent);
    assert(initialHistoryDelta<1e-12,"fixed-noise conditioning histories do not start identically");
    assert(firstHistoryDelta>1e-5,"conditioning histories do not diverge after first reverse update");
    assert(midHistoryDelta>firstHistoryDelta*0.1,"conditioning divergence vanished unexpectedly by mid trajectory");
    assert(conditionMax>1e-4,"full DDIM plan is insensitive to theta sign under fixed noise");
    assert(conditionMean>1e-5,"full DDIM plan mean difference too small under fixed noise");
    assert(plusPlan.every(Number.isFinite)&&minusPlan.every(Number.isFinite),"conditioning comparison produced non-finite actions");

    const diversityObs=[0,0,5*Math.PI/180,0],diversitySeeds=[10101,20202,30303];
    const diversityRuns=diversitySeeds.map(seed=>planHistoryFromFixedLatent(model,diversityObs,fixedGaussian16(seed)));
    for(const run of diversityRuns){
      assert(run.history.length===20,"sampling diversity history must contain 20 candidate states");
      assert(run.plan.every(Number.isFinite),"sampling diversity produced non-finite actions");
    }
    let diversityInitialMin=Infinity,diversityPlanMean=0,diversityPlanMax=0,diversityPairs=0;
    for(let i=0;i<diversityRuns.length;i++)for(let j=i+1;j<diversityRuns.length;j++){
      diversityInitialMin=Math.min(diversityInitialMin,maxDiff(diversityRuns[i].history[0].latent,diversityRuns[j].history[0].latent));
      diversityPlanMean+=meanAbsDiff(diversityRuns[i].plan,diversityRuns[j].plan);
      diversityPlanMax=Math.max(diversityPlanMax,maxDiff(diversityRuns[i].plan,diversityRuns[j].plan));
      diversityPairs++;
    }
    diversityPlanMean/=diversityPairs;
    assert(diversityInitialMin>1e-4,"different seeds unexpectedly produced identical initial latents");
    assert(diversityPlanMean>1e-5&&diversityPlanMax>1e-4,"same-observation samples do not show plan diversity");
    for(let i=0;i<100;i++)model.predict(noisy,50,state);
    const runs=1500,t0=performance.now();
    for(let i=0;i<runs;i++)model.predict(noisy,50,state);
    const avg=(performance.now()-t0)/runs;
    assert(avg<10,"browser denoiser unexpectedly slow: "+avg.toFixed(3)+" ms");
    assert(m.training.validation_epsilon_mse<0.06,"validation metric regressed");
    console.log("MODEL_RUNTIME_CHECK_OK avgMs="+avg.toFixed(4)+" stateDelta="+maxDiff(a,byState).toFixed(4)+" timeDelta="+maxDiff(a,byTime).toFixed(4)+" fixedNoisePlanMaxDelta="+conditionMax.toFixed(4)+" fixedNoisePlanMeanDelta="+conditionMean.toFixed(4)+" initialHistoryDelta="+initialHistoryDelta.toFixed(6)+" firstHistoryDelta="+firstHistoryDelta.toFixed(4)+" midHistoryDelta="+midHistoryDelta.toFixed(4)+" diversityInitialMin="+diversityInitialMin.toFixed(4)+" diversityPlanMean="+diversityPlanMean.toFixed(4)+" diversityPlanMax="+diversityPlanMax.toFixed(4));
    server.close(()=>process.exit(0));
  }catch(e){console.error(e);server.close(()=>process.exit(1))}
});
