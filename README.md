# dsh-procedures

> 给 agent 开一个“抽卡”外挂：踩过的坑变成卡，失败时自动抽一张，卡库按需读；命中即由钩子本地提示，约省 50%~85% token。

文件化经验卡 + DSH 条件钩子。目标只有一个：让 agent 不再重复踩同一个坑，同时不把卡片常驻进上下文。

[English](README.en.md) | [Changelog](CHANGELOG.md)

当前版本：**1.2.1**（DSH 插件 + 通用本地版；市场候选版）。

## 30 秒上手

1. 工作区里建 `procedures/`（本工作区已有模板和 3 张种子卡）。
2. 安装插件（本机已装，entry `include:dsh-procedures`）。
3. 跑一次 `procedures audit`，确认 0 issue。
4. 故意触发一次含卡片锚点的失败，看是否出现 `[procedures] 命中经验卡 …`。
5. 踩到新坑就往 `_inbox.md` 记一行；够格的照模板升成正式卡。

## 它做什么

- **条件钩子**：工作区存在 `procedures/`，或配置了可用的 `globalDir` 时，才给该 agent 注入约 1.0 KB 的约定；两者都没有的工作区零成本。
- **严格匹配**：自动提示只认 `anchors` / `triggers`（字面匹配），并用 `requires`（全中才算）和 `excludes`（命中即跳过）压误报；不会因为标题里碰巧有 `Desktop` 就弹卡。
- **检索缓存**：目录 mtime/size 签名 + 750 ms TTL，2000 张卡 warm 约 6 ms/查询（见 `bench/search.mjs`）。
- **失败提示**：工具报错时，命中 trap 给一行指针；命中 spell 额外提示语言和“确认后再执行”，**不自动执行代码**。
- **自动收件箱（默认关）**：报错没有命中任何卡时，向 `procedures/_inbox.md` 追加一行（同 session 同错误只记一次）；global-only 模式不写。公开版默认关闭，因为原始报错可能含路径/密钥；需要时在 profile 覆盖 `autoInbox: true`。
- **命中统计**：本地卡命中写 `procedures/_stats.json`；全局卡命中写全局 sidecar（默认 `~/.dsh/procedures/global-stats.json`）。不碰卡片 YAML；`audit` 在 3 次命中后报 `promotion-candidate`。
- **命中后效果**：命中后开一个窗口（默认 5 个工具结果 / 120 秒）；同一张卡再触发记 `repeated`，窗口内没再触发记 `no_repeat`。`audit` 在复发 ≥2 次且不少于未复发时报 `repeat-after-hint`。这是“有没有再犯”的代理指标，不是“有没有读懂卡”的证明。
- **稀有度**：`rarity: rare` 允许 3 KB，`common` 仍 2 KB；不自动升级，audit 只给候选。
- **全局卡库**：配置 `globalDir` 后合并只读全局卡；同 id 工作区优先，命中提示显示 `global:<文件名>`。**只有全局库、没有本地 `procedures/` 的工作区也会挂载**（global-only 模式；只提示，不写本地 inbox/stats）。
- **全局治理**：`audit --global-dir` 会审全局卡 + 全局 stats，报 `[global]` 的 `stale-global`（超过 `--stale-days` 没活动）和 `promotion-candidate`；只出清单，不删卡。
- **只读 CLI**：`search` / `audit` / `list` / `synthesize`，不注册成模型工具，不占 tool schema。
- **通用本地版**：非 DSH agent 用 `portable/`：AGENTS.md 钩子 + CLI + `bin/hint.mjs` 适配器；卡片/检索/审计完全一样。
- **可选自动抽卡**：`synthesize --llm` 调 OpenAI 兼容接口写草稿；只写 `_drafts/`，不自动转正。

不做：向量检索、自动升卡、整卡注入、全库扫描、自动执行技能卡代码。

## 定位与 Pro

- **免费核心**：单机经验卡（本地卡、条件钩子、失败提示、CLI、Skill），永远 MIT 免费。
- **Pro（规划中，未发布）**：跨机器同步、团队共享卡库、用量/复发面板。核心不设收费墙，Pro 是独立服务层。详见 [PRO.md](PRO.md)。

## 从市场安装（DSH）

DSH 没有官方商店，市场是“添加索引源”的模式。把下面这个索引 URL 加进插件市场，就能搜到并安装 `dsh-procedures`：

```text
https://ghproxy.net/https://raw.githubusercontent.com/fubai-fenzhi/dsh-procedures/main/index.json
```

（GitHub raw 在国内部分网络会被重置；这是可用镜像，也可换 `https://fastly.jsdelivr.net/gh/fubai-fenzhi/dsh-procedures@main/index.json`。）

也可以直接用 npm：

```bash
npm i dsh-procedures
```

市场条目：`dsh-procedures`，`engines.dsh >= 0.2.1-rc.3`，MIT。

## 当前安装状态

- 已安装到 profile `desktop`：entry `include:dsh-procedures`，本地源码版（市场安装走 npm 最新）。
- 本工作区 `procedures/` 有 9 张卡；钩子已在当前会话生效。
- 默认 `autoInbox: false`；要恢复自动写入，在 profile 的 `cordis.patch.yml` 里覆盖 `autoInbox: true`（见“配置”）。
- 安装方式：`plugin_manager` 的 `install_bundle`。本地目录以 junction 链进 profile，改工作区文件即改安装内容（重启/重载后生效）；**`dsh-procedures/` 目录必须保留，删掉它等于删掉插件代码**。

## 给其他 agent 用

非 DSH 的 agent（Claude Code / Codex / Cursor / Gemini CLI / OpenClaw / 自研 agent）：

```powershell
node portable/setup.mjs --workspace E:\YourProject --write
```

- 创建 `procedures/` 模板，并把钩子追加到该项目的 `AGENTS.md`（`--agent-file CLAUDE.md` 可换）。
- 之后用 `bin/procedures.mjs` 检索/审计；harness 有 post-tool hook 时，把 `{tool,error}` 交给 `bin/hint.mjs --stdin`，把 stdout 追加到上下文。
- **通用版没有自动拦截/注入**；自动提示、自动 inbox、stats、复发统计仍是 DSH 插件专属。详见 [portable/README.md](portable/README.md)。
- 分享：压缩整个 `dsh-procedures/` 目录给对方，只需 Node ≥ 18，不需要 DSH。

## 跨机同步（免费自带 · 自托管）

`sync` 把**全局经验库**存进你自己的**私有 GitHub 仓库**，多台机器 `pull/push` 同步；不经过任何第三方服务器。

```bash
# 一次性配置（token 只需该私有仓库的 Contents 读写）
node bin/procedures.mjs sync init --repo <owner>/<private-repo> --token <github-token> --create

# 日常
node bin/procedures.mjs sync push     # 本机 → 远端
node bin/procedures.mjs sync pull     # 远端 → 本机
node bin/procedures.mjs sync          # pull 后 push
node bin/procedures.mjs sync status
```

- 只同步全局库（`~/.dsh/procedures/global`）的卡 + `global-stats.json`；工作区 `procedures/` 的私有卡不动。
- 统计按卡合并：hits 取大、时间取晚，不会互相覆盖。
- token 从 `DSH_PROCEDURES_SYNC_TOKEN` 或 `~/.dsh/procedures/sync.json` 读；建议 fine-grained token，只给这个私有仓库 Contents 读写。
- 托管版 / 团队共享 / 用量面板是 Pro 规划，见 [PRO.md](PRO.md)。

## 社区卡库（Community，默认开）

插件默认启用社区卡库支持：

- 钩子里会提示：缺卡可 `community pull`，有值得分享的卡可 `contribute`（先预览、确认后发）。
- 拉取精选卡到全局库（公开仓库、只读，不覆盖你已有的卡）：

```bash
node bin/procedures.mjs community pull
node bin/procedures.mjs community status
```

- 贡献自己的卡（默认只预览；确认后加 `--yes` 才会在社区仓库开 issue）：

```bash
node bin/procedures.mjs contribute          # 预览
node bin/procedures.mjs contribute --yes    # 提交（需要 GitHub token）
```

- 只提交**你本地已有的卡**，不会上传 `_inbox.md` 里的原始报错；维护者审核后合并进 `cards/`，所有人再 `community pull`。
- 社区仓库：https://github.com/fubai-fenzhi/dsh-procedures-community
- token：`DSH_PROCEDURES_CONTRIBUTE_TOKEN`（或 `--token`），需要 issue 写权限；只读拉取不需要 token。
- 关掉：在 profile 的 `cordis.patch.yml` 覆盖 `community: false`。

## 目录

```
工作区/
  procedures/
    INDEX.md            只放易混现象的消歧，不逐卡列
    _模板.md            trap 卡骨架
    _模板-spell.md      spell 卡骨架
    _inbox.md           踩坑/失败自动收件箱
    _stats.json         命中统计（运行时生成，不提交）
    _drafts/            synthesize 生成的草稿（不自动升卡）
    cards/
      <分类>-<现象>.md  正式卡，单卡 ≤ 2 KB（rare ≤ 3 KB）
```

## 卡片格式

YAML front matter 负责机器匹配与生命周期，正文保持人/agent 可读：

```yaml
---
id: tool-app-asar-files
title: DSH Desktop 的包与 skill 文件在 app.asar 内，shell / ripgrep 读不到
type: trap
rarity: common
triggers:
  - skill 文件读不到
anchors:
  - app.asar
  - dsh-agent-preset
  - ENOENT
requires: []
excludes:
  - out of range
valid_until: 2027-12-31
environment: DSH Desktop / Windows
created: 2026-11-06
last_hit: null
hits: 0
---
```

- `anchors`：任务/报错里会**原样出现**的英文或符号，3–8 个；匹配优先级最高。
- `triggers`：任务里会出现的说法，可写正则 `/.../`。
- `requires`：所有词都出现才命中；`excludes`：任一出现就跳过。用来压“锚点太宽”的误报。
- `valid_until`：到期后不再参与匹配，`audit` 会报出来；`null` 表示不过期。
- `type`：`trap`（陷阱/反面清单）或 `spell`（可复用的修复动作）。
- `rarity`：`common`（默认，≤2 KB）或 `rare`（≤3 KB）。不自动升级；`audit` 在命中 3 次后给候选。
- 正文保留六段：触发 / 首选 / 被挡时 / 别再来 / 注意 / 证据；spell 还要有「可执行」「验证」。
- 旧卡（无 front matter）仍按 `> **触发**：` 和 `> **锚点**：` 行兼容。

## 技能卡（spell）

`type: spell` 的卡可以带一段代码，但**插件不会执行它**——命中时只提示卡路径、语言和“确认安全后再执行”。

````markdown
---
id: spell-check-json
title: 用 node 校验 JSON 文件
type: spell
language: powershell
triggers: [json 坏了]
anchors: [ConvertFrom-Json, JSON]
valid_until: null
environment: Windows
created: 2026-11-06
last_hit: null
hits: 0
---
# 技能-校验 JSON

## 触发
需要确认一个 JSON 文件是否合法。

## 可执行
```powershell
Get-Content .\data.json -Raw | ConvertFrom-Json | Out-Null
```

## 验证
退出码 0 且没有异常。

## 首选
none

## 别再来
none

## 注意
- 只校验语法，不校验业务字段。

证据：会话 id / commit
````

写卡用 `procedures/_模板-spell.md`；`audit` 会检查 spell 必须有代码块和「验证」段。

## 匹配精度

- 自动提示走 `strict` 模式：只认锚点/触发器，不再用标题、文件名、正文兜底；CLI 的 `search` 仍保留兜底，方便人找卡。
- 报错文本截到 800 字再匹配，避免超长报错的尾部噪声。
- 锚点太宽时用 `excludes` 拦掉常见误报。例：桌面卡加了 `excludes: [out of range]`，`read` 的 offset 越界不会再误报“桌面不存在”。

## 规模、统计与全局库

- **基准**：`node dsh-procedures\bench\search.mjs`（加 `--quick` 只跑 500 张）。本机实测：500 张 cold 60 ms / warm 2.5 ms，2000 张 cold 209 ms / warm 6.0 ms。缓存后已经够快，没有再引入 `rg` 子进程。
- **缓存**：目录 mtime/size 签名 + 750 ms TTL。编辑卡片后最多 750 ms 生效；`loadCards(dir, { refresh: true })` 可强制刷新，`clearCardCache()` 可清空。
- **本地 `_stats.json`**：本地卡命中并注入提示时 +1；`audit` 读它，`hits >= 3` 报 `promotion-candidate`；`list` 显示 hits / rep / clear。统计只写 sidecar，不改卡片 YAML。
- **命中后效果**：命中后开一个窗口（默认 5 个工具结果 / 120 秒）。同一张卡再触发记 `repeated`，窗口内没再触发记 `no_repeat`；`audit` 在复发 ≥2 且不少于未复发时报 `repeat-after-hint`。这是“有没有再犯”的代理指标，不是“有没有读懂卡”的证明。
- **全局 `global-stats.json`**：global 卡命中写全局 sidecar（默认 `~/.dsh/procedures/global-stats.json`），跨工作区聚合；`--global-stats` 可覆盖路径。global-only 模式也能记。
- **`rarity`**：`rare` 允许 3 KB，`common` 仍 2 KB；`rare` 但 hits < 3 给 warn。升级由人改 YAML，不自动改卡。
- **`globalDir`**：合并只读全局卡；同 id 工作区优先；命中提示显示 `global:<文件名>`。只有全局库、没有本地 `procedures/` 的工作区也能挂载（global-only；只提示，不写本地 inbox/stats）。`globalPenalty`（默认 1）给全局卡降权，避免弱全局命中压过本地卡。默认关闭。
- **全局 audit**：`audit --global-dir DIR --global-stats FILE --stale-days 90` 同时审本地和全局；输出带 `[global]`，`stale-global` 表示超过 N 天没活动，`promotion-candidate` 表示命中够多。只出清单，不删卡。

## CLI

需要 Node。DSH 自带运行时的路径（本机）：

```powershell
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
```

```powershell
# 按报错/任务词检索
& $node dsh-procedures\bin\procedures.mjs search "app.asar ENOENT" --dir procedures

# 结构、体积、过期、重复 id、spell 完整性检查；有 error 时退出码 1
& $node dsh-procedures\bin\procedures.mjs audit --dir procedures

# 同时审全局卡 + 全局 stats（默认 ~/.dsh/procedures/global-stats.json）
& $node dsh-procedures\bin\procedures.mjs audit --dir procedures --global-dir D:\shared\procedures --stale-days 90

# 列出现有卡
& $node dsh-procedures\bin\procedures.mjs list --dir procedures

# 手动记一行 inbox
& $node dsh-procedures\bin\procedures.mjs inbox add "只拿到 SPA 外壳" --tool web_fetch --dir procedures

# 无模型：把 inbox 每行生成 TODO 草稿骨架
& $node dsh-procedures\bin\procedures.mjs synthesize --dir procedures

# 合并只读全局卡库检索（默认给全局卡 -1 分）
& $node dsh-procedures\bin\procedures.mjs search "app.asar" --global-dir D:\shared\procedures --global-penalty 1

# 检索基准（合成卡，不碰真实卡库）
& $node dsh-procedures\bench\search.mjs --quick
```

## 自动抽卡（可选）

```powershell
# 只打印 prompt，不联网、不需要 key
& $node dsh-procedures\bin\procedures.mjs synthesize --llm --dry-run --dir procedures

# 真正调用：DeepSeek 默认
$env:DEEPSEEK_API_KEY = "sk-..."
& $node dsh-procedures\bin\procedures.mjs synthesize --llm --max 3 --dir procedures

# 带会话上下文，生成更准
& $node dsh-procedures\bin\procedures.mjs synthesize --llm --context chat.md --dir procedures
```

- 默认 `https://api.deepseek.com` / `deepseek-chat`；可用 `--base-url` / `--model` 或环境变量 `DSH_PROCEDURES_BASE_URL` / `DSH_PROCEDURES_MODEL` 覆盖。
- key 读 `DEEPSEEK_API_KEY` 或 `DSH_PROCEDURES_API_KEY`；本地 Ollama 这类 `http://127.0.0.1:...` 端点允许不带 key。
- 合格草稿写 `_drafts/draft-*.md`；不合格写 `*.rejected.md` 并保留原因。
- **永远不写 `cards/`，永远不自动转正。** 入卡前仍要人审。

## 配置

默认值写在 `dsh-procedures/cordis.patch.yml`：

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `dir` | `procedures` | 相对工作区的数据目录 |
| `autoInbox` | `false` | 未命中卡时自动写 `_inbox.md`（公开版默认关，需显式开启） |
| `hintOnError` | `true` | 命中卡时注入一行指针 |
| `maxCards` | `3` | 每次失败最多参与匹配的卡数 |
| `maxHintsPerSession` | `5` | 每个 session 最多提示次数 |
| `minErrorChars` | `8` | 太短的报错不处理 |
| `sectionOrder` | `800` | 钩子 section 在系统提示中的排序 |
| `ignoreTools` | `[]` | 不处理的工具名 |
| `hookText` | `""` | 覆盖默认钩子文案 |
| `debug` | `false` | 输出 attach / hint / inbox 调试日志 |
| `stats` | `true` | 命中并提示时写 `_stats.json` |
| `globalDir` | `""` | 只读全局卡库目录；空=关闭，支持 `~` |
| `globalPenalty` | `1` | 全局卡匹配后的降权分数（0=不降权） |
| `globalStats` | `true` | global 卡命中时写全局 stats |
| `globalStatsFile` | `""` | 全局 stats 路径；空=`~/.dsh/procedures/global-stats.json` |
| `resolutionWindow` | `5` | 命中后观察多少个工具结果 |
| `resolutionSeconds` | `120` | 命中后观察多少秒 |
| `community` | `true` | 启用社区卡库支持（钩子提示 + `community pull`） |
| `communityRepo` | `fubai-fenzhi/dsh-procedures-community` | 社区卡库仓库 |
| `communitySubmit` | `ask` | 贡献方式：`off` 不提示 / `ask` 手动确认（默认）/ `auto` 预留 |

要覆盖配置，在 profile 的 `cordis.patch.yml` 里加一条同 id 行（注意：匹配的 override 会替换**整个** config，没写的键会回落到默认值，不会继承 bundle 里的值）：

```yaml
- id: dsh-procedures
  config:
    autoInbox: true
    hintOnError: true
```

改完在 Plugin Manager 里禁用再启用 `dsh-procedures`，或重启 DSH。

## 验证

```powershell
# 1) 检索
& $node dsh-procedures\bin\procedures.mjs search "app.asar ENOENT" --dir procedures

# 2) 结构检查（应无 error）
& $node dsh-procedures\bin\procedures.mjs audit --dir procedures

# 3) 命中提示：触发一个含 chat.deepseek.com 的失败，下一轮应看到
#    [procedures] 命中经验卡 ...（锚点：...）...
# 4) spell 提示：触发一个含技能卡锚点的失败，下一轮应看到
#    [procedures] 命中技能卡 ...，语言：...。先读卡，确认安全后再执行...
# 5) 未命中：触发一个不含任何锚点的失败，procedures/_inbox.md 应多一行
```

单测（DSH 沙箱下 `node --test` 会因 spawn 受限失败，直接跑文件即可）：

```powershell
& $node dsh-procedures\test\cards.test.mjs
& $node dsh-procedures\test\plugin.test.mjs
& $node dsh-procedures\test\llm.test.mjs
& $node dsh-procedures\test\stats.test.mjs
& $node dsh-procedures\test\cache.test.mjs
& $node dsh-procedures\test\global.test.mjs
& $node dsh-procedures\test\rarity.test.mjs
& $node dsh-procedures\test\attach.test.mjs
& $node dsh-procedures\test\global-audit.test.mjs
```

## 发布

当前是 **1.2.1** 本地版本；1.2.0 已发布到 npm，1.2.1 待发布。

- 包名 `dsh-procedures` 在 npm 未被占用；`private` 已移除，`engines.dsh >= 0.2.1-rc.3`、`author`、`homepage`、`publishConfig` 已补。
- `npm pack` 实测 25 个文件、约 36 KB；`portable/`、`bin/hint.mjs`、locale/icon、CHANGELOG 都在包里。
- 市场没有“官方商店”：DSH 的 Discover 只读用户添加的 index URL；发布 = 上 npm（或 Git）+ 进第三方索引。

发布步骤（需要你的 npm 账号）：

```powershell
cd dsh-procedures
npm login
npm publish --access public
```

然后：

1. 把 `dsh-procedures/` 同步到 GitHub 仓库根目录（当前仓库还是旧的方法论 + tools；本机没 git，需要你 push 或用 API）。
2. 提交到第三方索引（dpharness / dshmarket 等），或在自有 index JSON 里加一条 `dsh-procedures`。
3. 用 `npm pack` 解压后的目录做一次干净 `install_bundle` 冒烟测试（发布前已在本机执行）。

## 关闭与回滚

- 只关某个工作区：删掉该工作区的 `procedures/`。如果 profile 配了 `globalDir`，该工作区会切到 global-only（仍提示，但不写 inbox/stats）；要彻底不挂载，把 `globalDir` 也清空。
- 关自动写入：`autoInbox: false`。
- 关失败提示：`hintOnError: false`。
- 临时禁用：Plugin Manager 或 `plugin_manager` → `set_plugin`，target `include:dsh-procedures`，enabled `false`。
- 卸载：`plugin_manager` → `remove_bundle`，target `dsh-procedures`。

## 已知限制

- 钩子只在 agent 创建时检测本地 `procedures/` 或 `globalDir`；目录是后来新建的，要新会话或重载插件才生效。agent 中途切换工作目录也不会重新挂载。
- global-only 模式只提示，不写本地 `_inbox.md`、不记本地 `_stats.json`；全局命中会写全局 stats。
- 全局 stats 默认在 `~/.dsh/procedures/global-stats.json`（工作区外），需要该目录可写；它是派生数据，删了只丢命中数。
- `stale-global` 是启发式：按 `last_hit`（没有则 `created`）超过 `--stale-days` 判定，只提示，不自动删卡/降级。
- `no_repeat` 只表示“窗口内同一张卡没再触发”，不证明 agent 读懂了卡或问题真解决了。
- 每个 agent 只跟踪一个 pending：新命中会把上一个 pending 记 `no_repeat`；session 结束仍未结算的不计数。
- `repeat-after-hint` 是启发式（复发 ≥2 且不少于未复发），只提示，不自动改卡/删卡。
- `globalPenalty` 只影响排序，不是硬隔离；全局卡仍可能在高分时压过本地弱命中。
- 钩子是约定不是强制；模型仍可能不读卡。
- 自动 inbox 记的是原始报错，不是解法；整理成卡仍要人/agent 做。
- 注入提示是 user 角色消息，会出现在会话记录里。
- 匹配是字面锚点/关键词，不做语义检索；锚点写不好就匹配不上。
- spell 卡不自动执行；需要人/agent 读卡后自行决定。
- 自动抽卡需要 key（本地端点除外），且输出要经过结构校验；不保证一次就合格。
- `_stats.json` 是派生缓存，不是卡片真值；删了只丢命中数，不影响匹配。
- `globalDir` 默认关闭；全局卡只读，不会写全局 `_inbox.md`。
- 未引入 `rg`：基准显示缓存后 2000 张 warm 约 6 ms；卡库到上万张再回来加。
- 缓存 TTL 750 ms：刚改完卡立刻触发失败，可能仍用旧卡；重载或 `refresh` 可强制刷新。
- 本插件与仓库 `docs/QUALITY-BUDGET.md` 的“不自动捕获、不自动写回、不加全局钩子”三条约束冲突。本次按用户选择默认全开，可用上表逐项关闭。

## 设计取舍

- 不把读卡包成 tool：tool schema 常驻 system prompt，等于把“按需目录”变成“每轮目录”，是反模式。
- 不注入整卡：只给路径和锚点，保持“索引常驻、卡按需读”的成本结构。
- 不自动升卡：`synthesize` 只写 `_drafts/`，正式卡由人审后移动；删卡同样由人决定。
- 统计写 sidecar：`_stats.json` / `global-stats.json` 只记命中，不改卡片 YAML；升级/退役仍由人决定。
- rarity 只给候选：不自动把卡改成 `rare`，避免命中数一够就放宽体积。
- 全局卡只读：`globalDir` 只参与检索和提示，不写全局 inbox、不自动改全局卡。
- 不自动执行 spell：从 Markdown 卡里自动跑代码是安全漏洞；先提示，让人/agent 确认。
- 提示去重：同一 session 同一张卡只提示一次；同一错误只记一次 inbox。
