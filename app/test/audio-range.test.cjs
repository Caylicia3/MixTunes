'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function renderer(){
  const events=[],elements=[],plays=[];let command;
  class Audio{
    constructor(){this.listeners={};this.currentTime=0;this.duration=NaN;this.readyState=0;this.paused=true;}
    addEventListener(type,listener){(this.listeners[type]||=[]).push(listener);}
    emit(type){for(const listener of this.listeners[type]||[])listener();}
    async play(){plays.push(this.currentTime);this.paused=false;this.emit('playing');}
    pause(){if(!this.paused){this.paused=true;this.emit('pause');}}
    load(){}remove(){}removeAttribute(){}
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/audio.js'),'utf8'),{window:{audioBridge:{event:e=>events.push(e),onCommand:fn=>command=fn}},document:{createElement(){const audio=new Audio();elements.push(audio);return audio;},body:{append(){}}},setInterval:()=>1,clearInterval(){}});
  const base={slot:0,token:'test',key:'netease:1',generation:1};
  return {events,elements,plays,async send(payload){await command({...base,...payload});},base};
}
test('audio activation waits for metadata and start seek completion before any sound',async()=>{
  const r=renderer();await r.send({name:'load',url:'test',playRange:{startMs:30000,endMs:60000}});await r.send({name:'play'});assert.equal(r.plays.length,0);
  const audio=r.elements[0];audio.duration=120;audio.readyState=1;audio.emit('loadedmetadata');assert.equal(audio.currentTime,30);assert.equal(r.plays.length,0);
  audio.emit('seeked');assert.deepEqual(r.plays,[30]);assert.equal(r.events.filter(e=>e.type==='playing').length,1);
});
test('audio clip end pauses and emits one ended event even if native ended also arrives',async()=>{
  const r=renderer();await r.send({name:'load',url:'test',playRange:{startMs:0,endMs:10000}});const audio=r.elements[0];audio.duration=120;audio.readyState=1;audio.emit('loadedmetadata');await r.send({name:'play'});
  audio.currentTime=10;audio.emit('timeupdate');audio.emit('timeupdate');audio.emit('ended');assert.equal(audio.paused,true);assert.equal(r.events.filter(e=>e.type==='ended').length,1);
});
test('cancel before metadata never autoplays later and dynamic ranges clamp renderer seeks',async()=>{
  const r=renderer();await r.send({name:'load',url:'test',playRange:{startMs:30000,endMs:60000}});await r.send({name:'play'});await r.send({name:'stop-all'});
  const audio=r.elements[0];audio.duration=120;audio.readyState=1;audio.emit('loadedmetadata');audio.emit('seeked');assert.equal(r.plays.length,0);
  await r.send({name:'range',playRange:{startMs:40000,endMs:50000}});audio.emit('seeked');await r.send({name:'seek',positionMs:1000});assert.equal(audio.currentTime,40);
});

test('invalid old start waits for a range acknowledgement instead of playing the opening fragment',async()=>{
  const r=renderer();await r.send({name:'load',url:'test',playRange:{startMs:90000,endMs:null}});await r.send({name:'play'});
  const audio=r.elements[0];audio.duration=60;audio.readyState=1;audio.emit('loadedmetadata');assert.equal(r.plays.length,0);assert.equal(r.events.at(-1).rangeReset,true);
  await r.send({name:'range',playRange:{startMs:30000,endMs:50000}});audio.emit('seeked');assert.deepEqual(r.plays,[30]);
});

test('seeking preserves the same audio element and playing intent through a transient native pause',async()=>{
  const r=renderer();await r.send({name:'load',url:'test'});const audio=r.elements[0];audio.duration=120;audio.readyState=1;audio.emit('loadedmetadata');await r.send({name:'play'});
  await r.send({name:'seek',positionMs:70000});audio.pause();audio.emit('seeked');
  assert.equal(r.elements.length,1);assert.equal(audio.paused,false);assert.deepEqual(r.plays,[0,70]);
  assert.equal(r.events.filter(e=>e.type==='seeked').at(-1).positionMs,70000);
});

test('a superseded seek completion and stale ended event cannot cancel the latest seek intent',async()=>{
  const r=renderer();await r.send({name:'load',url:'test',playRange:{startMs:0,endMs:90000}});const audio=r.elements[0];audio.duration=120;audio.readyState=1;audio.emit('loadedmetadata');await r.send({name:'play'});
  await r.send({name:'seek',positionMs:70000});await r.send({name:'seek',positionMs:20000});
  audio.currentTime=90;audio.emit('timeupdate');audio.emit('ended');audio.emit('seeked');
  assert.equal(r.events.filter(e=>e.type==='ended').length,0);assert.equal(r.events.filter(e=>e.type==='seeked').length,0);
  audio.currentTime=20;audio.emit('seeked');assert.equal(r.events.filter(e=>e.type==='seeked').length,1);assert.deepEqual(r.plays,[0,20]);
});
