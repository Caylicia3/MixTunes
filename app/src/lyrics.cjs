'use strict';
const {requestPlatformJson}=require('./providers.cjs');
const MAX_TEXT=1024*1024;
function decodeEntities(value){return String(value||'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(full,code)=>{const names={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(names[code.toLowerCase()])return names[code.toLowerCase()];const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return Number.isFinite(n)&&n>=0&&n<=0x10ffff?String.fromCodePoint(n):full;});}
function parseLrc(input){
  const text=decodeEntities(input).replace(/^\uFEFF/,'');if(text.length>MAX_TEXT)throw new Error('歌词过长');
  const timed=[],plain=[];const offset=Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1]||0);
  for(const raw of text.split(/\r?\n/).slice(0,20000)){
    const tags=[...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const line=raw.replace(/\[(?:\d{1,3}:\d{2}(?:[.:]\d{1,3})?|(?:ar|al|ti|au|by|offset|re|ve):[^\]]*)\]/gi,'').trim();
    if(!line)continue;
    if(tags.length){for(const tag of tags){const seconds=Number(tag[2]);if(seconds>=60)continue;timed.push({timeMs:Math.max(0,Number(tag[1])*60000+seconds*1000+Number((tag[3]||'').padEnd(3,'0'))+offset),text:line.slice(0,2000)});}}
    else plain.push({timeMs:null,text:line.slice(0,2000)});
  }
  const sorted=timed.sort((a,b)=>a.timeMs-b.timeMs);const seen=new Set();
  return (sorted.length?sorted:plain).filter(line=>{const id=line.timeMs+'\0'+line.text;if(seen.has(id))return false;seen.add(id);return true;}).slice(0,10000);
}
function withTranslation(lines,text){const translations=parseLrc(text);const byTime=new Map(translations.filter(l=>l.timeMs!==null).map(l=>[l.timeMs,l.text]));return lines.map(line=>({...line,...(byTime.has(line.timeMs)&&byTime.get(line.timeMs)!==line.text?{translation:byTime.get(line.timeMs)}:{})}));}
function result(track,lines,message='',source){return{ok:true,key:track.key,status:lines.some(l=>l.timeMs!==null)?'synced':lines.length?'plain':'unavailable',lines,source:source||track.platform,message:lines.length?'':message||'暂无歌词'};}
async function subtitleJson(value,context){
  let url=new URL(value.startsWith('//')?'https:'+value:value);
  for(let hop=0;hop<4;hop++){
    if(url.protocol!=='https:'||url.username||url.password||url.port&&!['443'].includes(url.port)||!/(^|\.)hdslb\.com$/.test(url.hostname)||!url.pathname.startsWith('/bfs/subtitle/'))throw new Error('字幕来源无效');
    const r=await context.fetch(url.href,{redirect:'manual',credentials:'include',headers:{Referer:'https://www.bilibili.com/'},signal:AbortSignal.timeout(8000)});
    if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('location'),url);continue;}
    if(!r.ok)throw new Error('字幕暂时无法读取');if(Number(r.headers.get('content-length')||0)>MAX_TEXT)throw new Error('字幕过长');
    const text=await r.text();if(text.length>MAX_TEXT)throw new Error('字幕过长');return JSON.parse(text);
  }throw new Error('字幕跳转过多');
}
async function fetchLyrics(track,context){
  if(!track||!['qq','netease','bilibili'].includes(track.platform))throw new Error('歌曲不存在');
  const options={signal:AbortSignal.timeout(9000)};
  if(track.platform==='netease'){
    if(!/^\d{1,20}$/.test(track.sourceId))throw new Error('歌曲来源无效');
    const data=await requestPlatformJson('https://music.163.com/api/song/lyric?'+new URLSearchParams({id:track.sourceId,lv:'-1',tv:'-1',kv:'-1'}),'netease',context,options);
    if(data.code!==undefined&&Number(data.code)!==200)throw new Error('歌词暂时无法读取');
    const lines=withTranslation(parseLrc(data.lrc?.lyric||''),data.tlyric?.lyric||'');
    return result(track,lines,data.nolyric?'纯音乐，无歌词':'暂无歌词');
  }
  if(track.platform==='qq'){
    if(!/^[\da-zA-Z]{6,32}$/.test(track.sourceId))throw new Error('歌曲来源无效');
    const referrer='https://y.qq.com/portal/player.html';
    // Electron/Chromium rejects this explicit cross-origin full Referer under
    // its default strict policy before sending the lyric request. Restrict the
    // matching policy to this QQ endpoint and fixed public official page.
    const data=await requestPlatformJson('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?'+new URLSearchParams({songmid:track.sourceId,g_tk:'5381',format:'json',nobase64:'1',inCharset:'utf8',outCharset:'utf-8',platform:'yqq.json',needNewCode:'0'}),'qq',context,{...options,referrer,referrerPolicy:'unsafe-url',headers:{Referer:referrer}});
    if(Number(data.retcode||data.code||0)!==0)throw new Error('歌词暂时无法读取');
    const decode=text=>{const value=String(text||'');if(data.nobase64===0)return Buffer.from(value,'base64').toString('utf8');if(value.length%4===0&&/^[A-Za-z0-9+/=]+$/.test(value)){const decoded=Buffer.from(value,'base64').toString('utf8');if(/\[\d{1,3}:\d{2}/.test(decoded))return decoded;}return value;};
    return result(track,withTranslation(parseLrc(decode(data.lyric)),decode(data.trans)), '暂无歌词');
  }
  if(!/^BV[a-zA-Z0-9]{10}$/.test(track.sourceId))return result(track,[],'这个视频暂无字幕','bilibili-subtitle');
  let cid=String(track.extra?.cid||'');
  if(!/^\d{1,20}$/.test(cid)){
    const view=await requestPlatformJson('https://api.bilibili.com/x/web-interface/view?bvid='+encodeURIComponent(track.sourceId),'bilibili',context,options);
    cid=String(view.data?.cid||'');
  }
  if(!/^\d{1,20}$/.test(cid))return result(track,[],'这个视频暂无字幕','bilibili-subtitle');
  const data=await requestPlatformJson('https://api.bilibili.com/x/player/v2?'+new URLSearchParams({bvid:track.sourceId,cid}),'bilibili',context,options);
  if(Number(data.code||0)!==0)return result(track,[],'字幕需要登录或暂不可用','bilibili-subtitle');
  const subtitles=data.data?.subtitle?.subtitles||[];const chosen=subtitles.find(s=>/^(zh|ai-zh)/.test(String(s.lan)))||subtitles[0];
  if(!chosen?.subtitle_url)return result(track,[],'这个视频暂无字幕','bilibili-subtitle');
  const body=await subtitleJson(chosen.subtitle_url,context);const lines=(Array.isArray(body.body)?body.body:[]).slice(0,10000).filter(l=>Number.isFinite(l.from)&&l.from>=0&&typeof l.content==='string'&&l.content.trim()).map(l=>({timeMs:Math.round(l.from*1000),text:decodeEntities(l.content).slice(0,2000)})).sort((a,b)=>a.timeMs-b.timeMs);
  return result(track,lines,'这个视频暂无字幕','bilibili-subtitle');
}
class LyricsService{
  constructor({engine,contextFor,fetcher=fetchLyrics,now=()=>Date.now()}){Object.assign(this,{engine,contextFor,fetcher,now});this.cache=new Map();}
  invalidate(platform){
    if(!['qq','netease','bilibili'].includes(platform))throw new Error('不支持的平台');
    let removed=0;for(const [key,entry]of this.cache)if(entry.platform===platform){this.cache.delete(key);removed++;}
    return removed;
  }
  async get(key){
    if(typeof key!=='string'||key.length>200)throw new Error('歌曲参数无效');
    const track=this.engine.current()?.key===key?this.engine.current():this.engine.state.tracks.find(t=>t.key===key);
    if(!track)throw new Error('歌曲不存在');
    const cached=this.cache.get(key);if(cached&&cached.until>this.now())return cached.value;
    const value=Promise.resolve().then(()=>this.fetcher(track,this.contextFor(track.platform))).catch(()=>({...result(track,[],'歌词暂时无法加载，请稍后重试'),status:'error'}));
    this.cache.set(key,{until:this.now()+5*60000,value,platform:track.platform});while(this.cache.size>50)this.cache.delete(this.cache.keys().next().value);
    const data=await value;if(data.status==='error'&&this.cache.get(key)?.value===value)this.cache.delete(key);return data;
  }
}
module.exports={parseLrc,withTranslation,fetchLyrics,LyricsService};
