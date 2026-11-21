# 经验流程（procedures）— 通用钩子片段

【经验流程 · procedures】
本工作区 procedures/ 存踩过的坑与解法，不常驻，按需读。

- 动手前，两步：
  ① 冷启动：任务里出现 URL / 仓库链接 /「装不装、值不值得装」时，先按任务里的名词搜一次，命中就直接打开第一张卡；第一次失败后必须回头查一次卡库，再动手修。
  ② 撞上现象（网页抓不到正文 / 改了不生效 / 报错原文）：先搜卡再修，一次打开一张。
     grep：grep -ril "<任务词>" procedures/*.md procedures/cards/*.md
     Windows：Select-String -Path procedures\*.md,procedures\cards\*.md -Pattern "<任务词>"
     装了本工具：node "{{KIT_DIR}}/bin/procedures.mjs" search "<任务词>" --dir procedures
     用任务里的名词 / 报错原文搜，别搜「触发」这种字面词；别用 glob / 列目录挑卡。
- 卡住时：同一动作连续失败两次就停。先查卡；没有卡就加载相关 skill；卡里写「去加载 xxx skill」时照做。别第三次盲试。
- 多步「怎么做」优先照 skill 走；卡只放一步修复，不塞整段 SOP。
- 踩坑当时：不是照卡走通、而是又试错了几轮 → 立刻往 procedures/_inbox.md 记一行（现象 + 一句话解法），别等收尾。
- 收尾：只看 _inbox.md，够格的照 _模板.md 整理成卡；不扫全库、不复制卡正文。
- 如果 harness 支持 post-tool hook：把 `{tool, error}` 传给
  `node "{{KIT_DIR}}/bin/hint.mjs" --stdin --dir procedures`，
  把 stdout 追加到下一轮上下文；stdout 为空表示没命中，不要为此报错。
