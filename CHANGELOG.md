# Changelog

## 1.0.0

- Release candidate: publishable package metadata (`private` removed, `engines.dsh`, author/homepage, publishConfig).
- Row id namespaced to `dsh-procedures` to avoid collisions in a shared market.
- **Market-safe default**: `autoInbox` is now `false`; autosaving raw errors is opt-in.
- Portable kit for non-DSH agents (`portable/setup.mjs`, `bin/hint.mjs`).
- English README summary.

## 0.6.0

- Portable local kit: AGENTS snippet, setup script, generic `bin/hint.mjs` adapter.
- `buildHint` moved to `lib/hint.mjs` so non-DSH harnesses can reuse it.

## 0.5.0

- Post-hint effect metric: `repeated` / `no_repeat` within a 5-result / 120 s window.
- `audit` reports `repeat-after-hint`; `list` shows rep/clear.

## 0.4.0

- Global hit stats aggregated in `~/.dsh/procedures/global-stats.json`.
- `audit --global-dir` reviews global cards and reports `stale-global`.
- Global-only workspaces attach even without a local `procedures/`.

## 0.3.1

- Fix: global-only workspaces (no local `procedures/`) now attach.
- `globalPenalty` (default 1) for merged local/global ranking.

## 0.3.0

- Search cache (mtime/size signature + 750 ms TTL); 2000-card warm ~6 ms.
- `_stats.json` hit counts, rarity (`rare` ≤3 KB), global card library.
- LICENSE, .gitignore, package metadata.

## 0.2.0

- Spell cards (`type: spell`, `actionable_code` / fenced block); suggest-only, never auto-execute.
- LLM-assisted `synthesize --llm` (draft-only, `_drafts/`).
- `requires` / `excludes` matching, strict auto-hints, 800-char error cap.

## 0.1.0

- Initial DSH bundle: conditional hook, failure hints, auto inbox, card engine, CLI, audit.
