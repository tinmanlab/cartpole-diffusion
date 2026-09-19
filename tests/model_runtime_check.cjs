const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split("?")[0]);
  const p=path.join(root,url==="/"?"/index.html":url);
  fs.readFile(p,(e,d)=>{if(e){res.statusCode=404;return res.end("not found")}res.end(d)});
});
function assert(ok,msg){if(!ok)throw new Error(msg)}
function maxDiff(a,b){let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m}
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
    for(let i=0;i<100;i++)model.predict(noisy,50,state);
    const runs=1500,t0=performance.now();
    for(let i=0;i<runs;i++)model.predict(noisy,50,state);
    const avg=(performance.now()-t0)/runs;
    assert(avg<10,"browser denoiser unexpectedly slow: "+avg.toFixed(3)+" ms");
    assert(m.training.validation_epsilon_mse<0.06,"validation metric regressed");
    console.log("MODEL_RUNTIME_CHECK_OK avgMs="+avg.toFixed(4)+" stateDelta="+maxDiff(a,byState).toFixed(4)+" timeDelta="+maxDiff(a,byTime).toFixed(4));
    server.close(()=>process.exit(0));
  }catch(e){console.error(e);server.close(()=>process.exit(1))}
});
