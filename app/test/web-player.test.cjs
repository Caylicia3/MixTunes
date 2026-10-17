'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { WebPlayer, allowedNavigation, qqSong, neteaseSong, pageBootstrap } = require('../src/web-player.cjs');

function page(range={startMs:0,endMs:null}) {
  const playPositions=[];
  class Media {
    constructor() { this.listeners = {}; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 200; this.readyState=1; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type) { const event = { stopImmediatePropagation() { this.stopped = true; } }; for (const listener of this.listeners[type] || []) listener(event); return event; }
    play() { playPositions.push(this.currentTime);this.paused = false; this.emit('playing'); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  class Document { createElement(type) { return new Media(); } querySelectorAll() { return []; } querySelector() { return null; } }
  const media = new Media();
  const api = { info: {}, setPlayerList(_play, list) { this.list = list; }, pausePlayer() { media.pause(); }, playAnyPos() { this.info = this.list[0]; media.play(); }, getSongInfoObj() { return this.info; }, OnSongPlayEnd() {} };
  const window = { require: () => ({ interFace: api }) };
  const context = vm.createContext({ window, document: new Document(), HTMLMediaElement: Media, Document, CSS: { escape: value => value }, URL, Set, WeakMap });
  vm.runInContext(`(${pageBootstrap.toString()})('bridge')`, context);
  const bridge = window.bridge;
  bridge.configure({ track: { platform: 'qq', durationMs: 200000 }, expectedId: 'target', generation: 1, qqSong: { songmid: 'target', songid: 1 },range });
  return { bridge, media, api,playPositions };
}

test('official navigation requires web protocol and exact domain suffixes', () => {
  assert.equal(allowedNavigation('qq', 'https://ptlogin2.qq.com/login'), true);
  assert.equal(allowedNavigation('qq', 'https://qq.com.evil.example/'), false);
  assert.equal(allowedNavigation('qq', 'file:///C:/Users/'), false);
  assert.equal(allowedNavigation('netease', 'https://music.163.com/#/song?id=1'), true);
  assert.equal(allowedNavigation('netease', 'https://not163.com/'), false);
});

test('song payloads preserve official identifiers and normalize both API shapes', () => {
  assert.equal(qqSong({ sourceId: 'mid', title: 'T', extra: { qqRawSong: { mid: 'mid', id: 12, name: 'T' } } }).songid, 12);
  assert.throws(() => qqSong({ sourceId: 'mid' }), /原始资料/);
  assert.deepEqual(neteaseSong({ sourceId: '1', extra: { neteaseRawSong: { id: 1, ar: [{ name: 'A' }], al: { name: 'B' }, dt: 90000 } } }).artists, [{ name: 'A' }]);
});

test('QQ manual OnSongPlayEnd does not advance unified queue; real media end does once', async () => {
  const { bridge, media, api } = page();
  await bridge.command('play');
  api.OnSongPlayEnd();
  assert.equal(bridge.snapshot().events.length, 0);
  media.currentTime = 200; media.ended = true;
  assert.equal(media.emit('ended').stopped, true);
  media.emit('ended');
  const events = bridge.snapshot().events;
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'ended');
});

test('wrong song media events and preview ends cannot advance queue', async () => {
  const { bridge, media, api } = page();
  await bridge.command('play');
  api.info = { songmid: 'different' };
  media.ended = true;
  media.emit('ended');
  assert.equal(bridge.snapshot().events.length, 0);
  api.info = { songmid: 'target' };
  media.duration = 30;
  media.emit('ended');
  assert.equal(bridge.snapshot().events[0].type, 'error');
});

test('playing requires observed progress; obsolete generation snapshots are ignored', async () => {
  const emitted = [];
  const player = new WebPlayer({ electron: {}, sessionFor: () => ({}), onEvent: event => emitted.push(event) });
  clearInterval(player.timer);
  const request = { track: { key: 'qq:target' }, generation: 2, record: {}, started: true, startedAt: Date.now(), lastPosition: null };
  player.current = request;
  const states = [
    { generation: 1, matches: true, media: true, paused: false, positionMs: 9000, durationMs: 200000 },
    { generation: 2, matches: true, media: true, paused: false, positionMs: 0, durationMs: 200000 },
    { generation: 2, matches: true, media: true, paused: false, positionMs: 350, durationMs: 200000 },
  ];
  player._eval = async () => states.shift();
  await player._poll();
  assert.equal(emitted.length, 0);
  await player._poll();
  assert.equal(emitted.some(event => event.type === 'playing'), false);
  await player._poll();
  assert.equal(emitted.filter(event => event.type === 'playing').length, 1);
  player.destroy();
});

test('stale play/pause generations and command results cannot control a new load', async () => {
  const player = new WebPlayer({ electron: {}, sessionFor: () => ({}) });
  clearInterval(player.timer);
  const request = { track: { key: 'qq:old' }, generation: 2, record: {}, started: true };
  player.current = request;
  let executed = false;
  player._eval = async () => { executed = true; return true; };
  await assert.rejects(player.play(1), /失效/);
  await assert.rejects(player.pause(1), /失效/);
  assert.equal(executed, false);
  assert.equal(request.started, true);
  let finish;
  player._eval = () => new Promise(resolve => { finish = resolve; });
  const command = player._command('play', null, 2);
  player.current = { track: { key: 'qq:new' }, generation: 3, record: {} };
  finish(true);
  await assert.rejects(command, /失效/);
  player.destroy();
});

test('official webpage gates automatic playback and seeks before the first original play',async()=>{
  const {bridge,media,api,playPositions}=page({startMs:10000,endMs:40000});
  api.info={songmid:'target'};await media.play();assert.equal(playPositions.length,0);
  await bridge.command('seek',25000);await bridge.command('play');assert.deepEqual(playPositions,[25]);
  await bridge.command('pause');await bridge.command('seek',500);assert.equal(media.currentTime,10);assert.equal(media.paused,true);
});

test('official webpage clip boundary emits exactly one natural end and keeps the source duration intact',async()=>{
  const {bridge,media,playPositions}=page({startMs:10000,endMs:20000});await bridge.command('play');assert.deepEqual(playPositions,[10]);
  media.currentTime=20;media.emit('timeupdate');media.emit('timeupdate');media.ended=true;media.emit('ended');
  const events=bridge.snapshot().events;assert.equal(events.filter(event=>event.type==='ended').length,1);assert.equal(media.paused,true);assert.equal(media.duration,200);
});
