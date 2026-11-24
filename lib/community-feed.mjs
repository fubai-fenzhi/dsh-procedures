import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Local cache of the community feed so the hook stays synchronous. */
export function feedCachePath(home = homedir()) {
  return join(home, '.dsh', 'procedures', 'community-feed.json');
}

export function readFeedCache(file = feedCachePath()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(data.latest)) return null;
    return data;
  } catch {
    return null;
  }
}

function hash(text) {
  let value = 0;
  for (const char of String(text)) value = (value * 31 + char.codePointAt(0)) | 0;
  return value;
}

/**
 * Refresh the cached community feed from the public repo (contents + commits).
 * A fresh cache shorter than `ttlMs` is returned without network access.
 */
export async function refreshFeed({
  repo,
  token = '',
  fetchImpl = globalThis.fetch,
  file = feedCachePath(),
  now = () => Date.now(),
  ttlMs = 60 * 60 * 1000,
} = {}) {
  const cached = readFeedCache(file);
  if (cached && now() - Date.parse(cached.fetchedAt ?? '') < ttlMs) return cached;

  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const listResponse = await fetchImpl(`https://api.github.com/repos/${repo}/contents/cards`, { headers });
  if (!listResponse.ok) return cached ?? null;
  const list = await listResponse.json();
  const cards = list.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md')).map((entry) => entry.name);

  const commitResponse = await fetchImpl(`https://api.github.com/repos/${repo}/commits?per_page=10`, { headers });
  const commits = commitResponse.ok ? await commitResponse.json() : [];
  const latest = [];
  for (const commit of commits) {
    const match = /^Add community card (.+)$/.exec(commit.commit?.message ?? '');
    if (!match) continue;
    latest.push({ name: match[1], at: commit.commit?.author?.date ?? null });
    if (latest.length >= 5) break;
  }

  const feed = { repo, cards: cards.length, latest, fetchedAt: new Date(now()).toISOString() };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
  } catch {
    // a read-only home directory must not break the feed itself
  }
  return feed;
}

/** One rotating line: cards count plus one recent addition chosen by seed. */
export function feedLine(feed, seed = '') {
  if (!feed || typeof feed.cards !== 'number') return '';
  const latest = Array.isArray(feed.latest) ? feed.latest : [];
  if (latest.length === 0) return `\n- 社区卡库：${feed.cards} 张卡。`;
  const pick = latest[Math.abs(hash(seed)) % latest.length];
  const name = String(pick.name ?? '').replace(/\.md$/, '');
  const when = pick.at ? `（${String(pick.at).slice(0, 10)}）` : '';
  return `\n- 社区卡库：${feed.cards} 张卡；最近新增《${name}》${when}。`;
}
