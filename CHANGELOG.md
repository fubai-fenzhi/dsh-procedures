# Changelog

## 1.6.5

- Panel: the community ticker no longer appends the card date after the title.

## 1.6.4

- Security: the `/dsh-procedures/contribute/open` route now enforces the Connection Host/Origin and browser-authentication checks (`ctx.connection.requestRejection`) and fails closed with 401/403, so local card content is not served to unauthenticated requests.

## 1.6.3

- One-click submit now opens the first card's GitHub issue page automatically (log in, click Create); remaining cards stay as links below, so the flow is a single click.

## 1.6.2

- Docs: add a token-cost section (resident hook ~440 tokens/turn, card bodies load on demand) and link the official DeepSeek pricing page; the npm description now mentions the resident cost. No runtime changes.

## 1.6.1

- One-click submission now skips cards that already have an open `[card]` issue and tells you how many are waiting for review — repeated clicks no longer create duplicate issues.

## 1.6.0

- One-click submission: the panel's **一键提交我的卡牌** button calls a host route (`/dsh-procedures/contribute/open`, separate `dsh-procedures-ui` row) that turns the current workspace's local cards into pre-filled GitHub issue links; no token needed.
- The UI route requires `webServer`; the core hook row is independent, so Electron/file:// profiles keep working.
- The panel also shows the plugin version and npm update check.

## 1.5.3

- Client: clicking **Procedures** (or **刷新**) also checks the npm registry for a newer `dsh-procedures` and shows "有新版 x.y.z → 去 设置 → 插件 → 插件市场 更新"; the check is cached for an hour.
- Version shown in the panel; no host route or `webServer` dependency.

## 1.5.2

- Client: the panel auto-refreshes once per day (24h) instead of every 5 minutes; clicking **Procedures** or **刷新** still forces an immediate refresh.
- Clarify: clicking Procedures refreshes community data only; plugin upgrades stay in Plugin Manager.

## 1.5.1

- Client: clicking the sidebar **Procedures** button (or the panel's 刷新 button) forces a fresh feed fetch, bypassing the hourly cache; the panel also auto-refreshes every 5 minutes.

## 1.5.0

- Client UI: a "Procedures" settings tab and a sidebar button that open a rolling community ticker (latest additions rotate every 3s, hourly cache in localStorage).
- The client reads the public community repo directly (no token, no host route); disabled gracefully when the browser has no network.
- Tests: unchanged host suite still passes.

## 1.4.0

- Community feed: the hook shows a rotating, real "community cards: N, latest …" line (hourly cache); add `procedures community feed` CLI and the `communityFeed` config (default true).
- Community library seeded 9 → 16 cards; three demo submissions were merged through the issue flow and closed.
- Tests for the feed cache and rotation.

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
