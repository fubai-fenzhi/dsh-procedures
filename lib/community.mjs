import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { createGitHubClient } from './sync.mjs';

/** Curated community card repository maintained by the project owner. */
export const COMMUNITY_REPO = 'fubai-fenzhi/dsh-procedures-community';
export const COMMUNITY_BRANCH = 'main';

/** Local card files from one procedures directory, as `{ name, content }` with repo-relative card names. */
export function collectCardFiles(dir) {
  const files = [];
  if (!dir || !existsSync(dir)) return files;
  const skip = new Set(['INDEX.md', 'README.md']);

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('_')) continue;
    if (skip.has(entry.name)) continue;
    files.push({ name: entry.name, content: readFileSync(join(dir, entry.name), 'utf8') });
  }

  const cardsDir = join(dir, 'cards');
  if (existsSync(cardsDir)) {
    for (const entry of readdirSync(cardsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      files.push({ name: entry.name, content: readFileSync(join(cardsDir, entry.name), 'utf8') });
    }
  }

  return files;
}

async function remoteCardEntries(client) {
  const list = await client.listDir('cards');
  return list.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'));
}

/** Download curated community cards into the local global library; never overwrites an existing local card. */
export async function communityPull({
  globalDir,
  repo = COMMUNITY_REPO,
  branch = COMMUNITY_BRANCH,
  token = '',
  fetchImpl,
  dryRun = false,
  log = () => {},
} = {}) {
  const client = createGitHubClient({ repo, branch, token, fetchImpl });
  const remote = await remoteCardEntries(client);
  let added = 0;
  let skipped = 0;

  for (const entry of remote) {
    const file = await client.getFile(`cards/${entry.name}`);
    if (!file) continue;
    const target = join(globalDir, 'cards', entry.name);
    if (existsSync(target)) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, 'utf8');
    }
    added += 1;
    log(`pull cards/${entry.name}`);
  }

  return { added, skipped, total: remote.length };
}

/** Create a GitHub issue carrying one card; the project owner curates it into the community repo. */
export async function createIssue({
  repo = COMMUNITY_REPO,
  token,
  title,
  body,
  labels = ['card-submission'],
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.github.com',
} = {}) {
  if (!token) throw new Error('contribute needs a GitHub token with issues write access');
  const response = await fetchImpl(`${baseUrl}/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // status-only message
    }
    throw new Error(`GitHub ${response.status} create issue${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

const REDACT_RULES = [
  { name: 'token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, replacement: '<token>' },
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '<email>' },
  { name: 'win-path', pattern: /\b[A-Za-z]:\\[^\s"'`<>|]+/g, replacement: '<path>' },
  { name: 'home-path', pattern: /\/(?:home|Users)\/[^\s"'`<>|]+/g, replacement: '<path>' },
  { name: 'private-ip', pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, replacement: '<private-ip>' },
];

/** Redact credentials, emails, absolute paths and private addresses before a card leaves the machine. */
export function scrubCard(content) {
  let text = String(content ?? '');
  const redactions = [];
  for (const rule of REDACT_RULES) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(text)) continue;
    redactions.push(rule.name);
    rule.pattern.lastIndex = 0;
    text = text.replace(rule.pattern, rule.replacement);
  }
  return { content: text, redactions };
}

/** A card must be a bounded Markdown file with YAML frontmatter carrying id and title. */
export function validateCard(content) {
  const text = String(content ?? '');
  if (text.length > 4096) return { ok: false, reason: 'larger than 4 KB' };
  if (!text.startsWith('---')) return { ok: false, reason: 'missing YAML frontmatter' };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { ok: false, reason: 'unterminated frontmatter' };
  const frontmatter = text.slice(3, end);
  if (!/^\s*id:\s*\S+/m.test(frontmatter)) return { ok: false, reason: 'missing id' };
  if (!/^\s*title:\s*\S+/m.test(frontmatter)) return { ok: false, reason: 'missing title' };
  return { ok: true };
}

export const COMMUNITY_POLICY_VALUES = ['off', 'ask', 'auto'];

export function communityPolicyPath(home = homedir()) {
  return join(home, '.dsh', 'procedures', 'community.json');
}

export function readCommunityPolicy(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return COMMUNITY_POLICY_VALUES.includes(data?.submit) ? data.submit : 'ask';
  } catch {
    return 'ask';
  }
}

export function writeCommunityPolicy(file, submit) {
  if (!COMMUNITY_POLICY_VALUES.includes(submit)) {
    throw new Error(`invalid submit policy: ${submit}`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ submit }, null, 2)}\n`, 'utf8');
}

export function contributeLogPath(home = homedir()) {
  return join(home, '.dsh', 'procedures', 'contribute-log.json');
}

export function readContributeLog(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function appendContributeLog(file, entry) {
  const list = readContributeLog(file);
  list.push(entry);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(list.slice(-500), null, 2)}\n`, 'utf8');
}

/**
 * Offer local cards that the community repo does not have yet.
 * `dryRun` is the default; `auto` adds validation, redaction and a daily cap.
 */
export async function contribute({
  dirs,
  repo = COMMUNITY_REPO,
  branch = COMMUNITY_BRANCH,
  token = '',
  fetchImpl,
  dryRun = true,
  auto = false,
  cap = 5,
  home,
  now = new Date(),
  logFile,
  log = () => {},
} = {}) {
  const client = createGitHubClient({ repo, branch, token, fetchImpl });
  let remoteNames;
  try {
    const remote = await remoteCardEntries(client);
    remoteNames = new Set(remote.map((entry) => entry.name));
  } catch {
    remoteNames = new Set();
  }

  const candidates = [];
  const seen = new Set();
  for (const dir of dirs ?? []) {
    for (const file of collectCardFiles(dir)) {
      const name = file.name.replace(/^cards\//, '');
      if (remoteNames.has(name) || seen.has(name)) continue;
      seen.add(name);
      candidates.push({ name, content: file.content });
    }
  }

  const logPath = logFile ?? contributeLogPath(home);
  const recent = readContributeLog(logPath).filter(
    (entry) => now.getTime() - Date.parse(entry.at ?? '') < 24 * 60 * 60 * 1000,
  );

  let submitted = 0;
  let blocked = 0;
  let redacted = 0;
  let capped = 0;

  for (const card of candidates) {
    const validation = validateCard(card.content);
    if (!validation.ok) {
      blocked += 1;
      log(`skip ${card.name}: ${validation.reason}`);
      continue;
    }
    const scrubbed = scrubCard(card.content);
    if (scrubbed.redactions.length > 0) redacted += 1;
    if (auto && recent.length + submitted >= cap) {
      capped += 1;
      continue;
    }
    if (!dryRun) {
      const issue = await createIssue({
        repo,
        token,
        title: `[card] ${card.name}`,
        body: scrubbed.content,
        fetchImpl,
      });
      appendContributeLog(logPath, {
        name: card.name,
        at: now.toISOString(),
        issue: issue?.number ?? null,
        redactions: scrubbed.redactions,
      });
      submitted += 1;
    }
    log(`${dryRun ? 'would submit' : 'submitted'} ${card.name}${scrubbed.redactions.length ? ` (redacted: ${scrubbed.redactions.join(',')})` : ''}`);
  }

  return {
    candidates: candidates.length,
    submitted,
    skipped: seen.size - candidates.length,
    blocked,
    redacted,
    capped,
  };
}

/** Count curated community cards and local global cards. */
export async function communityStatus({ globalDir, repo = COMMUNITY_REPO, branch = COMMUNITY_BRANCH, token = '', fetchImpl } = {}) {
  const client = createGitHubClient({ repo, branch, token, fetchImpl });
  const remote = await remoteCardEntries(client);
  const local = collectCardFiles(join(globalDir, 'cards')).length;
  return { repo, remote: remote.length, local };
}
