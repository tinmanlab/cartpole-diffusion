const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
if(!scripts.length)throw new Error("no inline script found");
for(const [i,src] of scripts.entries())new vm.Script(src,{filename:"index-inline-"+i+".js"});
for(const required of ["app/control_loop_viz.js",'id="observation"','id="denoiseStages"','id="execution"',"Observe the plant","Diffusion Policy makes a future force plan","Execute only the first 4 forces"]){
  if(!html.includes(required))throw new Error("missing "+required);
}
console.log("INLINE_SCRIPT_SYNTAX_OK",scripts.length);
