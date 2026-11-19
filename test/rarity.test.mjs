import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditCards } from '../lib/cards.mjs';

function library() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-rarity-'));
  mkdirSync(join(root, 'cards'), { recursive: true });
  return root;
}

function bigCard(rarity) {
  const padding = 'x'.repeat(2300);
  return `---
id: ${rarity}-big
title: ${rarity} 大卡
type: trap
rarity: ${rarity}
anchors: [big.example, probe.big, ENOENT]
valid_until: 2030-01-01
---
# 工具-大卡

## 首选
none

## 别再来
none

## 注意
- ${padding}

证据：test
`;
}

test('rare cards may reach 3 KB, common cards stay at 2 KB', () => {
  const rareRoot = library();
  writeFileSync(join(rareRoot, 'cards', 'rare-big.md'), bigCard('rare'), 'utf8');
  const rare = auditCards(rareRoot);
  const rareCodes = rare.issues.map((issue) => issue.code);
  assert.ok(!rareCodes.includes('oversize'));
  assert.ok(rareCodes.includes('rare-with-few-hits'));
  assert.equal(rare.ok, true);

  const commonRoot = library();
  writeFileSync(join(commonRoot, 'cards', 'common-big.md'), bigCard('common'), 'utf8');
  const common = auditCards(commonRoot);
  assert.ok(common.issues.some((issue) => issue.code === 'oversize'));
  assert.equal(common.ok, false);
});
