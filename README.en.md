# dsh-procedures

File-based experience cards for DeepSeek Harness (DSH) and other agents.

> Turn repeated agent mistakes into small per-workspace cards. When a matching tool error appears, inject only a one-line pointer — never the whole card.

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

## Install (DSH)

The package is a DSH bundle (`dsh.bundle.patch` in `package.json`). Install `dsh-procedures@1.0.0` through Plugin Manager or a market index. It declares `engines.dsh >= 0.2.1-rc.3`.

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
