import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { emptyStats, readStatsAt } from './stats.mjs';

/** Config file lives beside the global library, not in the workspace. */
export const SYNC_CONFIG_FILE = 'sync.json';
export const SYNC_STATS_FILE = 'global-stats.json';
export const SYNC_DEFAULT_BRANCH = 'main';

export function defaultSyncPaths(home = homedir()) {
  const base = join(home, '.dsh', 'procedures');
  return {
    configFile: join(base, SYNC_CONFIG_FILE),
    globalDir: join(base, 'global'),
    statsFile: join(base, SYNC_STATS_FILE),
  };
}

export function readSyncConfig(file) {
  if (!file || !existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function writeSyncConfig(file, config) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** Resolve flags > environment > stored config > defaults. Never throws for missing credentials. */
export function resolveSyncConfig(flags = {}, options = {}) {
  const home = options.home ?? homedir();
  const defaults = defaultSyncPaths(home);
  const configFile = resolve(flags.config ?? defaults.configFile);
  const stored = readSyncConfig(configFile) ?? {};
  const repo = String(flags.repo ?? stored.repo ?? '').trim();
  const branch = String(flags.branch ?? stored.branch ?? SYNC_DEFAULT_BRANCH).trim() || SYNC_DEFAULT_BRANCH;
  const token = String(
    flags.token
    ?? process.env.DSH_PROCEDURES_SYNC_TOKEN
    ?? stored.token
    ?? '',
  ).trim();
  const globalDir = resolve(flags['global-dir'] ?? flags.globalDir ?? stored.globalDir ?? defaults.globalDir);
  const statsFile = resolve(flags['stats-file'] ?? flags.statsFile ?? stored.statsFile ?? defaults.statsFile);
  return { repo, branch, token, globalDir, statsFile, configFile };
}

function encodePath(path) {
  return String(path)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeBase64(text) {
  return Buffer.from(String(text ?? '').replace(/\s+/g, ''), 'base64').toString('utf8');
}

function encodeBase64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

/** Minimal GitHub Contents client; every method maps to one REST call. */
export function createGitHubClient({
  repo,
  branch = SYNC_DEFAULT_BRANCH,
  token,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.github.com',
} = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function request(path, init = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    if (response.status === 404) return { status: 404, data: null };
    if (!response.ok) {
      let detail = '';
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        // keep the status-only message
      }
      throw new Error(`GitHub ${response.status} ${path}${detail ? `: ${detail}` : ''}`);
    }
    return { status: response.status, data: await response.json() };
  }

  function contentsPath(path) {
    const encoded = encodePath(path);
    const ref = `?ref=${encodeURIComponent(branch)}`;
    return encoded ? `/repos/${repo}/contents/${encoded}${ref}` : `/repos/${repo}/contents${ref}`;
  }

  return {
    async repoInfo() {
      const result = await request(`/repos/${repo}`);
      return result.data;
    },
    async listDir(path = '') {
      const result = await request(contentsPath(path));
      if (Array.isArray(result.data)) return result.data;
      if (result.data && typeof result.data === 'object') return [result.data];
      return [];
    },
    async getFile(path) {
      const result = await request(contentsPath(path));
      if (!result.data || Array.isArray(result.data) || typeof result.data.content !== 'string') return null;
      return { content: decodeBase64(result.data.content), sha: result.data.sha };
    },
    async putFile(path, content, sha, message) {
      const body = { message, content: encodeBase64(content), branch };
      if (sha) body.sha = sha;
      await request(`/repos/${repo}/contents/${encodePath(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  };
}

/** Local global-library files keyed by their repo-relative path. */
export function collectLocal(globalDir) {
  const files = {};
  if (!existsSync(globalDir)) return files;

  for (const entry of readdirSync(globalDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('_')) continue;
    files[entry.name] = readFileSync(join(globalDir, entry.name), 'utf8');
  }

  const cardsDir = join(globalDir, 'cards');
  if (existsSync(cardsDir)) {
    for (const entry of readdirSync(cardsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      files[`cards/${entry.name}`] = readFileSync(join(cardsDir, entry.name), 'utf8');
    }
  }

  return files;
}

function laterText(left, right) {
  const a = typeof left === 'string' ? left : '';
  const b = typeof right === 'string' ? right : '';
  if (!a) return b || null;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Conservative merge: counts never shrink; timestamps keep the later one. */
export function mergeStats(local, remote) {
  const merged = emptyStats();
  const ids = new Set([
    ...Object.keys(local?.cards ?? {}),
    ...Object.keys(remote?.cards ?? {}),
  ]);

  for (const id of ids) {
    const a = local?.cards?.[id] ?? {};
    const b = remote?.cards?.[id] ?? {};
    const outcomeAt = laterText(a.last_outcome_at, b.last_outcome_at);
    const outcome = outcomeAt === (b.last_outcome_at ?? null) && b.last_outcome ? b.last_outcome : a.last_outcome;
    merged.cards[id] = {
      hits: Math.max(Number(a.hits) || 0, Number(b.hits) || 0),
      last_hit: laterText(a.last_hit, b.last_hit),
      last_session: a.last_session ?? b.last_session ?? null,
      repeated: Math.max(Number(a.repeated) || 0, Number(b.repeated) || 0),
      no_repeat: Math.max(Number(a.no_repeat) || 0, Number(b.no_repeat) || 0),
      last_outcome: outcome ?? null,
      last_outcome_at: outcomeAt,
    };
  }

  merged.updated_at = laterText(local?.updated_at, remote?.updated_at);
  return merged;
}

function requireConfig(config) {
  if (!config.repo) throw new Error('missing sync repo; run: procedures sync init --repo <owner/name> --token <token>');
  if (!config.token) throw new Error('missing sync token; set DSH_PROCEDURES_SYNC_TOKEN or run procedures sync init --token <token>');
}

/** Create a private repository for the authenticated user (used by `sync init --create`). */
export async function createUserRepo({
  repo,
  token,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.github.com',
  privateRepo = true,
} = {}) {
  const name = String(repo).split('/').pop();
  const response = await fetchImpl(`${baseUrl}/user/repos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, private: privateRepo }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // status-only message
    }
    throw new Error(`GitHub ${response.status} create repo ${repo}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

function writeLocal(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

/** Download the remote global library into the local directory and merge remote stats. */
export async function syncPull({ config, fetchImpl, dryRun = false, log = () => {} } = {}) {
  requireConfig(config);
  const client = createGitHubClient({ repo: config.repo, branch: config.branch, token: config.token, fetchImpl });
  const root = await client.listDir('');
  const cards = await client.listDir('cards');

  const remotePaths = [];
  for (const entry of root) {
    if (entry.type === 'file' && entry.name.endsWith('.md') && !entry.name.startsWith('_')) remotePaths.push(entry.name);
  }
  for (const entry of cards) {
    if (entry.type === 'file' && entry.name.endsWith('.md')) remotePaths.push(`cards/${entry.name}`);
  }

  let written = 0;
  let skipped = 0;
  for (const relative of remotePaths) {
    const remote = await client.getFile(relative);
    if (!remote) continue;
    const target = join(config.globalDir, ...relative.split('/'));
    const local = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (local === remote.content) {
      skipped += 1;
      continue;
    }
    if (!dryRun) writeLocal(target, remote.content);
    written += 1;
    log(`pull ${relative}`);
  }

  const remoteStats = await client.getFile(SYNC_STATS_FILE);
  const localStats = readStatsAt(config.statsFile);
  const merged = mergeStats(localStats, remoteStats ? JSON.parse(remoteStats.content) : emptyStats());
  const changed = JSON.stringify(merged) !== JSON.stringify(localStats);
  if (changed && !dryRun) writeLocal(config.statsFile, `${JSON.stringify(merged, null, 2)}\n`);

  return { written, skipped, total: remotePaths.length, statsMerged: Boolean(remoteStats), statsChanged: changed };
}

/** Upload local files that differ from the remote library, then push merged stats. */
export async function syncPush({ config, fetchImpl, dryRun = false, message = 'sync: update global library', log = () => {} } = {}) {
  requireConfig(config);
  const client = createGitHubClient({ repo: config.repo, branch: config.branch, token: config.token, fetchImpl });
  const root = await client.listDir('');
  const cards = await client.listDir('cards');

  const remoteShas = new Map();
  for (const entry of root) {
    if (entry.type === 'file' && entry.name.endsWith('.md')) remoteShas.set(entry.name, entry.sha);
  }
  for (const entry of cards) {
    if (entry.type === 'file' && entry.name.endsWith('.md')) remoteShas.set(`cards/${entry.name}`, entry.sha);
  }

  const localFiles = collectLocal(config.globalDir);
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const [relative, content] of Object.entries(localFiles)) {
    const sha = remoteShas.get(relative);
    if (!sha) {
      if (!dryRun) await client.putFile(relative, content, undefined, message);
      added += 1;
      log(`push new ${relative}`);
      continue;
    }
    const remote = await client.getFile(relative);
    if (remote && remote.content === content) {
      skipped += 1;
      continue;
    }
    if (!dryRun) await client.putFile(relative, content, sha, message);
    updated += 1;
    log(`push update ${relative}`);
  }

  const remoteStatsFile = await client.getFile(SYNC_STATS_FILE);
  const merged = mergeStats(
    readStatsAt(config.statsFile),
    remoteStatsFile ? JSON.parse(remoteStatsFile.content) : emptyStats(),
  );
  const serialized = `${JSON.stringify(merged, null, 2)}\n`;
  const remoteSerialized = remoteStatsFile ? `${JSON.stringify(JSON.parse(remoteStatsFile.content), null, 2)}\n` : null;
  const statsChanged = (Object.keys(merged.cards).length > 0 || remoteStatsFile !== null)
    && remoteSerialized !== serialized;

  if (statsChanged) {
    if (!dryRun) {
      writeLocal(config.statsFile, serialized);
      await client.putFile(SYNC_STATS_FILE, serialized, remoteStatsFile?.sha, message);
    }
    log('push stats');
  }

  return { added, updated, skipped, statsChanged };
}
