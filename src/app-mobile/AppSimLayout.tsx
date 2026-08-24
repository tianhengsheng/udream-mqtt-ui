import type { ReactNode } from 'react';

/**
 * App 自测页统一布局：手机模拟器固定在左上角，门店/查询等控件放右侧栏。
 * 手艺人身份见顶部账号栏，页面内不再重复展示。
 */
export function AppSimLayout({ controls, children }: { controls?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 12 }}>
      <div style={{ flexShrink: 0 }}>{children}</div>
      {controls != null && (
        <div style={{ flex: 1, minWidth: 260, maxWidth: 560 }}>{controls}</div>
      )}
    </div>
  );
}
