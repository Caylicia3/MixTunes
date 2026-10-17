'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {parseInput,importResource}=require('../src/providers.cjs');
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const bvid=id=>'BV'+String(id).padStart(10,'0');
const favorite=id=>({id,type:2,bvid:bvid(id),title:'Favorite '+id,attr:0,ugc:{first_cid:id+100}});
const view=id=>({code:0,data:{bvid:bvid(id),aid:id,title:'Video '+id,pic:'http://i0.hdslb.com/bfs/archive/'+id+'.jpg',owner:{name:'Author '+id},pages:[{page:1,cid:id+100,duration:120+id}]}});
const folder=(items,count,hasMore=false)=>({code:0,data:{info:{id:1234567890,title:'Music',media_count:count},medias:items,has_more:hasMore}});
const resource=()=>parseInput('https://www.bilibili.com/medialist/detail/ml1234567890')[0];

test('Bilibili favourite parser accepts current/legacy folder routes and keeps folder and series namespaces distinct',()=>{
  for(const url of ['https://www.bilibili.com/medialist/detail/ml1234567890?spm_id_from=333.1','https://www.bilibili.com/list/ml1234567890?bvid=BV1Ga41177a3&oid=214631298','https://space.bilibili.com/123456789/favlist?fid=1234567890','https://www.bilibili.com/medialist/play/123456789?business=space&business_id=1234567890','https://www.bilibili.com/medialist/play/123456789?business=space_collection&business_id=1234567890','https://www.bilibili.com/list?listID=1234567890']){
    assert.deepEqual(parseInput(url)[0],{platform:'bilibili',kind:'favorites',id:'1234567890',url:'https://www.bilibili.com/medialist/detail/ml1234567890'});
  }
  for(const url of ['https://space.bilibili.com/123456789/lists/1234567890?type=season','https://space.bilibili.com/123456789/favlist?fid=not-an-id','https://www.bilibili.com/list/watchlater','https://www.bilibili.com.evil.test/list/ml1234567890'])assert.throws(()=>parseInput(url));
});

test('favourite import reads all official pages and preserves source order despite concurrent video checks',async()=>{
  const pages=[],viewCalls=[];let active=0,maxActive=0;
  const result=await importResource(resource(),{fetch:async(url,options)=>{
    assert.equal(options.credentials,'include');assert.equal(options.redirect,'manual');assert.equal(new Headers(options.headers).get('referer'),'https://www.bilibili.com/');
    const parsed=new URL(url);
    if(parsed.pathname.includes('/fav/resource/list')){
      const page=Number(parsed.searchParams.get('pn'));pages.push(page);
      assert.equal(parsed.searchParams.get('media_id'),'1234567890');assert.equal(parsed.searchParams.get('ps'),'20');assert.equal(parsed.searchParams.get('platform'),'web');assert.equal(parsed.searchParams.get('order'),'mtime');
      return response(folder(Array.from({length:page===1?20:3},(_,index)=>favorite((page-1)*20+index+1)),23,page===1));
    }
    const id=Number(parsed.searchParams.get('bvid').slice(2));viewCalls.push(id);active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,id%3===0?1:5));active--;return response(view(id));
  }});
  assert.deepEqual(pages,[1,2]);assert.equal(viewCalls.length,23);assert.ok(maxActive<=3);assert.ok(maxActive>1);
  assert.deepEqual(result.tracks.map(t=>t.sourceId),Array.from({length:23},(_,i)=>bvid(i+1)));
  assert.equal(result.expectedCount,23);assert.equal(result.declaredCount,23);assert.equal(result.fetchedCount,23);assert.equal(result.skippedCount,0);assert.deepEqual(result.warnings,[]);
  assert.equal(result.tracks[0].key,`bilibili:${bvid(1)}:101`);assert.equal(result.tracks[0].artist,'Author 1');assert.equal(result.tracks[0].durationMs,121000);assert.match(result.tracks[0].coverUrl,/^https:\/\/i0\.hdslb\.com/);
});

test('stale, private, deleted and unsupported favourite items are skipped with an honest count',async()=>{
  const medias=[favorite(1),{...favorite(2),attr:9,title:'已失效视频'},{...favorite(3),type:12},favorite(4),favorite(5),{...favorite(6),bvid:'invalid'}];let viewCalls=0;
  const result=await importResource(resource(),{fetch:async url=>{
    const parsed=new URL(url);if(parsed.pathname.includes('/fav/'))return response(folder(medias,6));viewCalls++;
    const id=Number(parsed.searchParams.get('bvid').slice(2));return response(id===4?{code:-403}:id===5?{code:-404}:view(id));
  }});
  assert.equal(viewCalls,3);assert.equal(result.tracks.length,1);assert.equal(result.fetchedCount,6);assert.equal(result.skippedCount,5);assert.equal(result.expectedCount,6);
  assert.ok(result.warnings.some(w=>/跳过 5 条/.test(w)));assert.equal(result.tracks[0].sourceId,bvid(1));
});

test('private or absent favourite folder fails explicitly instead of reporting an empty successful import',async()=>{
  for(const[code,expected]of[[-101,'LOGIN_REQUIRED'],[-403,'FAVORITES_UNAVAILABLE'],[-404,'NOT_FOUND'],[11201,'FAVORITES_UNAVAILABLE']]){
    let calls=0;await assert.rejects(importResource(resource(),{fetch:async()=>{calls++;return response({code,message:'private'});}}),error=>error.code===expected&&/收藏夹/.test(error.message));assert.equal(calls,1);
  }
  await assert.rejects(importResource(resource(),{fetch:async()=>response({code:0,data:{info:{id:1234567890,title:'Private',media_count:2,attr:1},medias:null,has_more:false}})}),error=>error.code==='FAVORITES_UNAVAILABLE'&&error.message.includes('私密'));
});

test('a later failed page retains accessible entries and warns that the declared total was not fetched',async()=>{
  const result=await importResource(resource(),{fetch:async url=>{
    const parsed=new URL(url);if(parsed.pathname.includes('/fav/'))return response(parsed.searchParams.get('pn')==='1'?folder(Array.from({length:20},(_,i)=>favorite(i+1)),23,true):{code:-403});return response(view(Number(parsed.searchParams.get('bvid').slice(2))));
  }});
  assert.equal(result.tracks.length,20);assert.equal(result.expectedCount,23);assert.equal(result.fetchedCount,20);assert.ok(result.warnings.some(w=>w.includes('第 2 页读取失败')));assert.ok(result.warnings.some(w=>/23.*20/.test(w)));
});

test('repeated favourite pages stop rather than looping and return each source only once',async()=>{
  let pages=0;const result=await importResource(resource(),{fetch:async url=>{
    const parsed=new URL(url);if(parsed.pathname.includes('/fav/')){pages++;return response(folder(Array.from({length:20},(_,i)=>favorite(i+1)),40,true));}return response(view(Number(parsed.searchParams.get('bvid').slice(2))));
  }});
  assert.equal(pages,2);assert.equal(result.tracks.length,20);assert.equal(result.fetchedCount,20);assert.equal(result.duplicateCount,20);assert.ok(result.warnings.some(w=>w.includes('没有返回新条目')));assert.ok(result.warnings.some(w=>/40.*20/.test(w)));
});

test('an actually empty accessible folder is distinguished from an inaccessible one',async()=>{
  const result=await importResource(resource(),{fetch:async()=>response(folder(null,0,false))});assert.equal(result.expectedCount,0);assert.equal(result.fetchedCount,0);assert.deepEqual(result.tracks,[]);assert.deepEqual(result.warnings,[]);
});
