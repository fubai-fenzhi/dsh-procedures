import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditCards } from '../lib/cards.mjs';
import { recordHitAt } from '../lib/stats.mjs';

function dir(prefix) {
  return mkdtempSync(join(tmpdir(), `dsh-${prefix}-`));
}

const GLOBAL_CARD = `---
id: global-stale
title: 全局旧卡
type: trap
triggers: [global]
anchors: [global.stale, probe.global, ENOENT]
valid_until: 2030-01-01
created: 2020-01-01
---
# 工具-全局旧卡

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;

test('audit includes global cards, global stats, and stale candidates', () => {
  const workspace = dir('audit-ws');
  const global = dir('audit-global');
  mkdirSync(join(global, 'cards'), { recursive: true });
  writeFileSync(join(global, 'cards', 'global-stale.md'), GLOBAL_CARD, 'utf8');

  const statsFile = join(dir('audit-stats'), 'global-stats.json');
  for (let index = 0; index < 3; index += 1) {
    recordHitAt(statsFile, { id: 'global-stale' }, {
      sessionId: 'session-1',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  const result = auditCards(workspace, {
    globalDir: global,
    globalStatsFile: statsFile,
    now: Date.parse('2026-06-01T00:00:00.000Z'),
    staleDays: 90,
  });

  assert.equal(result.scopes.global, 1);
  assert.equal(result.stats.globalTracked, 1);
  const codes = result.issues
    .filter((issue) => issue.scope === 'global')
    .map((issue) => issue.code);
  assert.ok(codes.includes('promotion-candidate'));
  assert.ok(codes.includes('stale-global'));
  assert.equal(result.ok, true);
});

test('audit without globalDir stays workspace-only', () => {
  const workspace = dir('audit-ws-only');
  const result = auditCards(workspace);
  assert.equal(result.scopes.workspace, 0);
  assert.equal(result.scopes.global, 0);
  assert.equal(result.stats.globalTracked, 0);
});
