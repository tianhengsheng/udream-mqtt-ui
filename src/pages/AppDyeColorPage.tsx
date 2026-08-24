/**
 * 下料（App 端页，走 App token）。
 *
 * 四代机「直接组配方下料」自测页：**不做色板/颜色建议选择**，直接选管子颜色 + 克数：
 *   设备上下文（智染设备页交接） → 组配方（颜色行 + 可选双氧） → 几号管预览
 *   → 保存调色记录 → 执行调色 → 轮询状态
 *
 * 接口/字段全部在 src/api/dyeAppColor.ts 里对齐后端源码（含三处与需求描述不一致的地方，见该文件注释）：
 *   可选颜色 POST /apiDye/order/dye/getDyeConfigConstVO?model=4  → dyeConstList 就是 6 根染膏管
 *   余量参考 POST /dye/apiCraftsman/dyemachine/creamCapacity（复用 dyeAppDevice.ts）
 *   几号管   POST /apiDye/order/dye/getDyeColorRecordPortResult（**不是** getDyeColorRecordPortName，那个不回管号）
 *   保存     POST /apiDye/order/dye/savaOrUpdateColorRecordsV2
 *   执行下料 POST /dye/apiCraftsman/dyemachine/op?deviceId=&action=dispense（真机走蓝牙，自测用 MQTT 等价替代）
 *   状态     GET  /apiDye/order/dye/getNewDyeColorRecordsStatus?orderId=（orderId 必填，用保存返回的）
 *
 * 页面保持**浅色**（模拟器那套深色 theme.ts 是模拟器专用，不要往这里套）。
 * 设备上下文来自 localStorage `mqtt-app-selected-device`（与「智染设备页」的交接契约，
 * 见 dyeAppDevice.ts SelectedDevicePayload）；没有值时页面顶部可手输 deviceCode + storeId。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { PhoneFrame } from '../app-mobile/PhoneFrame';
import { AppSimLayout } from '../app-mobile/AppSimLayout';
import { useCraftsmanStore } from '../app-mobile/useCraftsmanStore';
import {
  CREAM_STATUS_META,
  SELECTED_DEVICE_KEY,
  fetchCreamCapacity,
  type DyeCreamCapacity,
  type SelectedDevicePayload,
} from '../api/dyeAppDevice';
import {
  IS_EXECUTE_NEW,
  MODEL_FOUR,
  OUT_MODEL_MANUAL,
  OUT_TYPE,
  SCENE_TYPE,
  SHOW_STATUS_LABEL,
  TAG_OPTIONS,
  dispatchDispense,
  fetchColorRecordPortResult,
  fetchColorRecordsStatus,
  fetchDyeConfigConst,
  isUsableColorId,
  previewHydrogenPorts,
  saveColorRecords,
  type DispensePump,
  type DyeColorConst,
  type DyeColorRecordDTO,
  type DyeColorRecordPortResult,
  type DyeColorRecordVO,
  type DyeColorStatus,
} from '../api/dyeAppColor';

/** 后端异常统一转成可展示文案（Resp 业务失败被拦截器 reject 的是裸 body，不是 Error） */
const errText = (e: any): string =>
  e?.retInfo || e?.retMsg || e?.msg || e?.message || (typeof e === 'string' ? e : '请求失败');

/** 配方里的一行染膏（本地态；colorName 就是管子色号，如 33/0） */
interface CreamRow {
  key: number;
  colorId: string;
  colorName: string;
  weight: number;
}

let rowSeq = 1;
const newRow = (): CreamRow => ({ key: rowSeq++, colorId: '', colorName: '', weight: 30 });

/** 读设备交接契约；解析失败按无值处理（自测页手输兜底） */
function readSelectedDevice(): Partial<SelectedDevicePayload> {
  try {
    const raw = localStorage.getItem(SELECTED_DEVICE_KEY);
    return raw ? (JSON.parse(raw) as SelectedDevicePayload) : {};
  } catch {
    return {};
  }
}

export function AppDyeColorPage() {
  const { user, storeId: loginStoreId } = useCraftsmanStore();

  // —— 设备上下文（localStorage 优先，可手改）——
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [storeId, setStoreId] = useState('');

  useEffect(() => {
    const d = readSelectedDevice();
    setDeviceCode(d.deviceCode || '');
    setDeviceName(d.deviceName || '');
    setStoreId(d.storeId || loginStoreId || '');
    // 只在进页时读一次交接契约，之后以页面内输入为准（避免覆盖用户手改）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 可选颜色 / 双氧 ——
  const [creamConsts, setCreamConsts] = useState<DyeColorConst[]>([]);
  const [hydrogenConsts, setHydrogenConsts] = useState<DyeColorConst[]>([]);
  const [constLoading, setConstLoading] = useState(false);
  const [constErr, setConstErr] = useState('');

  const loadConsts = useCallback(async () => {
    setConstLoading(true);
    setConstErr('');
    try {
      const c = await fetchDyeConfigConst(MODEL_FOUR);
      setCreamConsts(c.dyeConstList || []);
      setHydrogenConsts(c.dioxygenConstList || []);
    } catch (e) {
      setCreamConsts([]);
      setHydrogenConsts([]);
      setConstErr(errText(e));
    } finally {
      setConstLoading(false);
    }
  }, []);

  // —— 余量（只做展示参考，不参与下料计算）——
  const [capacity, setCapacity] = useState<DyeCreamCapacity | null>(null);
  const loadCapacity = useCallback(async () => {
    if (!deviceCode || !storeId) {
      setCapacity(null);
      return;
    }
    try {
      setCapacity(await fetchCreamCapacity(deviceCode, storeId));
    } catch {
      setCapacity(null); // 余量是辅助信息，失败不打断主流程
    }
  }, [deviceCode, storeId]);

  useEffect(() => {
    void loadConsts();
  }, [loadConsts]);
  useEffect(() => {
    void loadCapacity();
  }, [loadCapacity]);

  /** 管子名 → 余量，配方行上标注剩余克数 */
  const pumpByName = useMemo(() => {
    const m = new Map<string, NonNullable<DyeCreamCapacity['pumps']>[number]>();
    (capacity?.pumps || []).forEach((p) => p.name && m.set(p.name, p));
    return m;
  }, [capacity]);

  // —— 配方组建 ——
  const [rows, setRows] = useState<CreamRow[]>([newRow()]);
  const [tag, setTag] = useState(0);
  const [useHydrogen, setUseHydrogen] = useState(false);
  const [hydrogenName, setHydrogenName] = useState('');
  const [hydrogenWeight, setHydrogenWeight] = useState(60);

  const patchRow = (key: number, patch: Partial<CreamRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const totalCream = rows.reduce((s, r) => s + (r.colorId ? r.weight || 0 : 0), 0);

  /** 组装后端入参：染膏行 + （可选）双氧行。字段含义见 dyeAppColor.ts DyeColorRecordDTO */
  const buildDtoList = useCallback(
    (opts?: { creamOnly?: boolean }): DyeColorRecordDTO[] => {
      const base = {
        orderId: null,
        isSingle: 1,
        storeId,
        employeeId: user?.uid,
        deviceCode,
        deviceName: deviceName || deviceCode,
        isExecute: IS_EXECUTE_NEW,
        outModel: OUT_MODEL_MANUAL,
        recipeName: '',
        sceneType: SCENE_TYPE.BATCH,
      };
      const list: DyeColorRecordDTO[] = rows
        .filter((r) => r.colorId && r.weight > 0)
        .map((r) => ({
          ...base,
          colorId: r.colorId,
          colorName: r.colorName,
          weight: Math.round(r.weight),
          tag,
          outType: OUT_TYPE.CREAM,
        }));
      if (!opts?.creamOnly && useHydrogen && hydrogenName && hydrogenWeight > 0) {
        list.push({
          ...base,
          weight: Math.round(hydrogenWeight),
          tag,
          outType: OUT_TYPE.HYDROGEN,
          hydrogenName,
        });
      }
      return list;
    },
    [rows, tag, useHydrogen, hydrogenName, hydrogenWeight, storeId, deviceCode, deviceName, user?.uid],
  );

  const ctxReady = !!(storeId && deviceCode);
  const canSubmit = ctxReady && buildDtoList().length > 0;

  // —— 几号管预览 ——
  const [ports, setPorts] = useState<DyeColorRecordPortResult[]>([]);
  const [portLoading, setPortLoading] = useState(false);
  const [portErr, setPortErr] = useState('');

  /**
   * 预览：**只把染膏行发给后端**。
   * 原因见 dyeAppColor.ts —— 后端 getDyeColorRecordPortResult 里双氧分支
   * （createHydrogenDyeColorRecord）会真的 insert 一条调色记录，预览不该写库；
   * 双氧的 7/8 号管按后端同一套配比在本地推算展示。
   */
  const onPreview = useCallback(async () => {
    const creamDtos = buildDtoList({ creamOnly: true });
    const local = useHydrogen && hydrogenName ? previewHydrogenPorts(hydrogenName, Math.round(hydrogenWeight)) : [];
    if (creamDtos.length === 0) {
      setPorts(local);
      return;
    }
    setPortLoading(true);
    setPortErr('');
    try {
      const res = await fetchColorRecordPortResult(creamDtos);
      setPorts([...res, ...local]);
    } catch (e) {
      setPorts(local);
      setPortErr(errText(e));
    } finally {
      setPortLoading(false);
    }
  }, [buildDtoList, useHydrogen, hydrogenName, hydrogenWeight]);

  // 自动预览：配方一变就 600ms 防抖刷新几号管（还原真机"实时反馈"体验，无需手点按钮）
  useEffect(() => {
    if (!ctxReady) return;
    const timer = window.setTimeout(() => void onPreview(), 600);
    return () => window.clearTimeout(timer);
  }, [ctxReady, onPreview]);

  // —— 保存 / 执行 / 状态 ——
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<DyeColorRecordVO[]>([]);
  const [orderId, setOrderId] = useState('');
  const [opErr, setOpErr] = useState('');
  const [status, setStatus] = useState<DyeColorStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 配方/设备一变，之前保存的记录就作废（防止拿旧记录的管口去下料）
  useEffect(() => {
    setSaved([]);
    setOrderId('');
    setStatus(null);
  }, [rows, tag, useHydrogen, hydrogenName, hydrogenWeight, deviceCode, storeId]);

  /** 保存调色记录；成功返回落库行与订单 id（供确认下料串行使用），失败返回 null */
  const doSave = async (): Promise<{ rows: DyeColorRecordVO[]; oid: string } | null> => {
    const dtoList = buildDtoList();
    setOpErr('');
    try {
      const res = await saveColorRecords(dtoList);
      setSaved(res);
      const oid = res.find((r) => r.orderId)?.orderId || '';
      setOrderId(oid);
      setStatus(null);
      if (res.length < dtoList.length) {
        message.warning(`提交 ${dtoList.length} 行，后端只落库 ${res.length} 行（colorId 查不到的行会被丢弃）`);
      }
      return { rows: res, oid };
    } catch (e) {
      setSaved([]);
      setOpErr(errText(e));
      return null;
    }
  };

  /**
   * 解析 MQTT deviceId：按 SN(=deviceCode) 去 sim-server 反查在线模拟设备。
   * 真机 App 走蓝牙下料，自测里由模拟器扮演设备，所以「SN 相同的在线模拟设备」就是下料目标。
   */
  const resolveMqttDeviceId = async (): Promise<string> => {
    try {
      const r = await fetch('/simapi/devices').then((x) => x.json());
      const list: Array<{ deviceId: string; sn: string; connectionStatus: string }> = r?.data ?? [];
      const hit =
        list.find((d) => d.sn === deviceCode && d.connectionStatus === 'connected') ||
        list.find((d) => d.sn === deviceCode);
      if (hit) return hit.deviceId;
    } catch {
      /* sim-server 未起时返回空，由调用方提示 */
    }
    return '';
  };

  /**
   * 确认下料 = **一个按钮两步串行：保存调色记录 → MQTT dispense**（与真机 App 的「执行调色」一致）。
   * 真机 App 用蓝牙把配方发给设备，自测 UI 用云端 MQTT 指令等价替代——App 流程形态保持一致。
   * （executeColorRecord 的老 zmg 通道实现已被注释、必失败，本页不再使用，见 dyeAppColor.ts。）
   * pumps 取保存返回里的 dyeColorRecordPort（后端真实拆管结果），不依赖前端预览。
   */
  const onConfirmDispense = async () => {
    // 先探设备：目标不在线就不落库，避免堆"等待中"的死记录
    const target = await resolveMqttDeviceId();
    if (!target) {
      message.warning(`未找到 SN=${deviceCode} 的在线模拟设备，请先到「设备模拟器」连一台同 SN 的设备`);
      return;
    }
    setSaving(true);
    try {
      const savedRet = await doSave();
      if (!savedRet) return;
      const pumps: DispensePump[] = savedRet.rows
        .flatMap((r) => r.dyeColorRecordPort ?? [])
        .filter((p) => p.devicePort && p.weight)
        .map((p) => ({ pump: p.devicePort!, colorCode: p.name || '', gram: Math.round(p.weight!) }));
      if (pumps.length === 0) {
        message.warning('保存成功但没有可下料的管口（colorId 可能查不到配置），已停止下发');
        return;
      }
      await dispatchDispense(target, {
        taskId: `t-${Date.now()}`,
        orderId: savedRet.oid || undefined,
        formulaName: rows.map((r) => r.colorName).filter(Boolean).join('+') || '自测配方',
        pumps,
      });
      message.success(`已保存并向 ${target} 下发 dispense，去设备模拟器看执行过程`);
      setPolling(true); // 自动轮询到终态（见下方 effect）
      void onQueryStatus(savedRet.oid);
    } catch (e) {
      setOpErr(errText(e));
    } finally {
      setSaving(false);
    }
  };

  // oid 入参给"保存后立即查"用（setOrderId 同 tick 内闭包里还是旧值）
  const onQueryStatus = useCallback(
    async (oid?: string) => {
      const target = oid || orderId;
      if (!target) return;
      try {
        setStatus(await fetchColorRecordsStatus(target));
      } catch (e) {
        setOpErr(errText(e));
      }
    },
    [orderId],
  );

  // 自动轮询：3s 一轮，切页即停（不做长 sleep 死等）；到终态自动停
  useEffect(() => {
    if (!polling || !orderId) return;
    timerRef.current = window.setInterval(() => void onQueryStatus(), 3000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [polling, orderId, onQueryStatus]);
  useEffect(() => {
    // 0失败 / 20已取消 / 21已完成 = 终态，停止轮询
    if (status && [0, 20, 21].includes(status.status ?? -1)) setPolling(false);
  }, [status]);

  const goSimulator = () => (window as any).__t?.nav?.('设备模拟器');

  // —— 右侧控件栏（极简：只留设备上下文兜底输入 + 报错提示）——
  const controls = (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Card size="small" title="设备上下文">
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space wrap>
            <span>MAC码</span>
            <Input
              data-testid="appDye.device-code"
              value={deviceCode}
              onChange={(e) => setDeviceCode(e.target.value.trim())}
              placeholder="如 0400001"
              style={{ width: 140 }}
            />
          </Space>
          <Space wrap>
            <span>门店ID</span>
            <Input
              data-testid="appDye.store-id"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value.trim())}
              placeholder="storeId（19位）"
              style={{ width: 180 }}
            />
          </Space>
          <Space wrap>
            <span>设备名</span>
            <Input
              data-testid="appDye.device-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="deviceName"
              style={{ width: 140 }}
            />
          </Space>
          <Button size="small" data-testid="appDye.goto-sim" onClick={goSimulator}>
            去设备模拟器
          </Button>
        </Space>
      </Card>

      {(constErr || portErr || opErr) && (
        <Alert
          type="error"
          showIcon
          message="接口报错"
          description={[constErr, portErr, opErr].filter(Boolean).join(' / ')}
        />
      )}
    </Space>
  );

  return (
    <AppSimLayout controls={controls}>
      <PhoneFrame
        title="下料"
        rightAction={
          <span
            data-testid="appDye.refresh"
            onClick={() => {
              void loadConsts();
              void loadCapacity();
            }}
          >
            <ReloadOutlined /> 刷新
          </span>
        }
      >
        <div style={{ padding: '8px 10px 96px' }}>
          {!ctxReady && (
            <Alert
              type="warning"
              showIcon
              style={{ borderRadius: 10, marginBottom: 8 }}
              message="缺设备上下文"
              description="请在右侧填 MAC码 + 门店id，或先去「智染设备」页点「去下料」。"
            />
          )}
          <div style={{ background: '#fff', borderRadius: 12, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{deviceName || '未选择设备'}</div>
            <div style={{ color: '#8a8a8e', fontSize: 12, marginTop: 2 }}>
              SN {deviceCode || '-'} · 门店 {storeId || '-'}
            </div>
          </div>

          {/* —— 配方组建 —— */}
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 4px 6px' }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>配方（管子颜色 + 克数）</span>
            <span style={{ color: '#8a8a8e', fontSize: 12 }}>合计 {totalCream}g</span>
          </div>
          <Spin spinning={constLoading}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '8px 10px' }}>
              {creamConsts.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={constErr || '暂无可选颜色'} />
              ) : (
                rows.map((r, i) => {
                  const pump = r.colorName ? pumpByName.get(r.colorName) : undefined;
                  const meta = pump ? CREAM_STATUS_META[pump.status ?? 0] : undefined;
                  return (
                    <div key={r.key} style={{ marginBottom: 8 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Select
                          data-testid={`appDye.color-${i}`}
                          style={{ flex: 1 }}
                          placeholder="选择管子颜色"
                          value={r.colorId || undefined}
                          onChange={(v) => {
                            const c = creamConsts.find((x) => x.colorId === v);
                            patchRow(r.key, { colorId: v, colorName: c?.colorName || '' });
                          }}
                          options={creamConsts.map((c) => ({
                            value: c.colorId!,
                            label: `${c.value || ''} ${c.colorName || ''}${c.desc ? `（${c.desc}）` : ''}`,
                            disabled: !isUsableColorId(c.colorId),
                          }))}
                        />
                        <InputNumber
                          data-testid={`appDye.weight-${i}`}
                          style={{ width: 92 }}
                          min={1}
                          max={500}
                          precision={0}
                          addonAfter="g"
                          value={r.weight}
                          onChange={(v) => patchRow(r.key, { weight: Number(v) || 0 })}
                        />
                        <Button
                          data-testid={`appDye.del-${i}`}
                          icon={<DeleteOutlined />}
                          disabled={rows.length <= 1}
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        />
                      </Space.Compact>
                      {pump && (
                        <div style={{ fontSize: 11, color: meta?.color || '#8a8a8e', marginTop: 2, marginLeft: 2 }}>
                          {pump.devicePort}号口余量 {pump.weight ?? '-'}g（{meta?.text || '-'}）
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <Button
                data-testid="appDye.add-row"
                block
                icon={<PlusOutlined />}
                onClick={() => setRows((rs) => [...rs, newRow()])}
                disabled={creamConsts.length === 0}
              >
                加一行颜色
              </Button>
              <Divider style={{ margin: '10px 0' }} />
              <Space wrap>
                <span style={{ fontSize: 12 }}>标签</span>
                <Select
                  data-testid="appDye.tag"
                  style={{ width: 96 }}
                  value={tag}
                  onChange={setTag}
                  options={TAG_OPTIONS}
                />
                <Checkbox
                  data-testid="appDye.hydrogen-toggle"
                  checked={useHydrogen}
                  onChange={(e) => setUseHydrogen(e.target.checked)}
                >
                  加双氧
                </Checkbox>
              </Space>
              {useHydrogen && (
                <Space style={{ marginTop: 8 }} wrap>
                  <Select
                    data-testid="appDye.hydrogen-name"
                    style={{ width: 110 }}
                    placeholder="双氧浓度"
                    value={hydrogenName || undefined}
                    onChange={setHydrogenName}
                    options={hydrogenConsts.map((c) => ({ value: c.colorName!, label: c.colorName! }))}
                  />
                  <InputNumber
                    data-testid="appDye.hydrogen-weight"
                    style={{ width: 92 }}
                    min={1}
                    max={500}
                    precision={0}
                    addonAfter="g"
                    value={hydrogenWeight}
                    onChange={(v) => setHydrogenWeight(Number(v) || 0)}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    7号管3% / 8号管12% 按比例拆
                  </Typography.Text>
                </Space>
              )}
            </div>
          </Spin>

          {/* —— 几号管（自动预览，配方一变即刷新）—— */}
          <div style={{ margin: '12px 4px 6px', fontSize: 13, fontWeight: 600 }}>几号管下料</div>
          <div style={{ background: '#fff', borderRadius: 12, padding: '10px 12px' }}>
            <Spin spinning={portLoading}>
              {ports.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选好颜色和克数后自动计算" />
              ) : (
                ports.map((p, i) => (
                  <div
                    key={`${p.devicePort}-${p.name}-${i}`}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}
                  >
                    <span>
                      <Tag color="blue">{p.devicePort}号管</Tag>
                      {p.name}
                    </span>
                    <b>{p.weight}g</b>
                  </div>
                ))
              )}
            </Spin>
          </div>

          {/* —— 下料状态（保存/执行后展示在手机内）—— */}
          {saved.length > 0 && (
            <div style={{ margin: '10px 4px 0', fontSize: 12, color: '#8a8a8e' }}>
              已保存 {saved.length} 条调色记录 · 订单 {orderId || '-'}
            </div>
          )}
          {status && (
            <Alert
              style={{ marginTop: 8, borderRadius: 10 }}
              type={status.status === 0 ? 'error' : status.status === 21 ? 'success' : 'info'}
              showIcon
              message={`下料状态：${SHOW_STATUS_LABEL[status.status ?? -1] || '未知'}${polling ? '（轮询中…）' : ''}`}
              description={status.executeResult || undefined}
            />
          )}
        </div>

        {/* —— 底部操作条：一个按钮两步串行（保存调色记录 + MQTT 下料），与真机 App 一致 —— */}
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
          <Popconfirm
            title="确认下料"
            description="将保存调色记录并通过 MQTT 驱动同 SN 的模拟设备真实下料、扣减余量，确定？"
            okText="确认下料"
            cancelText="取消"
            onConfirm={() => void onConfirmDispense()}
          >
            <Button
              type="primary"
              block
              size="large"
              loading={saving}
              disabled={!canSubmit}
              data-testid="appDye.dispense"
              style={{ borderRadius: 22, height: 42 }}
            >
              确认下料
            </Button>
          </Popconfirm>
        </div>
      </PhoneFrame>
    </AppSimLayout>
  );
}
