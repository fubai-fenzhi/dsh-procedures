# dsh-procedures

File-based experience cards for DeepSeek Harness (DSH) and other agents.

> Turn repeated agent mistakes into small per-workspace cards. When a matching tool error appears, inject only a one-line pointer — never the whole card. Resolved locally on a hit, with roughly 83–90% fewer tokens per hit (measured; see `bench/tokens.mjs`). A community card library is included: pull curated cards, contribute your own.

[中文 README](README.md) | [Portable kit](portable/README.md) | [Changelog](CHANGELOG.md) | [Pro (planned)](PRO.md)

## Positioning & Pro

- **Free core**: single-machine experience cards (hook, failure hints, CLI, skills) — MIT, free forever.
- **Pro (planned, not shipped)**: cross-machine sync, team-shared card library, usage/recidivism dashboard. The core is never paywalled; Pro is a separate service layer.

## What it does

- **Conditional hook**: a ~1 KB system-prompt section only when the workspace has `procedures/` or a configured `globalDir`; zero cost otherwise.
- **Strict failure hints**: match `anchors` / `triggers` (+ `requires` / `excludes`), inject one line with the card path, never the card body.
- **Auto inbox** (opt-in, default **off**): unmatched tool errors can be appended to `procedures/_inbox.md`; raw errors may contain paths or secrets.
- **Stats**: local hits in `procedures/_stats.json`, global hits in `~/.dsh/procedures/global-stats.json`; `repeated` / `no_repeat` within a short window.
- **Rarity / global library**: `rare` cards may reach 3 KB; global cards are read-only and workspace cards win on id conflicts.
- **CLI**: `search`, `audit`, `list`, `inbox`, `synthesize` (optional LLM drafts).
- **Portable kit**: `AGENTS.md` hook + CLI + `bin/hint.mjs` for non-DSH agents.

Not included: tool registration, vector search, full-card injection, auto-promotion, auto-execution of spell code.

## Benchmarks

`node bench/tokens.mjs --dir procedures` on the current 9-card library (rough estimate: CJK ≈ 1 token/char, other ≈ 4 chars/token):

| Scenario | Baseline | Plugin | Saved |
|---|---|---|---|
| per hit: one-line hint vs full card | 3841 tok | 470 tok | **87.8%** (per card 82.9%–89.8%) |
| per session: all cards resident vs hook + 0 cards | 3841 tok | 367 tok | 90.4% |
| per session: all cards resident vs hook + 2 cards | 3841 tok | 1221 tok | 68.2% |

Per-hit savings land around **83%–90%**.

## Install from the market

DSH has no official store; its plugin market works by adding an index. Add this index URL in the plugin market to discover and install `dsh-procedures`:

```text
https://ghproxy.net/https://raw.githubusercontent.com/fubai-fenzhi/dsh-procedures/main/index.json
```

(GitHub raw can be reset on some networks; this mirror works. Alternative: `https://fastly.jsdelivr.net/gh/fubai-fenzhi/dsh-procedures@main/index.json`.)

Or install from npm directly:

```bash
npm i dsh-procedures
```

Market entry: `dsh-procedures`, `engines.dsh >= 0.2.1-rc.3`, MIT.

## Cross-machine sync (free, self-hosted)

`sync` keeps your **global** card library in your own **private GitHub repo** and syncs between machines with `pull`/`push` — no third-party server.

```bash
# one-time setup (token only needs Contents read/write on that private repo)
node bin/procedures.mjs sync init --repo <owner>/<private-repo> --token <github-token> --create

# daily
node bin/procedures.mjs sync push
node bin/procedures.mjs sync pull
node bin/procedures.mjs sync
node bin/procedures.mjs sync status
```

- Syncs only the global library (`~/.dsh/procedures/global`) plus `global-stats.json`; workspace-local cards stay untouched.
- Stats merge per card (larger hits, later timestamps) instead of overwriting.
- Token comes from `DSH_PROCEDURES_SYNC_TOKEN` or `~/.dsh/procedures/sync.json`; prefer a fine-grained token limited to that private repo.
- Hosted sync / team sharing / dashboard are planned Pro features; see [PRO.md](PRO.md).

## Community library (on by default)

The plugin enables community cards by default:

- The hook mentions `community pull` (fill gaps) and `contribute --open` (tokenless).
- Pull curated cards into the global library (public repo, read-only, never overwrites existing cards):

```bash
node bin/procedures.mjs community pull
node bin/procedures.mjs community status
```

- Tokenless submission (easiest first step): prints pre-filled GitHub issue links; click **Create** in the browser:

```bash
node bin/procedures.mjs contribute --open
```

- Community feed: the hook rotates a real "community cards: N, latest …" line (hourly cache, falls back to cache offline); `community feed` prints it.
- Visual panel: a **Procedures** settings tab and a sidebar **Procedures** button open a rolling feed (latest additions rotate every 3s; the browser reads GitHub directly with a 1-hour cache).

- Submission policy (set once, then it can run automatically):

```bash
node bin/procedures.mjs community policy          # show (default: ask)
node bin/procedures.mjs community policy ask      # preview, then confirm manually
node bin/procedures.mjs community policy auto     # submit automatically (redaction + daily cap)
node bin/procedures.mjs community policy off      # disable submission
```

- Manual contribution: `contribute` previews by default; `--open` prints submission links (no token); `--yes` submits once; `--auto` validates/redacts and applies the cap:

```bash
node bin/procedures.mjs contribute
node bin/procedures.mjs contribute --open
node bin/procedures.mjs contribute --yes
node bin/procedures.mjs contribute --auto
node bin/procedures.mjs contribute --auto --cap 10
```

- `auto` guardrails: only cards you already have locally (never raw `_inbox.md` errors), frontmatter validation, redaction of tokens/emails/absolute paths/private IPs, a daily cap of 5 by default, and a log at `~/.dsh/procedures/contribute-log.json`.
- Policy file: `~/.dsh/procedures/community.json` (the plugin's `communitySubmit` config only changes the hook wording).
- Community repo: https://github.com/fubai-fenzhi/dsh-procedures-community
- Token: `DSH_PROCEDURES_CONTRIBUTE_TOKEN` (or `--token`) with issue write access; `--open` and read-only pulls need no token.
- Disable: override `community: false` in the profile `cordis.patch.yml`.

## Install (DSH)

The package is a DSH bundle (`dsh.bundle.patch` in `package.json`). Install `dsh-procedures` through Plugin Manager or a market index. It declares `engines.dsh >= 0.2.1-rc.3`.

The bundle inserts row id `dsh-procedures` with `autoInbox: false` and `hintOnError: true`.

To enable auto-inbox in one profile, add to the profile's `cordis.patch.yml`:

```yaml
- id: dsh-procedures
  config:
    autoInbox: true
```

Then disable/enable the plugin row (or restart DSH).

## Portable (non-DSH agents)

```powershell
node portable/setup.mjs --workspace E:\YourProject --write
```

This creates `procedures/` templates and appends the hook to `AGENTS.md` (use `--agent-file CLAUDE.md` for another instruction file). For a post-tool hook, send `{tool,error}` to:

```powershell
echo '{"tool":"pwsh","error":"..."}' | node bin/hint.mjs --stdin --dir procedures
```

stdout is the one-line hint, or empty when nothing matches (exit code 0). Add `--inbox` to capture unmatched errors.

## Config (common keys)

| Key | Default | Meaning |
|---|---|---|
| `dir` | `procedures` | Workspace data directory |
| `autoInbox` | `false` | Append unmatched errors to `_inbox.md` |
| `hintOnError` | `true` | Inject a one-line hint on a card hit |
| `maxHintsPerSession` | `5` | Hint budget per session |
| `globalDir` | `""` | Read-only global card library |
| `globalPenalty` | `1` | Score penalty for global cards |
| `stats` / `globalStats` | `true` | Hit counters |
| `resolutionWindow` / `resolutionSeconds` | `5` / `120` | Post-hint repeat window |
| `communitySubmit` | `ask` | `off` / `ask` / `auto` submission policy |
| `communityFeed` | `true` | Rotating community line in the hook (real counts, hourly cache) |

## CLI

```powershell
node bin/procedures.mjs search "app.asar ENOENT" --dir procedures
node bin/procedures.mjs audit --dir procedures
node bin/procedures.mjs list --dir procedures
node bin/procedures.mjs synthesize --dir procedures
```

Requires Node >= 18.

## Limits

- Hints are literal anchor/keyword matches; no semantic search.
- `no_repeat` means "the same card did not fire within the window", not proof that the problem is solved.
- Auto-inbox is off by default because raw error text may contain sensitive data.
- Spell cards are suggested, never executed automatically.
- No official DSH market exists; Discover reads index URLs the user adds.

## License

MIT.
