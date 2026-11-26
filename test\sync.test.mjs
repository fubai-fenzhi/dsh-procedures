import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collectLocal, mergeStats, syncPull, syncPush } from '../lib/sync.mjs';

function dir(prefix) {
  return mkdtempSync(join(tmpdir(), `dsh-sync-${prefix}-`));
}

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

/** Tiny in-memory GitHub Contents API double, scoped to a fixed owner/repo. */
function makeFakeRepo(initial) {
  const files = new Map(Object.entries(initial ?? {}));
  const calls = [];

  async function fetchImpl(url, init = {}) {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname.replace(/^\/repos\/o\/r\/contents\/?/, ''));
    const method = init.method ?? 'GET';
    calls.push({ method, path });

    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      files.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
      return response(200, {});
    }

    if (files.has(path)) {
      const content = files.get(path);
      return response(200, {
        type: 'file',
        name: path.split('/').pop(),
        path,
        sha: `sha-${path}`,
        content: b64(content),
      });
    }

    const prefix = path ? `${path}/` : '';
    const children = [...files.keys()].filter(
      (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
    );
    if (children.length > 0 || path === '') {
      return response(200, children.map((key) => ({
        type: 'file',
        name: key.slice(prefix.length),
        path: key,
        sha: `sha-${key}`,
      })));
    }
    return response(404, {});
  }

  return { files, calls, fetchImpl };
}

test('mergeStats keeps the larger counts and the later timestamps', () => {
  const local = {
    version: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    cards: {
      a: {
        hits: 2,
        last_hit: '2026-01-01T00:00:00.000Z',
        repeated: 0,
        no_repeat: 1,
        last_outcome: 'no_repeat',
        last_outcome_at: '2026-01-01T00:00:00.000Z',
      },
    },
  };
  const remote = {
    version: 1,
    updated_at: '2026-01-02T00:00:00.000Z',
    cards: {
      a: {
        hits: 5,
        last_hit: '2026-01-02T00:00:00.000Z',
        repeated: 2,
        no_repeat: 0,
        last_outcome: 'repeated',
        last_outcome_at: '2026-01-02T00:00:00.000Z',
      },
      b: { hits: 1 },
    },
  };

  const merged = mergeStats(local, remote);
  assert.equal(merged.cards.a.hits, 5);
  assert.equal(merged.cards.a.last_hit, '2026-01-02T00:00:00.000Z');
  assert.equal(merged.cards.a.repeated, 2);
  assert.equal(merged.cards.a.no_repeat, 1);
  assert.equal(merged.cards.a.last_outcome, 'repeated');
  assert.equal(merged.cards.b.hits, 1);
  assert.equal(merged.updated_at, '2026-01-02T00:00:00.000Z');
});

test('collectLocal reads root and cards markdown and skips underscore files', () => {
  const root = dir('collect');
  writeFileSync(join(root, 'INDEX.md'), 'index');
  writeFileSync(join(root, '_模板.md'), 'template');
  mkdirSync(join(root, 'cards'));
  writeFileSync(join(root, 'cards', 'a.md'), 'a');

  const files = collectLocal(root);
  assert.deepEqual(Object.keys(files).sort(), ['INDEX.md', 'cards/a.md']);
  assert.equal(files['cards/a.md'], 'a');
  rmSync(root, { recursive: true, force: true });
});

test('syncPull downloads remote markdown and merges remote stats', async () => {
  const root = dir('pull');
  const globalDir = join(root, 'global');
  const statsFile = join(root, 'global-stats.json');
  const remote = makeFakeRepo({
    'INDEX.md': 'remote index',
    'cards/a.md': 'remote a',
    '_模板.md': 'remote template',
    'global-stats.json': JSON.stringify({
      version: 1,
      updated_at: '2026-01-02T00:00:00.000Z',
      cards: { a: { hits: 3 } },
    }),
  });
  const config = { repo: 'o/r', branch: 'main', token: 't', globalDir, statsFile };

  const result = await syncPull({ config, fetchImpl: remote.fetchImpl });
  assert.equal(result.written, 2);
  assert.equal(readFileSync(join(globalDir, 'cards', 'a.md'), 'utf8'), 'remote a');
  assert.equal(readFileSync(join(globalDir, 'INDEX.md'), 'utf8'), 'remote index');
  assert.equal(existsSync(join(globalDir, '_模板.md')), false);
  assert.match(readFileSync(statsFile, 'utf8'), /"a"/);
  rmSync(root, { recursive: true, force: true });
});

test('syncPush uploads new files, skips identical ones, and leaves remote-only files alone', async () => {
  const root = dir('push');
  const globalDir = join(root, 'global');
  const statsFile = join(root, 'global-stats.json');
  mkdirSync(join(globalDir, 'cards'), { recursive: true });
  writeFileSync(join(globalDir, 'INDEX.md'), 'local index');
  writeFileSync(join(globalDir, 'cards', 'new.md'), 'new card');
  writeFileSync(join(globalDir, 'cards', 'same.md'), 'same');

  const remote = makeFakeRepo({
    'INDEX.md': 'local index',
    'cards/same.md': 'same',
    'cards/old.md': 'old',
  });
  const config = { repo: 'o/r', branch: 'main', token: 't', globalDir, statsFile };

  const result = await syncPush({ config, fetchImpl: remote.fetchImpl });
  assert.equal(result.added, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 2);
  assert.equal(remote.files.get('cards/new.md'), 'new card');
  assert.equal(remote.files.get('cards/old.md'), 'old');
  rmSync(root, { recursive: true, force: true });
});
