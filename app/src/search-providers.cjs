'use strict';

const { requestPlatformJson, ProviderError } = require('./providers.cjs');
const { createHash } = require('node:crypto');
const PLATFORMS = new Set(['qq', 'netease', 'bilibili']);
const LABELS = { qq: 'QQ 音乐', netease: '网易云音乐', bilibili: 'Bilibili' };
const validMid = value => typeof value === 'string' && /^[a-zA-Z0-9]{6,32}$/.test(value);
const validBvid = value => typeof value === 'string' && /^BV[a-zA-Z0-9]{10}$/.test(value);
const validId = value => (typeof value !== 'number' || Number.isSafeInteger(value)) && /^\d{1,20}$/.test(String(value ?? '')) && !/^0+$/.test(String(value));
const isSubdomain = (host, root) => host === root || host.endsWith('.' + root);
// Normal WBI signing permutation from the official search client:
// https://s1.hdslb.com/bfs/static/shanks/laputa-search/assets/index-9c8665e7.js
// Signing keys below are public image filenames returned by /nav, not login
// credentials. No challenge tokens, CAPTCHA solving or alternate API is used.
const WBI_ORDER = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const biliKeys = new WeakMap();

function cleanText(value, limit = 500) {
  if (typeof value !== 'string') return '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', middot: '·', copy: '©' };
  let text = value;
  for (let pass = 0; pass < 2; pass++) text = text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? match;
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
  return text.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function coverUrl(value, platform) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) return '';
    const roots = platform === 'qq' ? ['gtimg.cn', 'qpic.cn'] : platform === 'netease' ? ['music.126.net'] : ['hdslb.com'];
    if (!roots.some(root => isSubdomain(url.hostname, root))) return '';
    url.protocol = 'https:'; url.port = ''; return url.href;
  } catch { return ''; }
}

function milliseconds(value, scale = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number * scale <= Number.MAX_SAFE_INTEGER ? Math.round(number * scale) : 0;
}
function bilibiliDuration(value) {
  if (typeof value === 'number') return milliseconds(value, 1000);
  if (typeof value !== 'string' || !/^\d{1,6}(?::\d{1,2}){1,2}$/.test(value.trim())) return 0;
  const parts = value.trim().split(':').map(Number);
  if (parts.slice(1).some(part => part >= 60)) return 0;
  return milliseconds(parts.reduce((seconds, part) => seconds * 60 + part, 0), 1000);
}

function qqItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.songmid || raw.mid;
  const title = cleanText(raw.songname || raw.title || raw.name);
  if (!validMid(id) || !title) return null;
  const albumMid = raw.albummid || raw.album?.mid;
  return { id, platform: 'qq', title,
    artist: (Array.isArray(raw.singer) ? raw.singer : []).map(artist => cleanText(artist?.name || artist?.title, 100)).filter(Boolean).join(' / ').slice(0, 300),
    coverUrl: validMid(albumMid) ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : coverUrl(raw.album?.picUrl || raw.picUrl, 'qq'),
    durationMs: milliseconds(raw.interval, 1000), url: `https://y.qq.com/n/ryqq/songDetail/${id}` };
}
function neteaseItem(raw) {
  if (!raw || typeof raw !== 'object' || !validId(raw.id)) return null;
  const title = cleanText(raw.name); if (!title) return null;
  const id = String(raw.id); const artists = raw.ar || raw.artists;
  return { id, platform: 'netease', title,
    artist: (Array.isArray(artists) ? artists : []).map(artist => cleanText(artist?.name, 100)).filter(Boolean).join(' / ').slice(0, 300),
    coverUrl: coverUrl(raw.al?.picUrl || raw.album?.picUrl, 'netease'), durationMs: milliseconds(raw.dt ?? raw.duration), url: `https://music.163.com/song?id=${id}` };
}
function bilibiliItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bvid = raw.bvid || raw.bv_id;
  const id = validBvid(bvid) ? bvid : validId(raw.aid) ? 'av' + raw.aid : '';
  const title = cleanText(raw.title); if (!id || !title) return null;
  return { id, platform: 'bilibili', title, artist: cleanText(raw.author, 300), coverUrl: coverUrl(raw.pic, 'bilibili'),
    durationMs: bilibiliDuration(raw.duration), url: `https://www.bilibili.com/video/${id}` };
}

function checkPlatformCode(platform, code, allowed) {
  if (allowed.includes(Number(code))) return;
  const blocked = [-352, -412, 412, 429].includes(Number(code));
  const login = [-101, 301, 401, 403, 1000, 104401].includes(Number(code));
  throw new ProviderError(blocked ? 'SEARCH_BLOCKED' : login ? 'LOGIN_REQUIRED' : 'SEARCH_UNAVAILABLE',
    blocked ? `${LABELS[platform]} 暂时限制了搜索请求，请到官方页面完成验证或稍后重试。` : login ? `${LABELS[platform]} 搜索需要登录，请在应用内打开官方登录窗口。` : `${LABELS[platform]} 暂未提供搜索结果，请稍后重试或打开官方搜索。`, { platform, platformCode: code });
}
function responseResult(platform, rawItems, count, page, pageSize, converter, serverHasMore) {
  if (!Array.isArray(rawItems) || count === null || count === undefined || !['number','string'].includes(typeof count) || !Number.isSafeInteger(Number(count)) || Number(count) < 0) throw new ProviderError('INVALID_RESPONSE', `${LABELS[platform]} 返回了无法识别的搜索数据。`);
  const seen = new Set(); const items = [];
  for (const raw of rawItems.slice(0, pageSize)) {
    const item = converter(raw);
    if (item && !seen.has(item.id)) { seen.add(item.id); items.push(item); }
  }
  // A malformed nonempty page is not a genuine zero-result search.
  if (rawItems.length && !items.length) throw new ProviderError('INVALID_RESPONSE', `${LABELS[platform]} 搜索结果缺少有效的歌曲或视频信息。`);
  const total = Number(count);
  return { platform, items, total, page, hasMore: page < 10 && rawItems.length > 0 && (serverHasMore === undefined ? page * pageSize < total : Boolean(serverHasMore)) };
}

async function searchQq(query, context, page, pageSize, signal) {
  const url = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp');
  for (const [key, value] of Object.entries({ w: query, format: 'json', p: page, n: pageSize, cr: 1, t: 0 })) url.searchParams.set(key, String(value));
  const data = await requestPlatformJson(url.href, 'qq', context, { signal });
  checkPlatformCode('qq', data.code, [0]);
  const songs = data.data?.song;
  return responseResult('qq', songs?.list, songs?.totalnum, page, pageSize, qqItem);
}
async function searchNetease(query, context, page, pageSize, signal) {
  const url = new URL('https://music.163.com/api/cloudsearch/pc');
  for (const [key, value] of Object.entries({ s: query, type: 1, limit: pageSize, offset: (page - 1) * pageSize, total: true })) url.searchParams.set(key, String(value));
  const data = await requestPlatformJson(url.href, 'netease', context, { signal });
  checkPlatformCode('netease', data.code, [200]);
  return responseResult('netease', data.result?.songs || (Number(data.result?.songCount) === 0 ? [] : undefined), data.result?.songCount, page, pageSize, neteaseItem);
}
async function searchBilibili(query, context, page, pageSize, signal) {
  let cached = biliKeys.get(context);
  if (!cached || cached.expiresAt < Date.now()) {
    const nav = await requestPlatformJson('https://api.bilibili.com/x/web-interface/nav', 'bilibili', context, { signal, headers: { Referer: 'https://search.bilibili.com/' } });
    const keyFromUrl = value => {
      const safe = coverUrl(value, 'bilibili');
      if (!safe) return '';
      return new URL(safe).pathname.split('/').pop().match(/^([a-f0-9]{32})\.[a-z0-9]+$/i)?.[1] || '';
    };
    const img = keyFromUrl(nav.data?.wbi_img?.img_url), sub = keyFromUrl(nav.data?.wbi_img?.sub_url);
    if (!img || !sub) throw new ProviderError('SEARCH_UNAVAILABLE', 'Bilibili 没有返回官方搜索签名资料，请稍后重试或打开官方搜索。');
    const source = img + sub;
    cached = { key: WBI_ORDER.map(index => source[index]).join('').slice(0, 32), expiresAt: Date.now() + 10 * 60 * 1000 };
    biliKeys.set(context, cached);
  }
  const values = { search_type: 'video', keyword: query, page, page_size: pageSize, order: 'totalrank', duration: 0, tids: 0,
    web_location: 1430654, platform: 'pc', highlight: 1, single_column: 0, source_tag: 3, wts: Math.round(Date.now() / 1000) };
  const encoded = Object.keys(values).sort().map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(values[key]).replace(/[!'()*]/g, ''))).join('&');
  const signature = createHash('md5').update(encoded + cached.key).digest('hex');
  const url = 'https://api.bilibili.com/x/web-interface/wbi/search/type?' + encoded + '&w_rid=' + signature;
  const data = await requestPlatformJson(url, 'bilibili', context, { signal, headers: { Referer: 'https://search.bilibili.com/' } });
  checkPlatformCode('bilibili', data.code, [0]);
  return responseResult('bilibili', data.data?.result || (Number(data.data?.numResults) === 0 ? [] : undefined), data.data?.numResults, page, pageSize, bilibiliItem,
    Number.isSafeInteger(Number(data.data?.numPages)) ? page < Number(data.data.numPages) : undefined);
}

async function searchPlatform(platform, query, context, options = {}) {
  if (!PLATFORMS.has(platform)) throw new ProviderError('UNSUPPORTED_PLATFORM', '不支持的搜索平台。');
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(query)) throw new ProviderError('INVALID_QUERY', '请输入 1 到 200 个字符的搜索词。');
  const page = options.page ?? 1, pageSize = options.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 20) throw new ProviderError('INVALID_PAGE', '搜索页数须为 1 到 10，每页最多 20 条。');
  if (typeof context?.fetch !== 'function') throw new ProviderError('NO_TRANSPORT', '未配置平台网络会话。');
  if (options.signal?.aborted) throw new ProviderError('SEARCH_CANCELED', '搜索已取消。');
  const controller = new AbortController(); let timeout = false;
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timeout = true; controller.abort(new DOMException('Search timed out', 'TimeoutError')); }, 10000); timer.unref?.();
  try {
    const resolver = platform === 'qq' ? searchQq : platform === 'netease' ? searchNetease : searchBilibili;
    return await resolver(query.trim(), context, page, pageSize, controller.signal);
  } catch (error) {
    if (options.signal?.aborted) throw new ProviderError('SEARCH_CANCELED', '搜索已取消。');
    if (timeout || error.details?.reason === 'TimeoutError') throw new ProviderError('SEARCH_TIMEOUT', `${LABELS[platform]} 搜索超时，请稍后重试。`);
    if (error.code === 'HTTP_ERROR' && [412, 429].includes(error.details?.status)) throw new ProviderError('SEARCH_BLOCKED', `${LABELS[platform]} 暂时限制了搜索请求，请到官方页面完成验证或稍后重试。`, { platform, status: error.details.status });
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); }
}

module.exports = { searchPlatform };
