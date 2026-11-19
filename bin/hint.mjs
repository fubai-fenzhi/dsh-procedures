#!/usr/bin/env node
/**
 * Harness-agnostic hint adapter. A hook can call this with the failed tool name
 * and error text; stdout is the one-line hint (empty when nothing matches).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { appendInbox, searchCards } from '../lib/cards.mjs';
import { buildHint } from '../lib/hint.mjs';

const USAGE = `hint — print the one-line procedures hint for a tool error

Usage:
  hint --error "..." [--tool pwsh] [--dir procedures] [--global-dir DIR] [--global-penalty 1] [--inbox] [--json]
  echo '{"tool":"pwsh","error":"..."}' | hint --stdin [--inbox] [--json]

Exit code is 0 even when nothing matches; hooks should not break the turn.`;

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

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

const { flags } = parseArgs(process.argv.slice(2));
if (flags.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

let payload = {};
if (flags.stdin) {
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error) {
    fail(`cannot parse stdin JSON: ${String(error)}`);
  }
}

const rawTool = flags.tool ?? payload.tool ?? payload.tool_name ?? 'tool';
const tool = String(rawTool).trim() || 'tool';
const rawError = flags.error ?? payload.error ?? payload.error_message ?? payload.message ?? '';
const error = typeof rawError === 'string' ? rawError : JSON.stringify(rawError);

if (!error.trim()) {
  fail('hint needs --error or --stdin JSON {tool,error}');
} else {
  const dir = resolve(process.cwd(), typeof flags.dir === 'string' ? flags.dir : 'procedures');
  const globalDir = typeof flags['global-dir'] === 'string'
    ? resolve(process.cwd(), flags['global-dir'])
    : undefined;
  const globalPenalty = Number.isFinite(Number(flags['global-penalty']))
    ? Number(flags['global-penalty'])
    : 1;
  const max = Number.parseInt(String(flags.max ?? '3'), 10) || 3;
  const hits = searchCards(dir, `${tool}\n${error}`, {
    max,
    strict: true,
    globalDir,
    globalPenalty,
  });

  if (hits.length > 0) {
    const hit = hits[0];
    const hint = buildHint(hit, process.cwd());
    if (flags.json) {
      printJson({
        hit: {
          id: hit.id,
          file: hit.scope === 'global' ? `global:${hit.file}` : hit.path,
          scope: hit.scope,
          type: hit.type,
          language: hit.language || null,
        },
        hint,
      });
    } else {
      process.stdout.write(`${hint}\n`);
    }
  } else if (flags.inbox) {
    const inbox = appendInbox(dir, { tool, message: error });
    if (flags.json) printJson({ hit: null, inbox });
  } else if (flags.json) {
    printJson({ hit: null });
  }
}
