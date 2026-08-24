import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** 机身设计尺寸（含 8px 边框），缩放比按它与可视高度换算 */
const FRAME_W = 406;
const FRAME_H = 816;

/** 极简手机外框：状态栏 + 标题栏（可带右上角动作）+ 可滚动内容区。让 App 页看起来像手机。
 *  外层按可视区高度整体等比缩小（只缩不放大），保证整个机身（含底部按钮）一屏显示完。 */
export function PhoneFrame({
  title,
  onBack,
  rightAction,
  children,
  overlay,
}: {
  title: string;
  onBack?: () => void;
  rightAction?: ReactNode;
  children: ReactNode;
  /** 框内浮层（弹窗等），绝对定位覆盖整框、不随 body 滚动裁剪 */
  overlay?: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      // 可用高度 = 视口高度 - 机身顶部到视口顶的距离（顶栏等） - 底部留白
      const top = el.getBoundingClientRect().top + window.scrollY;
      const avail = window.innerHeight - top - 12;
      setScale(Math.min(1, avail / FRAME_H));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div ref={wrapRef} style={{ height: FRAME_H * scale, display: 'flex', justifyContent: 'center', marginTop: 8 }}>
      {/* margin 置 0：居中/留白改由外层 wrapper 负责，缩放后原 16px margin 会造成偏移 */}
      <div className="phone-frame" style={{ margin: 0, transform: `scale(${scale})`, transformOrigin: 'top center' }}>
        <div className="phone-statusbar">
          <span>9:41</span>
          <div className="notch" />
          <span>📶 🔋</span>
        </div>
        <div className="phone-appbar">
          {onBack && (
            <span className="back" onClick={onBack}>
              ‹
            </span>
          )}
          {title}
          {rightAction && <span className="appbar-right">{rightAction}</span>}
        </div>
        <div className="phone-body">{children}</div>
        {overlay}
      </div>
    </div>
  );
}
