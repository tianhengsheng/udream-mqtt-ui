import { useState, type ComponentType } from 'react';
import { ConfigProvider, Layout, Menu, Tag, theme } from 'antd';
import { DesktopOutlined, MobileOutlined, RobotOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { TopBar } from './components/TopBar';
import { useSession, type ClientMode } from './store/useSession';
import { SimulatorPage } from './simulator/SimulatorPage';
import { SmokePage } from './pages/SmokePage';
import { ControlPanelPage } from './pages/ControlPanelPage';
import { PcDeviceListPage } from './pages/PcDeviceListPage';
import { PcDyeRecordPage } from './pages/PcDyeRecordPage';
import { PcDyeChangePage } from './pages/PcDyeChangePage';
import { PcDyeBedRecordPage } from './pages/PcDyeBedRecordPage';
import PcFirmwareUpgradePage from './pages/PcFirmwareUpgradePage';
import { AppDyeDevicePage } from './pages/AppDyeDevicePage';
import { AppWashbedPage } from './pages/AppWashbedPage';
import { AppDyeColorPage } from './pages/AppDyeColorPage';
import { bindNavigate } from './nav';

/**
 * 页面归属端。'device' = 设备端/无端页（模拟器、控制面板 iframe），
 * 不属于 App/PC/小程序任何业务端，切进去不挂 token、也不切 clientMode。
 */
type PageClient = ClientMode | 'device';

/** 侧栏菜单的端标签（device 用灰色「设备」，与业务端区分开） */
const CLIENT_TAG: Record<PageClient, { color: string; text: string }> = {
  pc: { color: 'geekblue', text: 'PC' },
  app: { color: 'green', text: 'App' },
  mini: { color: 'orange', text: '小程序' },
  device: { color: 'default', text: '设备' },
};

/**
 * 单数组驱动：菜单、客户端属性(决定发哪个端 token)、页面渲染全部从这里派生。
 * 新增一个页面只加一行；client 直接挂在条目上，不会出现"漏配发错端 token"的风险。
 */
const PAGES = [
  { key: 'simulator', client: 'device', label: '设备模拟器', Comp: SimulatorPage },
  { key: 'controlpanel', client: 'device', label: '控制面板', Comp: ControlPanelPage },
  { key: 'pcDeviceList', client: 'pc', label: '设备列表', Comp: PcDeviceListPage },
  { key: 'pcDyeRecord', client: 'pc', label: '调色记录', Comp: PcDyeRecordPage },
  { key: 'pcDyeChange', client: 'pc', label: '换料记录', Comp: PcDyeChangePage },
  { key: 'pcDyeBedRecord', client: 'pc', label: '洗头记录', Comp: PcDyeBedRecordPage },
  { key: 'pcFirmwareUpgrade', client: 'pc', label: '固件升级管理', Comp: PcFirmwareUpgradePage },
  { key: 'appDyeDevice', client: 'app', label: '智染设备', Comp: AppDyeDevicePage },
  { key: 'appWashbed', client: 'app', label: '洗头床控制', Comp: AppWashbedPage },
  // 下料页不出菜单：从「智染设备」页点「去下料」进入（label 跳转对 hidden 页有效，见 nav.ts）
  { key: 'appDyeColor', client: 'app', label: '下料(App)', Comp: AppDyeColorPage, hidden: true },
  // 框架自检页：脚手架连通性验证用，平时收起（__t.nav('框架自检') 可进）
  { key: 'smoke', client: 'pc', label: '框架自检', Comp: SmokePage, hidden: true },
] as const satisfies ReadonlyArray<{ key: string; client: PageClient; label: string; Comp: ComponentType; hidden?: boolean }>;

type PageKey = (typeof PAGES)[number]['key'];
/** hidden 的页面不出侧栏菜单，只能由页面内入口/测试钩子跳进去 */
const MENU_PAGES = PAGES.filter((p) => !('hidden' in p && p.hidden));
const LABEL_TO_KEY = Object.fromEntries(PAGES.map((p) => [p.label, p.key]));

const PAGE_STORE_KEY = 'udream-mqtt-page';
const getPage = (key: string) => PAGES.find((p) => p.key === key) ?? PAGES[0];

/** 切端：device 页不属于任何业务端（不发 token），保持上一个业务端不变即可。 */
const syncClientMode = (client: PageClient) => {
  if (client === 'device') return;
  useSession.getState().setClientMode(client);
};

export default function App() {
  const [page, setPage] = useState<PageKey>(() => {
    const p = getPage(localStorage.getItem(PAGE_STORE_KEY) || '').key;
    // 同步初始化当前端，确保首屏子页 fetch 前 clientMode 已就位（否则会发上一个端的 token）
    syncClientMode(getPage(p).client);
    return p;
  });

  const onMenuClick = (key: PageKey) => {
    // 必须先于 setPage 同步切端：React 子组件 effect 早于父组件，
    // 放 useEffect 里设会导致新页首个请求带上一个端的 token。
    syncClientMode(getPage(key).client);
    setPage(key);
    localStorage.setItem(PAGE_STORE_KEY, key);
  };

  // 页面内入口跨页跳转复用同一套切页逻辑（隐藏页靠 label 兜底，见 nav.ts）
  bindNavigate(onMenuClick as (key: string) => void, LABEL_TO_KEY);

  const ActivePage = getPage(page).Comp;

  return (
    <ConfigProvider
      locale={zhCN}
      componentSize="small"
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          fontSize: 12,
          controlHeight: 28,
          borderRadius: 4,
          paddingContentVerticalLG: 8,
        },
        components: {
          Table: {
            cellPaddingBlock: 4,
            cellPaddingInline: 8,
            headerBg: '#fafafa',
            headerSplitColor: '#e8e8e8',
            fontSize: 12,
          },
          Card: {
            paddingLG: 12,
            headerFontSize: 13,
            headerHeight: 36,
            headerHeightSM: 32,
          },
          Form: {
            itemMarginBottom: 12,
            verticalLabelPadding: '0 0 2px',
            labelFontSize: 12,
          },
          Tag: {
            fontSize: 11,
          },
          Button: {
            fontSize: 12,
          },
          Descriptions: {
            itemPaddingBottom: 4,
            titleMarginBottom: 4,
          },
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Layout.Sider theme="light" width={186} style={{ borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[page]}
            onClick={(e) => onMenuClick(e.key as PageKey)}
            items={MENU_PAGES.map((p) => ({
              key: p.key,
              icon:
                p.client === 'device' ? <RobotOutlined /> : p.client === 'pc' ? <DesktopOutlined /> : <MobileOutlined />,
              label: (
                <span>
                  <Tag
                    color={CLIENT_TAG[p.client].color}
                    style={{ marginInlineEnd: 6, paddingInline: 4, lineHeight: '16px' }}
                  >
                    {CLIENT_TAG[p.client].text}
                  </Tag>
                  {p.label}
                </span>
              ),
            }))}
            style={{ borderInlineEnd: 'none' }}
          />
        </Layout.Sider>
        <Layout style={{ background: '#f5f5f5' }}>
          <TopBar />
          <ActivePage />
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
