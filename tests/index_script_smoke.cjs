const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
if(!scripts.length)throw new Error("no inline script found");
for(const [i,src] of scripts.entries())new vm.Script(src,{filename:"index-inline-"+i+".js"});
for(const required of ["app/control_loop_viz.js",'id="observation"','id="denoiseStages"','id="execution"','id="guideBtn"','id="guideStep"','id="guideNext"','id="guideExit"','id="reobserveCompare"','id="denoiseTimeline"','id="denoiseOneStep"','id="conditioningCompare"',"1/6 · 관측","같은 noise에서 θ만 +5°↔−5°","첫 denoise update부터 candidate 경로가 갈라지는","6/6 · 다시 관측","한 cycle 설명","관측 (Observe)","계획 (Plan) · Diffusion이 미래 force 16개 생성","실행 (Act) · 앞 4개 force만 적용","0.32 s 미래","0.08 s 실행","receding horizon"]){
  if(!html.includes(required))throw new Error("missing "+required);
}
console.log("INLINE_SCRIPT_SYNTAX_OK",scripts.length);
