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

const USAGE = `procedures — file-based experience cards

Usage:
  procedures search "<task words or error text>" [--dir procedures] [--global-dir DIR] [--global-penalty 1] [--max 3] [--include-expired] [--json]
  procedures audit [--dir procedures] [--global-dir DIR] [--global-stats FILE] [--stale-days 90] [--json]
  procedures list [--dir procedures] [--json]
  procedures inbox add "<one line>" [--tool pwsh] [--dir procedures] [--json]
  procedures synthesize [--dir procedures] [--out procedures/_drafts] [--max 20] [--json]
  procedures synthesize --llm [--dry-run] [--context chat.md] [--max 5] [--base-url URL] [--model NAME] [--api-key KEY] [--json]

  --llm uses an OpenAI-compatible /chat/completions endpoint (DeepSeek by default).
  Key is read from DEEPSEEK_API_KEY or DSH_PROCEDURES_API_KEY; --dry-run needs no key.

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
} else {
  fail(`unknown command: ${command}\n\n${USAGE}`);
}
