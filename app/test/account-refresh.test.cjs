'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { LyricsService } = require('../src/lyrics.cjs');

const sources = {
  android: path.resolve(__dirname, '../../android/runtime/app-runtime.js'),
  desktop: path.resolve(__dirname, '../src/main.cjs'),
};
const platforms = ['qq', 'netease', 'bilibili'];
const signedOut = () => ({ loggedIn: false, verified: false, status: 'signed-out' });
const accounts = () => Object.fromEntries(platforms.map(platform => [platform, signedOut()]));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

// Extract declarations from production files instead of duplicating their logic.
// These focused functions contain strings/comments and nested functions, but no regex literals.
function declaration(source, name) {
  const match = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(source);
  assert.ok(match, 'production declaration missing: ' + name);
  const start = match.index, body = source.indexOf('{', start);
  let depth = 0, quote = null, comment = null, escaped = false;
  for (let index = body; index < source.length; index++) {
    const character = source[index], next = source[index + 1];
    if (comment === 'line') { if (character === '\n') comment = null; continue; }
    if (comment === 'block') { if (character === '*' && next === '/') { comment = null; index++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '/') { comment = 'line'; index++; continue; }
    if (character === '/' && next === '*') { comment = 'block'; index++; continue; }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unterminated production declaration: ' + name);
}

function load(kind, dependencies = {}) {
  const source = fs.readFileSync(sources[kind], 'utf8');
  const names = ['publishAccounts', 'updateAccounts', ...(kind === 'desktop' ? ['scheduleAccountsUpdate'] : [])];
  const timers = new Map(); let timerSerial = 0;
  const context = {
    Promise, Map, Object, console,
    engine: { state: { accounts: accounts(), tracks: [] }, publish() {} },
    lyricsService: undefined,
    accountsPromise: null, accountsRefresh: null, accountsRefreshAgain: false,
    accountsTimer: null, pendingVideo: null, videoRequest: 0, videoRequestSerial: 0, quitting: false,
    loginUrls: Object.fromEntries(platforms.map(platform => [platform, 'https://fixture.invalid/'])),
    contextFor: platform => ({ platform }),
    setTimeout(callback, delay) { const id = ++timerSerial; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...dependencies,
  };
  vm.createContext(context);
  vm.runInContext(names.map(name => declaration(source, name)).join('\n') + '\nthis.sourceFunctions={' + names.join(',') + '};', context, { filename: sources[kind] });
  return { context, ...context.sourceFunctions, timers,
    async runTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } await tick(); },
  };
}

function raceHarness(kind, { rejectFirst = false } = {}) {
  const firstInspection = deferred(), calls = [], publications = [];
  let loggedIn = false, qqInspections = 0;
  const cookies = platform => { calls.push(platform); return platform === 'qq' && loggedIn ? [{ name: 'fixture-marker', value: 'synthetic-only' }] : []; };
  const engine = { state: { accounts: accounts(), tracks: [] }, publish() { publications.push(this.state.accounts.qq?.loggedIn); } };
  const harness = load(kind, {
    engine,
    native: async (method, { platform }) => { assert.equal(method, 'cookies'); return cookies(platform); },
    sessionFor: platform => ({ cookies: { get: async () => cookies(platform) } }),
    restoredAccountState: (_, list) => list.length ? { loggedIn: true, verified: false, status: 'session-restored' } : signedOut(),
    inspectAccount: async (platform, _, list) => {
      if (platform === 'qq' && ++qqInspections === 1) {
        await firstInspection.promise;
        if (rejectFirst) throw new Error('synthetic old-request failure');
      }
      return list.length ? { loggedIn: true, verified: true, status: 'signed-in', userId: 'fixture-user' } : signedOut();
    },
  });
  return { ...harness, calls, publications, firstInspection,
    login() { loggedIn = true; },
    async settle() { await tick(); if (kind === 'desktop') await harness.runTimers(); await tick(); },
  };
}

for (const kind of ['android', 'desktop']) {
  test(kind + ': authorization during an old account request queues one fresh refresh', async () => {
    const harness = raceHarness(kind);
    const original = harness.updateAccounts(); await tick();
    assert.equal(harness.calls.length, 3);
    harness.login();
    const repeated = [harness.updateAccounts(), harness.updateAccounts(), harness.updateAccounts()];
    harness.firstInspection.resolve();
    await Promise.all([original, ...repeated]); await harness.settle();
    assert.equal(harness.calls.length, 6, 'multiple refresh events coalesce into exactly one trailing cookie read');
    assert.equal(harness.context.engine.state.accounts.qq.loggedIn, true);
    assert.equal(harness.context.engine.state.accounts.qq.verified, true);
    assert.equal(harness.context.accountsRefreshAgain, false);
    assert.equal(harness.context[kind === 'android' ? 'accountsPromise' : 'accountsRefresh'], null);
    await harness.updateAccounts();
    assert.equal(harness.calls.length, 9, 'a completed refresh does not block the next explicit request');
  });
}

test('android: an old platform verification failure still permits trailing successful authorization', async () => {
  const harness = raceHarness('android', { rejectFirst: true });
  const original = harness.updateAccounts(); await tick(); harness.login();
  const afterLogin = harness.updateAccounts(); harness.firstInspection.resolve();
  await Promise.all([original, afterLogin]); await harness.settle();
  assert.equal(harness.calls.length, 6);
  assert.equal(harness.context.engine.state.accounts.qq.verified, true);
});

function cacheHarness(kind, fetcher) {
  const tracks = platforms.map((platform, index) => ({ key: platform + ':fixture-' + index, platform, sourceId: 'fixture-' + index }));
  const counts = Object.fromEntries(platforms.map(platform => [platform, 0]));
  const engine = { current: () => null, state: { tracks, accounts: accounts() }, publish() {} };
  const service = new LyricsService({ engine, contextFor: () => ({}), fetcher: async track => {
    counts[track.platform]++;
    return fetcher ? fetcher(track, counts[track.platform]) : { ok: true, key: track.key, status: 'unavailable', lines: [], message: '暂无歌词' };
  } });
  return { ...load(kind, { engine, lyricsService: service }), engine, service, tracks, counts };
}

for (const kind of ['android', 'desktop']) {
  for (const [field, value] of [['loggedIn', true], ['verified', true], ['userId', 'fixture-user'], ['status', 'expired']]) {
    test(kind + ': ' + field + ' transition invalidates only that platform lyric cache', async () => {
      const harness = cacheHarness(kind);
      for (const track of harness.tracks) await harness.service.get(track.key);
      const next = { ...harness.engine.state.accounts, qq: { ...harness.engine.state.accounts.qq, [field]: value } };
      harness.publishAccounts(next);
      assert.equal(harness.service.cache.has(harness.tracks[0].key), false);
      assert.equal(harness.service.cache.has(harness.tracks[1].key), true);
      assert.equal(harness.service.cache.has(harness.tracks[2].key), true);
      for (const track of harness.tracks) await harness.service.get(track.key);
      assert.deepEqual(harness.counts, { qq: 2, netease: 1, bilibili: 1 });
    });
  }
  test(kind + ': repeated identity and display-only changes retain cached lyrics', async () => {
    const harness = cacheHarness(kind);
    for (const track of harness.tracks) await harness.service.get(track.key);
    harness.publishAccounts({ ...harness.engine.state.accounts, qq: { ...harness.engine.state.accounts.qq, nickname: '改昵称', message: '改提示' } });
    for (const track of harness.tracks) await harness.service.get(track.key);
    assert.deepEqual(harness.counts, { qq: 1, netease: 1, bilibili: 1 });
  });
  test(kind + ': late pre-login lyric failure cannot erase a post-login cache entry', async () => {
    const old = deferred();
    const harness = cacheHarness(kind, async (track, attempt) => {
      if (attempt === 1) return old.promise;
      return { ok: true, key: track.key, status: 'synced', lines: [{ timeMs: 0, text: 'fresh fixture' }] };
    });
    const track = harness.tracks[0], oldRequest = harness.service.get(track.key); await tick();
    harness.publishAccounts({ ...harness.engine.state.accounts, qq: { loggedIn: true, verified: true, status: 'signed-in', userId: 'fixture-user' } });
    const fresh = await harness.service.get(track.key);
    old.reject(new Error('synthetic late old failure'));
    assert.equal((await oldRequest).status, 'error');
    assert.strictEqual(await harness.service.get(track.key), fresh);
    assert.equal(harness.counts.qq, 2);
  });
}
