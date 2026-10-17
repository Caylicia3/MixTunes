'use strict';
(() => {
  const pending=new Map();let sequence=0;
  const safeError=value=>String(value||'操作失败').replace(/https?:\/\/\S+/g,'[来源地址]').replace(/(?:cookie|authorization)\s*[:=]\s*\S+/gi,'[登录信息]').slice(0,400);
  window.__mixNativeReply=result=>{
    if(typeof result==='string'){try{result=JSON.parse(result);}catch{return;}}
    const entry=pending.get(result?.id);if(!entry)return;pending.delete(result.id);clearTimeout(entry.timer);entry.detach?.();
    if(result.ok===false)entry.reject(new Error(safeError(result.error)));else entry.resolve(result.value);
  };
  function native(method,payload={},options={}){
    return new Promise((resolve,reject)=>{
      if(!window.MixTunesBridge?.postMessage){reject(new Error('请通过 MixTunes 安卓版打开'));return;}
      if(options.signal?.aborted){reject(new DOMException('Canceled','AbortError'));return;}
      const id='m'+(++sequence),entry={resolve,reject,timer:null,detach:null};
      const cancelNative=()=>{if(method==='fetch'||method==='share-fetch')try{window.MixTunesBridge.postMessage(JSON.stringify({id:'cancel-'+id,method:'cancel',payload:{requestId:id}}));}catch{}};
      const cancel=()=>{if(!pending.has(id))return;pending.delete(id);clearTimeout(entry.timer);entry.detach?.();cancelNative();reject(new DOMException('Canceled','AbortError'));};
      if(options.signal){options.signal.addEventListener('abort',cancel,{once:true});entry.detach=()=>options.signal.removeEventListener('abort',cancel);}
      entry.timer=setTimeout(()=>{if(!pending.has(id))return;pending.delete(id);entry.detach?.();cancelNative();reject(new Error('操作超时，请重试'));},options.timeoutMs??30000);
      pending.set(id,entry);
      try{window.MixTunesBridge.postMessage(JSON.stringify({id,method,payload}));}catch(error){pending.delete(id);clearTimeout(entry.timer);entry.detach?.();reject(new Error(safeError(error.message)));}
    });
  }
  class MiniBuffer extends Uint8Array{
    static from(value,encoding='utf8'){
      if(value instanceof ArrayBuffer)return new MiniBuffer(new Uint8Array(value));
      if(ArrayBuffer.isView(value))return new MiniBuffer(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
      if(Array.isArray(value))return new MiniBuffer(value);
      const text=String(value??'');
      if(encoding==='base64'){const raw=atob(text),out=new MiniBuffer(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
      if(encoding==='hex'){const out=new MiniBuffer(Math.floor(text.length/2));for(let i=0;i<out.length;i++)out[i]=parseInt(text.slice(i*2,i*2+2),16);return out;}
      return new MiniBuffer(new TextEncoder().encode(text));
    }
    static alloc(length){return new MiniBuffer(length);}
    static byteLength(value){return typeof value==='string'?new TextEncoder().encode(value).length:value.byteLength;}
    static concat(values){const out=new MiniBuffer(values.reduce((n,v)=>n+v.length,0));let offset=0;for(const value of values){out.set(value,offset);offset+=value.length;}return out;}
    toString(encoding='utf8'){
      if(encoding==='hex')return Array.from(this,v=>v.toString(16).padStart(2,'0')).join('');
      if(encoding==='base64'){let raw='';for(let i=0;i<this.length;i+=16384)raw+=String.fromCharCode(...this.subarray(i,i+16384));return btoa(raw);}
      return new TextDecoder().decode(this);
    }
  }
  window.Buffer=MiniBuffer;
  function cryptoCall(payload){
    if(!window.MixTunesBridge?.crypto)throw new Error('原生加密服务未连接');
    const result=JSON.parse(window.MixTunesBridge.crypto(JSON.stringify(payload)));
    if(result.ok===false)throw new Error(safeError(result.error));return result.value;
  }
  const crypto={
    randomUUID:()=>cryptoCall({op:'randomUUID'}),
    randomInt:(min,max)=>cryptoCall({op:'randomInt',min:max===undefined?0:min,max:max===undefined?min:max}),
    createHash(algorithm){const chunks=[];return{update(data,encoding='utf8'){chunks.push(MiniBuffer.from(data,encoding));return this;},digest(encoding){const raw=MiniBuffer.from(cryptoCall({op:'hash',algorithm,dataBase64:MiniBuffer.concat(chunks).toString('base64')}),'base64');return encoding?raw.toString(encoding):raw;}};},
    createCipheriv(algorithm,key,iv){const chunks=[];return{update(data,encoding='utf8'){chunks.push(MiniBuffer.from(data,encoding));return MiniBuffer.alloc(0);},final(){return MiniBuffer.from(cryptoCall({op:'cipher',algorithm,keyBase64:MiniBuffer.from(key).toString('base64'),ivBase64:MiniBuffer.from(iv).toString('base64'),dataBase64:MiniBuffer.concat(chunks).toString('base64')}),'base64');}};}
  };
  class EventEmitter{
    constructor(){this.listeners=new Map();}
    on(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);return this;}
    emit(type,...args){for(const fn of this.listeners.get(type)||[])fn(...args);return true;}
    removeListener(type,fn){this.listeners.get(type)?.delete(fn);return this;}
    once(type,fn){const listener=(...args)=>{this.removeListener(type,listener);fn(...args);};return this.on(type,listener);}
    removeAllListeners(type){if(type)this.listeners.delete(type);else this.listeners.clear();return this;}
  }
  if(typeof AbortSignal.timeout!=='function')AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('Timed out','TimeoutError')),ms);return c.signal;};
  async function nativeFetch(url,options={}){
    const headers=Object.fromEntries(new Headers(options.headers||{}).entries());
    const payload={url:String(url),method:options.method||'GET',headers};
    if(options.body!==undefined&&options.body!==null)payload.bodyBase64=MiniBuffer.from(options.body instanceof URLSearchParams?options.body.toString():options.body).toString('base64');
    const data=await native('fetch',payload,{signal:options.signal,timeoutMs:35000});
    const bytes=MiniBuffer.from(data.bodyBase64||'','base64');
    const response=new Response(['HEAD','204','205','304'].includes(String(payload.method))||[204,205,304].includes(data.status)?null:bytes,{status:data.status,headers:data.headers||{}});
    Object.defineProperty(response,'url',{value:data.url||String(url)});return response;
  }
  window.__mixPlatform={native,nativeFetch,crypto,EventEmitter,Buffer:MiniBuffer,safeError};
})();
