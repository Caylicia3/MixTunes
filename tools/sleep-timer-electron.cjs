'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('../app/node_modules/playwright-core');

// Runs the packaged Windows build. The test hook only exists when the app was
// started with --test-mode, so it is never reachable for normal users.
test('packaged Windows sleep timer expires while hidden in the tray', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const executable = process.env.MIXTUNES_SLEEP_EXECUTABLE || path.join(root, '.local-build/task-f-windows/win-unpacked/MixTunes.exe');
  if (!fs.existsSync(executable)) {
    t.skip(`packaged executable not found: ${executable}`);
    return;
  }
  const dataDir = path.join(root, '.local-build', 'task-f-runtime-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });
  const track = { key: 'netease:1', platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1', title: '隔离定时器测试', artist: '自动化测试', durationMs: 180000 };
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    schemaVersion: 2, tracks: [track],
    playlists: [{ id: 'source', name: '隔离测试歌单', queue: [track.key], currentKey: track.key, mode: 'sequential' }],
    queue: [track.key], currentKey: track.key, activePlaylistId: 'source', muted: true, volume: 0
  }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: executable, args: ['--test-mode', '--data-dir=' + dataDir], env, timeout: 60000 });
  t.after(() => app.close().catch(() => {}));
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.getElementById('connection-status').textContent === '已就绪');

  const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MixTunes').id);
  const visible = () => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), windowId);
  const hook = (expression) => app.evaluate(({ app }, source) => {
    const test = app.__mixSleepTest;
    if (!test) throw new Error('sleep test hook missing');
    return Function('test', 'return ' + source)(test);
  }, expression);

  // A playing player must be paused by the deadline even while hidden.
  await hook('test.forceStatus("playing")');
  const started = await hook('test.startSeconds(2)');
  assert.equal(started.active, true);
  assert.ok(started.remainingMs > 1000 && started.remainingMs <= 2000, 'short test duration accepted');

  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), windowId);
  await page.waitForTimeout(400);
  assert.equal(await visible(), false, 'closing hides instead of quitting');
  await page.waitForTimeout(2400);

  const expired = await hook('test.state()');
  assert.equal(expired.active, false, 'deadline cleared after expiry');
  const status = await hook('test.status()');
  assert.equal(status, 'paused', 'expiry paused the active playback');
  const state = await page.evaluate(() => window.playerAPI.getState());
  assert.equal(state.status, 'paused');
  assert.equal(state.currentKey, 'netease:1', 'current track kept');
  assert.equal(state.positionMs, 0, 'queue and progress untouched by the timer');
  assert.equal(await visible(), false, 'expiry never restores the window');
  assert.equal(app.process().killed, false, 'process stays alive after expiry');

  const log = await hook('test.log');
  const pauses = log.filter((entry) => entry.type === 'sleep-timer-expire');
  assert.equal(pauses.length, 1, 'expiry fires exactly once');
  assert.equal(pauses[0].pause, true, 'playing status requested a pause');

  // A manually paused player must never be resumed by the deadline.
  await app.evaluate(({ app }, id) => { app.emit('second-instance'); }, windowId);
  await page.waitForTimeout(300);
  assert.equal(await visible(), true, 'second instance restores the hidden window');
  await page.locator('#open-quality-settings').click();
  await page.locator('#sleep-timer-status').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器未开启');
  await page.locator('#close-quality-settings').click();

  await hook('test.forceStatus("paused")');
  await hook('test.startSeconds(1)');
  await page.waitForTimeout(1500);
  const secondLog = (await hook('test.log')).filter((entry) => entry.type === 'sleep-timer-expire');
  assert.equal(secondLog.length, 2);
  assert.equal(secondLog[1].pause, false, 'already paused never re-issues pause');
  assert.equal(await hook('test.status()'), 'paused', 'still paused, never resumed');
  assert.equal(await page.locator('#sleep-timer-cancel').isVisible().catch(() => false), false);

  const exit = new Promise(resolve => { app.process().once('exit', code => resolve(code)); setTimeout(() => resolve(null), 15000); });
  await app.evaluate(({ app }) => app.quit());
  assert.equal(await exit, 0, 'quitting the app leaves no timer process behind');
});
