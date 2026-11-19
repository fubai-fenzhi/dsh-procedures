import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { hitsOf, outcomesOf, readStats, readStatsAt } from './stats.mjs';

export const CARD_LIMIT_BYTES = 2048;
export const RARE_LIMIT_BYTES = 3072;
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const REQUIRED_SECTIONS = ['首选', '别再来', '注意'];

function unquote(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Parse the small YAML subset used by card front matter. */
export function parseYamlLite(source) {
  const out = {};
  const lines = String(source ?? '').split(/\r?\n/);
  let key = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\s+$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key !== null) {
      if (!Array.isArray(out[key])) out[key] = [];
      out[key].push(unquote(item[1]));
      continue;
    }

    const pair = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    key = pair[1];
    const raw = pair[2].trim();
    if (raw === '|' || raw === '>') {
      const block = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor];
        if (next.trim() === '') {
          block.push('');
          cursor += 1;
          continue;
        }
        if (!/^\s+/.test(next)) break;
        block.push(next);
        cursor += 1;
      }
      const nonEmpty = block.filter((row) => row.trim().length > 0);
      const indent = nonEmpty.length > 0
        ? Math.min(...nonEmpty.map((row) => /^\s*/.exec(row)[0].length))
        : 0;
      const content = block.map((row) => row.slice(indent)).join('\n');
      out[key] = raw === '|' ? content.replace(/\s+$/, '') : content.replace(/\s+/g, ' ').trim();
      index = cursor - 1;
      continue;
    }
    if (raw === '') {
      out[key] = [];
      continue;
    }
    if (raw === 'null' || raw === '~') {
      out[key] = null;
      continue;
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      out[key] = raw
        .slice(1, -1)
        .split(',')
        .map((part) => unquote(part))
        .filter(Boolean);
      continue;
    }
    out[key] = unquote(raw);
  }
  return out;
}

export function parseFrontMatter(text) {
  const match = FRONT_MATTER_RE.exec(String(text ?? ''));
  if (!match) return { data: {}, body: String(text ?? ''), hasFrontMatter: false };
  return {
    data: parseYamlLite(match[1]),
    body: String(text ?? '').slice(match[0].length),
    hasFrontMatter: true,
  };
}

function normalizeList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,，、;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstHeading(body) {
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].trim() : '';
}

function legacyField(body, label) {
  const pattern = new RegExp(
    `^\\s*(?:>\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*[：:]\\s*(.+)$`,
    'm',
  );
  const match = pattern.exec(body);
  return match ? match[1].trim() : '';
}

function normalizeLegacyAnchors(raw) {
  return raw
    .split(/[,，、;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstFencedCode(body) {
  const match = /```([^\n`]*)\r?\n([\s\S]*?)```/.exec(body);
  if (!match) return { language: '', code: '' };
  return { language: match[1].trim(), code: match[2].trim() };
}

export function parseCard(text, filePath = '<memory>') {
  const source = String(text ?? '');
  const { data, body, hasFrontMatter } = parseFrontMatter(source);
  const legacyTrigger = legacyField(body, '触发');
  const legacyAnchor = legacyField(body, '锚点');

  const anchors = normalizeList(data.anchors ?? data.anchor)
    .concat(normalizeLegacyAnchors(legacyAnchor))
    .filter((item, index, list) => list.indexOf(item) === index);
  const triggers = normalizeList(data.triggers ?? data.trigger).concat(
    legacyTrigger ? [legacyTrigger] : [],
  );

  const file = basename(filePath);
  const id = String(data.id ?? file.replace(/\.md$/i, '')).trim();
  const title = String(data.title ?? firstHeading(body) ?? file).trim() || file;
  const type = String(data.type ?? 'trap').trim().toLowerCase() || 'trap';
  const rarity = String(data.rarity ?? 'common').trim().toLowerCase() || 'common';
  const fenced = firstFencedCode(body);
  const actionableCode = String(data.actionable_code ?? '').trim() || fenced.code;
  const language = String(data.language ?? fenced.language ?? '').trim();
  const requires = normalizeList(data.requires ?? data.require);
  const excludes = normalizeList(data.excludes ?? data.exclude);
  const validUntil = data.valid_until ?? data.expires ?? null;
  const validUntilTime = (() => {
    if (validUntil === null || validUntil === undefined || validUntil === '') return null;
    const time = Date.parse(String(validUntil));
    return Number.isFinite(time) ? time : null;
  })();

  return {
    path: filePath,
    file,
    id,
    title,
    type,
    isSpell: type === 'spell',
    rarity,
    anchors,
    triggers,
    requires,
    excludes,
    anchorKeys: anchors.map((item) => item.toLowerCase()),
    triggerKeys: triggers.map((item) => item.toLowerCase()),
    requireKeys: requires.map((item) => item.toLowerCase()),
    excludeKeys: excludes.map((item) => item.toLowerCase()),
    actionableCode,
    language,
    validUntil,
    validUntilTime,
    environment: data.environment ?? null,
    created: data.created ?? null,
    lastHit: data.last_hit ?? null,
    hits: Number.parseInt(String(data.hits ?? '0'), 10) || 0,
    body,
    text: source,
    hasFrontMatter,
    size: Buffer.byteLength(source, 'utf8'),
  };
}

function listMarkdownFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    if (name.startsWith('_')) continue;
    if (name === 'INDEX.md' || name === 'README.md') continue;
    files.push(resolve(dir, name));
  }
  return files;
}

const CARD_CACHE = new Map();
const CARD_CACHE_TTL_MS = 750;

export function clearCardCache() {
  CARD_CACHE.clear();
}

function collectCardFiles(root) {
  const files = new Set();
  for (const file of listMarkdownFiles(join(root, 'cards'))) files.add(file);
  for (const file of listMarkdownFiles(root)) files.add(file);
  return [...files].sort();
}

function signatureOf(files) {
  return files.map((file) => {
    try {
      const stat = statSync(file);
      return `${file}:${stat.mtimeMs}:${stat.size}`;
    } catch {
      return `${file}:missing`;
    }
  }).join('|');
}

export function loadCards(dir, options = {}) {
  const root = resolve(dir);
  const scope = options.scope ?? 'workspace';
  const files = collectCardFiles(root);
  const key = `${root}\u0000${scope}`;
  const cached = CARD_CACHE.get(key);
  const now = Date.now();
  if (!options.refresh && cached !== undefined && now - cached.checkedAt < CARD_CACHE_TTL_MS) {
    return cached.cards;
  }

  const signature = signatureOf(files);
  if (!options.refresh && cached !== undefined && cached.signature === signature) {
    cached.checkedAt = now;
    return cached.cards;
  }

  const cards = files.map((file) => ({
    ...parseCard(readFileSync(file, 'utf8'), file),
    scope,
  }));
  CARD_CACHE.set(key, { signature, cards, checkedAt: now });
  return cards;
}

export function isExpired(card, now = Date.now()) {
  if (Number.isFinite(card.validUntilTime)) return card.validUntilTime < now;
  if (card.validUntilTime === null) return false;
  if (card.validUntil === null || card.validUntil === undefined || card.validUntil === '') {
    return false;
  }
  const time = Date.parse(String(card.validUntil));
  return Number.isFinite(time) && time < now;
}

function tokens(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}

function matchTrigger(trigger, triggerLower, query, lowerQuery) {
  const text = String(trigger ?? '').trim();
  if (!text) return false;
  const regex = /^\/(.+)\/([a-z]*)$/s.exec(text);
  if (regex) {
    try {
      return new RegExp(regex[1], regex[2]).test(query);
    } catch {
      return false;
    }
  }
  return triggerLower.length >= 2 && lowerQuery.includes(triggerLower);
}

/**
 * Rank cards against a task/error string. Anchors outrank triggers; body text
 * is only a last resort so a long error message does not match everything.
 * `strict` disables title/body fallback; `globalDir` adds a read-only library
 * where workspace cards with the same id win.
 */
export function searchCards(dir, query, options = {}) {
  const rawQuery = String(query ?? '').trim();
  if (!rawQuery) return [];
  const now = options.now ?? Date.now();
  const lowerQuery = rawQuery.toLowerCase();
  const max = Number.isInteger(options.max) ? options.max : 3;
  const scored = [];

  const workspaceCards = loadCards(dir, { scope: 'workspace' });
  let cards = workspaceCards;
  if (options.globalDir) {
    const workspaceIds = new Set(workspaceCards.map((card) => card.id));
    const globalCards = loadCards(options.globalDir, { scope: 'global' })
      .filter((card) => !workspaceIds.has(card.id));
    cards = workspaceCards.concat(globalCards);
  }

  for (const card of cards) {
    const expired = isExpired(card, now);
    if (expired && !options.includeExpired) continue;

    const excluded = card.excludeKeys.some(
      (term) => term.length >= 2 && lowerQuery.includes(term),
    );
    if (excluded) continue;
    const missingRequired = card.requireKeys.some(
      (term) => term.length >= 2 && !lowerQuery.includes(term),
    );
    if (missingRequired) continue;

    let score = 0;
    const matched = [];

    card.anchorKeys.forEach((anchorKey, index) => {
      if (anchorKey.length >= 2 && lowerQuery.includes(anchorKey)) {
        score += 3;
        matched.push({ on: 'anchor', value: card.anchors[index] });
      }
    });
    card.triggers.forEach((trigger, index) => {
      if (matchTrigger(trigger, card.triggerKeys[index], rawQuery, lowerQuery)) {
        score += 2;
        matched.push({ on: 'trigger', value: trigger });
      }
    });
    if (score === 0 && options.strict !== true) {
      for (const token of tokens(`${card.title} ${card.file}`)) {
        if (token.length >= 4 && lowerQuery.includes(token)) {
          score += 1;
          matched.push({ on: 'title', value: token });
        }
      }
    }
    if (score === 0 && options.strict !== true && rawQuery.length >= 3 && rawQuery.length <= 120) {
      if (card.body.toLowerCase().includes(lowerQuery)) {
        score += 1;
        matched.push({ on: 'body', value: rawQuery });
      }
    }

    const penalty = card.scope === 'global' && Number.isFinite(Number(options.globalPenalty))
      ? Number(options.globalPenalty)
      : 0;
    const adjusted = score - penalty;
    if (adjusted > 0) scored.push({ ...card, score: adjusted, matched, expired });
  }

  scored.sort((left, right) => right.score - left.score
    || (left.scope === right.scope ? 0 : left.scope === 'workspace' ? -1 : 1)
    || left.file.localeCompare(right.file));
  return scored.slice(0, max);
}

export function auditCards(dir, options = {}) {
  const now = options.now ?? Date.now();
  const staleDays = Number.isFinite(Number(options.staleDays)) && Number(options.staleDays) > 0
    ? Number(options.staleDays)
    : 90;
  const workspaceCards = loadCards(dir, { refresh: true, scope: 'workspace' });
  const workspaceStats = readStats(dir);
  const globalCards = options.globalDir
    ? loadCards(options.globalDir, { refresh: true, scope: 'global' })
    : [];
  const globalStats = options.globalStatsFile
    ? readStatsAt(options.globalStatsFile)
    : { version: 1, cards: {}, updated_at: null };

  const entries = [
    ...workspaceCards.map((card) => ({ card, scope: 'workspace', stats: workspaceStats })),
    ...globalCards.map((card) => ({ card, scope: 'global', stats: globalStats })),
  ];
  const issues = [];
  const seenIds = new Map();

  for (const { card, scope, stats } of entries) {
    const report = (severity, code, message) => {
      issues.push({ severity, code, file: card.file, scope, message });
    };

    if (!card.hasFrontMatter) {
      report('warn', 'no-front-matter', '缺少 YAML front matter（按旧卡兼容读取）');
    }
    if (!card.id) report('error', 'no-id', '缺少 id');
    if (!card.title) report('error', 'no-title', '缺少 title');
    if (card.anchors.length === 0) {
      report('error', 'no-anchors', '缺少 anchors，失败时无法精确命中');
    } else if (card.anchors.length < 3) {
      report('warn', 'few-anchors', `只有 ${card.anchors.length} 个锚点，建议 3–8 个`);
    } else if (card.anchors.length > 8) {
      report('warn', 'many-anchors', `有 ${card.anchors.length} 个锚点，过多等于没筛`);
    }
    if (card.triggers.length === 0) report('warn', 'no-triggers', '缺少 triggers');
    if (card.type === 'spell') {
      if (!card.actionableCode) {
        report('error', 'spell-without-code', 'spell 卡缺少 actionable_code 或代码块');
      }
      if (!card.language) {
        report('warn', 'spell-without-language', 'spell 卡建议标注 language');
      }
      if (!card.body.includes('验证')) {
        report('error', 'spell-without-verify', 'spell 卡缺少「验证」段');
      }
    } else if (card.type !== 'trap') {
      report('warn', 'unknown-type', `未知 type「${card.type}」，按 trap 处理`);
    }
    const limit = card.rarity === 'rare' ? RARE_LIMIT_BYTES : CARD_LIMIT_BYTES;
    if (card.size > limit) {
      report('error', 'oversize', `${card.size} B 超过 ${limit} B 上限（${card.rarity}）`);
    }
    if (!['common', 'rare'].includes(card.rarity)) {
      report('warn', 'unknown-rarity', `未知 rarity「${card.rarity}」，按 common 处理`);
    }
    const hits = hitsOf(stats, card);
    const outcomes = outcomesOf(stats, card);
    if (hits >= 3 && card.rarity !== 'rare') {
      report('info', 'promotion-candidate', `命中 ${hits} 次，可考虑升 rare（需人工改 YAML）`);
    }
    if (card.rarity === 'rare' && hits < 3) {
      report('warn', 'rare-with-few-hits', `rare 但只命中 ${hits} 次，确认是否够格`);
    }
    if (outcomes.repeated >= 2 && outcomes.repeated >= outcomes.noRepeat) {
      report(
        'warn',
        'repeat-after-hint',
        `命中后同类错误复发 ${outcomes.repeated} 次 / 未复发 ${outcomes.noRepeat} 次；检查锚点或解法`,
      );
    }
    for (const section of REQUIRED_SECTIONS) {
      if (!card.body.includes(section)) {
        report('error', 'missing-section', `缺少「${section}」段`);
      }
    }
    if (!card.body.includes('证据')) report('warn', 'no-evidence', '缺少「证据」段');
    if (isExpired(card, now)) {
      report('warn', 'expired', `valid_until ${card.validUntil} 已过期`);
    }
    if (scope === 'global') {
      const last = stats.cards?.[card.id]?.last_hit;
      const baselineText = typeof last === 'string' ? last : card.created;
      const baseline = baselineText ? Date.parse(String(baselineText)) : NaN;
      if (Number.isFinite(baseline) && now - baseline > staleDays * 86400000) {
        report('warn', 'stale-global', `global 卡最后活动 ${baselineText}，超过 ${staleDays} 天；考虑复核/退役`);
      }
    }
    const key = `${scope}\u0000${card.id}`;
    if (seenIds.has(key)) {
      report('error', 'duplicate-id', `id 与 ${seenIds.get(key)} 重复`);
    } else {
      seenIds.set(key, card.file);
    }
  }

  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((left, right) => order[left.severity] - order[right.severity]
    || (left.scope === right.scope ? 0 : left.scope === 'workspace' ? -1 : 1)
    || left.file.localeCompare(right.file));
  return {
    dir: resolve(dir),
    globalDir: options.globalDir ? resolve(options.globalDir) : null,
    cards: entries.length,
    scopes: { workspace: workspaceCards.length, global: globalCards.length },
    stats: {
      tracked: Object.keys(workspaceStats.cards).length,
      globalTracked: Object.keys(globalStats.cards).length,
    },
    issues,
    ok: issues.every((issue) => issue.severity !== 'error'),
  };
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Append one inbox line; duplicate signatures inside the tail are skipped. */
export function appendInbox(dir, entry = {}) {
  const root = resolve(dir);
  if (!existsSync(root)) return { added: false, reason: 'missing-dir' };
  const file = join(root, '_inbox.md');
  const tool = oneLine(entry.tool ?? 'tool') || 'tool';
  const message = oneLine(entry.message ?? '').slice(0, 160);
  if (!message) return { added: false, reason: 'empty-message' };
  const line = `- ${timestamp(entry.time instanceof Date ? entry.time : new Date())} [${tool}] ${message}`;

  let current = '';
  if (existsSync(file)) current = readFileSync(file, 'utf8');
  const tail = current.split(/\r?\n/).slice(-100);
  const duplicated = tail.some((row) => {
    const match = /^-\s+\S+ \S+\s+\[([^\]]+)\]\s+(.*)$/.exec(row);
    return match !== null
      && match[1] === tool
      && match[2].slice(0, 120) === message.slice(0, 120);
  });
  if (duplicated) {
    return { added: false, reason: 'duplicate' };
  }

  mkdirSync(root, { recursive: true });
  const prefix = current.length === 0
    ? ''
    : current.endsWith('\n\n')
      ? ''
      : current.endsWith('\n')
        ? '\n'
        : '\n\n';
  appendFileSync(file, `${prefix}${line}\n`, 'utf8');
  return { added: true, line, file };
}

export function readInbox(dir) {
  const file = join(resolve(dir), '_inbox.md');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+\[([^\]]+)\]\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ time: match[1], tool: match[2], message: match[3] }));
}

/** Turn inbox lines into review drafts. No model call, no promotion. */
export function synthesizeDrafts(dir, options = {}) {
  const root = resolve(dir);
  const outDir = resolve(options.outDir ?? join(root, '_drafts'));
  const entries = readInbox(root);
  if (entries.length === 0) return { created: [], skipped: 0, outDir };

  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.tool}|${entry.message.slice(0, 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  mkdirSync(outDir, { recursive: true });
  const created = [];
  let skipped = 0;
  unique.slice(0, Number(options.max ?? 20)).forEach((entry, index) => {
    const date = entry.time.slice(0, 10).replaceAll('-', '');
    const name = `draft-${date}-${String(index + 1).padStart(2, '0')}.md`;
    const file = join(outDir, name);
    if (existsSync(file)) {
      skipped += 1;
      return;
    }
    const slug = `${entry.tool}-${entry.message.slice(0, 24)}`.replace(/[^\p{L}\p{N}-]+/gu, '-');
    const content = `---
id: draft-${date}-${index + 1}
title: TODO ${slug}
type: trap
triggers: []
anchors: []
valid_until: null
environment: ""
created: ${entry.time.slice(0, 10)}
last_hit: null
hits: 0
---

# TODO-${slug}

## 触发
- ${entry.message}

## 首选
TODO

## 被挡时
TODO

## 别再来
| 弯路 | 为什么不通 |
| --- | --- |
| TODO | TODO |

## 注意
- 先确认这是不是复发；孤例不要升成正式卡。

证据：_inbox.md ${entry.time}
`;
    writeFileSync(file, content, 'utf8');
    created.push(file);
  });

  return { created, skipped, outDir };
}

export function relativeCardPath(fromDir, cardPath) {
  return relative(resolve(fromDir), resolve(cardPath)).replaceAll('\\', '/');
}
