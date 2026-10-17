'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { VideoPlayer, videoTarget, sameVideo, clipRange, clampVideoBounds, inspectBilibiliSession, playbackAccess, videoPageBootstrap } = require('../src/video-player.cjs');

function page() {
  class Media {
    constructor() { this.tagName = 'VIDEO'; this.listeners = {}; this.paused = true; this.ended = false; this.seeking = false; this.currentTime = 0; this.duration = 10; this.readyState = 1; this.videoWidth = 640; this.playCalls = 0; }
    play() { ++this.playCalls; this.paused = false; this.emit('play'); return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(value => value !== listener); }
    emit(type) { const event = { stopImmediatePropagation() { this.stopped = true; } }; for (const listener of this.listeners[type] || []) listener(event); return event; }
  }
  const video = new Media();
  class Document { querySelectorAll() { return [video]; } createElement() { return new Media(); } }
  const window = {};
  const location = { href: 'https://www.bilibili.com/video/BV17x411w7KC/?p=1' };
  const context = vm.createContext({ window, location, document: new Document(), HTMLMediaElement: Media, Document, MutationObserver: class { observe() {} }, URL, Set, WeakSet, setTimeout, clearTimeout });
  vm.runInContext(`(${videoPageBootstrap.toString()})('bridge')`, context);
  window.bridge.configure({ generation: 1, target: { bvid: 'BV17x411w7KC', page: 1 }, range: { startMs: 1000, endMs: 3000 }, volume: 0.5 });
  return { video, bridge: window.bridge, location };
}

test('only an exact official video and part are accepted', () => {
  const target = videoTarget({ platform: 'bilibili', sourceId: 'BV17x411w7KC', extra: { page: 2 } });
  assert.equal(sameVideo(target.url, target), true);
  assert.equal(sameVideo('https://www.bilibili.com.evil.test/video/BV17x411w7KC/?p=2', target), false);
  assert.equal(sameVideo('https://www.bilibili.com/video/BV17x411w7KC/?p=1', target), false);
  assert.throws(() => videoTarget({ platform: 'qq' }), /仅支持/);
  assert.throws(() => clipRange({ startMs: 2000, endMs: 1000 }), /无效/);
});

test('website autoplay stays muted and paused until prepared engine play', async () => {
  const { bridge, video } = page();
  await video.play();
  assert.equal(video.playCalls, 0);
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);
  assert.equal(bridge.prepare().ready, true);
  assert.equal(video.currentTime, 1);
  assert.equal(video.paused, true);
  await bridge.command('play');
  assert.equal(video.playCalls, 1);
  assert.equal(video.paused, false);
  assert.equal(video.muted, false);
});

test('clip end fires once and blocks official auto-next/loop', async () => {
  const { bridge, video } = page();
  bridge.prepare(); await bridge.command('play');
  video.currentTime = 3; video.emit('timeupdate'); video.emit('timeupdate');
  assert.equal(bridge.snapshot().events.filter(event => event.type === 'ended').length, 1);
  assert.equal(video.paused, true);
  await video.play();
  assert.equal(video.paused, true);
  assert.equal(video.playCalls, 1);
});

test('new generation and changed URL cannot keep previous video playing', async () => {
  const { bridge, video, location } = page();
  bridge.prepare(); await bridge.command('play');
  bridge.configure({ generation: 2, target: { bvid: 'BV17x411w7KC', page: 1 }, range: { startMs: 0, endMs: null }, volume: 0 });
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);
  bridge.prepare();
  location.href = 'https://www.bilibili.com/video/BV17x411w7KC/?p=2';
  await assert.rejects(bridge.command('play'), /其他视频/);
});

test('stale generation play is rejected before issuing page commands', async () => {
  const player = new VideoPlayer({ electron: {}, sessionFor: () => ({}) });
  player.current = { generation: 4 };
  await assert.rejects(player.play(3), /失效/);
  player.destroy();
});

test('a window closed by the user can be paused during engine cleanup', async () => {
  const player = new VideoPlayer({ electron: {}, sessionFor: () => ({}) });
  player.current = { generation: 1, record: { webContents: { isDestroyed: () => true } } };
  player._command = async () => { throw new Error('must not reach a destroyed renderer'); };
  await player.pause();
  player.destroy();
});

test('embedded bounds stay within host content and hiding does not close or pause', () => {
  assert.deepEqual(clampVideoBounds({ x: 700, y: -10, width: 500, height: 900 }, { width: 800, height: 600 }), { x: 700, y: 0, width: 100, height: 600 });
  const events = [];
  const player = new VideoPlayer({ electron: {}, sessionFor: () => ({}), onEvent: event => events.push(event) });
  let visible; let bounds;
  player.record = { host: { isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }) }, webContents: { isDestroyed: () => false }, view: { setBounds: value => { bounds = value; }, setVisible: value => { visible = value; } } };
  player.setLayout({ visible: true, bounds: { x: 500, y: 80, width: 600, height: 700 } });
  assert.deepEqual(bounds, { x: 500, y: 80, width: 300, height: 520 });
  player.setLayout({ visible: false });
  assert.equal(visible, false); assert.equal(events.length, 0);
  player.record = null; player.destroy();
});

test('official nav distinguishes verified logout from account-check network failure', async () => {
  const signedOut = await inspectBilibiliSession({ fetch: async () => new Response(JSON.stringify({ code: -101, data: { isLogin: false } })) });
  assert.equal(signedOut.isLogin, false); assert.equal(signedOut.verified, true);
  const unavailable = await inspectBilibiliSession({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(unavailable.isLogin, null); assert.equal(unavailable.status, 'unavailable');
  const signedIn = await inspectBilibiliSession({ fetch: async () => new Response(JSON.stringify({ code: 0, data: { isLogin: true } })) });
  assert.equal(signedIn.isLogin, true); assert.equal(signedIn.verified, true);
});

test('preview flags stay unknown without official evidence and anonymous play is gated', async () => {
  assert.equal(playbackAccess({ data: { timelength: 110000 } }).isPreview, null);
  assert.equal(playbackAccess({ data: { is_preview: false } }).isPreview, false);
  assert.equal(playbackAccess({ data: { is_preview: true } }).isPreview, true);
  const player = new VideoPlayer({ electron: {}, sessionFor: () => ({}) });
  player.current = { generation: 1, auth: { isLogin: false } };
  await assert.rejects(player.play(1), error => error.code === 'LOGIN_REQUIRED');
  player.current.auth.isLogin = null;
  await assert.rejects(player.play(1), error => error.code === 'AUTH_UNAVAILABLE');
  player.destroy();
});
