'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const{createHash}=require('node:crypto');
const{searchPlatform}=require('../src/search-providers.cjs');
const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
const mid='002w57E00BGzXn';
const qqSong=(id=mid)=>({songmid:id,songname:'<em class="keyword">Song</em> &amp; Name',interval:180,singer:[{name:'Artist &quot;A&quot;'}],albummid:'001R1Xpd2hf7QR'});
const netSong=(id=33894312)=>({id,name:'Song',ar:[{name:'Artist'}],al:{picUrl:'http://p3.music.126.net/cover.jpg'},dt:180000});
const biliVideo=(id='BV17x411w7KC')=>({bvid:id,title:'<em class="keyword">钢琴</em> &amp; &#x97F3;乐',author:'UP &lt;img src=x onerror=evil&gt;',pic:'//i0.hdslb.com/bfs/archive/cover.jpg',duration:'1:02:03',arcurl:'https://evil.example/ignore'});
const nav=()=>({code:-101,data:{isLogin:false,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png',sub_url:'https://i0.hdslb.com/bfs/wbi/fedcba9876543210fedcba9876543210.png'}}});

test('QQ search uses first-party endpoint, forwards session options and builds canonical source links',async()=>{
  const result=await searchPlatform('qq','洛天依 & piano',{fetch:async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://c.y.qq.com');assert.equal(parsed.pathname,'/soso/fcgi-bin/client_search_cp');assert.equal(parsed.searchParams.get('w'),'洛天依 & piano');assert.equal(parsed.searchParams.get('p'),'2');assert.equal(parsed.searchParams.get('n'),'20');assert.equal(options.credentials,'include');assert.equal(options.redirect,'manual');assert.ok(options.signal);
    return response({code:0,data:{song:{list:[qqSong()],totalnum:41}}});
  }},{page:2});
  assert.equal(result.platform,'qq');assert.equal(result.total,41);assert.equal(result.page,2);assert.equal(result.hasMore,true);assert.equal(result.items[0].title,'Song & Name');assert.equal(result.items[0].artist,'Artist "A"');assert.equal(result.items[0].durationMs,180000);assert.equal(result.items[0].url,`https://y.qq.com/n/ryqq/songDetail/${mid}`);assert.match(result.items[0].coverUrl,/^https:\/\/y\.gtimg\.cn/);
});

test('NetEase search paginates by offset and accepts both current and legacy metadata shapes',async()=>{
  const result=await searchPlatform('netease','music',{fetch:async url=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://music.163.com');assert.equal(parsed.pathname,'/api/cloudsearch/pc');assert.equal(parsed.searchParams.get('offset'),'20');assert.equal(parsed.searchParams.get('type'),'1');
    return response({code:200,result:{songCount:21,songs:[netSong(),{id:'33894313',name:'Legacy',artists:[{name:'Old artist'}],album:{picUrl:'https://p4.music.126.net/old.jpg'},duration:200000}]}});
  }},{page:2});
  assert.equal(result.hasMore,false);assert.equal(result.items.length,2);assert.equal(result.items[0].coverUrl,'https://p3.music.126.net/cover.jpg');assert.equal(result.items[1].artist,'Old artist');assert.equal(result.items[1].durationMs,200000);assert.equal(result.items[1].url,'https://music.163.com/song?id=33894313');
});

test('Bilibili search follows current official WBI protocol and decodes title highlights to plain text',async()=>{
  let calls=0;
  const result=await searchPlatform('bilibili',"钢琴!'()*",{fetch:async(url,options)=>{
    calls++;const parsed=new URL(url);assert.equal(options.credentials,'include');assert.equal(new Headers(options.headers).get('referer'),'https://search.bilibili.com/');
    if(parsed.pathname.endsWith('/nav'))return response(nav());
    assert.equal(parsed.pathname,'/x/web-interface/wbi/search/type');assert.equal(parsed.searchParams.get('keyword'),'钢琴');assert.equal(parsed.searchParams.get('web_location'),'1430654');assert.equal(parsed.searchParams.get('page_size'),'20');assert.match(parsed.searchParams.get('w_rid'),/^[a-f0-9]{32}$/);assert.match(parsed.searchParams.get('wts'),/^\d{10}$/);
    const parameters=[...parsed.searchParams].filter(([key])=>key!=='w_rid').sort(([a],[b])=>a.localeCompare(b));
    const encoded=parameters.map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(value)).join('&');
    const source='0123456789abcdef0123456789abcdeffedcba9876543210fedcba9876543210';
    const order=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13];
    const key=order.map(index=>source[index]).join('');assert.equal(parsed.searchParams.get('w_rid'),createHash('md5').update(encoded+key).digest('hex'));
    return response({code:0,data:{result:[biliVideo()],numResults:100,numPages:5}});
  }});
  assert.equal(calls,2);assert.equal(result.items[0].title,'钢琴 & 音乐');assert.equal(result.items[0].artist,'UP');assert.equal(result.items[0].durationMs,3723000);assert.equal(result.items[0].coverUrl,'https://i0.hdslb.com/bfs/archive/cover.jpg');assert.equal(result.items[0].url,'https://www.bilibili.com/video/BV17x411w7KC');assert.equal(result.items[0].id,'BV17x411w7KC');assert.equal(result.items[0].key,undefined);assert.equal(result.items[0].cid,undefined);
});

test('Bilibili public keys cache per platform session and stop pagination after page ten',async()=>{
  let navCalls=0;const context={fetch:async url=>new URL(url).pathname.endsWith('/nav')?(navCalls++,response(nav())):response({code:0,data:{result:[biliVideo()],numResults:1000,numPages:50}})};
  assert.equal((await searchPlatform('bilibili','piano',context,{page:1})).hasMore,true);assert.equal((await searchPlatform('bilibili','piano',context,{page:10})).hasMore,false);assert.equal(navCalls,1);
});

test('untrusted IDs, executable/foreign images and payload links never enter the search result',async()=>{
  const result=await searchPlatform('netease','x',{fetch:async()=>response({code:200,result:{songCount:5,songs:[{...netSong(),name:'&lt;script&gt;evil()&lt;/script&gt;Safe &#0; Text',al:{picUrl:'https://music.126.net.evil.example/image'},url:'javascript:evil()'},netSong('1;evil()'),netSong(Number.MAX_SAFE_INTEGER+1),{...netSong(2),al:{picUrl:'javascript:evil()'}},{...netSong(3),al:{picUrl:'https://user:password@p3.music.126.net/image'}}]}})});
  assert.deepEqual(result.items.map(item=>item.id),['33894312','2','3']);assert.equal(result.items[0].title,'Safe Text');assert.ok(result.items.every(item=>item.coverUrl===''));assert.ok(result.items.every(item=>item.url.startsWith('https://music.163.com/song?id=')));
  const qq=await searchPlatform('qq','x',{fetch:async()=>response({code:0,data:{song:{list:[qqSong('bad/url'),qqSong()],totalnum:2}}})});assert.deepEqual(qq.items.map(item=>item.id),[mid]);
});

test('duplicate source IDs are returned once and malformed-only pages fail honestly',async()=>{
  const result=await searchPlatform('qq','x',{fetch:async()=>response({code:0,data:{song:{list:[qqSong(),qqSong()],totalnum:2}}})});assert.equal(result.items.length,1);assert.equal(result.total,2);
  await assert.rejects(searchPlatform('qq','x',{fetch:async()=>response({code:0,data:{song:{list:[qqSong('bad/url')],totalnum:1}}})}),error=>error.code==='INVALID_RESPONSE');
  await assert.rejects(searchPlatform('netease','x',{fetch:async()=>response({code:200,result:{songs:[],songCount:null}})}),error=>error.code==='INVALID_RESPONSE');
});

test('empty searches are valid only when the platform reports an actual zero total',async()=>{
  assert.deepEqual((await searchPlatform('qq','x',{fetch:async()=>response({code:0,data:{song:{list:[],totalnum:0}}})})).items,[]);
  const net=await searchPlatform('netease','x',{fetch:async()=>response({code:200,result:{songCount:0}})});assert.equal(net.total,0);assert.equal(net.hasMore,false);
  const bili=await searchPlatform('bilibili','x',{fetch:async url=>response(new URL(url).pathname.endsWith('/nav')?nav():{code:0,data:{numResults:0,numPages:0}})});assert.deepEqual(bili.items,[]);
});

test('Bilibili durations support minute and hour forms and reject malformed or fractional fields',async()=>{
  const videos=['3:09','62:03','1:02:03','1:99','not-time','1:02.5'].map((duration,i)=>({...biliVideo('BV'+String(i+1).padStart(10,'0')),duration}));
  const result=await searchPlatform('bilibili','x',{fetch:async url=>response(new URL(url).pathname.endsWith('/nav')?nav():{code:0,data:{result:videos,numResults:6,numPages:1}})});
  assert.deepEqual(result.items.map(item=>item.durationMs),[189000,3723000,3723000,0,0,0]);
});

test('platform rejection and HTTP anti-abuse failures stay explicit, with no retries or leaked server text',async()=>{
  for(const status of[412,429]){let calls=0;await assert.rejects(searchPlatform('qq','x',{fetch:async()=>{calls++;return response({message:'cookie=secret'},status);}}),error=>error.code==='SEARCH_BLOCKED'&&!error.message.includes('secret'));assert.equal(calls,1);}
  for(const[code,expected]of[[-352,'SEARCH_BLOCKED'],[-101,'LOGIN_REQUIRED'],[500,'SEARCH_UNAVAILABLE']])await assert.rejects(searchPlatform('netease','x',{fetch:async()=>response({code,message:'authorization=secret'})}),error=>error.code===expected&&!error.message.includes('secret'));
});

test('public WBI keys must be official safe image names and blocked responses never trigger key refresh loops',async()=>{
  const bad=nav();bad.data.wbi_img.img_url='https://evil.example/0123456789abcdef0123456789abcdef.png';let calls=0;
  await assert.rejects(searchPlatform('bilibili','x',{fetch:async()=>{calls++;return response(bad);}}),error=>error.code==='SEARCH_UNAVAILABLE');assert.equal(calls,1);
  calls=0;await assert.rejects(searchPlatform('bilibili','x',{fetch:async url=>{calls++;return response(new URL(url).pathname.endsWith('/nav')?nav():{code:-412});}}),error=>error.code==='SEARCH_BLOCKED');assert.equal(calls,2);
});

test('search redirect validation blocks foreign hosts before following them',async()=>{
  let calls=0;await assert.rejects(searchPlatform('qq','x',{fetch:async()=>{calls++;return new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}});}}),error=>error.code==='UNSAFE_URL');assert.equal(calls,1);
});

test('invalid query, platform, pages and pre-canceled requests never make a network call',async()=>{
  const context={fetch:async()=>{throw new Error('must not call');}};
  for(const query of['','  ','x'.repeat(201),'a\u0000b'])await assert.rejects(searchPlatform('qq',query,context),error=>error.code==='INVALID_QUERY');
  for(const options of[{page:0},{page:11},{page:1.5},{pageSize:21},{pageSize:0}])await assert.rejects(searchPlatform('qq','x',context,options),error=>error.code==='INVALID_PAGE');
  await assert.rejects(searchPlatform('evil','x',context),error=>error.code==='UNSUPPORTED_PLATFORM');const controller=new AbortController();controller.abort();await assert.rejects(searchPlatform('qq','x',context,{signal:controller.signal}),error=>error.code==='SEARCH_CANCELED');
});

test('caller cancellation aborts the actual transport and timeouts report a platform-specific error',async()=>{
  const controller=new AbortController();let interrupted=false;
  const pending=searchPlatform('qq','x',{fetch:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{interrupted=true;reject(new DOMException('cancel','AbortError'));},{once:true}))},{signal:controller.signal});
  controller.abort();await assert.rejects(pending,error=>error.code==='SEARCH_CANCELED');assert.equal(interrupted,true);
  await assert.rejects(searchPlatform('netease','x',{fetch:async()=>{throw new DOMException('timeout','TimeoutError');}}),error=>error.code==='SEARCH_TIMEOUT'&&error.message.includes('网易云'));
});

test('oversized search responses are rejected before parsing or displaying payloads',async()=>{
  await assert.rejects(searchPlatform('qq','x',{fetch:async()=>response({},200,{'content-length':String(13*1024*1024)})}),error=>error.code==='RESPONSE_TOO_LARGE');
});
