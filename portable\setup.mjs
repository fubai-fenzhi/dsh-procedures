#!/usr/bin/env node
/**
 * Scaffold a portable procedures/ directory and optionally append the hook to
 * an agent instruction file (AGENTS.md / CLAUDE.md / GEMINI.md / ...).
 */
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `procedures-setup — portable procedures kit

Usage:
  node portable/setup.mjs [--workspace DIR] [--write] [--agent-file AGENTS.md] [--force]

  --workspace   target project (default: current directory)
  --write       append the hook to the agent instruction file if missing
  --agent-file  instruction file name (default: AGENTS.md; e.g. CLAUDE.md)
  --force       overwrite existing template files

Without --write the rendered hook snippet is printed for manual pasting.`;

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
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
  return flags;
}

const here = dirname(fileURLToPath(import.meta.url));
const kitDir = resolve(here, '..').replaceAll('\\', '/');
const flags = parseArgs(process.argv.slice(2));

if (flags.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const workspace = resolve(process.cwd(), typeof flags.workspace === 'string' ? flags.workspace : '.');
const procedures = join(workspace, 'procedures');
const templates = ['INDEX.md', '_模板.md', '_模板-spell.md', '_inbox.md'];
const copied = [];
const skipped = [];

mkdirSync(join(procedures, 'cards'), { recursive: true });
for (const name of templates) {
  const source = join(here, 'templates', name);
  const target = join(procedures, name);
  if (!existsSync(source)) continue;
  if (existsSync(target) && flags.force !== true) {
    skipped.push(name);
    continue;
  }
  cpSync(source, target);
  copied.push(name);
}

const snippet = readFileSync(join(here, 'AGENTS-snippet.md'), 'utf8')
  .replaceAll('{{KIT_DIR}}', kitDir);

let agentFile = null;
let agentState = 'not-written';
if (flags.write) {
  const name = typeof flags['agent-file'] === 'string' ? flags['agent-file'] : 'AGENTS.md';
  agentFile = resolve(workspace, name);
  mkdirSync(dirname(agentFile), { recursive: true });
  const current = existsSync(agentFile) ? readFileSync(agentFile, 'utf8') : '';
  if (current.includes('经验流程 · procedures')) {
    agentState = 'already-present';
  } else {
    const prefix = current.length === 0
      ? ''
      : current.endsWith('\n\n')
        ? ''
        : current.endsWith('\n')
          ? '\n'
          : '\n\n';
    appendFileSync(agentFile, `${prefix}${snippet}\n`, 'utf8');
    agentState = 'appended';
  }
}

process.stdout.write(`workspace: ${workspace}\n`);
process.stdout.write(`procedures: ${procedures}\n`);
process.stdout.write(`templates copied: ${copied.join(', ') || '(none)'}\n`);
if (skipped.length > 0) {
  process.stdout.write(`templates skipped (already exist): ${skipped.join(', ')}\n`);
}
if (agentFile) {
  process.stdout.write(`agent file: ${agentFile} (${agentState})\n`);
} else {
  process.stdout.write('\n--- paste this into AGENTS.md / CLAUDE.md / GEMINI.md ---\n');
  process.stdout.write(`${snippet}\n`);
}
process.stdout.write('\nnext: create a card from _模板.md, then run\n');
process.stdout.write(`  node "${kitDir}/bin/procedures.mjs" audit --dir "${procedures}"\n`);
