#!/usr/bin/env node
/**
 * Compare cold and warm search cost on a synthetic card library.
 * Run: node bench/search.mjs [--quick]
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { clearCardCache, searchCards } from '../lib/cards.mjs';

function makeLibrary(count) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-procedures-bench-'));
  mkdirSync(join(root, 'cards'), { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const id = `bench-${String(index).padStart(4, '0')}`;
    const body = `---
id: ${id}
title: 基准卡 ${index}
type: trap
rarity: common
anchors: [probe-${index}, benchmark.example, ENOENT]
triggers: [基准 ${index}]
valid_until: 2030-01-01
---
# 工具-基准 ${index}

## 首选
none

## 别再来
| 弯路 | 为什么不通 |
| --- | --- |
| x | y |

## 注意
- ${'说明文字'.repeat(80)}

证据：bench
`;
    writeFileSync(join(root, 'cards', `${id}.md`), body, 'utf8');
  }
  return root;
}

function measure(count) {
  const dir = makeLibrary(count);
  const queries = Array.from(
    { length: 20 },
    (_, index) => `probe-${(index * 97) % count} not found`,
  );

  clearCardCache();
  const coldStart = performance.now();
  searchCards(dir, queries[0], { max: 3, strict: true });
  const cold = performance.now() - coldStart;

  const warmStart = performance.now();
  for (const query of queries) searchCards(dir, query, { max: 3, strict: true });
  const warm = (performance.now() - warmStart) / queries.length;

  rmSync(dir, { recursive: true, force: true });
  return { count, cold, warm };
}

const quick = process.argv.includes('--quick');
const counts = quick ? [500] : [500, 2000];
for (const count of counts) {
  const result = measure(count);
  console.log(
    `${result.count} cards: cold ${result.cold.toFixed(1)} ms, warm ${result.warm.toFixed(2)} ms/query`,
  );
}
