#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  appendInbox,
  auditCards,
  loadCards,
  searchCards,
  synthesizeDrafts,
} from '../lib/cards.mjs';
import { synthesizeWithLlm } from '../lib/llm.mjs';
import { hitsOf, outcomesOf, readStats } from '../lib/stats.mjs';
import {
  COMMUNITY_REPO,
  communityPull,
  communityStatus,
  contribute,
} from '../lib/community.mjs';
import {
  collectLocal,
  createGitHubClient,
  createUserRepo,
  resolveSyncConfig,
  syncPull,
  syncPush,
  writeSyncConfig,
} from '../lib/sync.mjs';

const USAGE = `procedures — file-based experience cards

Usage:
  procedures search "<task words or error text>" [--dir procedures] [--global-dir DIR] [--global-penalty 1] [--max 3] [--include-expired] [--json]
  procedures audit [--dir procedures] [--global-dir DIR] [--global-stats FILE] [--stale-days 90] [--json]
  procedures list [--dir procedures] [--json]
  procedures inbox add "<one line>" [--tool pwsh] [--dir procedures] [--json]
  procedures synthesize [--dir procedures] [--out procedures/_drafts] [--max 20] [--json]
  procedures synthesize --llm [--dry-run] [--context chat.md] [--max 5] [--base-url URL] [--model NAME] [--api-key KEY] [--json]
  procedures sync init --repo <owner/name> [--token TOKEN] [--branch main] [--global-dir DIR] [--create]
  procedures sync pull [--dry-run] [--json]
  procedures sync push [--dry-run] [--json]
  procedures sync status [--json]
  procedures sync   # pull then push
  procedures community pull [--global-dir DIR] [--repo OWNER/REPO] [--dry-run] [--json]
  procedures community status [--json]
  procedures contribute [--dir procedures] [--global-dir DIR] [--repo OWNER/REPO] [--yes] [--json]

  community pulls curated cards from the public community repo into the global library.
  contribute previews new local cards first; add --yes (and a GitHub token) to open issues.

  --llm uses an OpenAI-compatible /chat/completions endpoint (DeepSeek by default).
  Key is read from DEEPSEEK_API_KEY or DSH_PROCEDURES_API_KEY; --dry-run needs no key.

  sync keeps the global card library in a private GitHub repo (no server). The token is
  read from DSH_PROCEDURES_SYNC_TOKEN or the config file written by 'sync init'.

Examples:
  procedures search "app.asar ENOENT"
  procedures audit
  procedures inbox add "web_fetch 只返回 SPA 外壳" --tool web_fetch
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      flags[body] = argv[index + 1];
      index += 1;
      continue;
    }
    flags[body] = true;
  }
  return { positional, flags };
}

function dataDir(flags) {
  return resolve(process.cwd(), typeof flags.dir === 'string' ? flags.dir : 'procedures');
}

function relativePath(path) {
  return path.startsWith(process.cwd())
    ? path.slice(process.cwd().length + 1).replaceAll('\\', '/')
    : path;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function displayPath(card) {
  if (card.scope === 'global') return `global:${card.file}`;
  return relativePath(card.path);
}

function commandSearch(positional, flags) {
  const query = positional.slice(1).join(' ').trim();
  if (!query) return fail('search needs a query, e.g. procedures search "app.asar"');
  const globalDir = typeof flags['global-dir'] === 'string'
    ? resolve(process.cwd(), flags['global-dir'])
    : undefined;
  const hits = searchCards(dataDir(flags), query, {
    max: Number.parseInt(String(flags.max ?? '3'), 10) || 3,
    includeExpired: flags['include-expired'] === true,
    globalDir,
    globalPenalty: Number.isFinite(Number(flags['global-penalty']))
      ? Number(flags['global-penalty'])
      : 0,
  });
  if (flags.json) {
    printJson({
      query,
      hits: hits.map((card) => ({
        id: card.id,
        title: card.title,
        file: displayPath(card),
        scope: card.scope,
        rarity: card.rarity,
        score: card.score,
        expired: card.expired,
        validUntil: card.validUntil,
        matched: card.matched,
      })),
    });
    return undefined;
  }
  if (hits.length === 0) {
    process.stdout.write('no card matched\n');
    return undefined;
  }
  for (const card of hits) {
    const reasons = card.matched.map((match) => `${match.on}:${match.value}`).join(', ');
    const tags = [
      card.scope === 'global' ? 'global' : '',
      card.rarity === 'rare' ? 'rare' : '',
      card.expired ? 'expired' : '',
    ].filter(Boolean).join(',');
    process.stdout.write(`${card.score}\t${displayPath(card)}\n`);
    process.stdout.write(`\t${card.title}\n`);
    process.stdout.write(`\t${reasons}${tags ? `  [${tags}]` : ''}\n`);
  }
  return undefined;
}

function commandAudit(flags) {
  const globalDir = typeof flags['global-dir'] === 'string'
    ? resolve(process.cwd(), flags['global-dir'])
    : undefined;
  const globalStatsFile = globalDir
    ? (typeof flags['global-stats'] === 'string'
        ? resolve(process.cwd(), flags['global-stats'])
        : join(homedir(), '.dsh', 'procedures', 'global-stats.json'))
    : undefined;
  const staleDays = Number.parseInt(String(flags['stale-days'] ?? '90'), 10) || 90;
  const result = auditCards(dataDir(flags), { globalDir, globalStatsFile, staleDays });
  if (flags.json) {
    printJson(result);
  } else {
    process.stdout.write(
      `cards: ${result.cards} (workspace ${result.scopes?.workspace ?? 0}, global ${result.scopes?.global ?? 0})`
      + `  stats: ${result.stats?.tracked ?? 0}  globalStats: ${result.stats?.globalTracked ?? 0}`
      + `  issues: ${result.issues.length}\n`,
    );
    for (const issue of result.issues) {
      process.stdout.write(
        `${issue.severity.toUpperCase()}\t[${issue.scope ?? 'workspace'}]\t${issue.file}\t${issue.code}\t${issue.message}\n`,
      );
    }
  }
  if (!result.ok) process.exitCode = 1;
  return undefined;
}

function commandList(flags) {
  const dir = dataDir(flags);
  const cards = loadCards(dir, { refresh: true });
  const stats = readStats(dir);
  if (flags.json) {
    printJson(cards.map((card) => {
      const outcomes = outcomesOf(stats, card);
      return {
        id: card.id,
        title: card.title,
        file: relativePath(card.path),
        type: card.type,
        rarity: card.rarity,
        hits: hitsOf(stats, card),
        repeated: outcomes.repeated,
        noRepeat: outcomes.noRepeat,
        lastOutcome: outcomes.lastOutcome,
        anchors: card.anchors,
        triggers: card.triggers,
        validUntil: card.validUntil,
        size: card.size,
      };
    }));
    return undefined;
  }
  for (const card of cards) {
    const outcomes = outcomesOf(stats, card);
    process.stdout.write(
      `${card.id}\t${hitsOf(stats, card)} hits\t${outcomes.repeated} rep\t${outcomes.noRepeat} clear`
      + `\t${card.rarity}\t${card.size} B\t${relativePath(card.path)}\n`,
    );
  }
  process.stdout.write(`${cards.length} card(s)\n`);
  return undefined;
}

function commandInbox(positional, flags) {
  if (positional[1] !== 'add') {
    return fail('inbox needs the "add" subcommand: procedures inbox add "<line>"');
  }
  const message = positional.slice(2).join(' ').trim();
  if (!message) return fail('inbox add needs a message');
  const result = appendInbox(dataDir(flags), {
    tool: typeof flags.tool === 'string' ? flags.tool : 'manual',
    message,
  });
  if (flags.json) {
    printJson(result);
  } else if (result.added) {
    process.stdout.write(`added: ${result.line}\n`);
  } else {
    process.stdout.write(`skipped: ${result.reason}\n`);
  }
  return undefined;
}

async function commandSynthesize(flags) {
  const dir = dataDir(flags);
  const outDir = typeof flags.out === 'string' ? resolve(process.cwd(), flags.out) : undefined;

  if (flags.llm) {
    let context = '';
    if (typeof flags.context === 'string') {
      try {
        context = readFileSync(resolve(process.cwd(), flags.context), 'utf8');
      } catch (error) {
        return fail(`cannot read context: ${String(error)}`);
      }
    }
    let result;
    try {
      result = await synthesizeWithLlm({
        dir,
        outDir,
        max: Number.parseInt(String(flags.max ?? '5'), 10) || 5,
        context,
        dryRun: flags['dry-run'] === true,
        baseUrl: typeof flags['base-url'] === 'string' ? flags['base-url'] : undefined,
        model: typeof flags.model === 'string' ? flags.model : undefined,
        apiKey: typeof flags['api-key'] === 'string' ? flags['api-key'] : undefined,
      });
    } catch (error) {
      return fail(String(error));
    }
    if (flags.json) {
      printJson(result);
      return undefined;
    }
    if (result.dryRun) {
      process.stdout.write(`${result.prompt}\n`);
      process.stdout.write(`\n[dry-run] entries: ${result.entries}, model: ${result.config.model}, hasKey: ${result.config.hasKey}\n`);
      return undefined;
    }
    for (const file of result.created) process.stdout.write(`draft: ${relativePath(file)}\n`);
    for (const item of result.rejected) {
      process.stdout.write(`rejected: ${item.reason}${item.file ? ` (${relativePath(item.file)})` : ''}\n`);
    }
    if (result.created.length === 0) process.stdout.write('no valid draft\n');
    process.stdout.write(`out: ${relativePath(result.outDir)}\n`);
    return undefined;
  }

  const result = synthesizeDrafts(dir, {
    outDir,
    max: Number.parseInt(String(flags.max ?? '20'), 10) || 20,
  });
  if (flags.json) {
    printJson(result);
    return undefined;
  }
  for (const file of result.created) process.stdout.write(`draft: ${relativePath(file)}\n`);
  if (result.created.length === 0) process.stdout.write('no new draft\n');
  process.stdout.write(`out: ${relativePath(result.outDir)}\n`);
  return undefined;
}

async function commandSync(positional, flags) {
  const sub = positional[1] ?? 'all';
  const config = resolveSyncConfig(flags);
  const json = flags.json === true;
  const dryRun = flags['dry-run'] === true;

  if (sub === 'init') {
    if (!config.repo) return fail('sync init needs --repo <owner/name>');
    if (!config.token) return fail('sync init needs --token <token> (or DSH_PROCEDURES_SYNC_TOKEN)');
    const client = createGitHubClient({ repo: config.repo, branch: config.branch, token: config.token });
    let info = null;
    try {
      info = await client.repoInfo();
    } catch {
      info = null;
    }
    if (!info) {
      if (!flags.create) {
        return fail(`repo ${config.repo} not found or no access; create a private repo and retry, or pass --create`);
      }
      await createUserRepo({ repo: config.repo, token: config.token });
    }
    writeSyncConfig(config.configFile, {
      repo: config.repo,
      branch: config.branch,
      token: config.token,
      globalDir: config.globalDir,
      statsFile: config.statsFile,
    });
    if (json) {
      printJson({ ok: true, repo: config.repo, branch: config.branch, configFile: config.configFile, globalDir: config.globalDir });
    } else {
      process.stdout.write(`sync: configured ${config.repo} -> ${config.configFile}\n`);
      process.stdout.write(`sync: global library ${config.globalDir}\n`);
    }
    return undefined;
  }

  if (sub === 'status') {
    const client = createGitHubClient({ repo: config.repo, branch: config.branch, token: config.token });
    const root = await client.listDir('');
    const cards = await client.listDir('cards');
    const remote = [
      ...root.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md')),
      ...cards.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md')),
    ];
    const local = collectLocal(config.globalDir);
    if (json) {
      printJson({ repo: config.repo, branch: config.branch, remote: remote.length, local: Object.keys(local).length, globalDir: config.globalDir });
    } else {
      process.stdout.write(`repo: ${config.repo} (${config.branch})\n`);
      process.stdout.write(`remote: ${remote.length} file(s)\n`);
      process.stdout.write(`local: ${Object.keys(local).length} file(s) at ${config.globalDir}\n`);
    }
    return undefined;
  }

  if (!['pull', 'push', 'all'].includes(sub)) {
    return fail(`unknown sync subcommand: ${sub} (init|pull|push|status)`);
  }

  const log = (line) => {
    if (!json) process.stdout.write(`${line}\n`);
  };

  try {
    if (sub === 'pull' || sub === 'all') {
      const result = await syncPull({ config, dryRun, log });
      if (json) printJson({ action: 'pull', ...result });
      else process.stdout.write(`pulled: ${result.written} written, ${result.skipped} unchanged, ${result.total} remote${result.statsMerged ? ', stats merged' : ''}\n`);
    }
    if (sub === 'push' || sub === 'all') {
      const result = await syncPush({ config, dryRun, log });
      if (json) printJson({ action: 'push', ...result });
      else process.stdout.write(`pushed: +${result.added} new, ${result.updated} updated, ${result.skipped} unchanged${result.statsChanged ? ', stats pushed' : ''}\n`);
    }
  } catch (error) {
    return fail(String(error));
  }
  return undefined;
}

async function commandCommunity(positional, flags) {
  const sub = positional[1] ?? 'pull';
  const json = flags.json === true;
  const sync = resolveSyncConfig(flags);
  const repo = typeof flags.repo === 'string' ? flags.repo : COMMUNITY_REPO;
  const token = typeof flags.token === 'string'
    ? flags.token
    : (process.env.DSH_PROCEDURES_CONTRIBUTE_TOKEN ?? sync.token);

  if (sub === 'status') {
    const result = await communityStatus({ globalDir: sync.globalDir, repo, token });
    if (json) {
      printJson(result);
    } else {
      process.stdout.write(`community: ${result.repo}\n`);
      process.stdout.write(`remote: ${result.remote} card(s)\n`);
      process.stdout.write(`local global: ${result.local} card(s)\n`);
    }
    return undefined;
  }

  if (sub !== 'pull') return fail(`unknown community subcommand: ${sub} (pull|status)`);

  const dryRun = flags['dry-run'] === true;
  try {
    const result = await communityPull({
      globalDir: sync.globalDir,
      repo,
      token,
      dryRun,
      log: (line) => {
        if (!json) process.stdout.write(`${line}\n`);
      },
    });
    if (json) printJson({ action: 'pull', repo, ...result });
    else process.stdout.write(`pulled: ${result.added} added, ${result.skipped} existing, ${result.total} remote\n`);
  } catch (error) {
    return fail(String(error));
  }
  return undefined;
}

async function commandContribute(flags) {
  const json = flags.json === true;
  const sync = resolveSyncConfig(flags);
  const repo = typeof flags.repo === 'string' ? flags.repo : COMMUNITY_REPO;
  const token = typeof flags.token === 'string'
    ? flags.token
    : (process.env.DSH_PROCEDURES_CONTRIBUTE_TOKEN ?? sync.token);
  const dryRun = flags.yes !== true;

  try {
    const result = await contribute({
      dirs: [dataDir(flags), sync.globalDir],
      repo,
      token,
      dryRun,
      log: (line) => {
        if (!json) process.stdout.write(`${line}\n`);
      },
    });
    if (json) {
      printJson({ action: 'contribute', repo, dryRun, ...result });
    } else if (result.candidates === 0) {
      process.stdout.write('no new card to contribute\n');
    } else if (dryRun) {
      process.stdout.write(`would submit ${result.candidates} card(s) to ${repo}; re-run with --yes to open issues\n`);
    } else {
      process.stdout.write(`submitted ${result.submitted} card(s) to ${repo}\n`);
    }
  } catch (error) {
    return fail(String(error));
  }
  return undefined;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional[0];

if (!command || flags.help || command === 'help') {
  process.stdout.write(USAGE);
} else if (command === 'search') {
  commandSearch(positional, flags);
} else if (command === 'audit') {
  commandAudit(flags);
} else if (command === 'list') {
  commandList(flags);
} else if (command === 'inbox') {
  commandInbox(positional, flags);
} else if (command === 'synthesize') {
  await commandSynthesize(flags);
} else if (command === 'sync') {
  await commandSync(positional, flags);
} else if (command === 'community') {
  await commandCommunity(positional, flags);
} else if (command === 'contribute') {
  await commandContribute(flags);
} else {
  fail(`unknown command: ${command}\n\n${USAGE}`);
}
