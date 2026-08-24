/**
 * 页面内跳转（key 与 App.tsx 的 PAGES 同一套）。
 * 用于页面内入口直接跳到已有页面（如「外卖产品」页的全国排行榜入口 → 排行榜页），
 * 不新建页面、不复制组件；App 挂载时把菜单切换函数和「菜单文案→key」表注入进来。
 * 隐藏菜单的页面（如排行榜）没有侧栏入口，__t.nav 靠 navigateByLabel 兜底。
 */
let handler: ((key: string) => void) | null = null;
let labelToKey: Record<string, string> = {};

export const bindNavigate = (fn: (key: string) => void, labels: Record<string, string>) => {
  handler = fn;
  labelToKey = labels;
};

export const navigateTo = (key: string) => handler?.(key);

/** 按页面文案跳页，命中返回 true（供测试钩子在侧栏找不到菜单时兜底） */
export const navigateByLabel = (label: string) => {
  const key = labelToKey[label];
  if (!key) return false;
  handler?.(key);
  return true;
};
