---
id: spell-<动作>
title: <一句话说清这个动作>
type: spell
rarity: common
language: powershell
triggers:
  - <任务里会出现的说法>
anchors:
  - <任务里会原样出现的字：命令名 / 报错原文 / 域名>
valid_until: null
environment: ""
created: 2026-11-06
last_hit: null
hits: 0
---

# 技能-<动作>

## 触发
<什么时候用这张技能卡>

## 可执行
```powershell
<可直接运行的命令，带注释说明参数>
```

## 验证
<怎么确认执行成功：输出 / 退出码 / 文件变化>

## 注意
- <风险、前置条件、不要用在什么场景>

证据：<会话 id / commit / 文件路径>

---

写卡纪律：技能卡和执行片段都不自动运行；命中后插件只提示“先读卡、确认安全后再执行”。
