'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {parseLrc,withTranslation,fetchLyrics,LyricsService}=require('../src/lyrics.cjs');
test('LRC keeps fractional timestamps, repeated tags, sorted rows, decoded literal text and omits metadata',()=>{assert.deepEqual(parseLrc('[ti:Test]\n[00:03.050][00:01.2]A &amp; B\n[00:01.2]A &amp; B\n[00:02]<img src=x>'),[{timeMs:1200,text:'A & B'},{timeMs:2000,text:'<img src=x>'},{timeMs:3050,text:'A & B'}]);});
test('untimed real text remains plain and empty/instrumental responses have no invented rows',async()=>{assert.deepEqual(parseLrc('hello\n世界'),[{timeMs:null,text:'hello'},{timeMs:null,text:'世界'}]);assert.deepEqual(parseLrc('[ar:Artist]\n\n'),[]);const r=await fetchLyrics({key:'n1',platform:'netease',sourceId:'1'},{fetch:async()=>new Response(JSON.stringify({code:200,nolyric:true}))});assert.equal(r.status,'unavailable');assert.equal(r.lines.length,0);assert.match(r.message,/纯音乐/);});
test('translated lines attach only to the exact source timestamp',()=>{assert.deepEqual(withTranslation(parseLrc('[00:01.1]hello\n[00:02]world'),'[00:01.10]你好\n[00:03]别的'),[{timeMs:1100,text:'hello',translation:'你好'},{timeMs:2000,text:'world'}]);});
test('QQ JSONP/base64 from official response parses and bounded IDs cannot inject requests',async()=>{let address;const fetch=async url=>{address=url;return new Response('MusicJsonCallback('+JSON.stringify({retcode:0,lyric:Buffer.from('[00:02]line').toString('base64')})+')');};const r=await fetchLyrics({key:'q1',platform:'qq',sourceId:'001ABCdef'}, {fetch});assert.equal(r.lines[0].timeMs,2000);assert.match(address,/c\.y\.qq\.com\/lyric/);await assert.rejects(fetchLyrics({key:'x',platform:'qq',sourceId:'x&fake=1'},{fetch}));});
test('Bili uses only official captions and rejects off-platform subtitle URLs',async()=>{const t={key:'b1',platform:'bilibili',sourceId:'BV1gL411G7Bk',extra:{cid:1}};let count=0;const c={fetch:async()=>{count++;return new Response(JSON.stringify({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://evil.example/sub.json'}]}}}));}};await assert.rejects(fetchLyrics(t,c),/字幕来源无效/);assert.equal(count,1);const empty=await fetchLyrics(t,{fetch:async()=>new Response(JSON.stringify({code:0,data:{subtitle:{subtitles:[]}}}))});assert.equal(empty.lines.length,0);assert.equal(empty.source,'bilibili-subtitle');});
test('lyric cache authorizes current transient source and never unknown keys, coalesces same track',async()=>{const current={key:'temp',platform:'qq',sourceId:'001ABCdef'};let requests=0;const service=new LyricsService({engine:{current:()=>current,state:{tracks:[]}},contextFor:()=>({}),fetcher:async t=>{requests++;return{ok:true,key:t.key,status:'plain',lines:[{timeMs:null,text:'test'}]};}});await Promise.all([service.get('temp'),service.get('temp')]);assert.equal(requests,1);await assert.rejects(service.get('unknown'),/不存在/);});

test('QQ lyric transport sets a matching fixed official referrer policy while retaining session, redirect and abort protections',async()=>{
  const track={key:'qq:0023jknE09SmU1',platform:'qq',sourceId:'0023jknE09SmU1'};let calls=0;
  const result=await fetchLyrics(track,{fetch:async(url,options)=>{
    calls++;const address=new URL(url),headers=new Headers(options.headers);
    assert.equal(address.origin,'https://c.y.qq.com');assert.equal(address.pathname,'/lyric/fcgi-bin/fcg_query_lyric_new.fcg');assert.equal(address.searchParams.get('songmid'),track.sourceId);
    assert.equal(options.referrer,'https://y.qq.com/portal/player.html');assert.equal(headers.get('referer'),options.referrer);assert.equal(options.referrerPolicy,'unsafe-url');
    assert.equal(options.credentials,'include');assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);
    assert.equal(headers.has('cookie'),false);assert.equal(headers.has('origin'),false);
    return new Response(JSON.stringify({code:0,retcode:0,lyric:'[00:01.250]fixture line'}));
  }});
  assert.equal(calls,1);assert.equal(result.status,'synced');assert.equal(result.lines[0].timeMs,1250);
});

test('QQ platform rejection remains an error without alternate requests or invented lyric lines',async()=>{
  let calls=0;await assert.rejects(fetchLyrics({key:'q',platform:'qq',sourceId:'0023jknE09SmU1'},{fetch:async()=>{calls++;return new Response(JSON.stringify({retcode:-1,code:0,lyric:'[00:01]must not display'}));}}),/暂时无法读取/);assert.equal(calls,1);
});

test('a transient lyric failure is distinguishable from no lyrics and a second request can recover immediately',async()=>{
  const track={key:'qq:0023jknE09SmU1',platform:'qq',sourceId:'0023jknE09SmU1'};let calls=0;
  const service=new LyricsService({engine:{current:()=>track,state:{tracks:[]}},contextFor:()=>({}),fetcher:()=>{if(++calls===1)throw new Error('net failure with private details');return Promise.resolve({ok:true,key:track.key,status:'synced',lines:[{timeMs:1000,text:'fixture'}],source:'qq',message:''});}});
  const failed=await service.get(track.key);assert.equal(failed.status,'error');assert.deepEqual(failed.lines,[]);assert.match(failed.message,/重试/);assert.equal(JSON.stringify(failed).includes('private details'),false);assert.equal(service.cache.has(track.key),false);
  const recovered=await service.get(track.key);assert.equal(recovered.status,'synced');assert.equal(calls,2);assert.equal(service.cache.has(track.key),true);
});

test('a real empty lyric response stays unavailable and is cached without being treated as a transport failure',async()=>{
  const track={key:'qq:0023jknE09SmU1',platform:'qq',sourceId:'0023jknE09SmU1'};let calls=0;
  const service=new LyricsService({engine:{current:()=>track,state:{tracks:[]}},contextFor:()=>({}),fetcher:async()=>{calls++;return{ok:true,key:track.key,status:'unavailable',lines:[],source:'qq',message:'暂无歌词'};}});
  assert.equal((await service.get(track.key)).status,'unavailable');assert.equal((await service.get(track.key)).status,'unavailable');assert.equal(calls,1);
});

test('login-state invalidation clears only the requested platform including negative cache entries',async()=>{
  const qq={key:'qq:1',platform:'qq'},netease={key:'netease:1',platform:'netease'};const calls={qq:0,netease:0};
  const service=new LyricsService({engine:{current:()=>null,state:{tracks:[qq,netease]}},contextFor:()=>({}),fetcher:async track=>{calls[track.platform]++;return{ok:true,key:track.key,status:'unavailable',lines:[],source:track.platform,message:'暂无歌词'};}});
  await service.get(qq.key);await service.get(netease.key);assert.equal(service.invalidate('qq'),1);assert.equal(service.cache.has(qq.key),false);assert.equal(service.cache.has(netease.key),true);
  await service.get(qq.key);await service.get(netease.key);assert.deepEqual(calls,{qq:2,netease:1});assert.throws(()=>service.invalidate('https://example.com'),/不支持/);
});

test('a failed request invalidated during login cannot evict a newer successful same-track cache entry',async()=>{
  const track={key:'qq:1',platform:'qq'};let rejectFirst,calls=0;
  const service=new LyricsService({engine:{current:()=>track,state:{tracks:[]}},contextFor:()=>({}),fetcher:()=>++calls===1?new Promise((resolve,reject)=>rejectFirst=reject):Promise.resolve({ok:true,key:track.key,status:'synced',lines:[{timeMs:1000,text:'fixture'}],source:'qq',message:''})});
  const first=service.get(track.key);await Promise.resolve();assert.equal(service.invalidate('qq'),1);const second=await service.get(track.key);assert.equal(second.status,'synced');rejectFirst(new Error('old request'));
  assert.equal((await first).status,'error');assert.equal((await service.get(track.key)).status,'synced');assert.equal(calls,2);
});
