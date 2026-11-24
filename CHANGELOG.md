# Changelog

## 1.3.3

- `contribute --open`: prints pre-filled GitHub issue links, so contributing no longer needs a token (submit in the browser).
- Hook text points at `contribute --open`; npm and market descriptions mention the community library.
- Docs (both READMEs): tokenless submission path and community entry points.

## 1.3.2

- Description: replace the conservative 50–85% token claim with the measured 83–90% per hit (`bench/tokens.mjs`).
- README (both): update the claim and the benchmark conclusion; no runtime changes.

## 1.3.1

- Add `bench/tokens.mjs`: measures the one-line hint vs the whole card (per hit ~83–90% fewer tokens) and the resident whole-library baseline (68–90% depending on cards loaded).
- README: add measured benchmark numbers and refresh the current version line.
- Workspace card `tool-app-asar-files` promoted to `rarity: rare` after 4 hits.

## 1.3.0

- Community submission policy: `procedures community policy off|ask|auto`, persisted in `~/.dsh/procedures/community.json`.
- `procedures contribute --auto`: validates cards, redacts tokens/emails/absolute paths/private IPs, enforces a daily cap (default 5), and logs submissions to `contribute-log.json`.
- Hook text reflects the auto policy.
- Tests for scrubbing, validation, caps and policy.

## 1.2.1

- Metadata: author/copyright updated to `fubai-fenzhi` (`package.json`, market `index.json`, `LICENSE`).
- Docs: refresh the README install/market notes and repository links; sync repository source with the published package.
- No runtime changes.

## 1.2.0

- Community card library, enabled by default: the hook mentions `community pull` / `contribute`; `community pull` downloads curated cards from the public community repo; `contribute` previews local cards and opens issues only with `--yes`.
- Config: `community` (default true), `communityRepo`, `communitySubmit` (default `ask`). No automatic upload; raw `_inbox.md` errors are never sent.
- Docs: community sections in both READMEs.

## 1.1.0

- `procedures sync init|pull|push|status`: self-hosted cross-machine sync of the global card library and stats through a private GitHub repo (no server).
- Stats merge keeps larger counts and later timestamps.
- Hook text: stop after two consecutive failures; load the related Skill instead of a third blind retry.
- Docs: README sync section and roadmap update.

## 1.0.2

- Docs: use the ghproxy mirror as the market index URL in both READMEs (GitHub raw can be reset on some networks).
- No runtime changes.

## 1.0.1

- Docs: add a self-hosted plugin market index (`index.json`) and an install-from-market section to both READMEs.
- No runtime changes.

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
