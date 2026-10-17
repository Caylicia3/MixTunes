'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { QueueModel } = require('../src/queue.cjs');

test('sequential stops at end, repeat-all wraps, repeat-one permits explicit next', () => {
  const q = new QueueModel({ keys: ['a', 'b'] });
  q.select('a'); assert.equal(q.next({ natural: true }), 'b');
  assert.equal(q.next({ natural: true }), null);
  q.setMode('repeat-all'); assert.equal(q.next({ natural: true }), 'a');
  q.setMode('repeat-one'); assert.equal(q.next({ natural: true }), 'a');
  assert.equal(q.next({ natural: false }), 'b');
});
test('shuffle visits all remaining items once; peeking does not consume next', () => {
  const q = new QueueModel({ keys: ['a','b','c','d'], mode: 'shuffle', random: () => .25 });
  q.select('a');
  const peek = q.peekNext(); assert.equal(q.peekNext(), peek);
  const played = [q.currentKey, q.next(), q.next(), q.next()];
  assert.equal(new Set(played).size, 4);
  assert.equal(played[1], peek);
  const last = q.currentKey; assert.notEqual(q.next(), last);
});
test('previous follows playback history after shuffle and deleted items are omitted', () => {
  const q = new QueueModel({ keys: ['a','b','c'], mode: 'shuffle' });
  q.select('a'); q.select('c'); q.select('b');
  assert.equal(q.previous(), 'c');
  q.setKeys(['b','c']); assert.equal(q.previous(), 'c');
  assert.equal(q.currentKey, 'c');
});
test('failed repeat-one advances instead of retrying the same song forever', () => {
  const q = new QueueModel({ keys: ['a','b'], mode: 'repeat-one' });
  q.select('a'); assert.equal(q.next({ natural: true, failed: true }), 'b');
});
test('reorder preserves selected identity and invalid mode cannot mutate state', () => {
  const q = new QueueModel({ keys: ['a','b','c'] }); q.select('b');
  q.setKeys(['c','b','a']); assert.equal(q.peekNext(), 'a');
  assert.throws(() => q.setMode('bogus')); assert.equal(q.mode, 'sequential');
});
test('every complete shuffle cycle includes all songs without a repeated boundary',()=>{
  const q=new QueueModel({keys:['a','b','c','d'],mode:'shuffle',random:()=>.8});q.select('a');
  const first=[q.currentKey,q.next(),q.next(),q.next()];
  const second=[q.next(),q.next(),q.next(),q.next()];
  const third=[q.next(),q.next(),q.next(),q.next()];
  assert.equal(new Set(first).size,4);assert.equal(new Set(second).size,4);assert.equal(new Set(third).size,4);
  assert.notEqual(first.at(-1),second[0]);assert.notEqual(second.at(-1),third[0]);
});
