'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('../app/node_modules/playwright-core');

test('packaged Windows keeps live blur and opacity across tray hiding and restart', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const executable = process.env.MIXTUNES_EFFECTS_EXECUTABLE || path.join(root, '.local-build/task-background-live-effects-windows/win-unpacked/MixTunes.exe');
  if (!fs.existsSync(executable)) { t.skip(`packaged executable not found: ${executable}`); return; }
  const dataDir = path.join(root, '.local-build', 'task-background-live-effects-runtime-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });
  const track = { key: 'netease:1', platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1', title: '背景效果测试', artist: '自动化测试', coverUrl: 'https://covers.test/cover.svg', durationMs: 180000 };
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    schemaVersion: 2, tracks: [track], playlists: [{ id: 'source', name: '隔离测试歌单', queue: [track.key], currentKey: track.key, mode: 'sequential' }],
    queue: [track.key], currentKey: track.key, activePlaylistId: 'source', muted: true, volume: 0
  }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#3a7"/></svg>';

  async function launch() {
    const app = await electron.launch({ executablePath: executable, args: ['--test-mode', '--data-dir=' + dataDir], env, timeout: 60000 });
    t.after(() => app.close().catch(() => {}));
    const page = await app.firstWindow();
    await page.route('https://covers.test/**', route => route.fulfill({ body: cover, contentType: 'image/svg+xml' }));
    await page.waitForFunction(() => document.getElementById('connection-status').textContent === '已就绪');
    return { app, page };
  }
  const vars = (page) => page.evaluate(() => {
    const container = document.getElementById('cover-background');
    return { blur: container.style.getPropertyValue('--background-blur').trim(), opacity: container.style.getPropertyValue('--background-opacity').trim() };
  });
  const setRange = (page, id, value, event) => page.locator('#' + id).evaluate((node, data) => { node.value = String(data.value); node.dispatchEvent(new Event(data.event, { bubbles: true })); }, { value, event });

  const first = await launch();
  await first.page.locator('#open-quality-settings').click();
  await first.page.locator('#background-mode').selectOption('current-cover');
  await first.page.waitForFunction(() => { const image = document.querySelector('#cover-background img'); return image && image.naturalWidth > 0; });
  await setRange(first.page, 'background-blur', 40, 'input');
  await setRange(first.page, 'background-opacity', 35, 'input');
  assert.deepEqual(await vars(first.page), { blur: '40px', opacity: '0.35' });
  assert.match(await first.page.evaluate(() => getComputedStyle(document.querySelector('#cover-background img')).filter), /blur\(40px\)/);
  assert.equal(await first.page.evaluate(() => getComputedStyle(document.querySelector('.app')).filter), 'none');
  assert.equal(await first.page.evaluate(() => document.querySelectorAll('#sleep-timer-status').length), 1, 'task F panel still present');
  await setRange(first.page, 'background-blur', 40, 'change');
  await setRange(first.page, 'background-opacity', 35, 'change');
  const before = await first.page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  assert.equal(before['mixtunes-background-blur-cover'], '40');
  assert.equal(before['mixtunes-background-opacity'], '35');

  const windowId = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MixTunes').id);
  await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), windowId);
  await first.page.waitForTimeout(300);
  assert.equal(await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), windowId), false);
  await first.app.evaluate(({ app }) => app.emit('second-instance'));
  await first.page.waitForTimeout(250);
  assert.equal(await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), windowId), true);
  assert.deepEqual(await vars(first.page), { blur: '40px', opacity: '0.35' }, 'tray cycle keeps the live effect');
  await first.app.close().catch(() => {});

  const second = await launch();
  await second.page.waitForFunction(() => { const image = document.querySelector('#cover-background img'); return image && image.naturalWidth > 0; });
  assert.equal(await second.page.locator('#background-mode').inputValue(), 'current-cover');
  assert.deepEqual(await vars(second.page), { blur: '40px', opacity: '0.35' }, 'restart restores both settings');
  await second.page.locator('#open-quality-settings').click();
  assert.equal(await second.page.locator('#background-blur').inputValue(), '40');
  assert.equal(await second.page.locator('#background-opacity').inputValue(), '35');
  assert.equal(await second.page.locator('#background-blur-value').textContent(), '40px');
  await second.app.close().catch(() => {});
});
