import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendInbox } from '../lib/cards.mjs';
import {
  buildSynthesisPrompt,
  resolveLlmConfig,
  synthesizeWithLlm,
  validateDraft,
} from '../lib/llm.mjs';

const GOOD_CARD = `---
id: draft-test
title: 测试草稿
type: trap
triggers: [测试]
anchors: [test.example, web_fetch, ENOENT]
valid_until: 2027-01-01
environment: test
created: 2026-11-06
last_hit: null
hits: 0
---
# 工具-测试

## 触发
测试

## 首选
none

## 被挡时
none

## 别再来
| 弯路 | 为什么不通 |
| --- | --- |
| x | y |

## 注意
- test

证据：test
`;

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llm-'));
  appendInbox(root, { tool: 'web_fetch', message: 'chat.deepseek.com only returned shell' });
  return root;
}

function response(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  };
}

test('resolves explicit config over environment', () => {
  const config = resolveLlmConfig(
    { apiKey: 'explicit', baseUrl: 'https://example.test/', model: 'm1' },
    { DEEPSEEK_API_KEY: 'env-key' },
  );
  assert.equal(config.apiKey, 'explicit');
  assert.equal(config.baseUrl, 'https://example.test');
  assert.equal(config.model, 'm1');
});

test('builds a prompt with the record and required fields', () => {
  const prompt = buildSynthesisPrompt({
    entries: [{ tool: 'web_fetch', message: 'only returned shell' }],
    context: 'user asked for a summary',
  });
  assert.match(prompt, /web_fetch/);
  assert.match(prompt, /only returned shell/);
  assert.match(prompt, /anchors/);
  assert.match(prompt, /## 首选/);
});

test('validates a well-formed draft and rejects a malformed one', () => {
  const good = validateDraft(GOOD_CARD);
  assert.equal(good.ok, true);
  assert.equal(good.card.type, 'trap');

  const bad = validateDraft('not a card');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /front matter/);
});

test('synthesizes one draft through the chat endpoint', async () => {
  const dir = workspace();
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return response(GOOD_CARD);
  };

  const result = await synthesizeWithLlm({
    dir,
    env: {},
    apiKey: 'test-key',
    baseUrl: 'https://api.example.test/v1',
    model: 'test-model',
    fetchImpl,
    max: 1,
  });

  assert.equal(result.created.length, 1);
  assert.ok(existsSync(result.created[0]));
  assert.match(readFileSync(result.created[0], 'utf8'), /id: draft-test/);
  assert.equal(captured.url, 'https://api.example.test/v1/chat/completions');
  assert.equal(captured.init.headers.authorization, 'Bearer test-key');
  assert.equal(existsSync(join(dir, 'cards')), false);
});

test('writes a rejected file when the model output is malformed', async () => {
  const dir = workspace();
  const result = await synthesizeWithLlm({
    dir,
    env: {},
    apiKey: 'test-key',
    fetchImpl: async () => response('not a card'),
    max: 1,
  });
  assert.equal(result.created.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].file, /\.rejected\.md$/);
});

test('dry-run returns the prompt without calling the endpoint', async () => {
  const dir = workspace();
  const result = await synthesizeWithLlm({
    dir,
    env: {},
    dryRun: true,
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });
  assert.equal(result.dryRun, true);
  assert.match(result.prompt, /chat\.deepseek\.com/);
  assert.equal(existsSync(join(dir, '_drafts')), false);
});

test('requires a key for a remote endpoint', async () => {
  const dir = workspace();
  await assert.rejects(
    () => synthesizeWithLlm({ dir, env: {}, baseUrl: 'https://api.example.test/v1' }),
    /missing API key/,
  );
});

test('allows a keyless local endpoint', async () => {
  const dir = workspace();
  let authorization;
  const result = await synthesizeWithLlm({
    dir,
    env: {},
    baseUrl: 'http://127.0.0.1:11434/v1',
    fetchImpl: async (_url, init) => {
      authorization = init.headers.authorization;
      return response(GOOD_CARD);
    },
    max: 1,
  });
  assert.equal(result.created.length, 1);
  assert.equal(authorization, undefined);
});
