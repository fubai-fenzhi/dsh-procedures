import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collectCardFiles, communityPull, contribute, readCommunityPolicy, scrubCard, validateCard, writeCommunityPolicy } from '../lib/community.mjs';

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
  writeFileSync(join(root, 'cards', 'a.md'), cardText('a'));
  writeFileSync(join(root, 'cards', 'b.md'), cardText('b'));

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
  writeFileSync(join(root, 'cards', 'b.md'), cardText('b'));

  const remote = makeCommunityRepo({});
  const result = await contribute({
    dirs: [root],
    repo: 'o/r',
    token: 't',
    fetchImpl: remote.fetchImpl,
    dryRun: false,
    logFile: join(root, 'log.json'),
  });

  assert.equal(result.submitted, 1);
  assert.equal(remote.issues.length, 1);
  assert.match(remote.issues[0].title, /\[card\] b\.md/);
  rmSync(root, { recursive: true, force: true });
});

function cardText(id, body = '') {
  return `---\nid: ${id}\ntitle: ${id} card\n---\n\n${body}\n`;
}

test('scrubCard removes credentials, emails, paths and private addresses', () => {
  const token = `ghp_${'a'.repeat(30)}`;
  const text = `---\nid: x\ntitle: x\n---\n${token} someone@example.com C:\\Users\\me\\proj 192.168.1.5\n`;
  const result = scrubCard(text);
  assert.match(result.content, /<token>/);
  assert.match(result.content, /<email>/);
  assert.match(result.content, /<path>/);
  assert.match(result.content, /<private-ip>/);
  assert.equal(result.content.includes(token), false);
  assert.deepEqual(result.redactions.sort(), ['email', 'private-ip', 'token', 'win-path']);
});

test('validateCard rejects malformed cards and accepts a normal one', () => {
  assert.equal(validateCard(cardText('ok')).ok, true);
  assert.equal(validateCard('no frontmatter').ok, false);
  assert.equal(validateCard('---\ntitle: only\n---\n').ok, false);
  assert.equal(validateCard('---\nid: only\n---\n').ok, false);
});

test('community policy defaults to ask and round-trips', () => {
  const root = dir('policy');
  const file = join(root, 'community.json');
  assert.equal(readCommunityPolicy(file), 'ask');
  writeCommunityPolicy(file, 'auto');
  assert.equal(readCommunityPolicy(file), 'auto');
  writeCommunityPolicy(file, 'off');
  assert.equal(readCommunityPolicy(file), 'off');
  assert.throws(() => writeCommunityPolicy(file, 'nope'));
  rmSync(root, { recursive: true, force: true });
});

test('contribute redacts a token before creating the issue', async () => {
  const root = dir('redact');
  mkdirSync(join(root, 'cards'), { recursive: true });
  const token = `ghp_${'b'.repeat(30)}`;
  writeFileSync(join(root, 'cards', 'leak.md'), cardText('leak', `token is ${token}`));

  const remote = makeCommunityRepo({});
  const result = await contribute({
    dirs: [root],
    repo: 'o/r',
    token: 't',
    fetchImpl: remote.fetchImpl,
    dryRun: false,
    auto: true,
    cap: 10,
    logFile: join(root, 'log.json'),
  });

  assert.equal(result.submitted, 1);
  assert.equal(result.redacted, 1);
  assert.equal(remote.issues[0].body.includes(token), false);
  assert.match(remote.issues[0].body, /<token>/);
  rmSync(root, { recursive: true, force: true });
});

test('contribute auto enforces the daily cap', async () => {
  const root = dir('cap');
  mkdirSync(join(root, 'cards'), { recursive: true });
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(join(root, 'cards', `card-${index}.md`), cardText(`card-${index}`));
  }

  const remote = makeCommunityRepo({});
  const result = await contribute({
    dirs: [root],
    repo: 'o/r',
    token: 't',
    fetchImpl: remote.fetchImpl,
    dryRun: false,
    auto: true,
    cap: 2,
    logFile: join(root, 'log.json'),
  });

  assert.equal(result.submitted, 2);
  assert.equal(result.capped, 3);
  assert.equal(remote.issues.length, 2);
  rmSync(root, { recursive: true, force: true });
});
