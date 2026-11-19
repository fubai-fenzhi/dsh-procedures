import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseCard, readInbox } from './cards.mjs';

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-chat';
const DRAFT_LIMIT_BYTES = 2048;

export function resolveLlmConfig(options = {}, env = process.env) {
  const apiKey = String(
    options.apiKey
      ?? env.DSH_PROCEDURES_API_KEY
      ?? env.DEEPSEEK_API_KEY
      ?? env.OPENAI_API_KEY
      ?? '',
  ).trim();
  const baseUrl = String(
    options.baseUrl
      ?? env.DSH_PROCEDURES_BASE_URL
      ?? env.DEEPSEEK_BASE_URL
      ?? env.OPENAI_BASE_URL
      ?? DEFAULT_BASE_URL,
  ).trim().replace(/\/+$/, '');
  const model = String(
    options.model
      ?? env.DSH_PROCEDURES_MODEL
      ?? env.DEEPSEEK_MODEL
      ?? DEFAULT_MODEL,
  ).trim();
  return { apiKey, baseUrl, model };
}

function isLocal(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

export function redactConfig(config) {
  return { baseUrl: config.baseUrl, model: config.model, hasKey: Boolean(config.apiKey) };
}

function uniqueEntries(entries) {
  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const key = `${entry.tool}|${entry.message.slice(0, 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

export function buildSynthesisPrompt({ entries = [], context = '' } = {}) {
  const records = entries
    .map((entry) => `- [${entry.tool}] ${entry.message}`)
    .join('\n');
  return `你是经验卡编辑。下面是一条 agent 踩坑记录（可能含报错原文）。请把它整理成一张可复用的经验卡草稿。

只输出 Markdown 正文，不要解释，不要在外层加代码围栏。

硬性要求：
1. 文件必须以 YAML front matter 开头（--- 开头，--- 结尾），字段齐全：
   id, title, type, triggers, anchors, requires, excludes, valid_until, environment, created, last_hit, hits。
2. type 只能是 trap 或 spell。trap = 陷阱/反面清单；spell = 可复用的修复动作。
   如果是 spell，正文必须有「## 可执行」和一个带语言标记的代码块。
3. 正文必须包含这些段落：## 触发 / ## 首选 / ## 被挡时 / ## 别再来 / ## 注意 / 证据：。
4. anchors 写 3–8 个「任务或报错里会原样出现」的英文/符号（命令名、域名、扩展名、报错原文）；中文描述放 triggers，不要放 anchors。
5. 不要编造记录里没有的命令、路径、报错、版本号；不确定就写 TODO。
6. 全文 ≤ 2 KB。删叙述，保留命令、报错原文、判据。
7. requires / excludes 可留空数组；用它们表达“必须同时出现”/“出现就跳过”的词。

踩坑记录：
${records}

可选的会话上下文（可能为空）：
${String(context).slice(0, 8000) || '（无）'}
`;
}

export function stripFences(text) {
  const source = String(text ?? '').trim();
  const match = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(source);
  return (match ? match[1] : source).trim();
}

export function validateDraft(markdown) {
  const card = parseCard(String(markdown ?? ''), 'draft.md');
  if (!card.hasFrontMatter) return { ok: false, reason: 'missing YAML front matter', card };
  if (!card.id) return { ok: false, reason: 'missing id', card };
  if (!card.title) return { ok: false, reason: 'missing title', card };
  if (!['trap', 'spell'].includes(card.type)) {
    return { ok: false, reason: `unknown type: ${card.type}`, card };
  }
  if (card.anchors.length === 0) return { ok: false, reason: 'missing anchors', card };
  if (card.size > DRAFT_LIMIT_BYTES) {
    return { ok: false, reason: `oversize: ${card.size} B`, card };
  }
  for (const section of ['首选', '别再来', '注意']) {
    if (!card.body.includes(section)) {
      return { ok: false, reason: `missing section: ${section}`, card };
    }
  }
  if (card.type === 'spell') {
    if (!card.actionableCode) return { ok: false, reason: 'spell without code', card };
    if (!card.body.includes('验证')) return { ok: false, reason: 'spell without 验证', card };
  }
  return { ok: true, card };
}

export async function callChatCompletion({
  config,
  prompt,
  fetchImpl = globalThis.fetch,
  signal,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable in this runtime');
  const headers = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: '你是严谨的经验卡编辑，只输出 Markdown，不输出解释。' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response || response.ok !== true) {
    const status = response?.status ?? 'unknown';
    let detail = '';
    try {
      detail = typeof response?.text === 'function' ? await response.text() : '';
    } catch {
      detail = '';
    }
    throw new Error(`LLM HTTP ${status}: ${String(detail).slice(0, 300)}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('LLM returned empty content');
  }
  return stripFences(text);
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function safeSlug(value, fallback = 'card') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

/**
 * Draft cards with an OpenAI-compatible chat endpoint. Drafts only: this
 * function never writes to cards/ and never promotes a card.
 */
export async function synthesizeWithLlm(options = {}) {
  const dir = resolve(options.dir ?? 'procedures');
  const outDir = resolve(options.outDir ?? join(dir, '_drafts'));
  const entries = uniqueEntries(readInbox(dir));
  if (entries.length === 0) {
    return { created: [], rejected: [], entries: 0, outDir, dryRun: false };
  }

  const config = resolveLlmConfig(options, options.env ?? process.env);
  const max = Math.max(1, Math.min(Number.parseInt(String(options.max ?? '5'), 10) || 5, 20));
  const selected = entries.slice(0, max);
  const context = String(options.context ?? '').slice(0, 8000);
  const firstPrompt = buildSynthesisPrompt({ entries: [selected[0]], context });

  if (options.dryRun) {
    return {
      created: [],
      rejected: [],
      entries: selected.length,
      outDir,
      dryRun: true,
      prompt: firstPrompt,
      config: redactConfig(config),
    };
  }
  if (!config.apiKey && !isLocal(config.baseUrl)) {
    throw new Error(
      'missing API key: set DEEPSEEK_API_KEY or DSH_PROCEDURES_API_KEY (or use --dry-run / a local base URL)',
    );
  }

  mkdirSync(outDir, { recursive: true });
  const created = [];
  const rejected = [];
  const base = stamp();

  for (let index = 0; index < selected.length; index += 1) {
    const entry = selected[index];
    const prompt = buildSynthesisPrompt({ entries: [entry], context });
    let output;
    try {
      output = options.complete
        ? await options.complete(prompt, entry)
        : await callChatCompletion({
            config,
            prompt,
            fetchImpl: options.fetchImpl,
            signal: options.signal,
          });
    } catch (error) {
      rejected.push({ entry, reason: String(error) });
      continue;
    }

    const check = validateDraft(output);
    const name = `draft-${base}-${String(index + 1).padStart(2, '0')}-${safeSlug(check.card?.id ?? entry.tool)}`;
    if (check.ok) {
      const file = join(outDir, `${name}.md`);
      writeFileSync(file, `${output.trim()}\n`, 'utf8');
      created.push(file);
    } else {
      const file = join(outDir, `${name}.rejected.md`);
      writeFileSync(file, `<!-- rejected: ${check.reason} -->\n\n${output.trim()}\n`, 'utf8');
      rejected.push({ entry, reason: check.reason, file });
    }
  }

  return { created, rejected, entries: selected.length, outDir, dryRun: false };
}
