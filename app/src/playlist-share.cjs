'use strict';
const http=require('node:http'),os=require('node:os'),fs=require('node:fs'),crypto=require('node:crypto');
const {normaliseLibrary}=require('./store.cjs');const {isPrivateIpv4}=require('./share-link.cjs');
function shareLibrary(state){
  const library=normaliseLibrary(state);
  library.tracks=library.tracks.map(t=>{
    const cleaned={};for(const field of ['key','platform','sourceId','url','title','artist','album','coverUrl','durationMs','displayTitle','playRange'])if(t[field]!==undefined)cleaned[field]=t[field];
    if(t.extra){const extra={};for(const field of ['cid','aid','bvid','page','mediaMid','fee']){const v=t.extra[field];if(typeof v==='string'&&v.length<100||typeof v==='number'&&Number.isFinite(v))extra[field]=v;}if(Object.keys(extra).length)cleaned.extra=extra;}
    return cleaned;
  });return library;
}
function localAddresses(){return Object.entries(os.networkInterfaces()).flatMap(([name,entries])=>(entries||[]).filter(e=>!e.internal&&(e.family==='IPv4'||e.family===4)&&isPrivateIpv4(e.address)).map(e=>({address:e.address,label:name}))).sort((a,b)=>Number(/virtual|vmware|docker|wsl|tailscale|vpn/i.test(a.label))-Number(/virtual|vmware|docker|wsl|tailscale|vpn/i.test(b.label)));}
class PlaylistShare{
  constructor({getLibrary,apkPath,addresses=localAddresses,now=()=>Date.now(),ttlMs=20*60000}){Object.assign(this,{getLibrary,apkPath,addresses,now,ttlMs});this.server=null;this.share=null;this.timer=null;}
  async start(){
    this.stop();const addresses=this.addresses();if(!addresses.length)throw new Error('没有找到局域网地址，请让电脑和手机连接同一 Wi-Fi');
    const library=shareLibrary(this.getLibrary()),json=Buffer.from(JSON.stringify(library,null,2));if(json.length>12*1024*1024)throw new Error('歌单文件大于 12 MB，请先分批导出');
    const token=crypto.randomBytes(24).toString('hex'),expiresAt=this.now()+this.ttlMs;
    const server=http.createServer((req,res)=>this.handle(req,res));server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});
    this.server=server;const port=server.address().port;const urls=addresses.map(a=>({url:`http://${a.address}:${port}/share/${token}/`,label:a.label}));
    this.share={token,expiresAt,json,urls,trackCount:library.tracks.length,playlistCount:library.playlists.length};
    this.timer=setTimeout(()=>this.stop(),this.ttlMs);this.timer.unref?.();return{ok:true,url:urls[0].url,urls,expiresAt,trackCount:library.tracks.length,playlistCount:library.playlists.length};
  }
  handle(req,res){
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
    const send=(status,body,type='text/plain;charset=utf-8',extra={})=>{res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(req.method==='HEAD'?'':body);};
    const share=this.share;if(!share||this.now()>=share.expiresAt)return send(410,'链接已过期，请在电脑上重新生成');
    if(!['GET','HEAD'].includes(req.method))return send(405,'仅支持读取');
    const peer=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');if(!isPrivateIpv4(peer)&&peer!=='127.0.0.1')return send(403,'仅限局域网访问');
    const host=String(req.headers.host||'');const known=share.urls.find(x=>new URL(x.url).host===host);if(!known)return send(403,'地址无效');
    if(req.headers.origin&&req.headers.origin!=='http://'+host)return send(403,'来源无效');
    const base='/share/'+share.token+'/';if(req.url===base+'library.json')return send(200,share.json,'application/json;charset=utf-8',{'Content-Disposition':'attachment; filename="MixTunes-playlists.json"'});
    if(req.url===base+'MixTunes.apk'){
      const file=typeof this.apkPath==='function'?this.apkPath():this.apkPath;
      if(!file||!fs.existsSync(file))return send(404,'新版安装包尚未放入播放器文件夹');
      res.writeHead(200,{...headers,'Content-Type':'application/vnd.android.package-archive','Content-Length':fs.statSync(file).size,'Content-Disposition':'attachment; filename="MixTunes.apk"'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);return;
    }
    if(req.url!==base)return send(404,'链接无效');
    const dataUrl='http://'+host+base+'library.json',deep='mixtunes://playlist-import?url='+encodeURIComponent(dataUrl);
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>导入 MixTunes 歌单</title><style>body{font:16px system-ui,sans-serif;max-width:480px;margin:50px auto;padding:24px;color:#202124;background:#fafafa}h1{font-size:28px}a{display:block;background:#25262a;color:white;padding:16px;margin:14px 0;border-radius:14px;text-decoration:none;text-align:center}a.secondary{background:#e8e8eb;color:#25262a}p{color:#676971;line-height:1.7}</style><h1>MixTunes</h1><p>${share.playlistCount} 个歌单 · ${share.trackCount} 首歌曲</p><a href="${deep}">在 MixTunes 中导入</a><a class="secondary" href="${base}MixTunes.apk">安装／更新安卓版</a><a class="secondary" href="${base}library.json">下载歌单 JSON</a><p>电脑保持打开 MixTunes。链接 20 分钟内有效。歌单会合并到手机，账号需在手机上登录。</p></html>`;
    return send(200,html,'text/html;charset=utf-8');
  }
  stop(){clearTimeout(this.timer);this.timer=null;this.share=null;if(this.server){this.server.close();this.server.closeIdleConnections?.();this.server=null;}return{ok:true};}
}
module.exports={PlaylistShare,shareLibrary,localAddresses};
