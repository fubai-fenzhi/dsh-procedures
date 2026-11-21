import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/**
 * Offer local cards that the community repo does not have yet.
 * `dryRun` is the default so a contributor always sees the exact content first.
 */
export async function contribute({
  dirs,
  repo = COMMUNITY_REPO,
  branch = COMMUNITY_BRANCH,
  token = '',
  fetchImpl,
  dryRun = true,
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

  let submitted = 0;
  for (const card of candidates) {
    if (!dryRun) {
      await createIssue({ repo, token, title: `[card] ${card.name}`, body: card.content, fetchImpl });
      submitted += 1;
    }
    log(`${dryRun ? 'would submit' : 'submitted'} ${card.name}`);
  }

  return { candidates: candidates.length, submitted, skipped: seen.size - candidates.length };
}

/** Count curated community cards and local global cards. */
export async function communityStatus({ globalDir, repo = COMMUNITY_REPO, branch = COMMUNITY_BRANCH, token = '', fetchImpl } = {}) {
  const client = createGitHubClient({ repo, branch, token, fetchImpl });
  const remote = await remoteCardEntries(client);
  const local = collectCardFiles(join(globalDir, 'cards')).length;
  return { repo, remote: remote.length, local };
}
