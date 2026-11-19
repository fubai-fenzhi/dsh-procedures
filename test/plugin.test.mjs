import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHint, settlePending, shouldCapture } from '../index.js';

const base = { autoInbox: true, minErrorChars: 8 };

test('autoInbox=false suppresses inbox capture', () => {
  assert.equal(shouldCapture({ ...base, autoInbox: false }, [], 'a long enough error'), false);
});

test('a matching card suppresses inbox capture', () => {
  assert.equal(shouldCapture(base, [{ id: 'hit' }], 'a long enough error'), false);
});

test('captures an unmatched, long-enough error', () => {
  assert.equal(shouldCapture(base, [], 'a long enough error'), true);
  assert.equal(shouldCapture(base, [], 'short'), false);
});

test('buildHint distinguishes trap cards from spell cards', () => {
  const trap = buildHint({
    type: 'trap',
    path: 'procedures/cards/a.md',
    matched: [{ on: 'anchor', value: 'probe' }],
  }, process.cwd());
  assert.match(trap, /命中经验卡/);
  assert.match(trap, /probe/);

  const spell = buildHint({
    type: 'spell',
    path: 'procedures/cards/s.md',
    language: 'powershell',
    actionableCode: 'echo ok',
    matched: [],
  }, process.cwd());
  assert.match(spell, /命中技能卡/);
  assert.match(spell, /powershell/);
  assert.match(spell, /不要盲目运行/);

  const global = buildHint({
    type: 'trap',
    scope: 'global',
    file: 'global-card.md',
    path: 'C:/global/global-card.md',
    matched: [],
  }, process.cwd());
  assert.match(global, /global:global-card\.md/);
});

test('settlePending marks repeated when the same card fires', () => {
  const state = { pending: { cardId: 'a', at: 1000, remaining: 3, statsFile: 'x' } };
  const result = settlePending(state, [{ id: 'a' }], 2000, { resolutionSeconds: 120 });
  assert.equal(result.outcome, 'repeated');
  assert.equal(state.pending, null);
});

test('settlePending closes no_repeat after the window', () => {
  const state = { pending: { cardId: 'a', at: 1000, remaining: 2, statsFile: 'x' } };
  assert.equal(settlePending(state, [], 2000, { resolutionSeconds: 120 }), null);
  const result = settlePending(state, [], 3000, { resolutionSeconds: 120 });
  assert.equal(result.outcome, 'no_repeat');
  assert.equal(state.pending, null);
});

test('settlePending closes no_repeat after the time budget', () => {
  const state = { pending: { cardId: 'a', at: 0, remaining: 99, statsFile: 'x' } };
  const result = settlePending(state, [], 121000, { resolutionSeconds: 120 });
  assert.equal(result.outcome, 'no_repeat');
});
