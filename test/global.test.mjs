import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildHint } from '../index.js';
import { searchCards } from '../lib/cards.mjs';

function library() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-global-'));
  mkdirSync(join(root, 'cards'), { recursive: true });
  return root;
}

function card({ id, title, anchor }) {
  return `---
id: ${id}
title: ${title}
type: trap
anchors: [${anchor}, probe.shared, ENOENT]
valid_until: 2030-01-01
---
# 工具-${title}

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;
}

test('workspace cards win over global cards with the same id', () => {
  const workspace = library();
  const global = library();
  writeFileSync(join(workspace, 'cards', 'shared.md'), card({
    id: 'shared-card',
    title: '工作区共享卡',
    anchor: 'shared.example',
  }), 'utf8');
  writeFileSync(join(global, 'cards', 'shared.md'), card({
    id: 'shared-card',
    title: '全局共享卡',
    anchor: 'shared.example',
  }), 'utf8');

  const hits = searchCards(workspace, 'shared.example', { globalDir: global });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, '工作区共享卡');
  assert.equal(hits[0].scope, 'workspace');
});

test('finds a global-only card and labels the hint', () => {
  const workspace = library();
  const global = library();
  writeFileSync(join(global, 'cards', 'global-only.md'), card({
    id: 'global-card',
    title: '全局独有卡',
    anchor: 'global.example',
  }), 'utf8');

  assert.equal(searchCards(workspace, 'global.example').length, 0);
  const hits = searchCards(workspace, 'global.example', { globalDir: global });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].scope, 'global');

  const hint = buildHint(hits[0], workspace);
  assert.match(hint, /命中经验卡 global:global-only\.md/);
});

test('globalPenalty can let a local trigger outrank a global anchor', () => {
  const workspace = library();
  const global = library();
  writeFileSync(join(workspace, 'cards', 'local.md'), `---
id: local-trigger
title: 本地触发卡
type: trap
triggers: [shared-trigger]
anchors: [local.only, probe.local, ENOENT]
valid_until: 2030-01-01
---
# 工具-本地触发

## 首选
none

## 别再来
none

## 注意
none

证据：test
`, 'utf8');
  writeFileSync(join(global, 'cards', 'global.md'), card({
    id: 'global-anchor',
    title: '全局锚点卡',
    anchor: 'global.example',
  }), 'utf8');

  const query = 'global.example shared-trigger';
  assert.equal(searchCards(workspace, query, { globalDir: global })[0].id, 'global-anchor');
  assert.equal(
    searchCards(workspace, query, { globalDir: global, globalPenalty: 2 })[0].id,
    'local-trigger',
  );
});
