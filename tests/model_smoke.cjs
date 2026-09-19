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

    vm.runInThisContext(fs.readFileSync(path.join(root,"app/diffusion_viz.js"),"utf8"),{filename:"diffusion_viz.js"});
    vm.runInThisContext(fs.readFileSync(path.join(root,"app/control_loop_viz.js"),"utf8"),{filename:"control_loop_viz.js"});
    if(!globalThis.DiffusionViz||typeof globalThis.DiffusionViz.renderLadder!=="function")throw new Error("advanced viz api missing");
    if(!globalThis.ControlLoopViz||typeof globalThis.ControlLoopViz.renderStages!=="function"||typeof globalThis.ControlLoopViz.renderObservation!=="function"||typeof globalThis.ControlLoopViz.renderExecution!=="function"||typeof globalThis.ControlLoopViz.renderStateDelta!=="function"||typeof globalThis.ControlLoopViz.renderDenoiseUpdate!=="function"||typeof globalThis.ControlLoopViz.renderDenoiseTimeline!=="function"||typeof globalThis.ControlLoopViz.renderConditioningCompare!=="function"||typeof globalThis.ControlLoopViz.renderSamplingCompare!=="function")throw new Error("control-loop viz api missing");

    const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
    for(const id of ["plantCard","tickLabel","stepBtn","observation","denoiseStages","execution","ladder","inspector","runBtn","resetBtn","pushL","pushR","guideBtn","guideControls","guidePrev","guideNext","guideExit","guideStep","guideExplain","reobserveCompare","denoiseTimeline","denoiseOneStep","conditioningCompare","samplingCompare"])if(!html.includes('id="'+id+'"'))throw new Error("missing "+id);
    if(html.includes("distributionCanvas")||html.includes("Same state, many noise seeds"))throw new Error("probability-first UI must not be default");
    if(html.includes("policyArrow")||html.includes("pushArrow"))throw new Error("on-canvas force arrows must stay removed");
    console.log("MODEL_AND_CONTROL_LOOP_UI_SMOKE_OK",model.metadata.training.validation_epsilon_mse.toFixed(6));
    server.close(()=>process.exit(0));
  }catch(e){console.error(e);server.close(()=>process.exit(1))}
});
