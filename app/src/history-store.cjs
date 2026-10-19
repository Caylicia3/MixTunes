'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_ENTRIES, normaliseHistory } = require('./play-history.cjs');

class HistoryStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'history.json');
  }
  load() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    try {
      const data = JSON.parse(text);
      return normaliseHistory(Array.isArray(data?.entries) ? data.entries : data);
    } catch (error) {
      // A damaged history file must never block playback or take the app down.
      // Keep a copy for diagnosis and start with an empty, writable history.
      try { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`, fs.constants.COPYFILE_EXCL); } catch {}
      return [];
    }
  }
  save(entries) {
    const safe = normaliseHistory(Array.isArray(entries) ? entries : entries?.entries);
    fs.mkdirSync(this.directory, { recursive: true });
    const data = { schemaVersion: 1, entries: safe };
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
    return safe.length;
  }
}

module.exports = { HistoryStore, MAX_ENTRIES };
