import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collectCardFiles, communityPull, contribute } from '../lib/community.mjs';

function dir(prefix) {
  return mkdtempSync(join(tmpdir(), `dsh-community-${prefix}-`));
}

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

function makeCommunityRepo(initial, issues = []) {
  const files = new Map(Object.entries(initial ?? {}));

  async function fetchImpl(url, init = {}) {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    const pathname = decodeURIComponent(parsed.pathname);

    if (method === 'POST' && pathname === '/repos/o/r/issues') {
      issues.push(JSON.parse(init.body));
      return response(201, { number: issues.length });
    }

    const match = pathname.match(/^\/repos\/o\/r\/contents\/?(.*)$/);
    if (!match) return response(404, {});
    const path = match[1];

    if (files.has(path)) {
      return response(200, {
        type: 'file',
        name: path.split('/').pop(),
        path,
        sha: `sha-${path}`,
        content: b64(files.get(path)),
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

  return { files, issues, fetchImpl };
}

test('collectCardFiles reads root and cards markdown and skips underscore files', () => {
  const root = dir('collect');
  writeFileSync(join(root, 'INDEX.md'), 'index');
  writeFileSync(join(root, '_模板.md'), 'template');
  mkdirSync(join(root, 'cards'));
  writeFileSync(join(root, 'cards', 'a.md'), 'a');

  const files = collectCardFiles(root);
  assert.deepEqual(files.map((file) => file.name).sort(), ['a.md']);
  rmSync(root, { recursive: true, force: true });
});

test('communityPull adds missing cards and does not overwrite existing ones', async () => {
  const root = dir('pull');
  const globalDir = join(root, 'global');
  mkdirSync(join(globalDir, 'cards'), { recursive: true });
  writeFileSync(join(globalDir, 'cards', 'keep.md'), 'local keep');

  const remote = makeCommunityRepo({
    'cards/keep.md': 'remote keep',
    'cards/new.md': 'remote new',
  });
  const result = await communityPull({
    globalDir,
    repo: 'o/r',
    token: '',
    fetchImpl: remote.fetchImpl,
  });

  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 2);
  rmSync(root, { recursive: true, force: true });
});

test('contribute previews new cards without creating issues', async () => {
  const root = dir('preview');
  mkdirSync(join(root, 'cards'), { recursive: true });
  writeFileSync(join(root, 'cards', 'a.md'), 'a');
  writeFileSync(join(root, 'cards', 'b.md'), 'b');

  const remote = makeCommunityRepo({ 'cards/a.md': 'a' });
  const result = await contribute({
    dirs: [root],
    repo: 'o/r',
    token: 't',
    fetchImpl: remote.fetchImpl,
    dryRun: true,
  });

  assert.equal(result.candidates, 1);
  assert.equal(result.submitted, 0);
  assert.equal(remote.issues.length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('contribute submits one issue per new card when not dry-run', async () => {
  const root = dir('submit');
  mkdirSync(join(root, 'cards'), { recursive: true });
  writeFileSync(join(root, 'cards', 'b.md'), 'b');

  const remote = makeCommunityRepo({});
  const result = await contribute({
    dirs: [root],
    repo: 'o/r',
    token: 't',
    fetchImpl: remote.fetchImpl,
    dryRun: false,
  });

  assert.equal(result.submitted, 1);
  assert.equal(remote.issues.length, 1);
  assert.match(remote.issues[0].title, /\[card\] b\.md/);
  rmSync(root, { recursive: true, force: true });
});
