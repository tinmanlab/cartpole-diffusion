(function(root){
"use strict";
function decodeInt16(base64,scale){
  var raw=atob(base64),buf=new ArrayBuffer(raw.length),u8=new Uint8Array(buf);
  for(var i=0;i<raw.length;i++)u8[i]=raw.charCodeAt(i);
  var q=new Int16Array(buf),out=new Float32Array(q.length);
  for(var j=0;j<q.length;j++)out[j]=q[j]*scale;
  return out;
}
function silu(x){var c=Math.max(-30,Math.min(30,x)),s=1/(1+Math.exp(-c));return x*s}
function timestepEmbedding(t,dim,total){
  var h=Math.floor(dim/2),out=new Array(dim),z=t/total;
  for(var i=0;i<h;i++){var a=z*Math.pow(2,i)*Math.PI;out[i]=Math.sin(a);out[i+h]=Math.cos(a)}
  return out;
}
function dense(input,layer,activate){
  var rows=layer.shape[0],cols=layer.shape[1],w=layer.weight,b=layer.bias,out=new Array(cols);
  if(input.length!==rows)throw new Error("dense input mismatch");
  for(var j=0;j<cols;j++){var v=b[j];for(var i=0;i<rows;i++)v+=input[i]*w[i*cols+j];out[j]=activate?silu(v):v}
  return out;
}
async function readText(url){var r=await fetch(url);if(!r.ok)throw new Error("HTTP "+r.status+" "+url);return (await r.text()).trim()}
async function load(manifestUrl){
  var base=(typeof document!=="undefined"&&document.baseURI)?document.baseURI:undefined;
  var manifestAbs=new URL(manifestUrl,base);
  var r=await fetch(manifestAbs.href);if(!r.ok)throw new Error("HTTP "+r.status+" "+manifestAbs.href);
  var m=await r.json(),layers=[],siteBase=new URL("../",new URL(".",manifestAbs));
  for(var i=0;i<m.layers.length;i++){
    var spec=m.layers[i];
    var pair=await Promise.all([readText(new URL(spec.weight.path,siteBase).href),readText(new URL(spec.bias.path,siteBase).href)]);
    layers.push({
      shape:spec.weight.shape,
      weight:decodeInt16(pair[0],spec.weight.scale),
      bias:decodeInt16(pair[1],spec.bias.scale)
    });
  }
  function features(noisy,t,state){
    var x=noisy.slice(),ss=m.normalization.state_scale;
    for(var i=0;i<4;i++)x.push(state[i]/ss[i]);
    return x.concat(timestepEmbedding(t,m.diffusion.timestep_embedding_dim,m.diffusion.timesteps));
  }
  function predict(noisy,t,state){
    var x=features(noisy,t,state);
    for(var i=0;i<layers.length;i++)x=dense(x,layers[i],i<layers.length-1);
    return x;
  }
  return {metadata:m,predict:predict,features:features};
}
root.CartPoleTinyDenoiser={load:load,timestepEmbedding:timestepEmbedding};
})(typeof window!=="undefined"?window:globalThis);
