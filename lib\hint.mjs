import { relative } from 'node:path';

/** One-line hint for a matched card. Pure Node so other harnesses can reuse it. */
export function buildHint(hit, cwd) {
  const target = hit.scope === 'global'
    ? `global:${hit.file}`
    : relative(cwd, hit.path).replaceAll('\\', '/');
  const matched = Array.isArray(hit.matched) ? hit.matched : [];
  const anchor = matched.find((match) => match.on === 'anchor')?.value
    ?? matched[0]?.value
    ?? '';
  const suffix = anchor ? `（锚点：${anchor}）` : '';
  if (hit.type === 'spell' && hit.actionableCode) {
    return `[procedures] 命中技能卡 ${target}${suffix}，语言：${hit.language || 'unknown'}。先读卡，确认安全后再执行其中的代码片段，不要盲目运行。`;
  }
  return `[procedures] 命中经验卡 ${target}${suffix}。先读这张卡，再重试或换路，别直接重复刚才的调用。`;
}
