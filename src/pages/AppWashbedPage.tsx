/**
 * AI洗头床控制（App 端页，走 App token）。按小盾牌 App 原型还原两屏：
 *   ① 控制页：状态/目标温度调节(set_temp)/实时温度/洗头次数/上次洗头时间/WiFi/
 *      当前模式(含 5-速冲90秒)/水压强度 + 底部 开启(start)/停止(stop)/消毒(start model=4)；
 *   ② 设备信息页（右上「设置」进入）：网络/状态/水温/系统/编号/固件 + 预热排水开关(drain_on/off)。
 *      原型中「添加设备/故障上报」不接入。
 *
 * 全部走已有接口（见 src/api/washbedApp.ts），指令为云端 WiFi 链路（自测 UI 无蓝牙）。
 * 数据口径：进入/切设备查一次 + 每次操作后重查 + 8s 轮询（看模拟器水温/排水状态变化）。
 * 页面保持**浅色**（App 端约定，模拟器深色 theme.ts 不往这里套）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Select, Space, Spin, Switch, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PhoneFrame } from '../app-mobile/PhoneFrame';
import { AppSimLayout } from '../app-mobile/AppSimLayout';
import { useCraftsmanStore } from '../app-mobile/useCraftsmanStore';
import { queryDyeByModel, type DyeDeviceStoreItem } from '../api/dyeAppDevice';
import {
  MODEL_WASHBED_XTC,
  fetchRinseTypeConfig,
  fetchWashbedDetail,
  washbedOp,
  type RinseTypeConfig,
  type WashbedDetail,
} from '../api/washbedApp';

const errText = (e: any): string =>
  e?.retInfo || e?.retMsg || e?.msg || e?.message || (typeof e === 'string' ? e : '请求失败');

/** 设备状态 → 顶部文案（原型「待机中」） */
const STATUS_TEXT: Record<string, string> = {
  idle: '待机中',
  running: '运行中',
  paused: '已暂停',
  error: '离线',
};


/** 模式展示名：速冲按秒标注，其余按分钟 */
const modeLabel = (m: RinseTypeConfig) =>
  m.rinseType === 5 ? `${m.rinseTypeName || '速冲模式'}（90秒）`
    : `${m.rinseTypeName || `模式${m.rinseType}`}${m.rinseTypeMinute ? `(${m.rinseTypeMinute}分钟)` : ''}`;

/** 上次洗头时间：'2026-08-05T15:29:33' → '08.05 15:29' */
const fmtLastWash = (t?: string) => {
  if (!t) return '--';
  const s = t.replace('T', ' ');
  return `${s.slice(5, 10).replace('-', '.')} ${s.slice(11, 16)}`;
};

export function AppWashbedPage() {
  const { user, storeId } = useCraftsmanStore();

  const [devices, setDevices] = useState<DyeDeviceStoreItem[]>([]);
  const [picked, setPicked] = useState('');
  const [detail, setDetail] = useState<WashbedDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [opLoading, setOpLoading] = useState(false);
  const [view, setView] = useState<'control' | 'info'>('control');

  /** 目标水温（−/+ 直接下发 set_temp，本地同步显示） */
  const [targetTemp, setTargetTemp] = useState(38);
  /** 水压强度（本地调节，随「开启」一起下发） */
  const [pressure, setPressure] = useState(2);
  /** 当前模式（随「开启」一起下发） */
  const [mode, setMode] = useState<number>(5);
  const [modes, setModes] = useState<RinseTypeConfig[]>([]);
  /** 模式选择浮层（原型底部 picker） */
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [modeDraft, setModeDraft] = useState(5);

  /** 首次同步设置温度/水压后不再覆盖用户手调值 */
  const syncedRef = useRef(false);

  const refresh = useCallback(async (deviceCode: string) => {
    try {
      const d = await fetchWashbedDetail(deviceCode);
      setDetail(d);
      if (!syncedRef.current) {
        if (d.settingTemperature) setTargetTemp(d.settingTemperature);
        if (d.waterPressure) setPressure(d.waterPressure);
        syncedRef.current = true;
      }
    } catch (e) {
      message.error(errText(e));
    }
  }, []);

  /** 门店下的洗头床列表（model=25） */
  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    queryDyeByModel(storeId, MODEL_WASHBED_XTC)
      .then((list) => {
        setDevices(list);
        setPicked((cur) => (list.some((d) => d.deviceCode === cur) ? cur : list[0]?.deviceCode || ''));
      })
      .catch((e) => message.error(errText(e)))
      .finally(() => setLoading(false));
  }, [storeId]);

  /** 模式配置：只信 getRinseTypeConfig（config_const.rinse_type_config）真实返回，
   *  不做本地兜底——列表里有没有速冲，就是在验证环境配置是否已刷（这正是自测目的）。 */
  useEffect(() => {
    fetchRinseTypeConfig()
      .then((list) => {
        setModes(list);
        // 当前选中模式不在配置里（如速冲配置未刷）时回落到第一条，避免下发环境不认的模式码
        setMode((cur) => (list.some((m) => m.rinseType === cur) ? cur : list[0]?.rinseType ?? cur));
      })
      .catch((e) => message.error(`模式配置读取失败：${errText(e)}`));
  }, []);

  /** 切设备查一次 + 8s 轮询 */
  useEffect(() => {
    if (!picked) {
      setDetail(null);
      return;
    }
    syncedRef.current = false;
    void refresh(picked);
    const timer = setInterval(() => void refresh(picked), 8000);
    return () => clearInterval(timer);
  }, [picked, refresh]);

  const doOp = async (
    action: string,
    label: string,
    extra?: { model?: number; waterPressure?: number; waterTemperature?: number },
  ) => {
    if (!picked) {
      message.warning('请先选择洗头床');
      return;
    }
    setOpLoading(true);
    try {
      await washbedOp({ deviceId: picked, action, ...extra });
      message.success(`${label} 指令已下发`);
      void refresh(picked);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setOpLoading(false);
    }
  };

  /** −/+ 调目标温度并直接下发 set_temp（对齐真实 App 交互） */
  const changeTemp = (delta: number) => {
    const next = Math.min(60, Math.max(20, targetTemp + delta));
    if (next === targetTemp) return;
    setTargetTemp(next);
    void doOp('set_temp', `设置水温 ${next}°C`, { waterTemperature: next });
  };

  const statusText = detail?.connectionStatus === 0
    ? '离线'
    : STATUS_TEXT[detail?.status || ''] || '待机中';
  const online = detail?.connectionStatus === 1;
  const modeItem = modes.find((m) => m.rinseType === mode);

  /* ── 控制页 ─────────────────────────────────────────────────────────── */
  const controlView = (
    <div style={{ background: 'linear-gradient(#dff0fb, #f5f9fd 55%, #f5f5f7)', minHeight: '100%' }}>
      <div style={{ background: '#fde8e8', color: '#e05252', fontSize: 11, lineHeight: '17px', padding: '5px 10px' }}>
        ● 如有同事正在操作洗头床，请先联系同事断开再连接
        <br />
        　 用户如使用造型品会导致难度增加，建议使用中度清洁模式
      </div>

      <div style={{ textAlign: 'center', paddingTop: 14, color: '#2aa1e8', fontWeight: 600 }}>{statusText}</div>

      {/* 温度大圆盘：− / 圆盘 / + */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 8 }}>
        <button
          data-testid="washbed.temp-minus"
          onClick={() => changeTemp(-1)}
          style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: '#eaf4fd', color: '#2f9df0', fontSize: 22, cursor: 'pointer' }}
        >
          −
        </button>
        <div
          style={{
            width: 168, height: 168, borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 35%, #6ebcf5, #3f9ceb)',
            boxShadow: '0 10px 26px rgba(63,156,235,.35), inset 0 0 0 8px rgba(255,255,255,.25)',
            color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 11, background: 'rgba(255,255,255,.28)', borderRadius: 10, padding: '1px 8px' }}>
            实时温度:{detail?.waterTemperature ?? '--'}
          </span>
          <span data-testid="washbed.target-temp" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.25 }}>
            {targetTemp}°
          </span>
          <span style={{ fontSize: 10, opacity: 0.9 }}>冬季建议:40℃</span>
          <span style={{ fontSize: 10, opacity: 0.9 }}>夏季建议:38℃</span>
        </div>
        <button
          data-testid="washbed.temp-plus"
          onClick={() => changeTemp(1)}
          style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: '#eaf4fd', color: '#2f9df0', fontSize: 22, cursor: 'pointer' }}
        >
          +
        </button>
      </div>

      {/* 洗头次数 / 上次洗头时间 */}
      <div style={{ display: 'flex', margin: '14px 12px 0', background: 'rgba(255,255,255,.6)', borderRadius: 10, padding: '8px 0', textAlign: 'center' }}>
        <div style={{ flex: 1, borderRight: '1px solid #e8e8e8' }}>
          <div style={{ fontWeight: 600 }}>{detail?.washCount ?? '--'}</div>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>洗头次数</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{fmtLastWash(detail?.washingStartTime)}</div>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>上次洗头时间</div>
        </div>
      </div>

      {/* WiFi / 当前模式 / 水压强度 */}
      <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 12, padding: '0 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ fontWeight: 600 }}>WiFi状态</span>
          <span style={{ color: '#2f9df0', fontSize: 12 }}>{detail?.wifiName ? `📶 ${detail.wifiName}` : '未上报'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ fontWeight: 600 }}>当前模式</span>
          <button
            data-testid="washbed.mode"
            onClick={() => { setModeDraft(mode); setModePickerOpen(true); }}
            style={{ border: '1px solid #d9d9d9', borderRadius: 6, background: '#fff', padding: '4px 10px', cursor: 'pointer' }}
          >
            {modeItem ? modeLabel(modeItem) : `模式${mode}`} ›
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
          <span style={{ fontWeight: 600 }}>水压强度</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Button size="small" shape="circle" disabled={pressure <= 1} onClick={() => setPressure((p) => p - 1)}>−</Button>
            <span data-testid="washbed.pressure">{pressure}档</span>
            <Button size="small" shape="circle" disabled={pressure >= 4} onClick={() => setPressure((p) => p + 1)}>+</Button>
          </span>
        </div>
      </div>

      {/* 底部操作栏：开启 / 停止 / 消毒 */}
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '18px 0 10px' }}>
        {[
          { key: 'start', icon: '⏻', label: '开启', onClick: () => doOp('start', '开启', { model: mode, waterPressure: pressure, waterTemperature: targetTemp }) },
          { key: 'stop', icon: '⏹', label: '停止', onClick: () => doOp('stop', '停止') },
          { key: 'sterilize', icon: '🛡', label: '消毒', onClick: () => doOp('start', '消毒', { model: 4, waterPressure: pressure, waterTemperature: targetTemp }) },
        ].map((b) => (
          <button
            key={b.key}
            data-testid={`washbed.${b.key}`}
            disabled={opLoading}
            onClick={b.onClick}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#333' }}
          >
            <div style={{ width: 44, height: 44, borderRadius: '50%', border: '1.5px solid #444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, margin: '0 auto 4px' }}>
              {b.icon}
            </div>
            <div style={{ fontSize: 12 }}>{b.label}</div>
          </button>
        ))}
      </div>
    </div>
  );

  /* ── 模式选择浮层（原型底部 picker：取消 / 确定） ───────────────────── */
  const modePicker = modePickerOpen && (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 10 }}>
      <div style={{ background: '#fff', borderRadius: '14px 14px 0 0', paddingBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ cursor: 'pointer', color: '#595959' }} onClick={() => setModePickerOpen(false)}>取消</span>
          <span
            data-testid="washbed.mode-confirm"
            style={{ cursor: 'pointer', fontWeight: 600 }}
            onClick={() => { setMode(modeDraft); setModePickerOpen(false); }}
          >
            确定
          </span>
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '6px 0' }}>
          {modes.map((m) => (
            <div
              key={m.rinseType}
              data-testid={`washbed.mode-${m.rinseType}`}
              onClick={() => setModeDraft(m.rinseType!)}
              style={{
                textAlign: 'center', padding: '10px 0', cursor: 'pointer',
                color: modeDraft === m.rinseType ? '#1f1f1f' : '#bfbfbf',
                background: modeDraft === m.rinseType ? '#f5f5f5' : undefined,
                fontWeight: modeDraft === m.rinseType ? 600 : 400,
              }}
            >
              {modeDraft === m.rinseType
                ? <span style={{ border: '1px solid #d9d9d9', borderRadius: 4, padding: '4px 14px', background: '#fff' }}>{modeLabel(m)}</span>
                : modeLabel(m)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ── 设备信息页（原型图二；添加设备/故障上报不接入） ─────────────────── */
  const infoRow = (label: string, value?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 12px', borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ color: '#595959' }}>{value || '-'}</span>
    </div>
  );

  const infoView = (
    <div style={{ background: '#eef3f8', minHeight: '100%', padding: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 34, lineHeight: 1 }}>🛏️</div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>优剪AI智能洗头床</div>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>洗头次数：{detail?.washCount ?? '--'}</div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontWeight: 600 }}>{user?.defaultStoreName || '-'}</div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>绑定门店</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontWeight: 600, color: online ? '#1f1f1f' : '#ff4d4f' }}>{online ? '已连接' : '未连接'}</div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>设备网络</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', background: '#fff', borderRadius: 10, marginTop: 8, padding: '12px 0', textAlign: 'center' }}>
        <div style={{ flex: 1, borderRight: '1px solid #f0f0f0' }}>
          <div style={{ color: '#2f9df0', fontWeight: 600 }}>{statusText.replace('中', '') || '待机'}</div>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>设备状态</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#ff4d4f', fontWeight: 600 }}>{detail?.waterTemperature ?? '--'}°</div>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>当前水温</div>
        </div>
      </div>

      <div style={{ borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
        {infoRow('操作指南', '›')}
        {infoRow('操作系统版本', detail?.osVersion)}
        {infoRow('设备编号', detail?.sn || picked)}
        {infoRow('固件版本', detail?.firmwareVersion)}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderRadius: 10, marginTop: 8, padding: '12px' }}>
        <span style={{ fontSize: 13 }}>预热排水开关（打开可自动排水预热水温）</span>
        <Switch
          data-testid="washbed.drain-switch"
          checked={detail?.drainStatus === 1}
          loading={opLoading}
          onChange={(checked) =>
            doOp(checked ? 'drain_on' : 'drain_off', checked ? '开启预热排水' : '关闭预热排水')}
        />
      </div>
    </div>
  );

  return (
    <AppSimLayout
      controls={
        <Card size="small" title="联调控制">
          <Space direction="vertical" style={{ width: '100%' }}>
            {!storeId && <Alert type="warning" showIcon message="当前 App 账号无默认门店，无法拉洗头床列表" />}
            <Space>
              <span>洗头床：</span>
              <Select
                style={{ width: 220 }}
                value={picked || undefined}
                placeholder={loading ? '加载中…' : '选择洗头床'}
                options={devices.map((d) => ({
                  value: d.deviceCode!,
                  label: `${d.deviceName || '洗头床'}（${d.deviceCode}）`,
                }))}
                onChange={(v) => setPicked(v)}
              />
              <Button icon={<ReloadOutlined />} onClick={() => picked && void refresh(picked)} />
            </Space>
            {loading ? <Spin /> : devices.length === 0 && storeId && (
              <Alert type="info" showIcon message="该门店暂无已绑定的 AI 洗头床（model=25）" />
            )}
            <Alert
              type="info"
              showIcon
              message="指令走云端 /dye/apiCraftsman/device/op（WiFi 链路）；真机 App 的蓝牙路径自测 UI 不覆盖。数据 8s 轮询刷新。"
            />
          </Space>
        </Card>
      }
    >
      <PhoneFrame
        title={view === 'control' ? 'AI洗头床控制' : '设备信息'}
        onBack={view === 'info' ? () => setView('control') : undefined}
        rightAction={view === 'control'
          ? <span data-testid="washbed.settings" style={{ cursor: 'pointer' }} onClick={() => setView('info')}>设置</span>
          : undefined}
        overlay={modePicker}
      >
        {view === 'control' ? controlView : infoView}
      </PhoneFrame>
    </AppSimLayout>
  );
}
