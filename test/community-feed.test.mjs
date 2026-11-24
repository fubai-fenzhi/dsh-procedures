import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { feedLine, readFeedCache, refreshFeed } from '../lib/community-feed.mjs';

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

test('refreshFeed caches cards and recent additions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-feed-'));
  const file = join(root, 'feed.json');
  const fake = async (url) => {
    if (url.includes('/contents/cards')) {
      return response(200, [{ type: 'file', name: 'a.md' }, { type: 'file', name: 'b.md' }, { type: 'dir', name: 'x' }]);
    }
    if (url.includes('/commits')) {
      return response(200, [
        { commit: { message: 'Add community card a.md', author: { date: '2026-11-24T01:00:00Z' } } },
        { commit: { message: 'chore: readme', author: { date: '2026-11-23T01:00:00Z' } } },
      ]);
    }
    return response(404, {});
  };

  const feed = await refreshFeed({ repo: 'o/r', fetchImpl: fake, file, now: () => Date.parse('2026-11-24T02:00:00Z') });
  assert.equal(feed.cards, 2);
  assert.deepEqual(feed.latest, [{ name: 'a.md', at: '2026-11-24T01:00:00Z' }]);
  assert.equal(readFeedCache(file).cards, 2);
  rmSync(root, { recursive: true, force: true });
});

test('refreshFeed reuses a fresh cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-feed-'));
  const file = join(root, 'feed.json');
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return response(500, {});
  };
  await refreshFeed({ repo: 'o/r', fetchImpl: async (url) => {
    if (url.includes('/contents/cards')) return response(200, [{ type: 'file', name: 'a.md' }]);
    return response(200, []);
  }, file, now: () => 1000 });
  await refreshFeed({ repo: 'o/r', fetchImpl: fake, file, now: () => 2000, ttlMs: 10_000 });
  assert.equal(calls, 0);
  rmSync(root, { recursive: true, force: true });
});

test('feedLine rotates by seed', () => {
  const feed = {
    cards: 17,
    latest: [{ name: 'a.md', at: '2026-11-24T01:00:00Z' }, { name: 'b.md', at: '2026-11-23T01:00:00Z' }],
  };
  const first = feedLine(feed, 'seed-1');
  const second = feedLine(feed, 'seed-2');
  assert.match(first, /社区卡库：17 张卡；最近新增/);
  assert.match(second, /社区卡库：17 张卡；最近新增/);
  assert.notEqual(first, second);
});
