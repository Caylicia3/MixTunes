'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { target } = require('../ui/locate-playing.js');
const state = () => ({ currentKey: 'a', playbackPlaylistId: 'source', generation: 3,
  tracks: [{ key: 'a' }], playlists: [{ id: 'source', queue: ['a'] }] });

test('locate uses playback origin even when browsing a different playlist', () => {
  const snapshot = { ...state(), activePlaylistId: 'other', queue: [] };
  const before = structuredClone(snapshot);
  assert.deepEqual(target(snapshot), { key: 'a', playlistId: 'source', generation: 3 });
  assert.deepEqual(snapshot, before);
});

test('locate explains empty playback, preview, deleted origin and removed track', () => {
  for (const [patch, message] of [
    [{ currentKey: null }, '暂无'],
    [{ playbackPlaylistId: null }, '搜索试听'],
    [{ playlists: [] }, '已删除'],
    [{ playlists: [{ id: 'source', queue: [] }] }, '已移出'],
    [{ tracks: [] }, '已移出']
  ]) assert.ok(target({ ...state(), ...patch }).message.includes(message));
});
