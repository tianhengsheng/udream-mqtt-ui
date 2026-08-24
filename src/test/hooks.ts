/**
 * 测试钩子 window.__t —— 供 AI/人工在控制台驱动 UI 做自测（dev-only）。
 * 用法见 test-playbook.md「工作法」。所有方法返回可 JSON 序列化的紧凑结果，避免截图确认。
 */
import { useSession } from '../store/useSession';
import { navigateByLabel } from '../nav';

/** 归一化 antd 按钮文案（中文间会被插空格） */
const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, '').trim();

/** 收集 antd message 历史（toast 一闪即逝，靠观察器留档） */
const toastLog: string[] = [];
const observeToasts = () => {
  const ob = new MutationObserver((muts) => {
    muts.forEach((m) =>
      m.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        const list = n.matches('.ant-message-notice') ? [n] : [...n.querySelectorAll('.ant-message-notice')];
        list.forEach((el) => {
          const t = (el as HTMLElement).innerText.trim();
          if (t) toastLog.push(t);
        });
      }),
    );
  });
  ob.observe(document.body, { childList: true, subtree: true });
};

/** 元素查找：data-testid 精确 → 文本精确 → 文本包含；返回可点击祖先 */
function locate(sel: string): HTMLElement | null {
  const byId = document.querySelector<HTMLElement>(`[data-testid="${sel}"]`);
  if (byId) return byId;
  const want = norm(sel);
  const leaves = [...document.querySelectorAll<HTMLElement>('body *')].filter(
    (e) => e.children.length === 0 && e.offsetParent !== null,
  );
  // 同文本可能多处（底栏+浮层 sheet），取最后一个——浮层/弹窗后挂载，通常才是目标
  const exact = leaves.filter((e) => norm(e.textContent) === want);
  const fuzzy = leaves.filter((e) => norm(e.textContent).includes(want));
  const hit = exact[exact.length - 1] || fuzzy[fuzzy.length - 1];
  if (!hit) return null;
  let el: HTMLElement | null = hit;
  for (let i = 0; i < 4 && el; i++) {
    const cs = getComputedStyle(el);
    if (cs.cursor === 'pointer' || el.tagName === 'BUTTON' || el.onclick) return el;
    el = el.parentElement;
  }
  return hit;
}

/** React 受控输入赋值（native setter + input 事件） */
function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const __t = {
  /** 跳页：按侧栏菜单文案（如 '设备模拟器'）；hidden 的页面（如 '框架自检'）走 navigateByLabel 兜底 */
  nav(label: string) {
    const item = [...document.querySelectorAll<HTMLElement>('.ant-menu-item')].find((e) =>
      norm(e.textContent).includes(norm(label)),
    );
    if (!item) {
      if (navigateByLabel(label)) return { ok: true, via: 'hidden-page' };
      return { ok: false, error: 'menu not found', menus: [...document.querySelectorAll('.ant-menu-item')].map((e) => norm(e.textContent)) };
    }
    item.click();
    return { ok: true };
  },

  /** 点击：data-testid 或可见文本（自动归一空格、自动向上找可点祖先） */
  click(sel: string) {
    const el = locate(sel);
    if (!el) return { ok: false, error: `not found: ${sel}` };
    el.click();
    return { ok: true, tag: el.tagName };
  },

  /** 输入：普通输入框一次性赋值；placeholder/testid 定位 */
  type(sel: string, value: string) {
    let input = document.querySelector<HTMLInputElement>(`[data-testid="${sel}"]`);
    if (input && input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA') {
      input = input.querySelector('input,textarea');
    }
    if (!input) {
      input = [...document.querySelectorAll<HTMLInputElement>('input,textarea')].find(
        (i) => i.placeholder && i.placeholder.includes(sel) && i.offsetParent !== null,
      ) || null;
    }
    if (!input) return { ok: false, error: `input not found: ${sel}` };
    setInputValue(input, value);
    return { ok: true };
  },

  /** 4位核销码等 OTP 逐格输入（找页面上可见的 maxLength=1 输入组） */
  async otp(code: string) {
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]')].filter(
      (i) => i.offsetParent !== null,
    );
    if (boxes.length < code.length) return { ok: false, error: `otp boxes ${boxes.length} < ${code.length}` };
    for (let i = 0; i < code.length; i++) {
      setInputValue(boxes[i], code[i]);
      await sleep(60);
    }
    return { ok: true };
  },

  /** antd Select 选择：按框内 placeholder/当前值定位，打开后按选项文本选 */
  async select(selBoxText: string, optionText: string) {
    const box = [...document.querySelectorAll<HTMLElement>('.ant-select')].find((s) => {
      const t = norm(s.querySelector('.ant-select-selection-placeholder')?.textContent)
        || norm(s.querySelector('.ant-select-selection-item')?.textContent);
      return t.includes(norm(selBoxText));
    });
    if (!box) return { ok: false, error: `select not found: ${selBoxText}` };
    // antd 5.2x 打开下拉的两个前提（本项目实测踩过，缺一就是「option not found」）：
    //  1. 内部 input 必须先 focus，否则 selector 上的 mousedown 只拿焦点不开下拉；
    //  2. 事件要发 pointerdown（只发 mousedown 不生效）。
    box.querySelector('input')?.focus();
    const selector = box.querySelector('.ant-select-selector')!;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) =>
      selector.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0, detail: 1 })),
    );
    await sleep(500);
    // 仅可搜索的 Select 才走搜索框过滤；不可搜索的 Select 里那个 readOnly input 一写就会把下拉搞没
    const search = box.classList.contains('ant-select-show-search')
      ? document.querySelector<HTMLInputElement>('.ant-select-open .ant-select-selection-search-input')
      : null;
    if (search) { setInputValue(search, optionText); await sleep(400); }
    const opt = [...document.querySelectorAll<HTMLElement>('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')]
      .find((o) => norm(o.textContent).includes(norm(optionText)));
    if (!opt) return { ok: false, error: `option not found: ${optionText}` };
    opt.click();
    return { ok: true };
  },

  /** 当前快照：环境/端/账号/页面/弹窗/表格行数 —— 文本断言的主入口 */
  state() {
    const s = useSession.getState();
    const modal = document.querySelector<HTMLElement>('.ant-modal:not([style*="display: none"]) .ant-modal-body');
    const menuActive = norm(document.querySelector('.ant-menu-item-selected')?.textContent);
    return {
      env: s.currentEnv,
      clientMode: s.clientMode,
      user: s.currentUser()?.name,
      page: menuActive,
      modalText: modal ? modal.innerText.slice(0, 600) : null,
      tableRows: document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length,
    };
  },

  /** 页面可见文本抓取（限定包含 keyword 的块，替代截图核对文案） */
  read(keyword: string, chars = 400) {
    const leaves = [...document.querySelectorAll<HTMLElement>('body *')].filter(
      (e) => e.offsetParent !== null && e.innerText && e.innerText.includes(keyword) && e.innerText.length < 2000,
    );
    const best = leaves.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    return best ? best.innerText.slice(0, chars) : null;
  },

  /** 含 keyword 的合适粒度块（minLen 过滤掉纯标题，解决"只抓到'核销码'三个字"） */
  block(keyword: string, minLen = 20, chars = 600) {
    const hits = [...document.querySelectorAll<HTMLElement>('body *')].filter(
      (e) => e.offsetParent !== null && e.innerText
        && e.innerText.includes(keyword) && e.innerText.length >= minLen && e.innerText.length < 3000,
    );
    const best = hits.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    return best ? best.innerText.slice(0, chars) : null;
  },

  /** 手机端整屏文本快照（PhoneFrame 内可见内容 + 浮层弹窗），核对 mini/App 页面数据 */
  screen(chars = 1500) {
    const body = document.querySelector<HTMLElement>('.phone-body');
    // 浮层（核销码弹窗等）可能挂在 frame 外，一并带上
    const overlays = [...document.querySelectorAll<HTMLElement>('.phone-frame ~ *, .ant-modal-root')]
      .filter((e) => e.offsetParent !== null).map((e) => e.innerText).join('\n');
    const frame = document.querySelector<HTMLElement>('.phone-frame');
    const txt = (frame?.innerText || body?.innerText || '') + (overlays ? `\n--- 浮层 ---\n${overlays}` : '');
    return txt.replace(/\n{3,}/g, '\n\n').slice(0, chars);
  },

  /** PC antd 表格结构化读取：[{列名:值}]（默认第一张可见表） */
  table(maxRows = 20) {
    const tbl = [...document.querySelectorAll<HTMLElement>('.ant-table')].find((t) => t.offsetParent !== null);
    if (!tbl) return { ok: false, error: 'no visible table' };
    const heads = [...tbl.querySelectorAll('.ant-table-thead th')].map((th) => norm(th.textContent));
    const rows = [...tbl.querySelectorAll('.ant-table-tbody tr.ant-table-row')].slice(0, maxRows).map((tr) => {
      const cells = [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.trim().replace(/\n+/g, '|'));
      const row: Record<string, string> = {};
      heads.forEach((h, i) => { if (h) row[h] = cells[i] ?? ''; });
      return row;
    });
    return { ok: true, total: tbl.querySelectorAll('.ant-table-tbody tr.ant-table-row').length, rows };
  },

  /** 表格行内点击：先按 rowKw（如订单号）定位行，再点行内按钮（解决同名按钮多行歧义） */
  rowClick(rowKw: string, btnText: string) {
    const tr = [...document.querySelectorAll<HTMLElement>('.ant-table-tbody tr')].find(
      (r) => r.offsetParent !== null && r.innerText.includes(rowKw),
    );
    if (!tr) return { ok: false, error: `row not found: ${rowKw}` };
    const btn = [...tr.querySelectorAll<HTMLElement>('a,button,span')].find((b) => norm(b.textContent) === norm(btnText));
    if (!btn) return { ok: false, error: `btn not found in row: ${btnText}` };
    btn.click();
    return { ok: true };
  },

  /** PC 详情等 label-value 结构化：优先 antd Descriptions，退化为两列表格 */
  desc() {
    const out: Record<string, string> = {};
    const scope = document.querySelector<HTMLElement>('.ant-modal:not([style*="display: none"])') || document.body;
    scope.querySelectorAll('.ant-descriptions-item').forEach((it) => {
      const k = norm(it.querySelector('.ant-descriptions-item-label')?.textContent);
      const v = (it.querySelector('.ant-descriptions-item-content') as HTMLElement)?.innerText.trim();
      if (k) out[k] = v ?? '';
    });
    if (!Object.keys(out).length) {
      // 自绘两列布局兜底：label 元素紧跟 value 元素的成对结构
      scope.querySelectorAll<HTMLElement>('tr').forEach((tr) => {
        const tds = [...tr.querySelectorAll('td,th')].map((c) => (c as HTMLElement).innerText.trim());
        for (let i = 0; i + 1 < tds.length; i += 2) { if (tds[i]) out[tds[i]] = tds[i + 1]; }
      });
    }
    return out;
  },

  /** toast 历史（最近 n 条） */
  toasts(n = 5) {
    return toastLog.slice(-n);
  },

  sleep,
};

declare global {
  interface Window { __t: typeof __t }
}

export function installTestHooks() {
  window.__t = __t;
  observeToasts();
}
