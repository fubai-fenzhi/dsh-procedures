#!/usr/bin/env node
/**
 * Estimate token costs for the two claims in the README:
 *   1. per hit: one-line hint vs injecting the whole matched card
 *   2. per session: resident hook text vs keeping the whole card library resident
 * Run: node bench/tokens.mjs [--dir procedures]
 *
 * The token estimate is deliberately simple: CJK ≈ 1 token/char, other text ≈ 1 token/4 chars.
 * It is a directional bench, not a tokenizer-accurate count.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildHint } from '../lib/hint.mjs';
import { HOOK_TEXT } from '../lib/hook-text.mjs';

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const workspace = dirIndex >= 0 ? args[dirIndex + 1] : 'procedures';
const cardsDir = join(workspace, 'cards');

function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const char of String(text)) {
    if (/[\u4e00-\u9fff]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

function loadCards() {
  return readdirSync(cardsDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => {
      const text = readFileSync(join(cardsDir, name), 'utf8');
      const title = (text.match(/^title:\s*(.+)$/m) ?? [])[1] ?? name;
      const anchor = (text.match(/^anchors:\s*\n\s*-\s*(\S+)/m) ?? [])[1] ?? '';
      const hint = buildHint({
        scope: 'workspace',
        path: join(cardsDir, name),
        file: name,
        type: 'trap',
        matched: [{ on: 'anchor', value: anchor }],
      }, process.cwd());
      return {
        name,
        title: title.trim(),
        cardTokens: estimateTokens(text),
        hintTokens: estimateTokens(hint),
      };
    });
}

const cards = loadCards();
if (cards.length === 0) {
  console.error(`no cards found under ${cardsDir}`);
  process.exit(1);
}

const totalCard = cards.reduce((sum, card) => sum + card.cardTokens, 0);
const totalHint = cards.reduce((sum, card) => sum + card.hintTokens, 0);
const hookTokens = estimateTokens(HOOK_TEXT);

const rows = cards.map((card) => {
  const savings = 1 - card.hintTokens / card.cardTokens;
  return { ...card, savings };
});

console.log(`cards: ${cards.length} under ${workspace}`);
console.log(`hook text: ~${hookTokens} tokens`);
console.log('');
console.log('per card (hint vs full card):');
for (const row of rows) {
  console.log(
    `  ${row.name}: card ~${row.cardTokens} tok, hint ~${row.hintTokens} tok, saves ${(row.savings * 100).toFixed(1)}%`,
  );
}

const perHit = 1 - totalHint / totalCard;
const sessionAllResident = totalCard;
const sessionOnDemand0 = hookTokens;
const sessionOnDemand2 = hookTokens + (totalCard / cards.length) * 2;

console.log('');
console.log(`per-hit total: card ~${totalCard} tok vs hint ~${totalHint} tok -> ${(perHit * 100).toFixed(1)}% fewer`);
console.log(`per-session: all cards resident ~${sessionAllResident} tok`);
console.log(`per-session: hook + on-demand (0 cards) ~${sessionOnDemand0} tok -> ${((1 - sessionOnDemand0 / sessionAllResident) * 100).toFixed(1)}% fewer`);
console.log(`per-session: hook + on-demand (2 cards) ~${Math.round(sessionOnDemand2)} tok -> ${((1 - sessionOnDemand2 / sessionAllResident) * 100).toFixed(1)}% fewer`);
