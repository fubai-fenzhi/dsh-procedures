import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveAttach } from '../index.js';
import { globalHookText } from '../lib/hook-text.mjs';

function dir(prefix) {
  return mkdtempSync(join(tmpdir(), `dsh-${prefix}-`));
}

test('resolveAttach covers none/local/both/global', () => {
  const cwd = dir('attach');
  const global = dir('global');
  const base = { dir: 'procedures', globalDir: '' };

  assert.equal(resolveAttach(cwd, base).mode, 'none');

  mkdirSync(join(cwd, 'procedures'));
  assert.equal(resolveAttach(cwd, base).mode, 'local');

  mkdirSync(join(global, 'cards'), { recursive: true });
  assert.equal(resolveAttach(cwd, { ...base, globalDir: global }).mode, 'both');

  rmSync(join(cwd, 'procedures'), { recursive: true, force: true });
  assert.equal(resolveAttach(cwd, { ...base, globalDir: global }).mode, 'global');

  assert.equal(
    resolveAttach(cwd, { ...base, globalDir: join(global, 'missing') }).mode,
    'none',
  );
});

test('globalHookText embeds the global path', () => {
  const text = globalHookText('C:\\Users\\me\\.dsh\\global-procedures');
  assert.match(text, /全局库/);
  assert.match(text, /C:\/Users\/me\/\.dsh\/global-procedures/);
  assert.match(text, /global:<文件名>/);
});
