'use strict';

const MODES = new Set(['sequential', 'repeat-all', 'repeat-one', 'shuffle']);

class QueueModel {
  constructor({ keys = [], mode = 'sequential', random = Math.random } = {}) {
    this.keys = [...new Set(keys)];
    this.mode = MODES.has(mode) ? mode : 'sequential';
    this.currentKey = null;
    this.history = [];
    this.bag = [];
    this.shuffleStarted = false;
    this.random = random;
  }
  setKeys(keys) {
    this.keys = [...new Set(keys)];
    this.history = this.history.filter(k => this.keys.includes(k));
    this.bag = this.bag.filter(k => this.keys.includes(k));
    if (!this.keys.includes(this.currentKey)) this.currentKey = null;
    this.bag = [];
    this.shuffleStarted = false;
  }
  setMode(mode) {
    if (!MODES.has(mode)) throw new Error('不支持的播放模式');
    this.mode = mode;
    this.bag = [];
    this.shuffleStarted = false;
  }
  select(key, { history = true } = {}) {
    if (!this.keys.includes(key)) throw new Error('歌曲已不在播放列表中');
    if (history && this.currentKey && this.currentKey !== key) this.history.push(this.currentKey);
    this.currentKey = key;
    this.bag = this.bag.filter(k => k !== key);
    if (this.history.length > 1000) this.history.splice(0, this.history.length - 1000);
    return key;
  }
  shuffled(keys) {
    const result = [...keys];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(this.random() * (i + 1))));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  peekNext({ natural = true, failed = false } = {}) {
    if (!this.keys.length) return null;
    if (!this.currentKey) return this.keys[0];
    if (this.mode === 'repeat-one' && natural && !failed) return this.currentKey;
    if (this.mode === 'shuffle') {
      if (!this.bag.length) {
        // Current item already counts as visited in the first cycle.
        this.bag = this.shuffled(this.shuffleStarted?this.keys:this.keys.filter(k => k !== this.currentKey));
        if (!this.bag.length) this.bag = [this.currentKey];
        if(this.bag.length>1&&this.bag[0]===this.currentKey)[this.bag[0],this.bag[1]]=[this.bag[1],this.bag[0]];
        this.shuffleStarted = true;
      }
      return this.bag[0];
    }
    const index = this.keys.indexOf(this.currentKey);
    if (index + 1 < this.keys.length) return this.keys[index + 1];
    if (this.mode === 'repeat-all' || failed) return this.keys[0];
    return null;
  }
  next(options = {}) {
    const key = this.peekNext(options);
    if (key) this.select(key);
    return key;
  }
  previous() {
    while (this.history.length) {
      const key = this.history.pop();
      if (this.keys.includes(key)) return this.select(key, { history: false });
    }
    if (this.mode === 'shuffle') return this.currentKey;
    const index = this.keys.indexOf(this.currentKey);
    return index > 0 ? this.select(this.keys[index - 1], { history: false }) : this.currentKey;
  }
}

module.exports = { QueueModel, MODES };
