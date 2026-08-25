import { useState } from 'react';
import { Badge, Button, ConfigProvider, Space, Tooltip, Typography, theme } from 'antd';
import { PlusOutlined, DisconnectOutlined } from '@ant-design/icons';
import { useWebSocket } from './hooks/useWebSocket';
import { useDeviceStore } from './store/useDeviceStore';
import { DeviceCard } from './components/DeviceCard';
import { AddDeviceModal } from './components/AddDeviceModal';
import { LogPanel } from './components/LogPanel';
import { ACCENT, BG_CARD, BG_PAGE, BORDER, BORDER_WEAK, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY } from './theme';

const { Text } = Typography;

/**
 * 设备模拟器页：设备卡片网格 + 底部 MQTT 日志面板 + 右上「添加设备」。
 * 布局照搬 device-web-react 的 App.tsx，只是去掉了它自带的 Layout/Header 外壳——
 * 外壳由本项目脚手架（侧栏菜单 + TopBar）提供，这里只出内容区。
 *
 * 数据链路：本页所有请求走 vite proxy /simapi → sim-server(3001)，
 * 实时状态/日志走 /simws → ws://localhost:3001/ws（useWebSocket 自动重连）。
 * 真正的 MQTT mTLS 连接在 sim-server 里建（浏览器建不了 TCP TLS）。
 *
 * 注意：本页组件尺寸不跟随外层 ConfigProvider 的 small（模拟器 UI 按默认尺寸设计），
 * 故在此嵌一层 ConfigProvider 还原 middle + 原配色。
 * 同时本页整体走深色（darkAlgorithm 也加在这层），外层脚手架仍是浅色，
 * 所以最外层容器必须自己铺满深色底，否则内容不足时下方会露出脚手架的浅灰。
 */
export function SimulatorPage() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  useWebSocket();

  const { devices, wsConnected } = useDeviceStore();

  return (
    <ConfigProvider
      componentSize="middle"
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: ACCENT,
          borderRadius: 8,
          fontSize: 14,
          // darkAlgorithm 默认从纯黑派生，整体偏硬；把基色换成本页页面底，
          // 让 antd 自己派生出来的容器/浮层色跟自绘区域（卡片、日志面板）同一套色系。
          // 弹窗（添加设备/指令参数）内的绝大多数控件靠这几个 token 自动适配。
          colorBgBase: BG_PAGE,
          colorBgElevated: BG_CARD,
          colorBorder: BORDER,
          colorBorderSecondary: BORDER_WEAK,
          colorText: TEXT_PRIMARY,
          colorTextSecondary: TEXT_SECONDARY,
          colorTextTertiary: TEXT_MUTED,
        },
      }}
    >
      {/* 整页 flex 纵向：页头固定 → 设备区自己滚 → 日志面板钉在内容区底部（不再 fixed 横跨侧栏） */}
      <div
        style={{
          padding: 16,
          height: 'calc(100vh - 45px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          // 深色底铺满整个内容区（含内容不足时的下方留白），盖住脚手架的浅灰
          background: BG_PAGE,
          color: TEXT_PRIMARY,
        }}
      >
        {/* 页头：模拟器服务连接状态 + 添加设备 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            flexShrink: 0,
          }}
        >
          <Space align="center">
            <Text strong style={{ fontSize: 16, color: TEXT_PRIMARY }}>IoT 设备模拟器</Text>
            <Text style={{ fontSize: 12, color: TEXT_SECONDARY }}>MQTT mTLS 联调工具（sim-server:3001）</Text>
          </Space>
          <Space>
            <Tooltip title={wsConnected ? '已连接到本地模拟器服务' : '正在连接本地模拟器服务...（npm run dev 会一并启动）'}>
              <Badge
                status={wsConnected ? 'success' : 'processing'}
                text={<Text style={{ fontSize: 12, color: TEXT_SECONDARY }}>{wsConnected ? '服务正常' : '连接中...'}</Text>}
              />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
              添加设备
            </Button>
          </Space>
        </div>

        {/* 设备区：内容多了自己滚，不把日志面板顶走（minHeight:0 是 flex 子项能滚的前提） */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {devices.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 16,
              color: TEXT_SECONDARY,
            }}
          >
            <DisconnectOutlined style={{ fontSize: 64, color: TEXT_MUTED }} />
            <Text style={{ fontSize: 16, color: TEXT_SECONDARY }}>
              暂无设备，点击右上角「添加设备」开始模拟
            </Text>
            <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
              添加第一个设备
            </Button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              // 固定卡宽：设备少时卡片不随容器拉通铺满（拉长很难看），放不下自动换行
              gridTemplateColumns: 'repeat(auto-fill, min(380px, 100%))',
              gap: 16,
            }}
          >
            {devices.map((device) => (
              <DeviceCard key={device.deviceId} device={device} />
            ))}
            {/* 添加更多设备的占位卡 */}
            <div
              style={{
                border: `2px dashed ${BORDER}`,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 200,
                cursor: 'pointer',
                color: TEXT_MUTED,
                transition: 'all 0.2s',
                flexDirection: 'column',
                gap: 8,
              }}
              onClick={() => setAddModalOpen(true)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = ACCENT;
                e.currentTarget.style.color = ACCENT;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = BORDER;
                e.currentTarget.style.color = TEXT_MUTED;
              }}
            >
              <PlusOutlined style={{ fontSize: 28 }} />
              <span style={{ fontSize: 14 }}>添加设备</span>
            </div>
          </div>
        )}
        </div>

        {/* MQTT 日志面板（页面内卡片，钉在内容区底部，默认收起） */}
        <LogPanel />

        <AddDeviceModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onSuccess={() => setAddModalOpen(false)}
        />
      </div>
    </ConfigProvider>
  );
}
