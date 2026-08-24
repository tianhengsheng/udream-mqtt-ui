/**
 * 智染设备（App 端页，走 App token）。
 *
 * 还原真实 App「智能烫染洗护 → 四代调色仪」流程：
 *   选门店（登录默认门店）→ 选四代机 → 看染膏容量监控 → 去下料。
 *
 * 对接接口见 src/api/dyeAppDevice.ts（两个接口入参都在 query string）：
 *   设备列表 GET /apiDye/base/dye/queryDyeByModel?storeIds=&model=4
 *   容量监控 POST /dye/apiCraftsman/dyemachine/creamCapacity?macCode=&storeId=
 *
 * 页面保持**浅色**（模拟器那套深色 theme.ts 是模拟器专用，不要往这里套）。
 * 「去下料」把选中设备写 localStorage `mqtt-app-selected-device` 后跳「下料(App)」页，
 * 该 key 与字段名是两页共同约定的契约，见 dyeAppDevice.ts SelectedDevicePayload。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Spin, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PhoneFrame } from '../app-mobile/PhoneFrame';
import { AppSimLayout } from '../app-mobile/AppSimLayout';
import { StoreResolveBar } from '../app-mobile/StoreResolveBar';
import { useCraftsmanStore } from '../app-mobile/useCraftsmanStore';
import {
  CREAM_STATUS_META,
  MODEL_DYE_MACHINE_4,
  fetchCreamCapacity,
  lastPickKey,
  queryDyeByModel,
  saveSelectedDevice,
  type DyeCreamCapacity,
  type DyeCreamPump,
  type DyeDeviceStoreItem,
} from '../api/dyeAppDevice';

/** 后端异常统一转成可展示文案（Resp 业务失败被拦截器 reject 的是裸 body，不是 Error） */
const errText = (e: any): string =>
  e?.retInfo || e?.retMsg || e?.msg || e?.message || (typeof e === 'string' ? e : '请求失败');

/** 胶囊柱固定 8 个槽位：后端只回配置过的出料口，缺的补空位，保证仿真机形态稳定 */
const PUMP_SLOTS = 8;

/** 「更新于」时间：后端 LocalDateTime 序列化成 'yyyy-MM-dd HH:mm:ss'，只展示到分钟 */
const fmtSyncTime = (t?: string) => (t ? t.replace('T', ' ').slice(0, 16) : '暂无上报');

export function AppDyeDevicePage() {
  const { user, stores, storeId, setStoreId } = useCraftsmanStore();

  const [devices, setDevices] = useState<DyeDeviceStoreItem[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceErr, setDeviceErr] = useState('');
  const [picked, setPicked] = useState<string>(''); // 选中设备的 deviceCode

  const [capacity, setCapacity] = useState<DyeCreamCapacity | null>(null);
  const [capLoading, setCapLoading] = useState(false);
  const [capErr, setCapErr] = useState('');

  const pickedDevice = useMemo(
    () => devices.find((d) => d.deviceCode === picked),
    [devices, picked],
  );

  /** 拉门店下的四代机列表，并恢复上次选中（localStorage 按 storeId 分键） */
  const loadDevices = useCallback(async () => {
    if (!storeId) {
      setDevices([]);
      setPicked('');
      return;
    }
    setDeviceLoading(true);
    setDeviceErr('');
    try {
      const list = await queryDyeByModel(storeId, MODEL_DYE_MACHINE_4);
      setDevices(list);
      const remembered = localStorage.getItem(lastPickKey(storeId)) || '';
      const hit = list.find((d) => d.deviceCode === remembered) || list[0];
      setPicked(hit?.deviceCode || '');
    } catch (e) {
      setDevices([]);
      setPicked('');
      setDeviceErr(errText(e));
    } finally {
      setDeviceLoading(false);
    }
  }, [storeId]);

  /** 拉当前选中设备的染膏容量。查不到绑定时后端回 pumps=[]，属「无数据」不是异常 */
  const loadCapacity = useCallback(async () => {
    if (!storeId || !picked) {
      setCapacity(null);
      return;
    }
    setCapLoading(true);
    setCapErr('');
    try {
      setCapacity(await fetchCreamCapacity(picked, storeId));
    } catch (e) {
      setCapacity(null);
      setCapErr(errText(e));
    } finally {
      setCapLoading(false);
    }
  }, [storeId, picked]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    void loadCapacity();
  }, [loadCapacity]);

  const onPick = (d: DyeDeviceStoreItem) => {
    if (!d.deviceCode) return;
    setPicked(d.deviceCode);
    if (storeId) localStorage.setItem(lastPickKey(storeId), d.deviceCode);
  };

  /** 去下料：写交接契约 → 跳「下料(App)」页（该页由他人开发，未注册时静默留在本页） */
  const goDispense = () => {
    if (!pickedDevice?.deviceCode || !storeId) {
      message.warning('请先选择设备');
      return;
    }
    saveSelectedDevice({
      deviceCode: pickedDevice.deviceCode,
      deviceName: pickedDevice.deviceName || pickedDevice.deviceCode,
      storeId,
      dyeDeviceStoreId: pickedDevice.id,
    });
    // __t.nav 返回 {ok:boolean}；下料页还没注册进 PAGES 时 ok=false，只提示不报错
    const r = (window as any).__t?.nav?.('下料(App)');
    if (!r || r.ok === false) message.info('已记录设备，「下料(App)」页尚未接入');
  };

  // —— 8 个胶囊柱：按 devicePort 归位，缺口补空 ——
  const pumps = capacity?.pumps || [];
  const slots: (DyeCreamPump | null)[] = Array.from({ length: PUMP_SLOTS }, (_, i) => {
    const port = i + 1;
    return pumps.find((p) => p.devicePort === port) || null;
  });
  // 后端出料口若不是 1~8（异常配置），兜底按顺序铺，避免整排空白看不出问题
  const fallbackFill = slots.every((s) => s === null) && pumps.length > 0;
  const showSlots = fallbackFill ? pumps.slice(0, PUMP_SLOTS) : slots;

  const controls = (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <StoreResolveBar role={user?.role} stores={stores} storeId={storeId} onStoreChange={setStoreId} />
      <Card size="small" title="调试信息">
        <Space direction="vertical" size={2} style={{ fontSize: 12 }}>
          <span>门店 storeId：{storeId || '(无)'}</span>
          <span>
            设备列表：GET /apiDye/base/dye/queryDyeByModel?storeIds={storeId || '-'}&model=
            {MODEL_DYE_MACHINE_4}（共 {devices.length} 台）
          </span>
          <span>
            容量监控：POST /dye/apiCraftsman/dyemachine/creamCapacity?macCode={picked || '-'}&storeId=
            {storeId || '-'}（{pumps.length} 个出料口）
          </span>
          <Space>
            <Button size="small" data-testid="appDevice.reload-devices" onClick={() => void loadDevices()}>
              重查设备
            </Button>
            <Button size="small" data-testid="appDevice.reload-capacity" onClick={() => void loadCapacity()}>
              重查容量
            </Button>
          </Space>
        </Space>
      </Card>
      {(deviceErr || capErr) && (
        <Alert type="error" showIcon message="接口报错" description={[deviceErr, capErr].filter(Boolean).join(' / ')} />
      )}
    </Space>
  );

  return (
    <AppSimLayout controls={controls}>
      <PhoneFrame
        title="四代调色仪"
        rightAction={
          <span data-testid="appDevice.refresh" onClick={() => { void loadDevices(); void loadCapacity(); }}>
            <ReloadOutlined /> 刷新
          </span>
        }
      >
        <div style={{ padding: '8px 10px 76px' }}>
          {/* —— 设备选择 —— */}
          <div style={{ fontSize: 13, fontWeight: 600, margin: '2px 4px 6px' }}>选择设备</div>
          <Spin spinning={deviceLoading}>
            {deviceErr ? (
              <Alert type="error" showIcon message={deviceErr} style={{ borderRadius: 10 }} />
            ) : devices.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={storeId ? '该门店暂无四代调色仪' : '请先在右侧选择门店'}
              />
            ) : (
              devices.map((d) => {
                const on = d.deviceCode === picked;
                return (
                  <div
                    key={d.deviceCode}
                    data-testid={`appDevice.pick-${d.deviceCode}`}
                    onClick={() => onPick(d)}
                    style={{
                      background: '#fff',
                      border: `1px solid ${on ? '#2f6bff' : '#eee'}`,
                      boxShadow: on ? '0 0 0 2px rgba(47,107,255,0.12)' : 'none',
                      borderRadius: 12,
                      padding: '10px 12px',
                      marginBottom: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{d.deviceName || '未命名设备'}</span>
                      <Tag color={d.status === 1 ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>
                        {d.status === 1 ? '已连接' : '未连接'}
                      </Tag>
                    </div>
                    <div style={{ marginTop: 4, color: '#8a8a8e', fontSize: 12 }}>
                      SN {d.deviceCode}
                      {d.runDesc ? ` · ${d.runDesc}` : ''}
                    </div>
                  </div>
                );
              })
            )}
          </Spin>

          {/* —— 染膏容量监控 —— */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '14px 4px 6px',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>染膏容量监控</span>
            <span
              data-testid="appDevice.refresh-capacity"
              onClick={() => void loadCapacity()}
              style={{ color: '#2f6bff', fontSize: 12, cursor: 'pointer' }}
            >
              <ReloadOutlined /> 刷新
            </span>
          </div>
          <div style={{ background: '#fff', borderRadius: 12, padding: '10px 8px' }}>
            <Spin spinning={capLoading}>
              {capErr ? (
                <Alert type="error" showIcon message={capErr} />
              ) : pumps.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无余量数据" />
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  {showSlots.map((p, i) => (
                    <PumpBar key={p?.devicePort ?? `empty-${i}`} port={p?.devicePort ?? i + 1} pump={p} />
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8, color: '#8a8a8e', fontSize: 11, textAlign: 'center' }}>
                更新于 {fmtSyncTime(capacity?.lastSyncTime)}
              </div>
            </Spin>
          </div>
        </div>

        {/* —— 底部去下料 —— */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px 12px 14px',
            background: '#fff',
            borderTop: '1px solid #f0f0f0',
          }}
        >
          <Button
            type="primary"
            block
            size="large"
            disabled={!pickedDevice}
            onClick={goDispense}
            style={{ borderRadius: 22, height: 40 }}
          >
            去下料
          </Button>
        </div>
      </PhoneFrame>
    </AppSimLayout>
  );
}

/** 单个出料口胶囊柱：底部按余量百分比填色，颜色随 status（0 正常 / 1 预警 / 2 阻断）。 */
function PumpBar({ port, pump }: { port: number; pump: DyeCreamPump | null }) {
  const meta = CREAM_STATUS_META[pump?.status ?? 0] || CREAM_STATUS_META[0];
  const percent = Math.max(0, Math.min(100, pump?.percent ?? 0));
  const empty = !pump;
  return (
    <div
      data-testid={`appDevice.pump-${port}`}
      style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10, color: '#8a8a8e' }}
    >
      {/* 柱体：外壳固定高度，内层按 percent 从底部撑起 */}
      <div
        style={{
          height: 96,
          borderRadius: 8,
          background: '#f2f3f5',
          border: '1px solid #ececec',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'flex-end',
        }}
      >
        {!empty && (
          <div
            style={{
              width: '100%',
              height: `${percent}%`,
              background: meta.color,
              opacity: 0.85,
              transition: 'height .3s',
            }}
          />
        )}
        <span
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 6,
            fontSize: 11,
            fontWeight: 600,
            color: empty ? '#c0c0c0' : '#1c1c1e',
          }}
        >
          {empty ? '-' : `${percent}%`}
        </span>
      </div>
      {/* 色号 / 双氧浓度（后端 name 字段），空槽位用 '-' 占位 */}
      <div
        style={{
          marginTop: 4,
          color: empty ? '#c0c0c0' : '#1c1c1e',
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {pump?.name || '-'}
      </div>
      <div>{port}号</div>
      {!empty && (
        <div style={{ color: meta.color }}>
          {meta.text} {pump?.weight ?? 0}g
        </div>
      )}
    </div>
  );
}
