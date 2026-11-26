import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditCards } from '../lib/cards.mjs';
import {
  hitsOf,
  outcomesOf,
  readStats,
  readStatsAt,
  recordHit,
  recordHitAt,
  recordOutcomeAt,
} from '../lib/stats.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-stats-'));
  mkdirSync(join(root, 'cards'), { recursive: true });
  return root;
}

const CARD = `---
id: stats-card
title: 统计卡
type: trap
anchors: [stats.example, probe.stats, ENOENT]
valid_until: 2030-01-01
---
# 工具-统计卡

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;

test('recordHit increments the sidecar without touching card YAML', () => {
  const root = workspace();
  const file = join(root, 'cards', 'stats-card.md');
  writeFileSync(file, CARD, 'utf8');
  const before = CARD;

  const first = recordHit(root, { id: 'stats-card' }, {
    now: new Date('2026-01-01T00:00:00.000Z'),
    sessionId: 'session-1',
  });
  const second = recordHit(root, { id: 'stats-card' }, {
    now: new Date('2026-01-02T00:00:00.000Z'),
    sessionId: 'session-2',
  });

  assert.equal(first.hits, 1);
  assert.equal(second.hits, 2);
  assert.equal(second.last_session, 'session-2');
  assert.equal(readStats(root).cards['stats-card'].hits, 2);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('hitsOf falls back to YAML hits when stats are absent', () => {
  const stats = { cards: {} };
  assert.equal(hitsOf(stats, { id: 'x', hits: 7 }), 7);
  assert.equal(hitsOf({ cards: { x: { hits: 2 } } }, { id: 'x', hits: 7 }), 2);
});

test('audit reports a promotion candidate after three hits', () => {
  const root = workspace();
  writeFileSync(join(root, 'cards', 'stats-card.md'), CARD, 'utf8');
  for (let index = 0; index < 3; index += 1) {
    recordHit(root, { id: 'stats-card' }, { sessionId: 'session-1' });
  }
  const result = auditCards(root);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('promotion-candidate'));
  assert.equal(result.ok, true);
});

test('corrupt stats fall back to an empty sidecar', () => {
  const root = workspace();
  writeFileSync(join(root, '_stats.json'), 'not json', 'utf8');
  const stats = readStats(root);
  assert.deepEqual(stats.cards, {});
});

test('recordHitAt creates parent directories and reads back', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-stats-file-'));
  const file = join(root, 'nested', 'global-stats.json');
  const entry = recordHitAt(file, { id: 'global-card' }, {
    now: new Date('2026-01-01T00:00:00.000Z'),
    sessionId: 'session-9',
  });
  assert.equal(entry.hits, 1);
  assert.equal(readStatsAt(file).cards['global-card'].hits, 1);
  assert.deepEqual(readStatsAt(join(root, 'missing.json')).cards, {});
});

test('recordOutcomeAt counts repeated/no_repeat and preserves hits', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-outcome-'));
  const file = join(root, 'stats.json');
  recordHitAt(file, { id: 'card-a' });
  recordOutcomeAt(file, { id: 'card-a' }, 'repeated');
  recordOutcomeAt(file, { id: 'card-a' }, 'no_repeat');
  const stats = readStatsAt(file);
  assert.equal(stats.cards['card-a'].hits, 1);
  assert.equal(stats.cards['card-a'].repeated, 1);
  assert.equal(stats.cards['card-a'].no_repeat, 1);
  assert.equal(outcomesOf(stats, { id: 'card-a' }).lastOutcome, 'no_repeat');

  recordHitAt(file, { id: 'card-a' });
  assert.equal(readStatsAt(file).cards['card-a'].repeated, 1);
});

test('audit reports repeat-after-hint', () => {
  const root = workspace();
  writeFileSync(join(root, 'cards', 'stats-card.md'), CARD, 'utf8');
  const file = join(root, '_stats.json');
  recordHitAt(file, { id: 'stats-card' });
  recordOutcomeAt(file, { id: 'stats-card' }, 'repeated');
  recordOutcomeAt(file, { id: 'stats-card' }, 'repeated');
  const codes = auditCards(root).issues.map((issue) => issue.code);
  assert.ok(codes.includes('repeat-after-hint'));
});
