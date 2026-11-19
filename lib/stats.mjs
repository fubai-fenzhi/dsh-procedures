import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const STATS_FILE = '_stats.json';

export function statsPath(dir) {
  return join(resolve(dir), STATS_FILE);
}

export function emptyStats() {
  return { version: 1, cards: {}, updated_at: null };
}

export function readStatsAt(file) {
  if (!file || !existsSync(file)) return emptyStats();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const cards = data && typeof data.cards === 'object' && data.cards !== null ? data.cards : {};
    return {
      version: 1,
      cards,
      updated_at: typeof data?.updated_at === 'string' ? data.updated_at : null,
    };
  } catch {
    return emptyStats();
  }
}

export function readStats(dir) {
  return readStatsAt(statsPath(dir));
}

/** Increment one card's hit count in an explicit stats file. Card YAML is never touched. */
export function recordHitAt(file, card, options = {}) {
  const id = String(card?.id ?? '').trim();
  if (!file || !id) return null;

  const stats = readStatsAt(file);
  const previous = stats.cards[id] ?? { hits: 0, last_hit: null, last_session: null };
  const now = options.now instanceof Date ? options.now : new Date();
  const entry = {
    ...previous,
    hits: (Number(previous.hits) || 0) + 1,
    last_hit: now.toISOString(),
    last_session: options.sessionId ?? previous.last_session ?? null,
  };
  stats.cards[id] = entry;
  stats.updated_at = now.toISOString();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  return entry;
}

/** Record what happened after a hint: the same card repeated, or the window closed clean. */
export function recordOutcomeAt(file, card, outcome, options = {}) {
  const id = String(card?.id ?? '').trim();
  if (!file || !id) return null;
  if (outcome !== 'repeated' && outcome !== 'no_repeat') return null;

  const stats = readStatsAt(file);
  const previous = stats.cards[id] ?? {
    hits: 0,
    last_hit: null,
    last_session: null,
    repeated: 0,
    no_repeat: 0,
  };
  const now = options.now instanceof Date ? options.now : new Date();
  const entry = {
    ...previous,
    repeated: (Number(previous.repeated) || 0) + (outcome === 'repeated' ? 1 : 0),
    no_repeat: (Number(previous.no_repeat) || 0) + (outcome === 'no_repeat' ? 1 : 0),
    last_outcome: outcome,
    last_outcome_at: now.toISOString(),
  };
  stats.cards[id] = entry;
  stats.updated_at = now.toISOString();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  return entry;
}

/** Workspace sidecar under <dir>/_stats.json. */
export function recordHit(dir, card, options = {}) {
  const root = resolve(dir);
  if (!existsSync(root)) return null;
  return recordHitAt(statsPath(root), card, options);
}

export function hitsOf(stats, card) {
  const stored = Number(stats?.cards?.[card?.id]?.hits);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Number(card?.hits) || 0;
}

export function outcomesOf(stats, card) {
  const entry = stats?.cards?.[card?.id] ?? {};
  return {
    repeated: Number(entry.repeated) || 0,
    noRepeat: Number(entry.no_repeat) || 0,
    lastOutcome: typeof entry.last_outcome === 'string' ? entry.last_outcome : null,
  };
}
