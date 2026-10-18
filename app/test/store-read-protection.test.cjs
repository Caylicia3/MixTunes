'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LibraryStore, normaliseLibrary } = require('../src/store.cjs');
function isolated(t) {
  const directory = fs.mkdtempSync(path.join(__dirname, '.mixlink-read-protection-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new LibraryStore(directory);
}
test('missing library still permits first-run initialization and restart', t => {
  const store = isolated(t), initial = store.load();
  store.save(initial);
  assert.deepEqual(new LibraryStore(store.directory).load(), initial);
});
for (const original of ['{"schemaVersion":2,"tracks":[', '']) {
  test(`unreadable JSON (${original.length} bytes) blocks load and every save without changing bytes`, t => {
    const store = isolated(t);
    fs.writeFileSync(store.file, original);
    assert.throws(() => store.load(), /歌单读取失败.*保留原文件.*禁止保存/);
    for (let i = 0; i < 2; i++) assert.throws(() => store.save(normaliseLibrary({})), /歌单读取失败/);
    assert.equal(fs.readFileSync(store.file, 'utf8'), original);
    assert.equal(fs.existsSync(store.file + '.tmp'), false);
    fs.unlinkSync(store.file);
    assert.throws(() => store.load(), /歌单读取失败/, 'removing the file does not silently unlock the failed instance');
    assert.throws(() => store.save({}), /歌单读取失败/);
  });
}
test('filesystem read failure is distinct from missing file and cannot create a replacement', t => {
  const store = isolated(t);
  fs.mkdirSync(store.file);
  assert.throws(() => store.load(), /歌单读取失败/);
  assert.throws(() => store.save({}), /歌单读取失败/);
  assert.equal(fs.statSync(store.file).isDirectory(), true);
  assert.equal(fs.existsSync(store.file + '.tmp'), false);
});
test('valid existing library preserves playlist settings and normal writes', t => {
  const store = isolated(t);
  const data = normaliseLibrary({ schemaVersion: 2, volume: .23, muted: true, qualitySettings: { qq: 'high' }, playlists: [{id:'kept', name:'保留歌单', queue:[], mode:'shuffle'}], activePlaylistId:'kept' });
  fs.writeFileSync(store.file, JSON.stringify(data));
  assert.deepEqual(store.load(), data);
  store.save(store.load());
  assert.deepEqual(new LibraryStore(store.directory).load(), data);
});
