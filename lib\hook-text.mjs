/** Resident convention injected into sessions that opt in with a procedures/ directory. */
export const HOOK_TEXT = `【经验流程 · procedures】
本工作区 procedures/ 存踩过的坑与解法，不常驻，按需读。

- 动手前，两步：
  ① 冷启动：任务里出现 URL / 仓库链接 /「装不装、值不值得装」时，先按任务里的名词搜一次，命中就直接打开第一张卡；第一次失败后必须回头查一次卡库，再动手修。
  ② 撞上现象（网页抓不到正文 / 改了不生效 / 报错原文）：先搜卡再修，一次打开一张。
     PowerShell：Select-String -Path procedures\\*.md,procedures\\cards\\*.md -Pattern "<任务词>"
     grep：grep -ril "<任务词>" procedures/*.md procedures/cards/*.md
     用任务里的名词 / 报错原文搜，别搜「触发」这种字面词；别用 glob / 列目录挑卡。
- 卡住时：同一动作连续失败两次就停。先查卡；没有卡就加载相关 Skill（skill <名>）；卡里写「去加载 xxx skill」时照做。别第三次盲试。
- 多步「怎么做」优先照 Skill 走；卡只放一步修复，不塞整段 SOP。
- 踩坑当时：不是照卡走通、而是又试错了几轮 → 立刻往 procedures/_inbox.md 记一行（现象 + 一句话解法），别等收尾。
- 收尾：只看 _inbox.md，够格的照 _模板.md 整理成卡；不扫全库、不复制卡正文。`;

/** Global-only variant: the workspace has no procedures/ but globalDir is configured. */
export function globalHookText(globalDir) {
  const root = String(globalDir ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
  return `【经验流程 · procedures（全局库）】
本工作区没有 procedures/；已配置只读全局卡库：${root}

- 撞上现象（网页抓不到正文 / 改了不生效 / 报错原文）：先搜全局卡库，再修。
  PowerShell：Select-String -Path "${root}/*.md","${root}/cards/*.md" -Pattern "<任务词>"
  grep：grep -ril "<任务词>" "${root}"/*.md "${root}"/cards/*.md
- 命中提示会写 global:<文件名>；按提示打开那张卡，不要重复刚才的调用。
- 卡住时：同一动作连续失败两次就停，先查全局卡库；没有卡就加载相关 Skill（skill <名>）；别第三次盲试。
- 踩坑当时：本工作区没有 procedures/，在回复末尾写一行「待记 inbox」；要持久化就在本工作区建 procedures/，插件会自动接管。
- 收尾：全局卡只读，不要在全局库写卡；本工作区有 _inbox.md 时只看它。`;
}
