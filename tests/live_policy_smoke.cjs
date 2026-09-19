const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,".."),H=16,MAXF=10,S=.008,T=100,TAU=.02,START=95,STRIDE=5;
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function ab(t){const x=(t/T+S)/(1+S),f=Math.cos(x*Math.PI/2),f0=Math.cos((S/(1+S))*Math.PI/2);return clamp(f*f/(f0*f0),1e-5,1)}
function physics(s,u){const c=Math.cos(s[2]),sn=Math.sin(s[2]),tmp=(clamp(u,-MAXF,MAXF)+.05*s[3]*s[3]*sn)/1.1,tha=(9.8*sn-c*tmp)/(.5*(4/3-.1*c*c/1.1)),xa=tmp-.05*tha*c/1.1;return[s[0]+TAU*s[1],s[1]+TAU*xa,s[2]+TAU*s[3],s[3]+TAU*tha]}
function ddim(x,cur,prev,pred){const ac=ab(cur),ap=ab(prev),sc=Math.sqrt(ac),nc=Math.sqrt(1-ac),sp=Math.sqrt(ap),np=Math.sqrt(1-ap);const x0=x.map((v,i)=>clamp((v-nc*pred[i])/sc,-1.2,1.2));return x0.map((v,i)=>sp*v+np*pred[i])}
let seed=11;
function rnd(){let a=seed+=0x6D2B79F5;a=Math.imul(a^a>>>15,a|1);a^=a+Math.imul(a^a>>>7,a|61);return((a^a>>>14)>>>0)/4294967296}
function noise(){const out=[];let sp=null;while(out.length<H){if(sp!==null){out.push(sp);sp=null;continue}let u=0,v=0;while(!u)u=rnd();while(!v)v=rnd();const m=Math.sqrt(-2*Math.log(u));out.push(m*Math.cos(2*Math.PI*v));sp=m*Math.sin(2*Math.PI*v)}return out}
const server=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split("?")[0]),p=path.join(root,u==="/"?"/index.html":u);fs.readFile(p,(e,d)=>{if(e){res.statusCode=404;return res.end("x")}res.end(d)})});
server.listen(8124,"127.0.0.1",async()=>{
  try{
    require(path.join(root,"app/tiny_denoiser.js"));
    const model=await globalThis.CartPoleTinyDenoiser.load("http://127.0.0.1:8124/artifacts/model.json");
    let s=[0,0,5*Math.PI/180,0],plan=[],cursor=4,maxTheta=0,maxX=0,plans=0;
    function makePlan(){let x=noise(),cur=START;while(cur>0){const prev=Math.max(0,cur-STRIDE),pred=model.predict(x,cur,s);x=ddim(x,cur,prev,pred);cur=prev}plan=x.map(v=>clamp(v,-1,1));cursor=0;plans++}
    for(let k=0;k<500;k++){if(cursor>=4)makePlan();s=physics(s,plan[cursor++]*MAXF);if(s.some(v=>!Number.isFinite(v)))throw new Error("non-finite rollout");maxTheta=Math.max(maxTheta,Math.abs(s[2]));maxX=Math.max(maxX,Math.abs(s[0]));if(Math.abs(s[2])>18*Math.PI/180||Math.abs(s[0])>2.4)throw new Error("live rollout fell at step "+k+" theta="+(s[2]*180/Math.PI).toFixed(2)+" x="+s[0].toFixed(2))}
    console.log("LIVE_POLICY_10S_OK plans="+plans+" maxThetaDeg="+(maxTheta*180/Math.PI).toFixed(2)+" maxX="+maxX.toFixed(2));
    server.close(()=>process.exit(0));
  }catch(e){console.error(e);server.close(()=>process.exit(1))}
});
