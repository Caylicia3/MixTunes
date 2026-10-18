'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { _electron } = require('../app/node_modules/playwright-core');

test('Windows 1.0.0 accepted build upgrades to candidate without changing private data', { timeout: 45000, skip: process.platform !== 'win32' }, async t => {
  const oldExe = process.env.MIXTUNES_PREVIOUS_EXECUTABLE, newExe = process.env.MIXTUNES_RELEASE_EXECUTABLE;
  assert.ok(oldExe && newExe, 'Set previous and release executable paths');
  const directory = fs.mkdtempSync(path.resolve(__dirname, '../.local-build/release-upgrade-'));
  const track = {key:'netease:1', sourceId:'1', platform:'netease', url:'https://music.163.com/song?id=1', title:'隔离升级数据', artist:'测试'};
  fs.writeFileSync(path.join(directory,'library.json'), JSON.stringify({schemaVersion:2, tracks:[track], playlists:[{id:'one',name:'保留歌单',queue:[track.key],currentKey:track.key,mode:'repeat-one'},{id:'empty',name:'保留空歌单',queue:[],mode:'shuffle'}],activePlaylistId:'one',volume:.23,muted:true,qualitySettings:{qq:'high',netease:'standard',bilibili:'auto'}}));
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  async function launch(executablePath) {
    const app = await _electron.launch({executablePath, args:['--test-mode','--data-dir='+directory], env});
    t.after(() => app.close().catch(() => {}));
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelector('#connection-status').textContent === '已就绪' && document.querySelector('#background-mode') && !document.querySelector('#background-mode').disabled);
    return {app,page};
  }
  const previous = await launch(oldExe);
  const saved = await previous.page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width=64; canvas.height=64;
    canvas.getContext('2d').fillRect(0,0,64,64);
    const background = {version:1,image:canvas.toDataURL('image/jpeg'),crop:{x:.3,y:.7,zoom:1.5}};
    await playerAPI.background('save', background);
    const settings = {'mixtunes-background-mode':'custom','mixtunes-background-opacity':'41','mixtunes-background-blur-cover':'22','mixtunes-background-blur-custom':'7'};
    for(const [key,value] of Object.entries(settings)) localStorage.setItem(key,value);
    await playerAPI.sleepTimer('set',{minutes:15});
    return {background,settings};
  });
  await previous.app.close();
  const before = fs.readFileSync(path.join(directory,'custom-background.json'));
  const libraryBefore = JSON.parse(fs.readFileSync(path.join(directory,'library.json'),'utf8'));
  const next = await launch(newExe);
  const actual = await next.page.evaluate(async keys => ({settings:Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),background:await playerAPI.background('load'),sleep:await playerAPI.sleepTimer('get'),state:await playerAPI.getState()}),Object.keys(saved.settings));
  assert.deepEqual(actual.settings,saved.settings);
  assert.deepEqual(actual.background,saved.background);
  assert.equal(actual.sleep.endsAt, null);
  // JSON omits optional undefined fields in the runtime track objects.
  for(const key of ['tracks','playlists','activePlaylistId','qualitySettings','volume','muted']) assert.deepEqual(JSON.parse(JSON.stringify(actual.state[key])),libraryBefore[key]);
  assert.deepEqual(fs.readFileSync(path.join(directory,'custom-background.json')),before);
  await next.app.close();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'library.json'),'utf8')),libraryBefore);
});
