import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { clearCardCache, loadCards } from '../lib/cards.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cache-'));
  mkdirSync(join(root, 'cards'), { recursive: true });
  return root;
}

function card(title) {
  return `---
id: cache-card
title: ${title}
type: trap
anchors: [cache.example, probe.cache, ENOENT]
valid_until: 2030-01-01
---
# 工具-缓存

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;
}

test('returns the cached array for repeated loads', () => {
  const root = workspace();
  const file = join(root, 'cards', 'cache.md');
  writeFileSync(file, card('第一版'), 'utf8');
  clearCardCache();

  const first = loadCards(root);
  const second = loadCards(root);
  assert.equal(first, second);
});

test('refresh reloads after a file edit', () => {
  const root = workspace();
  const file = join(root, 'cards', 'cache.md');
  writeFileSync(file, card('第一版'), 'utf8');
  clearCardCache();

  const first = loadCards(root);
  writeFileSync(file, card('第二版'), 'utf8');
  const refreshed = loadCards(root, { refresh: true });
  assert.notEqual(first, refreshed);
  assert.match(refreshed[0].title, /第二版/);
});
