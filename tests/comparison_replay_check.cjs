const http=require("http"),fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split("?")[0]);
  const p=path.join(root,url==="/"?"/index.html":url);
  fs.readFile(p,(e,d)=>{if(e){res.statusCode=404;return res.end("not found")}res.end(d)});
});
function assert(ok,msg){if(!ok)throw new Error(msg)}
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
function physics(s,u,push){
  const c=Math.cos(s.theta),sn=Math.sin(s.theta),total=1.1;
  const tmp=(clamp(u,-10,10)+push+.05*s.thetaDot*s.thetaDot*sn)/total;
  const tha=(9.8*sn-c*tmp)/(.5*(4/3-.1*c*c/total));
  const xa=tmp-.05*tha*c/total;
  return{x:s.x+.02*s.xDot,xDot:s.xDot+.02*xa,theta:s.theta+.02*s.thetaDot,thetaDot:s.thetaDot+.02*tha};
}
server.listen(8131,"127.0.0.1",async()=>{
  try{
    require(path.join(root,"app/tiny_denoiser.js"));
    vm.runInThisContext(fs.readFileSync(path.join(root,"app/diffusion_compare.js"),"utf8"),{filename:"diffusion_compare.js"});
    const model=await globalThis.CartPoleTinyDenoiser.load("http://127.0.0.1:8131/artifacts/model.json");
    const core={
      physics,
      terminal:s=>Math.abs(s.theta)>18*Math.PI/180||Math.abs(s.x)>2.4,
      planForSeed:(obs,seed)=>{
        let x=fixedGaussian16(seed),cur=95;
        while(cur>0){const prev=Math.max(0,cur-5),pred=model.predict(x,cur,obs);x=ddim(x,cur,prev,pred);cur=prev}
        return x.map(v=>clamp(v,-1,1));
      }
    };
    const A=globalThis.DiffusionCompare.runToEnd(model,core);
    const B=globalThis.DiffusionCompare.runToEnd(model,core);
    assert(A.trace.length===501,"comparison trace length must be 501");
    assert(JSON.stringify(A.trace)===JSON.stringify(B.trace),"comparison trace is not deterministic");
    const ids=globalThis.DiffusionCompare.CONTROLLERS.map(x=>x.id);
    const initialStates=ids.map(id=>JSON.stringify(A.trace[0].controllers[id].state));
    assert(new Set(initialStates).size===1,"comparison initial states differ");
    assert(new Set(ids.map(id=>A.trace[0].controllers[id].baseSeed)).size===3,"comparison base seeds are not distinct");
    for(const snap of A.trace){
      const ds=ids.map(id=>snap.controllers[id].disturbance);
      assert(new Set(ds).size===1,"controllers received different disturbance at tick "+snap.tick);
      assert(ds[0]===snap.disturbance,"snapshot disturbance mismatch at tick "+snap.tick);
      for(const id of ids){
        const c=snap.controllers[id];
        assert(Number.isFinite(c.state.x)&&Number.isFinite(c.state.theta),"non-finite replay state "+id+" tick "+snap.tick);
        assert(Number.isFinite(c.nextForce)&&Number.isFinite(c.metrics.controlEffort),"non-finite replay control "+id+" tick "+snap.tick);
      }
    }
    for(const pulse of globalThis.DiffusionCompare.DISTURBANCE_PULSES){
      assert(A.trace[pulse.start+1].disturbance===pulse.force,"scheduled disturbance missing at "+pulse.start);
    }
    const divergenceTick=120;
    const states=ids.map(id=>A.trace[divergenceTick].controllers[id].state);
    const stateStrings=states.map(JSON.stringify);
    assert(new Set(stateStrings).size>1,"seed streams did not produce divergent closed-loop states by tick "+divergenceTick);
    const summary=globalThis.DiffusionCompare.summary(A);
    for(const id of ids){
      const s=summary[id];
      assert(Number.isFinite(s.survivalSeconds)&&Number.isFinite(s.maxAbsTheta)&&Number.isFinite(s.meanAbsTheta)&&Number.isFinite(s.controlEffort),"non-finite summary "+id);
      if(s.failed){
        const failTick=s.survivalSteps,frozen=JSON.stringify(A.trace[failTick].controllers[id].state);
        for(let tick=failTick+1;tick<A.trace.length;tick++){
          assert(JSON.stringify(A.trace[tick].controllers[id].state)===frozen,id+" state changed after failure at tick "+tick);
          assert(A.trace[tick].controllers[id].nextForce===0,id+" next force nonzero after failure");
        }
      }
    }
    console.log("DIFFUSION_COMPARISON_REPLAY_OK",JSON.stringify({traceLength:A.trace.length,divergenceTick,summary}));
    server.close(()=>process.exit(0));
  }catch(e){console.error(e);server.close(()=>process.exit(1))}
});
