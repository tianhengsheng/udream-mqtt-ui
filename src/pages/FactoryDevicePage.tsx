import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Space } from 'antd';
import { CloudSyncOutlined, LoadingOutlined } from '@ant-design/icons';
import { PhoneFrame } from '../app-mobile/PhoneFrame';
import { AppSimLayout } from '../app-mobile/AppSimLayout';
import { useSession } from '../store/useSession';
import { promptLogin } from '../api/client';
import {
  fetchCloudEnvList,
  fetchOnlineAll,
  findSimDevice,
  getSimDevice,
  NO_SIM_SWITCH,
  simulateSwitch,
  type CloudEnv,
  type EnvOnlineResult,
} from '../api/dyeFactory';

/**
 * 出厂APP → 设备详情（无源码，照截图复刻；只做设备编码标题 + 「云端环境切换」）。
 * 真实 App 经蓝牙连上设备拿到设备编码、确认切换时蓝牙写入设备；浏览器无蓝牙，
 * 设备编码由右侧「模拟蓝牙已连接」输入；确认切换改由设备模拟器把同 SN 的模拟设备改连所选环境 broker，
 * 再轮询在线状态直到落到新环境（uat / prod 不模拟）。模拟器里没有该 SN 视为真机：不支持切换（只能出厂 App 蓝牙切）。
 */

/** 供测试钩子读取的页面状态（__t.factory.state） */
export const factoryPageState: {
  deviceCode: string;
  envs: CloudEnv[];
  online: EnvOnlineResult[];
  loading: boolean;
  dialogOpen: boolean;
  selected: string | null;
  switching: boolean;
  switchError: string | null;
  /** 是否模拟设备（模拟器里有该 SN）；null=未识别 */
  isSim: boolean | null;
  error: string | null;
} = {
  deviceCode: '',
  envs: [],
  online: [],
  loading: false,
  dialogOpen: false,
  selected: null,
  switching: false,
  switchError: null,
  isSim: null,
  error: null,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 模拟切换后轮询在线：间隔 / 次数（设备重连 + 首帧 status 建 SN 索引需几秒） */
const POLL_INTERVAL = 3000;
const POLL_TIMES = 6;

const DEVICE_KEY = 'mqtt-ui-factory-device-code';

export function FactoryDevicePage() {
  const factoryToken = useSession((s) => s.users.find((u) => u.id === s.factoryUserId)?.token);
  const currentEnv = useSession((s) => s.currentEnv);
  const [codeDraft, setCodeDraft] = useState(() => localStorage.getItem(DEVICE_KEY) || '');
  const [deviceCode, setDeviceCode] = useState(() => localStorage.getItem(DEVICE_KEY) || '');
  const [envs, setEnvs] = useState<CloudEnv[]>([]);
  const [online, setOnline] = useState<EnvOnlineResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isSim, setIsSim] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  Object.assign(factoryPageState, {
    deviceCode, envs, online, loading, dialogOpen, selected, switching, switchError, isSim, error,
  });

  const refresh = useCallback(async (): Promise<EnvOnlineResult[]> => {
    if (!deviceCode) return [];
    if (!factoryToken) {
      // 同其他页：没登录弹「未登录 · 去登录」
      setEnvs([]);
      setOnline([]);
      promptLogin();
      return [];
    }
    setLoading(true);
    setError(null);
    findSimDevice(deviceCode).then((id) => setIsSim(!!id));
    try {
      const list = await fetchCloudEnvList();
      setEnvs(list);
      const res = await fetchOnlineAll(list, deviceCode);
      setOnline(res);
      return res;
    } catch (e) {
      const b = e as { retCode?: string; retMsg?: string; message?: string };
      setError(b?.retCode ? `[${b.retCode}] ${b.retMsg ?? ''}` : b?.message || '查询失败');
      setEnvs([]);
      setOnline([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [deviceCode, factoryToken, currentEnv]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onlineEnv = envs.find((e) => online.find((o) => o.code === e.code)?.status === 'online');
  // 已有结果时刷新不闪「查询中」
  const statusText = !deviceCode ? '未知' : onlineEnv ? onlineEnv.name : loading && online.length === 0 ? '查询中' : '未知';

  /** 连接设备：编码不变时也重新查询（否则停留在上次结果） */
  const connect = () => {
    localStorage.setItem(DEVICE_KEY, codeDraft);
    if (codeDraft === deviceCode) refresh();
    else setDeviceCode(codeDraft);
  };

  const openDialog = () => {
    setSelected(null);
    setSwitchError(null);
    setDialogOpen(true);
    refresh();
  };

  const confirm = async () => {
    const env = envs.find((e) => e.code === selected);
    if (!env || switching || isSim === false) return;
    if (NO_SIM_SWITCH.has(env.code)) {
      setSwitchError(`自测 UI 不模拟切到${env.name}环境`);
      return;
    }
    setSwitchError(null);
    setSwitching(true);
    try {
      await simulateSwitch(deviceCode, env);
      const addr = `${env.host}:${env.port}`;
      let last: EnvOnlineResult | undefined;
      for (let i = 0; i < POLL_TIMES; i++) {
        await sleep(POLL_INTERVAL);
        last = (await refresh()).find((o) => o.code === env.code);
        if (last?.status === 'online') {
          setDialogOpen(false);
          return;
        }
        // 设备已连上 broker 但该环境查不了在线（如未部署 / 未登录）：不再等，直接说明
        const sim = await getSimDevice(deviceCode);
        const connected = sim?.connectionStatus === 'connected' && `${sim.mqttHost}:${sim.mqttPort}` === addr;
        if (connected && last?.status === 'unavailable') {
          setSwitchError(`设备已连上${env.name}，但该环境暂无法查询在线状态（${last.reason ?? '未知原因'}）`);
          return;
        }
      }
      // 超时：以模拟器真实连接状态区分「没连上 broker」与「连上了但后端未识别在线」
      const sim = await getSimDevice(deviceCode);
      const connected = sim?.connectionStatus === 'connected' && `${sim.mqttHost}:${sim.mqttPort}` === addr;
      setSwitchError(
        connected
          ? `设备已连上${env.name}，但该环境后端未识别为在线（可能未收到首帧上报或 dye 服务异常）`
          : `设备未能连上${env.name}（${addr}），请检查模拟器日志`,
      );
    } catch (e) {
      setSwitchError((e as Error).message);
    } finally {
      setSwitching(false);
    }
  };

  const dialog = dialogOpen && (
    <div className="fx-mask" data-testid="factory-env-mask" onClick={() => !switching && setDialogOpen(false)}>
      <div className="fx-dialog" data-testid="factory-env-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="fx-dialog-icon">
          <CloudSyncOutlined />
        </div>
        <div className="fx-dialog-title">云端环境切换</div>
        <div className="fx-dialog-sub">选择设备要连接的云端环境</div>
        <div className={`fx-env-list${switching ? ' switching' : ''}`}>
          {envs.map((e) => {
            const isOnline = online.find((o) => o.code === e.code)?.status === 'online';
            return (
              <div
                key={e.code}
                className="fx-env-item"
                data-testid={`factory-env-option-${e.code}`}
                onClick={() => {
                  if (switching) return;
                  setSelected(e.code);
                  setSwitchError(null);
                }}
              >
                <span className={`fx-radio${selected === e.code ? ' checked' : ''}`} />
                <div className="fx-env-text">
                  <div className="fx-env-name">
                    {e.name}
                    {isOnline && (
                      <span className="fx-online" data-testid={`factory-env-online-${e.code}`}>
                        在线
                      </span>
                    )}
                  </div>
                  <div className="fx-env-host">
                    {e.host}:{e.port}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {isSim === false && (
          <div className="fx-switch-note" data-testid="factory-env-real-device">
            真机不支持在自测 UI 切换，请用出厂 App 蓝牙切换
          </div>
        )}
        {switchError && (
          <div className="fx-switch-error" data-testid="factory-env-error">
            {switchError}
          </div>
        )}
        <button
          className={`fx-confirm${selected && isSim !== false ? ' active' : ''}`}
          data-testid="factory-env-confirm"
          disabled={!selected || switching || isSim === false}
          onClick={confirm}
        >
          {switching ? (
            <>
              <LoadingOutlined style={{ marginRight: 8 }} />
              切换中…
            </>
          ) : (
            '确认切换'
          )}
        </button>
      </div>
    </div>
  );

  const controls = (
    <Space direction="vertical" size={10} style={{ display: 'flex' }}>
      <div style={{ fontSize: 12, color: '#888' }}>模拟蓝牙已连接的设备编码（真实 App 由蓝牙读取）</div>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          data-testid="factory-device-code-input"
          placeholder="设备编码，如 0400015"
          value={codeDraft}
          onChange={(e) => setCodeDraft(e.target.value.trim())}
          onPressEnter={connect}
        />
        <Button
          type="primary"
          data-testid="factory-device-connect"
          onClick={connect}
        >
          连接
        </Button>
      </Space.Compact>
      {error && <Alert type="error" showIcon message={error} />}
    </Space>
  );

  return (
    <AppSimLayout controls={controls}>
      <PhoneFrame title={deviceCode || '未连接设备'} onBack={() => {}} overlay={dialog}>
        <div className="m-section-title">功能</div>
        <div className="fx-func-item" data-testid="factory-env-switch-item" onClick={() => {
            if (!deviceCode) return;
            if (!factoryToken) promptLogin();
            else openDialog();
          }}>
          <span className="fx-func-icon">
            <CloudSyncOutlined />
          </span>
          <span className="fx-func-name">云端环境切换</span>
          <span className="fx-func-value" data-testid="factory-env-switch-value">
            {statusText}
          </span>
        </div>
      </PhoneFrame>
    </AppSimLayout>
  );
}
