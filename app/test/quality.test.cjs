'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseQualitySettings, isQualitySupported } = require('../src/quality.cjs');
const { parseInput, importResource, resolveTrack } = require('../src/providers.cjs');

const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const qq = { platform: 'qq', sourceId: '0016IKty1sTxqi', url: 'https://y.qq.com/n/ryqq/songDetail/0016IKty1sTxqi', extra: { mediaMid: '002J3L3S3suxlD' } };
const netease = { platform: 'netease', sourceId: '33894312', url: 'https://music.163.com/song?id=33894312' };
const bili = { platform: 'bilibili', sourceId: 'BV17x411w7KC', url: 'https://www.bilibili.com/video/BV17x411w7KC', extra: { bvid: 'BV17x411w7KC', cid: '279786' } };

test('quality settings default to auto, reject unsupported levels and ignore foreign fields', () => {
  assert.deepEqual(normaliseQualitySettings(), { qq: 'auto', netease: 'auto', bilibili: 'auto' });
  assert.deepEqual(normaliseQualitySettings({ qq: 'high', netease: 'lossless', bilibili: 'lossless', evil: true }), { qq: 'high', netease: 'lossless', bilibili: 'auto' });
  assert.equal(isQualitySupported('qq', 'standard'), true);
  assert.equal(isQualitySupported('netease', 'hires'), false);
  assert.equal(isQualitySupported('bilibili', 'high'), false);
  assert.equal(isQualitySupported('foreign', 'auto'), false);
});

test('QQ auto requests original lossless, 320 MP3 and AAC together and chooses highest full authorization', async () => {
  let calls = 0;
  const result = await resolveTrack(qq, { fetch: async url => {
    calls++;
    const payload = JSON.parse(new URL(url).searchParams.get('data'));
    assert.deepEqual(payload.req_1.param.filename, ['F000002J3L3S3suxlD.flac', 'M800002J3L3S3suxlD.mp3', 'C400002J3L3S3suxlD.m4a']);
    assert.deepEqual(payload.req_1.param.songmid, [qq.sourceId, qq.sourceId, qq.sourceId]);
    return response({ code: 0, req_1: { code: 0, data: { sip: ['https://aqqmusic.tc.qq.com/'], midurlinfo: [
      { purl: 'C400same.m4a?vkey=test' }, { purl: 'F000same.flac?vkey=test' }, { purl: 'M800same.mp3?vkey=test' },
    ] } } });
  } });
  assert.equal(calls, 1);
  assert.match(result.url, /F000same\.flac/);
  assert.equal(result.requestedQuality, 'auto');
  assert.equal(result.actualQuality, 'lossless');
  assert.equal(result.codec, 'flac');
  assert.equal(result.qualityFallbackReason, undefined);
});

test('QQ unauthorized lossless gracefully uses returned 320 MP3 with a visible downgrade reason', async () => {
  const result = await resolveTrack(qq, { qualitySettings: { qq: 'lossless' }, fetch: async () => response({ code: 0, req_1: { code: 0, data: { sip: ['https://aqqmusic.tc.qq.com/'], midurlinfo: [
    { purl: '', result: 104003 }, { purl: 'M800same.mp3?vkey=test' }, { purl: 'C400same.m4a?vkey=test' },
  ] } } }) });
  assert.equal(result.requestedQuality, 'lossless');
  assert.equal(result.actualQuality, 'high');
  assert.equal(result.codec, 'mp3');
  assert.equal(result.bitrate, 320000);
  assert.match(result.quality, /320/);
  assert.match(result.qualityFallbackReason, /无损.*320/);
});

test('QQ high never asks for lossless and full AAC outranks a high-quality preview', async () => {
  const result = await resolveTrack(qq, { qualitySettings: { qq: 'high' }, fetch: async url => {
    const payload = JSON.parse(new URL(url).searchParams.get('data'));
    assert.deepEqual(payload.req_1.param.filename, ['M800002J3L3S3suxlD.mp3', 'C400002J3L3S3suxlD.m4a']);
    return response({ code: 0, req_1: { code: 0, data: { sip: ['https://aqqmusic.tc.qq.com/'], midurlinfo: [
      { purl: 'M800same.mp3?vkey=test', isPreview: true }, { purl: 'C400same.m4a?vkey=test' },
    ] } } });
  } });
  assert.equal(result.actualQuality, 'standard');
  assert.equal(result.preview, false);
  assert.match(result.qualityFallbackReason, /高品质.*AAC/);
  assert.equal(result.bitrate, undefined);
});

test('NetEase auto retries official lower levels only when higher authorization has no playable URL', async () => {
  const levels = [];
  const result = await resolveTrack(netease, { fetch: async url => {
    const query = new URL(url).searchParams;
    levels.push(query.get('level'));
    return response({ code: 200, data: [{ id: 33894312, code: query.get('level') === 'lossless' ? 404 : 200,
      url: query.get('level') === 'lossless' ? null : 'https://m8.music.126.net/original.mp3', level: 'exhigh', type: 'mp3', br: 320000 }] });
  } });
  assert.deepEqual(levels, ['lossless', 'exhigh']);
  assert.equal(result.actualQuality, 'high');
  assert.equal(result.bitrate, 320000);
  assert.equal(result.codec, 'mp3');
  assert.match(result.qualityFallbackReason, /无损.*320/);
});

test('NetEase describes the actual returned quality instead of claiming requested lossless', async () => {
  const result = await resolveTrack(netease, { qualitySettings: { netease: 'lossless' }, fetch: async () => response({ code: 200, data: [
    { id: 33894312, url: 'https://m8.music.126.net/original.mp3', level: 'standard', type: 'mp3', br: 128000 },
  ] }) });
  assert.equal(result.requestedQuality, 'lossless');
  assert.equal(result.actualQuality, 'standard');
  assert.equal(result.quality, 'MP3 128 kbps');
  assert.match(result.qualityFallbackReason, /无损/);
});

test('NetEase returns original FLAC when platform grants it without a false downgrade', async () => {
  const result = await resolveTrack(netease, { qualitySettings: { netease: 'lossless' }, fetch: async () => response({ code: 200, data: [
    { id: 33894312, url: 'https://m8.music.126.net/original.flac', level: 'lossless', type: 'flac', br: 860000 },
  ] }) });
  assert.equal(result.actualQuality, 'lossless');
  assert.equal(result.quality, 'FLAC 无损');
  assert.equal(result.codec, 'flac');
  assert.equal(result.qualityFallbackReason, undefined);
});

test('Bilibili auto chooses highest official AAC and standard chooses lower bandwidth', async () => {
  const fetch = async () => response({ code: 0, data: { dash: { audio: [
    { codecs: 'mp4a.40.2', bandwidth: 192000, baseUrl: 'https://primary.bilivideo.com/high.m4s' },
    { codecs: 'mp4a.40.2', bandwidth: 64000, baseUrl: 'https://primary.bilivideo.com/low.m4s' },
  ] } } });
  const highest = await resolveTrack(bili, { fetch });
  assert.match(highest.url, /high\.m4s/);
  assert.equal(highest.bitrate, 192000);
  assert.equal(highest.requestedQuality, 'auto');
  const standard = await resolveTrack(bili, { fetch, qualitySettings: { bilibili: 'standard' } });
  assert.match(standard.url, /low\.m4s/);
  assert.equal(standard.bitrate, 64000);
  assert.equal(standard.actualQuality, 'standard');
});

test('Bilibili imports HTTPS cover from official HTTP/relative image URL and rejects unsafe hosts', async () => {
  for (const [input, expected] of [
    ['http://i2.hdslb.com/bfs/archive/cover.jpg', 'https://i2.hdslb.com/bfs/archive/cover.jpg'],
    ['//i0.hdslb.com/bfs/archive/cover.jpg', 'https://i0.hdslb.com/bfs/archive/cover.jpg'],
    ['https://hdslb.com.evil.test/cover.jpg', ''],
    ['https://evil@i0.hdslb.com/cover.jpg', ''],
    ['https://i0.hdslb.com:8443/cover.jpg', ''],
  ]) {
    const imported = await importResource(parseInput(bili.url)[0], { fetch: async () => response({ code: 0, data: {
      bvid: bili.sourceId, aid: 170001, title: 'Test', pic: input, pages: [{ page: 1, cid: 279786, duration: 30 }],
    } }) });
    assert.equal(imported.tracks[0].coverUrl, expected);
  }
});
