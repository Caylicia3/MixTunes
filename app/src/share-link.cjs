'use strict';
function isPrivateIpv4(host){
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return false;
  const p=host.split('.').map(Number);if(p.some(n=>n<0||n>255))return false;
  return p[0]===10||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31;
}
function normaliseShareLink(input){
  if(typeof input!=='string'||input.length>2048)throw new Error('请粘贴电脑生成的歌单链接');
  let url;try{url=new URL(input.trim());if(url.protocol==='mixtunes:'&&url.hostname==='playlist-import')url=new URL(url.searchParams.get('url'));}catch{throw new Error('歌单链接无效');}
  if(url.protocol!=='http:'||url.username||url.password||!isPrivateIpv4(url.hostname)||!/^\d+$/.test(url.port)||Number(url.port)<1024||Number(url.port)>65535||url.search||url.hash)throw new Error('仅支持同一 Wi-Fi 下电脑生成的歌单链接');
  const match=url.pathname.match(/^\/share\/([a-f0-9]{48})\/(?:library\.json)?$/);if(!match)throw new Error('歌单链接无效');
  url.pathname='/share/'+match[1]+'/library.json';return url.href;
}
module.exports={isPrivateIpv4,normaliseShareLink};
