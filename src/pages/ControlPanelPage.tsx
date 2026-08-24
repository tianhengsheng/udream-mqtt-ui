/**
 * 控制面板（iframe 嵌入页，设备端 / 不挂 token）。
 *
 * 面板本体是 dye-service 部署的静态页（后端仓库
 * `dye/dye-service/src/main/resources/mqtt/control-panel.html`，运行时 `/tools/control-panel.html`），
 * 要对外直接暴露给别人访问测试，所以**不做 React 化**、源码只在后端仓库维护。
 * 本页只做统一入口：固定地址下拉选择 + iframe 嵌入 + 新窗口打开。
 *
 * 注意：iframe 是浏览器直连面板地址，**不走 vite proxy**（所以 envs.ts 不需要 /dye 的 serviceOverride）。
 */
import { useState } from 'react';
import { Button, Select, Space } from 'antd';
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons';

/** 面板部署地址（固定几处，默认第一个）；新部署点在这里加一行 */
const PANEL_URLS = [
  { value: 'http://192.168.1.205:30015/tools/control-panel.html', label: 'dev（192.168.1.205:30015）' },
  { value: 'http://localhost:20016/tools/control-panel.html', label: '本地（localhost:20016）' },
];

const STORE_KEY = 'mqtt-panel-url';
const readUrl = () => {
  const saved = localStorage.getItem(STORE_KEY);
  return PANEL_URLS.some((o) => o.value === saved) ? (saved as string) : PANEL_URLS[0].value;
};

export function ControlPanelPage() {
  const [src, setSrc] = useState(readUrl);
  // 点「刷新」时自增，强制 iframe 重新拉取（同地址重载也生效）
  const [reloadSeq, setReloadSeq] = useState(0);

  const onChange = (u: string) => {
    localStorage.setItem(STORE_KEY, u);
    setSrc(u);
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, height: 'calc(100vh - 45px)' }}>
      <Space.Compact>
        <Select
          data-testid="panel.url"
          value={src}
          onChange={onChange}
          options={PANEL_URLS}
          style={{ width: 320 }}
        />
        <Button data-testid="panel.load" icon={<ReloadOutlined />} onClick={() => setReloadSeq((n) => n + 1)}>
          刷新
        </Button>
        <Button data-testid="panel.open" icon={<ExportOutlined />} onClick={() => window.open(src, '_blank', 'noopener')}>
          新窗口打开
        </Button>
      </Space.Compact>

      <iframe
        key={`${src}#${reloadSeq}`}
        data-testid="panel.frame"
        src={src}
        title="dye-service 控制面板"
        style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
      />
    </div>
  );
}
