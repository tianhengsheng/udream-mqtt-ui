/**
 * 排队叫号（App 端页，走手艺人 token）。
 *
 * 联调「叫号触发洗头床预热排水」的操作台：左侧手机壳=发型师排队列表（每条可单独叫号），
 * 右侧同屏显示本店洗头床的排水状态与实时水温——叫号后不用切到模拟器页就能看到预热效果。
 *
 * ⚠️ 刷新列表本身可能就是一次叫号：/queued/query 在 pageNum=1 且队列无「叫号中/服务中」时，
 * 后端会自动 call()（QueuedQueryServiceImplActor#getQueuedList）。故本页**不做自动轮询**，
 * 列表刷新一律手动触发，避免莫名其妙地反复叫号干扰测试判断。
 *
 * 页面保持**浅色**（业务端页约定）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Popconfirm, Space, Spin, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { PhoneFrame } from '../app-mobile/PhoneFrame';
import { AppSimLayout } from '../app-mobile/AppSimLayout';
import { useCraftsmanStore } from '../app-mobile/useCraftsmanStore';
import { queryDyeByModel, type DyeDeviceStoreItem } from '../api/dyeAppDevice';
import { MODEL_WASHBED_XTC, fetchWashbedDetail, washbedOp, type WashbedDetail } from '../api/washbedApp';
import {
  ACTIVE_STATUS_LABEL,
  QUEUED_ALLOW_ACTIVE_STATUS,
  QUEUED_STATUS_LABEL,
  callQueued,
  getActiveStatus,
  queryQueued,
  updateActiveStatus,
  updateQueuedStatus,
  type QueuedDetail,
} from '../api/queuedSim';

const errText = (e: any): string =>
  e?.retInfo || e?.retMsg || e?.msg || e?.message || (typeof e === 'string' ? e : '请求失败');

/** 排队状态 → Tag 色 */
const STATUS_COLOR: Record<number, string> = { 0: 'default', 1: 'processing', 2: 'green', 3: 'orange' };

/** 洗头床一行状态（设备 + 云端状态缓存） */
interface BedRow {
  sn: string;
  name?: string;
  detail?: WashbedDetail;
}

export function AppQueuedCallPage() {
  const { user, storeId } = useCraftsmanStore();
  const craftsmanId = user?.uid || '';

  const [rows, setRows] = useState<QueuedDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const [beds, setBeds] = useState<BedRow[]>([]);
  const [bedLoading, setBedLoading] = useState(false);

  /** 手艺人工作状态（非 1/4/5 时顾客取号会被后端直接拒掉） */
  const [activeStatus, setActiveStatus] = useState<number | undefined>();
  /** 工作状态来源：db 与取号校验同源；cache 为 Redis 缓存兜底，可能与 DB 不一致 */
  const [statusSource, setStatusSource] = useState<'db' | 'cache' | undefined>();
  const [statusBusy, setStatusBusy] = useState(false);

  /** 拉排队列表（手动触发；注意后端可能顺带自动叫号，见文件头） */
  const loadQueue = useCallback(async () => {
    if (!storeId || !craftsmanId) return;
    setLoading(true);
    try {
      setRows(await queryQueued({ storeId, craftsmanId }));
    } catch (e) {
      message.error(`排队列表读取失败：${errText(e)}`);
    } finally {
      setLoading(false);
    }
  }, [storeId, craftsmanId]);

  /** 拉本店洗头床 + 各自云端状态（排水/水温） */
  const loadBeds = useCallback(async () => {
    if (!storeId) return;
    setBedLoading(true);
    try {
      const devices: DyeDeviceStoreItem[] = await queryDyeByModel(storeId, MODEL_WASHBED_XTC);
      const list = await Promise.all(
        devices
          .filter((d) => d.deviceCode)
          .map(async (d) => ({
            sn: d.deviceCode!,
            name: d.deviceName,
            detail: await fetchWashbedDetail(d.deviceCode!).catch(() => undefined),
          })),
      );
      setBeds(list);
    } catch (e) {
      message.error(`洗头床状态读取失败：${errText(e)}`);
    } finally {
      setBedLoading(false);
    }
  }, [storeId]);

  /** 拉手艺人当前工作状态 */
  const loadActiveStatus = useCallback(async () => {
    if (!storeId || !craftsmanId) return;
    try {
      const r = await getActiveStatus(storeId, craftsmanId);
      setActiveStatus(r.activeStatus);
      setStatusSource(r.source);
    } catch (e) {
      message.error(`工作状态读取失败：${errText(e)}`);
    }
  }, [storeId, craftsmanId]);

  /** 切工作状态。走 mgt 接口，绕开 App 端「您已下班,请打卡上班后再操作」的拦截（见 api/queuedSim.ts） */
  const switchActiveStatus = async (next: number) => {
    if (!storeId || !craftsmanId) return;
    setStatusBusy(true);
    try {
      await updateActiveStatus(storeId, craftsmanId, next);
      message.success(`工作状态已切为「${ACTIVE_STATUS_LABEL[next] ?? next}」`);
      await loadActiveStatus();
    } catch (e) {
      message.error(`工作状态切换失败：${errText(e)}`);
    } finally {
      setStatusBusy(false);
    }
  };

  useEffect(() => {
    void loadQueue();
    void loadBeds();
    void loadActiveStatus();
  }, [loadQueue, loadBeds, loadActiveStatus]);

  /**
   * 过号：排队中 / 叫号中 → 已过号(4)，结束这条排队。
   * 自测账号取号有上限，联调时叫过的号不结掉就取不了新号；过号也会触发预热关闭事件（CLOSE）。
   */
  const doPass = async (row: QueuedDetail) => {
    if (!row.id) return;
    setActing(true);
    try {
      // 过号原因/详情后端必填，自测固定给一组文案
      await updateQueuedStatus(row.id, 4, { passedType: '1', passedContent: '自测工具过号' });
      message.success(`已过号：${row.queuedNo || row.id}`);
      await loadQueue();
      setTimeout(() => void loadBeds(), 2000);
    } catch (e) {
      message.error(`过号失败：${errText(e)}`);
    } finally {
      setActing(false);
    }
  };

  /** 叫号：CAS 排队中 → 叫号中，命中后端预热钩子 */
  const doCall = async (row: QueuedDetail) => {
    if (!row.id) return;
    setActing(true);
    try {
      await updateQueuedStatus(row.id, 1);
      message.success(`已叫号：${row.queuedNo || row.id}`);
      await loadQueue();
      // 预热是异步链路（Kafka → dye → MQTT），留点时间再看床的状态
      setTimeout(() => void loadBeds(), 2000);
    } catch (e) {
      message.error(`叫号失败：${errText(e)}`);
    } finally {
      setActing(false);
    }
  };

  /** 触发叫号（真实自动叫号路径，叫队首那条） */
  const doAutoCall = async () => {
    if (!storeId || !craftsmanId) return;
    setActing(true);
    try {
      const queuedId = await callQueued(storeId, craftsmanId);
      message.success(queuedId ? `已触发叫号：${queuedId}` : '无可叫号的排队（或已有叫号中/服务中）');
      await loadQueue();
      setTimeout(() => void loadBeds(), 2000);
    } catch (e) {
      message.error(`触发叫号失败：${errText(e)}`);
    } finally {
      setActing(false);
    }
  };

  /** 手动关排水：预热只开不关，测完用它收尾 */
  const closeDrain = async (sn: string) => {
    try {
      await washbedOp({ deviceId: sn, action: 'drain_off' });
      message.success(`已关闭排水：${sn}`);
      void loadBeds();
    } catch (e) {
      message.error(errText(e));
    }
  };

  const bedColumns: ColumnsType<BedRow> = [
    { title: '设备', dataIndex: 'sn', render: (v: string, r) => `${r.name || '洗头床'}（${v}）` },
    {
      title: '在线',
      width: 60,
      render: (_, r) =>
        r.detail?.connectionStatus === 1 ? <Tag color="green">在线</Tag> : <Tag>离线</Tag>,
    },
    { title: '水温', width: 70, render: (_, r) => (r.detail?.waterTemperature ? `${r.detail.waterTemperature}°C` : '-') },
    {
      title: '排水',
      width: 90,
      render: (_, r) =>
        r.detail?.drainStatus === 1 ? <Tag color="cyan">预热中</Tag> : <Tag>关闭</Tag>,
    },
    {
      title: '',
      width: 80,
      render: (_, r) =>
        r.detail?.drainStatus === 1 ? (
          <Button size="small" danger data-testid={`queuedCall.drainOff-${r.sn}`} onClick={() => closeDrain(r.sn)}>
            关排水
          </Button>
        ) : null,
    },
  ];

  /* ── 手机壳内：排队列表 ───────────────────────────────────────────── */
  const phoneView = (
    <div style={{ background: '#f5f6f8', minHeight: '100%', padding: 10 }}>
      {rows.length === 0 && (
        <div style={{ textAlign: 'center', color: '#bfbfbf', padding: '40px 0' }}>
          {loading ? <Spin /> : '暂无排队'}
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{r.queuedNo || '-'}</span>
            <Space size={4}>
              {r.shampooBed && <Tag color="cyan">洗头床</Tag>}
              <Tag color={STATUS_COLOR[r.queuedStatus ?? 0]}>
                {QUEUED_STATUS_LABEL[r.queuedStatus ?? 0] || r.queuedStatus}
              </Tag>
            </Space>
          </div>
          <div style={{ fontSize: 12, color: '#595959', margin: '6px 0' }}>
            {r.nickname || r.customerName || '顾客'} · {r.itemNames || '-'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#bfbfbf' }}>id: {r.id}</span>
            <Space size={4}>
              {(r.queuedStatus === 0 || r.queuedStatus === 1) && (
                <Popconfirm title={`确定把 ${r.queuedNo || r.id} 置为已过号？`} okText="过号" cancelText="取消" onConfirm={() => doPass(r)}>
                  <Button size="small" danger loading={acting} data-testid={`queuedCall.pass-${r.id}`}>
                    过号
                  </Button>
                </Popconfirm>
              )}
              {r.queuedStatus === 0 && (
                <Button
                  size="small"
                  type="primary"
                  loading={acting}
                  data-testid={`queuedCall.call-${r.id}`}
                  onClick={() => doCall(r)}
                >
                  叫号
                </Button>
              )}
            </Space>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <AppSimLayout
      controls={
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Card
            size="small"
            title="排队操作"
            extra={
              <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadQueue()}>
                刷新列表
              </Button>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {!storeId && <Alert type="warning" showIcon message="当前 App 账号无默认门店" />}
              <Space>
                <Button type="primary" loading={acting} data-testid="queuedCall.autoCall" onClick={doAutoCall}>
                  触发叫号（叫队首）
                </Button>
                <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                  门店 {storeId || '-'} / 手艺人 {craftsmanId || '-'}
                </span>
              </Space>
              <Space>
                <span style={{ fontSize: 12 }}>
                  工作状态：
                  <Tag color={activeStatus != null && QUEUED_ALLOW_ACTIVE_STATUS.includes(activeStatus) ? 'green' : 'red'}>
                    {activeStatus == null ? '-' : (ACTIVE_STATUS_LABEL[activeStatus] ?? activeStatus)}
                  </Tag>
                  {statusSource && (
                    <Tag
                      color={statusSource === 'db' ? 'blue' : 'orange'}
                      data-testid="queuedCall.statusSource"
                      title={statusSource === 'db'
                        ? '来自 craftsman_store 表，与取号校验同源'
                        : '来自 Redis 缓存（未登录小程序或查库接口被拒），可能与取号校验读的 DB 不一致；登录小程序账号后刷新可读 DB'}
                    >
                      {statusSource === 'db' ? 'DB' : '缓存'}
                    </Tag>
                  )}
                </span>
                <Button
                  size="small"
                  loading={statusBusy}
                  disabled={activeStatus === 1}
                  data-testid="queuedCall.setAcceptance"
                  onClick={() => void switchActiveStatus(1)}
                >
                  切「可接单」
                </Button>
                <Button
                  size="small"
                  loading={statusBusy}
                  disabled={activeStatus === 0}
                  data-testid="queuedCall.setRest"
                  onClick={() => void switchActiveStatus(0)}
                >
                  切「休息中」
                </Button>
              </Space>
              {activeStatus != null && !QUEUED_ALLOW_ACTIVE_STATUS.includes(activeStatus) && (
                <Alert
                  type="error"
                  showIcon
                  message="当前状态顾客取号会被拒（后端只放行 可接单/接剪发单/吃饭中），先切「可接单」再去小程序取号。"
                />
              )}
              <Alert
                type="warning"
                showIcon
                message="刷新列表本身可能触发叫号：队列里没有「叫号中/服务中」时后端会自动 call()。本页因此不做自动轮询。"
              />
            </Space>
          </Card>

          <Card
            size="small"
            title="本店洗头床（预热效果）"
            extra={<Button size="small" icon={<ReloadOutlined />} loading={bedLoading} onClick={() => void loadBeds()} />}
          >
            <Table
              size="small"
              rowKey="sn"
              columns={bedColumns}
              dataSource={beds}
              pagination={false}
              locale={{ emptyText: '本店无已绑定洗头床' }}
            />
          </Card>

          <Alert
            type="info"
            showIcon
            message="叫号后链路：order 发 Kafka → dye 调度器选床 → MQTT drain_on。床的状态约 2 秒后自动刷新一次，没变化就手动刷。预热只开不关，测完记得关排水。"
          />
        </Space>
      }
    >
      <PhoneFrame title="排队叫号">{phoneView}</PhoneFrame>
    </AppSimLayout>
  );
}
