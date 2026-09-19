const http=require("http"),fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split("?")[0]);
  const p=path.join(root,url==="/"?"/index.html":url);
  fs.readFile(p,(e,d)=>{if(e){res.statusCode=404;return res.end("not found")}res.end(d)});
});
server.listen(8123,"127.0.0.1",async()=>{
  try{
    require(path.join(root,"app/tiny_denoiser.js"));
    const model=await globalThis.CartPoleTinyDenoiser.load("http://127.0.0.1:8123/artifacts/model.json");
    const out=model.predict(new Array(16).fill(0),50,[0,0,0,0]);
    if(out.length!==16||out.some(x=>!Number.isFinite(x)))throw new Error("bad inference");
    if(model.metadata.training.validation_epsilon_mse>0.06)throw new Error("metric threshold");
    const vizSource=fs.readFileSync(path.join(root,"app/diffusion_viz.js"),"utf8");
    vm.runInThisContext(vizSource,{filename:"diffusion_viz.js"});
    if(!globalThis.DiffusionViz||typeof globalThis.DiffusionViz.renderLadder!=="function")throw new Error("viz api missing");
    const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
    for(const id of ["ladder","inspector","execute","denoiseBtn","generateBtn","hoverReadout"])if(!html.includes('id="'+id+'"'))throw new Error("missing "+id);
    if(!html.includes("Diffusion = noise"))throw new Error("diffusion-first explanation missing");
    console.log("MODEL_AND_VIZ_SMOKE_OK",model.metadata.training.validation_epsilon_mse.toFixed(6));
    server.close(()=>process.exit(0));
  }catch(e){console.error(e);server.close(()=>process.exit(1))}
});
