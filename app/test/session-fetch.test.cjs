'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fetchWithSession } = require('../src/session-fetch.cjs');

function fallback(run) {
  const request = new EventEmitter();
  request.abort = () => { request.aborted = true; request.emit('abort'); };
  request.end = body => { request.body = body; queueMicrotask(() => run(request)); };
  const electron = { net: { request(options) { request.options = options; return request; } } };
  const session = { fetch: async () => { throw new Error('net::ERR_BLOCKED_BY_CLIENT'); } };
  return { request, electron, session };
}

test('normal fetch succeeds unchanged and unrelated errors never retry', async () => {
  const original = new Response('ok');
  assert.equal(await fetchWithSession({}, { fetch: async () => original }, 'https://x.test'), original);
  await assert.rejects(fetchWithSession({}, { fetch: async () => { throw new Error('ERR_ACCESS_DENIED'); } }, 'https://x.test', { redirect: 'manual' }), /ACCESS_DENIED/);
});

test('manual redirect is returned for caller validation, never followed', async () => {
  const env = fallback(request => request.emit('redirect', 302, 'GET', 'https://destination.test/', { location: ['https://destination.test/'], 'x-test': ['a'] }));
  const response = await fetchWithSession(env.electron, env.session, 'https://origin.test/', { redirect: 'manual', headers: { Range: 'bytes=0-100', Referer: 'https://www.bilibili.com/', 'User-Agent': 'test' } });
  assert.equal(response.status, 302);
  assert.equal(response.url, 'https://origin.test/');
  assert.equal(response.headers.get('location'), 'https://destination.test/');
  assert.equal(env.request.aborted, true);
  assert.equal(env.request.options.headers.range, 'bytes=0-100');
  assert.equal(env.request.options.credentials, 'include');
});

test('Electron Redirect was cancelled exposes a manual redirect without following it', async () => {
  const env = fallback(request => request.emit('redirect', 302, 'GET', 'https://y.music.163.com/m/song?id=123', {}));
  env.session.fetch = async () => { throw new Error('Redirect was cancelled'); };
  const response = await fetchWithSession(env.electron, env.session, 'https://163cn.tv/example', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://y.music.163.com/m/song?id=123');
  assert.equal(env.request.options.redirect, 'manual');
  assert.equal(env.request.aborted, true);
});

test('redirect fallback does not retry automatic redirects, unrelated cancellation or an aborted signal', async () => {
  let retries = 0;
  const electron = { net: { request() { retries++; throw new Error('unexpected retry'); } } };
  const session = { fetch: async () => { throw new Error('Redirect was cancelled'); } };
  await assert.rejects(fetchWithSession(electron, session, 'https://163cn.tv/example', { redirect: 'follow' }), /Redirect was cancelled/);
  await assert.rejects(fetchWithSession(electron, { fetch: async () => { throw new Error('Request was cancelled'); } }, 'https://163cn.tv/example', { redirect: 'manual' }), /Request was cancelled/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchWithSession(electron, session, 'https://163cn.tv/example', { redirect: 'manual', signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(retries, 0);
});

test('response streams before end and cancel aborts its upstream', async () => {
  let message;
  const env = fallback(request => {
    message = new EventEmitter(); message.statusCode = 206;
    message.headers = { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-9/100' };
    request.emit('response', message);
  });
  const response = await fetchWithSession(env.electron, env.session, 'https://origin.test/a', { redirect: 'manual' });
  const reader = response.body.getReader();
  message.emit('data', Buffer.from('first'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  assert.equal(response.status, 206);
  await reader.cancel();
  assert.equal(env.request.aborted, true);
});

test('AbortSignal continues to cancel a returned streaming response', async () => {
  const signal = new AbortController();
  const env = fallback(request => { const message = new EventEmitter(); message.statusCode = 200; message.headers = {}; request.emit('response', message); });
  const response = await fetchWithSession(env.electron, env.session, 'https://origin.test/a', { redirect: 'manual', signal: signal.signal });
  const pending = response.body.getReader().read();
  signal.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(env.request.aborted, true);
});

test('HEAD/null-body statuses work, replayable POST bodies preserve bytes', async () => {
  const env = fallback(request => { const message = new EventEmitter(); message.statusCode = 204; message.headers = {}; request.emit('response', message); message.emit('end'); });
  const response = await fetchWithSession(env.electron, env.session, 'https://origin.test/a', { redirect: 'manual', method: 'POST', body: '{"x":1}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.equal(env.request.body, '{"x":1}');
});
