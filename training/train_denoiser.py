"""Train a tiny state-conditioned DDPM noise predictor with NumPy and export browser weights."""
from __future__ import annotations
import argparse,base64,json
from pathlib import Path
import numpy as np
from training.cartpole_core import *

INPUT_DIM=36
HIDDEN=(64,64)
OUTPUT_DIM=16

def silu(x):
    s=1/(1+np.exp(-np.clip(x,-30,30))); return x*s
def silu_grad(x):
    s=1/(1+np.exp(-np.clip(x,-30,30))); return s*(1+x*(1-s))

class MLP:
    def __init__(self,rng):
        dims=(INPUT_DIM,*HIDDEN,OUTPUT_DIM); self.w=[]; self.b=[]
        for fi,fo in zip(dims[:-1],dims[1:]):
            self.w.append((rng.standard_normal((fi,fo))*np.sqrt(2/fi)).astype(np.float32))
            self.b.append(np.zeros(fo,dtype=np.float32))
    @property
    def params(self):
        out=[]
        for w,b in zip(self.w,self.b):out.extend([w,b])
        return out
    def forward(self,x,cache=False):
        acts=[x]; zs=[]
        for i,(w,b) in enumerate(zip(self.w,self.b)):
            z=x@w+b; zs.append(z); x=silu(z) if i<len(self.w)-1 else z; acts.append(x)
        return (x,(acts,zs)) if cache else x
    def gradients(self,x,y):
        pred,(acts,zs)=self.forward(x,True)
        d=(2*(pred-y)/(y.shape[0]*y.shape[1])).astype(np.float32)
        gw=[None]*len(self.w); gb=[None]*len(self.b)
        for i in reversed(range(len(self.w))):
            gw[i]=acts[i].T@d; gb[i]=d.sum(0)
            if i>0:d=(d@self.w[i].T)*silu_grad(zs[i-1])
        grads=[]
        for a,b in zip(gw,gb):grads.extend([a,b])
        return float(np.mean((pred-y)**2)),grads

class Adam:
    def __init__(self,params):
        self.m=[np.zeros_like(p) for p in params]; self.v=[np.zeros_like(p) for p in params]
    def step(self,params,grads,lr,n):
        for i,(p,g) in enumerate(zip(params,grads)):
            self.m[i]=.9*self.m[i]+.1*g; self.v[i]=.999*self.v[i]+.001*g*g
            mh=self.m[i]/(1-.9**n); vh=self.v[i]/(1-.999**n)
            p-=lr*mh/(np.sqrt(vh)+1e-8)

def make_batch(rng,n):
    s=sample_states(rng,n); clean=rollout_action_chunk(s)
    t=rng.integers(1,DIFFUSION_STEPS,size=n,dtype=np.int32)
    eps=rng.standard_normal((n,HORIZON)).astype(np.float32)
    noisy,_=corrupt_action(clean,t,eps)
    return build_features(noisy,t,s),eps

def validation(seed,n):
    rng=np.random.default_rng(seed); s=sample_states(rng,n); clean=rollout_action_chunk(s)
    t=rng.integers(1,DIFFUSION_STEPS,size=n,dtype=np.int32)
    eps=rng.standard_normal((n,HORIZON)).astype(np.float32)
    noisy,ab=corrupt_action(clean,t,eps)
    return s,clean,t,eps,noisy,ab,build_features(noisy,t,s)

def recover(model,noisy,start_t,states,stride=5):
    x=noisy.copy(); cur=start_t
    while cur>0:
        prev=max(0,cur-stride); tt=np.full(len(x),cur,dtype=np.int32)
        pred=model.forward(build_features(x,tt,states)); ab=alpha_bar(tt)[:,None]
        x0=np.clip((x-np.sqrt(1-ab)*pred)/np.sqrt(ab),-1.2,1.2)
        ap=alpha_bar(np.full_like(tt,prev))[:,None]
        x=np.sqrt(ap)*x0+np.sqrt(1-ap)*pred; cur=prev
    return x

def quantized_spec(array,path):
    a=np.asarray(array,dtype=np.float32); mx=float(np.max(np.abs(a))) or 1.0
    scale=mx/32767; q=np.round(a/scale).astype("<i2")
    Path(path).write_text(base64.b64encode(q.tobytes()).decode(),encoding="ascii")
    return {"path":path.replace("\\","/"),"shape":list(a.shape),"scale":scale}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--steps",type=int,default=6000); ap.add_argument("--batch-size",type=int,default=512); ap.add_argument("--seed",type=int,default=42); args=ap.parse_args()
    rng=np.random.default_rng(args.seed); model=MLP(np.random.default_rng(args.seed+1)); opt=Adam(model.params)
    val=validation(args.seed+1000,4096); history=[]
    for step in range(1,args.steps+1):
        x,y=make_batch(rng,args.batch_size); loss,grads=model.gradients(x,y)
        lr=3e-3 if step<args.steps*.5 else (8e-4 if step<args.steps*.84 else 3e-4)
        opt.step(model.params,grads,lr,step)
        if step==1 or step%500==0 or step==args.steps:
            vl=float(np.mean((model.forward(val[-1])-val[3])**2)); history.append({"step":step,"train_mse":loss,"validation_mse":vl}); print(history[-1])
    pred=model.forward(val[-1]); eps_mse=float(np.mean((pred-val[3])**2))
    x0=np.clip((val[4]-np.sqrt(1-val[5])*pred)/np.sqrt(val[5]),-1.5,1.5)
    x0_mae=float(np.mean(np.abs(x0-val[1])))
    erng=np.random.default_rng(args.seed+99); es=sample_states(erng,1024); ec=rollout_action_chunk(es); reverse={}
    for t0 in (30,50,70,85,95):
        e=erng.standard_normal((len(es),HORIZON)).astype(np.float32); noisy,_=corrupt_action(ec,np.full(len(es),t0,dtype=np.int32),e); rec=recover(model,noisy,t0,es)
        reverse[str(t0)]={"action_mae":float(np.mean(np.abs(rec-ec))),"first_action_mae":float(np.mean(np.abs(rec[:,0]-ec[:,0])))}
    metrics={"seed":args.seed,"steps":args.steps,"batch_size":args.batch_size,"validation_size":4096,"validation_epsilon_mse":eps_mse,"single_step_x0_mae":x0_mae,"ddim_recovery":reverse,"history":history}
    if eps_mse>0.06 or reverse["70"]["action_mae"]>0.09: raise SystemExit("acceptance threshold failed: "+json.dumps(metrics))
    out=Path("artifacts"); out.mkdir(exist_ok=True)
    layers=[]
    for i,(w,b) in enumerate(zip(model.w,model.b)):
        layers.append({"weight":quantized_spec(w,str(out/f"layer{i}_weight.b64")),"bias":quantized_spec(b,str(out/f"layer{i}_bias.b64"))})
    manifest={"format":"cartpole-diffusion-tiny-mlp-int16-v1","version":"0.2","architecture":{"input_dim":36,"hidden_dims":[64,64],"output_dim":16,"activation":"silu","quantization":"int16-per-tensor"},"normalization":{"state_scale":[float(x) for x in STATE_SCALE],"action_scale_newtons":MAX_FORCE},"diffusion":{"timesteps":DIFFUSION_STEPS,"schedule":"cosine","cosine_s":COSINE_S,"timestep_embedding_dim":TIMESTEP_EMBED_DIM,"reverse_stride":5},"teacher":{"type":"near_upright_discrete_lqr","gain":[float(x) for x in TEACHER_GAIN],"horizon":HORIZON},"training":metrics,"layers":layers}
    (out/"model.json").write_text(json.dumps(manifest,separators=(",",":")),encoding="utf-8")
    (out/"training_metrics.json").write_text(json.dumps(metrics,indent=2),encoding="utf-8")
    print(json.dumps(metrics,indent=2))

if __name__=="__main__":main()
