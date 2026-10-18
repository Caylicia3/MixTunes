'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('packaged Windows aborts corrupted-library startup and preserves original bytes', { timeout: 30000, skip: process.platform !== 'win32' }, async () => {
  const executable = process.env.MIXTUNES_RELEASE_EXECUTABLE;
  assert.ok(executable && fs.existsSync(executable), 'Set MIXTUNES_RELEASE_EXECUTABLE to the actual candidate EXE');
  const directory = fs.mkdtempSync(path.resolve(__dirname, '../.local-build/release-library-protection-'));
  const original = '{"schemaVersion":2,"tracks":[';
  const file = path.join(directory, 'library.json');
  fs.writeFileSync(file, original);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--test-mode', '--smoke-test', '--data-dir=' + directory], {env, windowsHide: true, stdio: 'ignore'});
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('Candidate did not stop after failed library load')); }, 20000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); resolve(code); });
  });
  assert.equal(result, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.equal(fs.existsSync(path.join(directory, 'smoke-result.json')), false);
});
