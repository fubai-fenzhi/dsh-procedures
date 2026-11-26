import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  appendInbox,
  auditCards,
  isExpired,
  loadCards,
  parseCard,
  readInbox,
  searchCards,
  synthesizeDrafts,
} from '../lib/cards.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-procedures-'));
  mkdirSync(join(root, 'cards'), { recursive: true });
  return root;
}

function writeCard(root, name, text) {
  const file = join(root, 'cards', name);
  writeFileSync(file, text, 'utf8');
  return file;
}

const ACTIVE_CARD = `---
id: fetch-spa
title: SPA 抓取空壳
type: trap
anchors: [example.com, web_fetch]
triggers:
  - 只拿到壳
  - SPA
valid_until: 2030-01-01
environment: test
created: 2026-01-01
---
# 抓取-SPA

## 首选
curl https://example.com

## 别再来
| 弯路 | 为什么不通 |
| --- | --- |
| 直抓 | 空壳 |

## 注意
- 200 不代表有正文

证据：test
`;

const EXPIRED_CARD = `---
id: old-card
title: 过期卡
type: trap
anchors: [expired.example]
triggers: [过期]
valid_until: 2000-01-01
---
# 旧卡

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;

const LEGACY_CARD = `# 旧格式卡

> **触发**：旧格式现象
> **锚点**：legacy.example, legacy_command
> **验证**：跑通

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;

test('parses YAML front matter arrays and scalar metadata', () => {
  const card = parseCard(ACTIVE_CARD, 'cards/active.md');
  assert.equal(card.id, 'fetch-spa');
  assert.deepEqual(card.anchors, ['example.com', 'web_fetch']);
  assert.deepEqual(card.triggers, ['只拿到壳', 'SPA']);
  assert.equal(card.validUntil, '2030-01-01');
  assert.equal(card.hasFrontMatter, true);
  assert.equal(isExpired(card), false);
});

test('keeps legacy cards working through 触发/锚点 lines', () => {
  const card = parseCard(LEGACY_CARD, 'cards/legacy.md');
  assert.equal(card.hasFrontMatter, false);
  assert.deepEqual(card.anchors, ['legacy.example', 'legacy_command']);
  assert.ok(card.triggers.some((trigger) => trigger.includes('旧格式现象')));
});

test('ranks an anchor hit above a trigger-only hit', () => {
  const root = workspace();
  writeCard(root, 'active.md', ACTIVE_CARD);
  const hits = searchCards(root, 'web_fetch https://example.com/share');
  assert.equal(hits[0].id, 'fetch-spa');
  assert.ok(hits[0].matched.some((match) => match.on === 'anchor' && match.value === 'web_fetch'));
});

test('hides expired cards unless includeExpired is set', () => {
  const root = workspace();
  writeCard(root, 'expired.md', EXPIRED_CARD);
  assert.equal(searchCards(root, 'expired.example').length, 0);
  const expanded = searchCards(root, 'expired.example', { includeExpired: true });
  assert.equal(expanded[0].id, 'old-card');
  assert.equal(expanded[0].expired, true);
});

test('audit reports structural and lifecycle problems', () => {
  const root = workspace();
  writeCard(root, 'broken.md', `---
id: fetch-spa
title: 坏卡
type: trap
anchors: [only-one]
valid_until: 2000-01-01
---
# 坏卡

## 首选
none
`);
  writeCard(root, 'active.md', ACTIVE_CARD);
  const result = auditCards(root);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('missing-section'));
  assert.ok(codes.includes('few-anchors'));
  assert.ok(codes.includes('expired'));
  assert.ok(codes.includes('duplicate-id'));
  assert.equal(result.ok, false);
});

test('loadCards reads both cards/ and the data root without templates', () => {
  const root = workspace();
  writeCard(root, 'active.md', ACTIVE_CARD);
  writeFileSync(join(root, '_模板.md'), ACTIVE_CARD, 'utf8');
  writeFileSync(join(root, 'INDEX.md'), '# index', 'utf8');
  const cards = loadCards(root);
  assert.equal(cards.length, 1);
});

test('inbox appends one line and skips duplicates', () => {
  const root = workspace();
  const first = appendInbox(root, { tool: 'pwsh', message: 'Cannot find path E:\\nope' });
  const second = appendInbox(root, { tool: 'pwsh', message: 'Cannot find path E:\\nope' });
  assert.equal(first.added, true);
  assert.equal(second.added, false);
  const entries = readInbox(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tool, 'pwsh');
});

test('synthesize writes drafts and never touches cards/', () => {
  const root = workspace();
  appendInbox(root, { tool: 'web_fetch', message: 'chat.deepseek.com only returned shell' });
  const result = synthesizeDrafts(root);
  assert.equal(result.created.length, 1);
  const draft = readFileSync(result.created[0], 'utf8');
  assert.match(draft, /type: trap/);
  assert.match(draft, /chat\.deepseek\.com/);
  assert.equal(loadCards(root).length, 0);
});

const GUARDED_CARD = `---
id: guarded
title: 受约束的卡
type: trap
anchors: [guarded.example]
requires: [not found]
excludes: [offset out of range]
valid_until: 2030-01-01
---
# 工具-受约束

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;

test('parses requires and excludes', () => {
  const card = parseCard(GUARDED_CARD, 'cards/guarded.md');
  assert.deepEqual(card.requires, ['not found']);
  assert.deepEqual(card.excludes, ['offset out of range']);
});

test('requires and excludes gate a card before scoring', () => {
  const root = workspace();
  writeCard(root, 'guarded.md', GUARDED_CARD);
  assert.equal(searchCards(root, 'guarded.example').length, 0);
  assert.equal(searchCards(root, 'guarded.example not found').length, 1);
  assert.equal(searchCards(root, 'guarded.example offset out of range').length, 0);
});

test('does not match a broad path anchor on an unrelated offset error', () => {
  const root = workspace();
  writeCard(root, 'desktop.md', `---
id: desktop-probe
title: 桌面卡
type: trap
anchors:
  - E:\\Desktop
excludes:
  - offset out of range
valid_until: 2030-01-01
---
# 环境-桌面

## 首选
E:\\Desktop

## 别再来
none

## 注意
none

证据：test
`);
  const query = 'Error: offset out of range for "E:\\Desktop\\钩子优于插件.txt"';
  assert.equal(searchCards(root, query).length, 0);
});

const SPELL_FENCED = `---
id: spell-self-check
title: 自检技能
type: spell
language: powershell
anchors: [spell.example]
triggers: [自检]
valid_until: 2030-01-01
---
# 技能-自检

## 触发
自检

## 可执行
\`\`\`powershell
Write-Output "ok"
\`\`\`

## 验证
输出 ok

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;

const SPELL_BLOCK = `---
id: spell-block
title: 块技能
type: spell
language: bash
anchors: [spell.block]
actionable_code: |
  echo ok
  echo done
valid_until: 2030-01-01
---
# 技能-块

## 触发
块

## 可执行
none

## 验证
ok

## 首选
none

## 别再来
none

## 注意
none

证据：test
`;

test('parses a spell card from a fenced code block', () => {
  const card = parseCard(SPELL_FENCED, 'cards/spell.md');
  assert.equal(card.type, 'spell');
  assert.equal(card.isSpell, true);
  assert.equal(card.language, 'powershell');
  assert.match(card.actionableCode, /Write-Output "ok"/);
});

test('parses actionable_code from a YAML block scalar', () => {
  const card = parseCard(SPELL_BLOCK, 'cards/spell-block.md');
  assert.match(card.actionableCode, /echo ok/);
  assert.match(card.actionableCode, /echo done/);
});

test('audit rejects a spell without code or verification', () => {
  const root = workspace();
  writeCard(root, 'bad-spell.md', `---
id: bad-spell
title: 坏技能
type: spell
anchors: [bad.example]
---
# 技能-坏

## 触发
x

## 首选
none

## 别再来
none

## 注意
none

证据：test
`);
  const codes = auditCards(root).issues.map((issue) => issue.code);
  assert.ok(codes.includes('spell-without-code'));
  assert.ok(codes.includes('spell-without-verify'));
});

test('strict mode ignores title and body fallback', () => {
  const root = workspace();
  writeCard(root, 'desktop-title.md', `---
id: desktop-title
title: Desktop tools
type: trap
anchors: [unrelated.example]
valid_until: 2030-01-01
---
# 工具-桌面

## 首选
none

## 别再来
none

## 注意
none

证据：test
`);
  assert.equal(searchCards(root, 'desktop path').length, 1);
  assert.equal(searchCards(root, 'desktop path', { strict: true }).length, 0);
});

test('a numbered offset error is excluded by a literal out-of-range guard', () => {
  const root = workspace();
  writeCard(root, 'desktop-real.md', `---
id: desktop-real
title: 桌面卡
type: trap
anchors: [E:\\Desktop]
excludes: [out of range]
valid_until: 2030-01-01
---
# 环境-桌面

## 首选
none

## 别再来
none

## 注意
none

证据：test
`);
  const query = 'Error: offset 10000 is out of range for "E:\\Desktop\\钩子优于插件.txt"';
  assert.equal(searchCards(root, query).length, 0);
});
