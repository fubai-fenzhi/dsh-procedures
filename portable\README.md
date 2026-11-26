# procedures 通用本地版（给非 DSH 的 agent）

同一套**经验卡 + 索引 + inbox + 检索/审计 CLI**，不依赖 DSH。任何能跑 shell、能读指令文件的 agent 都能用。

## 和 DSH 插件的区别

| 能力 | DSH 插件 | 通用本地版 |
|---|---|---|
| 常驻约定 | 条件注入 system prompt | 写进 `AGENTS.md` / `CLAUDE.md` 等指令文件 |
| 失败时自动提示 | `tools/result` 自动匹配 + 注入 | 靠 agent 按约定自己搜；或 harness hook 调 `bin/hint.mjs` |
| 自动 inbox | 未命中自动写 | 手动 `inbox add`；或 `hint.mjs --inbox` |
| 命中/复发统计 | 有 | CLI 有 stats 读取，但需要 harness 调 `hint.mjs` 才能自动累积 |
| 卡片/检索/审计/抽卡 | 有 | **完全一样** |

一句话：**卡库和引擎是通用的；自动拦截是 DSH 专属的，其他 harness 要么靠约定，要么接 `hint.mjs`。**

## 要求

- Node.js ≥ 18
- 一个能执行命令的 shell
- 一个该 agent 会读的指令文件（`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / 等价物）

## 快速开始

把整个 `dsh-procedures/` 目录复制到目标机器（或者解压分享的 zip），然后：

```powershell
node portable/setup.mjs --workspace E:\YourProject --write
```

它会：

1. 创建 `E:\YourProject\procedures\`，放入 `INDEX.md`、`_模板.md`、`_模板-spell.md`、`_inbox.md`；
2. 把 `AGENTS-snippet.md` 追加到 `E:\YourProject\AGENTS.md`（已有同款钩子会跳过）；
3. 打印下一步命令。

`--agent-file CLAUDE.md` / `GEMINI.md` 可换目标文件；`--force` 覆盖已存在的模板；不加 `--write` 只打印片段，不改任何文件。

## 手动安装

1. 在目标工作区建 `procedures/`，复制 `portable/templates/` 里的四份模板。
2. 把 `portable/AGENTS-snippet.md` 粘进该 agent 的指令文件，把 `{{KIT_DIR}}` 换成 `dsh-procedures` 的绝对路径。
3. 写第一张卡（照 `_模板.md`），然后：

```powershell
node "<KIT_DIR>\bin\procedures.mjs" audit --dir procedures
```

## CLI

```powershell
# 检索
node "<KIT_DIR>\bin\procedures.mjs" search "app.asar ENOENT" --dir procedures

# 审计（结构/体积/过期/重复 id/spell 完整性）
node "<KIT_DIR>\bin\procedures.mjs" audit --dir procedures

# 列表 + 命中/复发/未复发
node "<KIT_DIR>\bin\procedures.mjs" list --dir procedures

# 手动记 inbox
node "<KIT_DIR>\bin\procedures.mjs" inbox add "只拿到 SPA 外壳" --tool web_fetch --dir procedures

# 从 inbox 生成 TODO 草稿
node "<KIT_DIR>\bin\procedures.mjs" synthesize --dir procedures

# 可选：调 DeepSeek / OpenAI 兼容接口写草稿（只写 _drafts/，不转正）
$env:DEEPSEEK_API_KEY = "sk-..."
node "<KIT_DIR>\bin\procedures.mjs" synthesize --llm --max 3 --dir procedures
```

## 接 harness hook（可选）

`bin/hint.mjs` 是给任何 harness 用的通用适配器：

```powershell
# 参数方式
node "<KIT_DIR>\bin\hint.mjs" --tool pwsh --error "Cannot find path ..." --dir procedures

# stdin JSON 方式（推荐给 hook）
'{"tool":"pwsh","error":"Cannot find path ..."}' | node "<KIT_DIR>\bin\hint.mjs" --stdin --dir procedures
```

- 命中时 stdout 输出一行 `[procedures] ...`；没命中时 stdout 为空、退出码 0。
- `--inbox`：没命中时把这一行写进 `procedures/_inbox.md`。
- `--json`：输出 `{hit, hint}`，方便 hook 程序解析。
- 接到 harness 的 post-tool hook：把 `{tool,error}` 传进去，把 stdout 追加到下一轮上下文；不要因为 stdout 为空报错。

典型接法：

```text
PostToolUse(tool, error):
  out = shell("node <KIT_DIR>/bin/hint.mjs --stdin --dir procedures", {tool, error})
  if out: append_to_context(out)
```

具体 hook 配置名（Claude Code / Codex / OpenClaw / Cursor）各不相同，按各自文档把上面这条命令接进去即可。

## 给其他 DSH profile

如果对方也是 DSH，只是换了 profile：直接用完整插件，比通用版好——把 `dsh-procedures/` 复制过去，用 `plugin_manager` 的 `install_bundle` 安装，或把 profile 的 `node_modules/dsh-procedures` 指向这个目录。完整插件才有自动提示、自动 inbox、stats 和复发统计。

## 分享

```powershell
Compress-Archive -Path dsh-procedures -DestinationPath dsh-procedures-portable.zip -Force
```

对方解压后跑 `node portable/setup.mjs --workspace <项目> --write`。只需要 Node，不需要 DSH。

## 限制

- 通用版没有自动注入；agent 不按指令搜卡，就不会触发。
- `hint.mjs` 只负责“匹配 + 输出一行”，不维护 session 级 pending；复发/未复发统计要 harness 自己按事件调用并记录。
- 指令文件是常驻的，成本和 DSH 的 1 KB section 相当；这是“让 agent 知道有卡库”的必要开销。
- 卡片匹配仍是字面锚点/关键词，不做语义检索。
- spell 卡不会自动执行。

## 授权

MIT，见上一级 `LICENSE`。
