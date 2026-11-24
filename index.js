import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { readFeedCache, refreshFeed, feedLine } from './lib/community-feed.mjs';
import { appendInbox, searchCards } from './lib/cards.mjs';
import { HOOK_TEXT, globalHookText } from './lib/hook-text.mjs';
import { buildHint } from './lib/hint.mjs';
import { recordHitAt, recordOutcomeAt, statsPath } from './lib/stats.mjs';

export { buildHint };

let createUserMessage;
try {
  const llm = await import('@deepseek-ai/dsh-llm');
  createUserMessage = llm.createUserMessage;
} catch {
  createUserMessage = undefined;
}

export const name = 'dsh-procedures';
export const inject = ['systemPrompt', 'workingDirectory', 'agents'];

const DEFAULTS = {
  dir: 'procedures',
  autoInbox: true,
  hintOnError: true,
  maxCards: 3,
  maxHintsPerSession: 5,
  minErrorChars: 8,
  sectionOrder: 800,
  ignoreTools: [],
  hookText: '',
  debug: false,
  stats: true,
  globalDir: '',
  globalPenalty: 1,
  globalStats: true,
  globalStatsFile: '',
  resolutionWindow: 5,
  resolutionSeconds: 120,
  community: true,
  communityRepo: 'fubai-fenzhi/dsh-procedures-community',
  communitySubmit: 'ask',
  communityFeed: true,
};

function positive(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const ignore = Array.isArray(source.ignoreTools)
    ? source.ignoreTools
    : typeof source.ignoreTools === 'string'
      ? source.ignoreTools.split(',')
      : [];
  return {
    ...DEFAULTS,
    dir: typeof source.dir === 'string' && source.dir.trim() ? source.dir.trim() : DEFAULTS.dir,
    autoInbox: source.autoInbox !== false,
    hintOnError: source.hintOnError !== false,
    maxCards: positive(source.maxCards, DEFAULTS.maxCards),
    maxHintsPerSession: positive(source.maxHintsPerSession, DEFAULTS.maxHintsPerSession),
    minErrorChars: positive(source.minErrorChars, DEFAULTS.minErrorChars),
    sectionOrder: Number.isFinite(Number(source.sectionOrder))
      ? Number(source.sectionOrder)
      : DEFAULTS.sectionOrder,
    ignoreTools: ignore.map((item) => String(item).trim()).filter(Boolean),
    hookText: typeof source.hookText === 'string' && source.hookText.trim() ? source.hookText : '',
    debug: source.debug === true,
    stats: source.stats !== false,
    globalDir: typeof source.globalDir === 'string' ? source.globalDir.trim() : '',
    globalPenalty: Number.isFinite(Number(source.globalPenalty)) && Number(source.globalPenalty) >= 0
      ? Number(source.globalPenalty)
      : DEFAULTS.globalPenalty,
    globalStats: source.globalStats !== false,
    globalStatsFile: typeof source.globalStatsFile === 'string' ? source.globalStatsFile.trim() : '',
    resolutionWindow: positive(source.resolutionWindow, DEFAULTS.resolutionWindow),
    resolutionSeconds: positive(source.resolutionSeconds, DEFAULTS.resolutionSeconds),
    community: source.community !== false,
    communityRepo: typeof source.communityRepo === 'string' && source.communityRepo.trim()
      ? source.communityRepo.trim()
      : DEFAULTS.communityRepo,
    communitySubmit: ['off', 'ask', 'auto'].includes(source.communitySubmit)
      ? source.communitySubmit
      : DEFAULTS.communitySubmit,
    communityFeed: source.communityFeed !== false,
  };
}

function communityFeedText(cfg, agent) {
  if (!cfg.community || !cfg.communityFeed) return '';
  try {
    const cached = readFeedCache();
    refreshFeed({ repo: cfg.communityRepo }).catch(() => {});
    if (!cached) return '';
    const seed = `${agent?.id ?? ''}:${new Date().toISOString().slice(0, 10)}`;
    return feedLine(cached, seed);
  } catch {
    return '';
  }
}

function warn(ctx, message) {
  const logger = ctx?.logger;
  if (logger && typeof logger.warn === 'function') logger.warn(`[procedures] ${message}`);
  else if (typeof console !== 'undefined') console.warn(`[procedures] ${message}`);
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function configuredDir(cwd, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const expanded = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')
    ? join(homedir(), raw.slice(1))
    : raw;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export function globalStatsPath(cwd, value) {
  const raw = String(value ?? '').trim();
  const expanded = raw
    ? (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')
        ? join(homedir(), raw.slice(1))
        : raw)
    : join(homedir(), '.dsh', 'procedures', 'global-stats.json');
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export function resolveAttach(cwd, cfg) {
  const localDir = resolve(cwd, cfg.dir);
  const hasLocal = isInside(cwd, localDir) && existsSync(localDir);
  const globalDir = configuredDir(cwd, cfg.globalDir);
  const hasGlobal = Boolean(globalDir && existsSync(globalDir));
  const mode = hasLocal ? (hasGlobal ? 'both' : 'local') : hasGlobal ? 'global' : 'none';
  return {
    localDir,
    hasLocal,
    globalDir,
    hasGlobal,
    mode,
    globalStatsFile: globalStatsPath(cwd, cfg.globalStatsFile),
  };
}

function errorText(result) {
  const parts = [];
  const push = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return;
    const duplicate = parts.some(
      (part) => part === text || part.includes(text) || text.includes(part),
    );
    if (!duplicate) parts.push(text);
  };

  const failure = result?.error;
  if (failure && typeof failure === 'object') {
    if (typeof failure.message === 'string') push(failure.message);
    const info = failure.info;
    if (info && typeof info === 'object') {
      if (info.name) push(String(info.name));
      if (info.code) push(String(info.code));
    }
  }
  for (const block of Array.isArray(result?.content) ? result.content : []) {
    if (block && block.type === 'text' && typeof block.text === 'string') push(block.text);
  }
  return parts.join(' | ').slice(0, 800);
}

function injectText(ctx, agent, text) {
  try {
    if (typeof agent.inject !== 'function') return;
    const message = typeof createUserMessage === 'function'
      ? createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'cordis-host-runner' },
        })
      : {
          id: randomUUID(),
          role: 'user',
          time: Date.now(),
          content: [{ type: 'text', text }],
          source: { kind: 'cordis-host-runner' },
        };
    agent.inject(message);
  } catch (error) {
    warn(ctx, `inject failed: ${String(error)}`);
  }
}

export function shouldCapture(cfg, hits, text) {
  return cfg.autoInbox === true && hits.length === 0 && text.length >= cfg.minErrorChars;
}

export function settlePending(state, hits, now, cfg) {
  const pending = state.pending;
  if (!pending) return null;
  pending.remaining -= 1;
  const repeated = Array.isArray(hits) && hits.some((hit) => hit.id === pending.cardId);
  const elapsed = now - pending.at >= Number(cfg.resolutionSeconds) * 1000;
  if (repeated) {
    state.pending = null;
    return { ...pending, outcome: 'repeated' };
  }
  if (pending.remaining <= 0 || elapsed) {
    state.pending = null;
    return { ...pending, outcome: 'no_repeat' };
  }
  return null;
}

function statsFileForHit(hit, cfg, dataDir, hasLocal, globalStatsFile) {
  if (hit.scope === 'global') return cfg.globalStats ? globalStatsFile : null;
  return hasLocal && cfg.stats ? statsPath(dataDir) : null;
}

function onToolResult(ctx, cfg, agent, cwd, dataDir, state, exec, result, globalDir, hasLocal, globalStatsFile) {
  if (!result) return;
  const now = Date.now();
  const isError = result.isError === true;
  const tool = typeof exec?.name === 'string' && exec.name ? exec.name : 'tool';
  let text = '';
  let hits = [];

  if (isError && !cfg.ignoreTools.includes(tool)) {
    text = errorText(result);
    if (text.length >= cfg.minErrorChars) {
      hits = searchCards(dataDir, `${tool}\n${text}`, {
        max: cfg.maxCards,
        strict: true,
        globalDir,
        globalPenalty: cfg.globalPenalty,
      });
    }
  }

  if (state.pending) {
    const settled = settlePending(state, hits, now, cfg);
    if (settled) {
      try {
        recordOutcomeAt(settled.statsFile, { id: settled.cardId }, settled.outcome, {
          now: new Date(now),
        });
      } catch (error) {
        warn(ctx, `resolution update failed: ${String(error)}`);
      }
      if (cfg.debug) warn(ctx, `resolution ${settled.outcome} for ${settled.cardId}`);
    }
  }

  if (!isError || cfg.ignoreTools.includes(tool) || text.length < cfg.minErrorChars) return;

  if (hits.length > 0) {
    if (!cfg.hintOnError) return;
    const hit = hits[0];
    if (state.cards.has(hit.id) || state.hints >= cfg.maxHintsPerSession) return;
    state.cards.add(hit.id);
    state.hints += 1;
    injectText(ctx, agent, buildHint(hit, cwd));

    const file = statsFileForHit(hit, cfg, dataDir, hasLocal, globalStatsFile);
    if (file) {
      try {
        if (state.pending) {
          recordOutcomeAt(state.pending.statsFile, { id: state.pending.cardId }, 'no_repeat', {
            now: new Date(now),
          });
          state.pending = null;
        }
        recordHitAt(file, hit, { sessionId: agent.id });
        state.pending = {
          cardId: hit.id,
          at: now,
          remaining: cfg.resolutionWindow,
          statsFile: file,
        };
      } catch (error) {
        warn(ctx, `stats update failed: ${String(error)}`);
      }
    }
    if (cfg.debug) warn(ctx, `hint ${hit.id} for ${agent.id}`);
    return;
  }

  if (!hasLocal) return;
  if (!shouldCapture(cfg, hits, text)) return;
  const signature = `${tool}|${text.replace(/\s+/g, ' ').slice(0, 120)}`;
  if (state.signatures.has(signature)) return;
  state.signatures.add(signature);
  const appended = appendInbox(dataDir, { tool, message: text });
  if (cfg.debug && appended.added) warn(ctx, `inbox captured ${tool} for ${agent.id}`);
}

export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig);
  const attached = new Map();

  const detach = (id) => {
    const state = attached.get(id);
    if (!state) return;
    attached.delete(id);
    for (const dispose of state.registrations.reverse()) {
      try {
        dispose?.();
      } catch {
        // The agent context may already be disposed; nothing left to release.
      }
    }
  };

  const attach = (agent) => {
    if (!agent || attached.has(agent.id)) return;
    let cwd;
    try {
      cwd = ctx.workingDirectory.get(agent.session);
    } catch {
      return;
    }
    if (typeof cwd !== 'string' || cwd.length === 0) return;

    const plan = resolveAttach(cwd, cfg);
    if (plan.mode === 'none') return;
    const dataDir = plan.localDir;
    const globalDir = plan.globalDir;
    const hasLocal = plan.hasLocal;

    const state = {
      registrations: [],
      cards: new Set(),
      hints: 0,
      signatures: new Set(),
      pending: null,
    };

    try {
      const base = cfg.hookText || (hasLocal
        ? (plan.hasGlobal
            ? `${HOOK_TEXT}\n- 也配置了只读全局库；命中全局卡时提示会写 global:<文件名>。`
            : HOOK_TEXT)
        : globalHookText(globalDir));
      const communityLine = cfg.communitySubmit === 'off'
        ? '\n- 社区卡库已启用：缺卡可 procedures community pull。'
        : cfg.communitySubmit === 'auto'
          ? '\n- 社区卡库已启用（auto）：缺卡可 procedures community pull；收尾可 procedures contribute（自动脱敏、每日限额）。'
          : '\n- 社区卡库已启用：缺卡可 procedures community pull；收尾把值得分享的卡提给社区：procedures contribute --open（免 token，生成提交链接）。';
      const hook = cfg.community ? `${base}${communityLine}${communityFeedText(cfg, agent)}` : base;
      state.registrations.push(agent.ctx.systemPrompt.section({
        name: 'procedures',
        order: cfg.sectionOrder,
        text: hook,
      }));
    } catch (error) {
      warn(ctx, `section registration failed for ${agent.id}: ${String(error)}`);
    }

    try {
      state.registrations.push(agent.ctx.on('tools/result', (exec, result) => {
        try {
          onToolResult(ctx, cfg, agent, cwd, dataDir, state, exec, result, globalDir, hasLocal, plan.globalStatsFile);
        } catch (error) {
          warn(ctx, `result handler failed: ${String(error)}`);
        }
      }));
    } catch (error) {
      warn(ctx, `tools/result registration failed: ${String(error)}`);
    }

    attached.set(agent.id, state);
    if (cfg.debug) warn(ctx, `attached ${agent.id} (${plan.mode}: ${hasLocal ? dataDir : globalDir})`);
  };

  ctx.effect(() => {
    for (const agent of ctx.agents.list()) {
      try {
        attach(agent);
      } catch (error) {
        warn(ctx, `attach failed: ${String(error)}`);
      }
    }

    const offCreated = ctx.on('agent/created', ({ agent }) => {
      try {
        attach(agent);
      } catch (error) {
        warn(ctx, `attach on created failed: ${String(error)}`);
      }
    });
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => detach(agent.id));

    return () => {
      offCreated();
      offDisposed();
      for (const id of [...attached.keys()]) detach(id);
    };
  });
}
