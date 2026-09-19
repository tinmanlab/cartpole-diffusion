"""Shared Cart-Pole dynamics and diffusion math for the v0.2 teaching model."""
from __future__ import annotations
import math
import numpy as np

DT=0.02
GRAVITY=9.8
MASS_POLE=0.1
TOTAL_MASS=1.1
HALF_POLE_LENGTH=0.5
POLEMASS_LENGTH=0.05
MAX_FORCE=10.0
HORIZON=16
DIFFUSION_STEPS=100
COSINE_S=0.008
TIMESTEP_EMBED_DIM=16
TEACHER_GAIN=np.array([3.02047836,5.99053209,53.60976189,14.17379801],dtype=np.float32)
STATE_SCALE=np.array([0.8,1.2,math.radians(12.0),math.radians(100.0)],dtype=np.float32)

def physics_step(state,force):
    s=np.asarray(state,dtype=np.float32)
    single=s.ndim==1
    if single:s=s[None,:]
    u=np.asarray(force,dtype=np.float32)
    if u.ndim==0:u=np.full((s.shape[0],),float(u),dtype=np.float32)
    u=np.clip(u.reshape(-1),-MAX_FORCE,MAX_FORCE)
    x,xd,th,thd=s.T
    c=np.cos(th); sn=np.sin(th)
    temp=(u+POLEMASS_LENGTH*thd*thd*sn)/TOTAL_MASS
    tha=(GRAVITY*sn-c*temp)/(HALF_POLE_LENGTH*(4.0/3.0-MASS_POLE*c*c/TOTAL_MASS))
    xa=temp-POLEMASS_LENGTH*tha*c/TOTAL_MASS
    out=np.stack([x+DT*xd,xd+DT*xa,th+DT*thd,thd+DT*tha],axis=1).astype(np.float32)
    return out[0] if single else out

def teacher_force(state):
    s=np.asarray(state,dtype=np.float32)
    return np.clip(s@TEACHER_GAIN,-MAX_FORCE,MAX_FORCE)

def rollout_action_chunk(states,horizon=HORIZON):
    s=np.asarray(states,dtype=np.float32)
    single=s.ndim==1
    if single:s=s[None,:]
    s=s.copy()
    out=np.empty((s.shape[0],horizon),dtype=np.float32)
    for i in range(horizon):
        u=np.asarray(teacher_force(s),dtype=np.float32)
        out[:,i]=u/MAX_FORCE
        s=physics_step(s,u)
    return out[0] if single else out

def sample_states(rng,count):
    return rng.uniform(-STATE_SCALE,STATE_SCALE,size=(count,4)).astype(np.float32)

def alpha_bar(timestep):
    t=np.asarray(timestep,dtype=np.float32)
    x=(t/DIFFUSION_STEPS+COSINE_S)/(1.0+COSINE_S)
    f=np.cos(x*np.pi/2.0)
    f0=math.cos((COSINE_S/(1.0+COSINE_S))*math.pi/2.0)
    return np.clip((f*f)/(f0*f0),1e-5,1.0).astype(np.float32)

def timestep_embedding(timestep,dim=TIMESTEP_EMBED_DIM):
    t=np.asarray(timestep,dtype=np.float32).reshape(-1,1)/DIFFUSION_STEPS
    freqs=(2.0**np.arange(dim//2,dtype=np.float32))*np.pi
    angles=t*freqs[None,:]
    return np.concatenate([np.sin(angles),np.cos(angles)],axis=1).astype(np.float32)

def build_features(noisy,timestep,state):
    a=np.asarray(noisy,dtype=np.float32)
    s=np.asarray(state,dtype=np.float32)
    if a.ndim==1:a=a[None,:]
    if s.ndim==1:s=s[None,:]
    t=np.asarray(timestep)
    if t.ndim==0:t=np.full((a.shape[0],),int(t),dtype=np.int32)
    return np.concatenate([a,s/STATE_SCALE,timestep_embedding(t)],axis=1).astype(np.float32)

def corrupt_action(clean,timestep,noise):
    clean=np.asarray(clean,dtype=np.float32); eps=np.asarray(noise,dtype=np.float32)
    t=np.asarray(timestep)
    ab=alpha_bar(int(t)) if t.ndim==0 else alpha_bar(t)[:,None]
    noisy=np.sqrt(ab)*clean+np.sqrt(1.0-ab)*eps
    return noisy.astype(np.float32),np.asarray(ab,dtype=np.float32)
