import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Space, message } from 'antd';
import { CloudSyncOutlined } from '@ant-design/icons';
import { PhoneFrame } from '../app-mobile/PhoneFrame';
import { AppSimLayout } from '../app-mobile/AppSimLayout';
import { useSession } from '../store/useSession';
import { fetchCloudEnvList, fetchOnlineAll, type CloudEnv, type EnvOnlineResult } from '../api/dyeFactory';

/**
 * 出厂APP → 设备详情（无源码，照截图复刻；只做设备编码标题 + 「云端环境切换」）。
 * 真实 App 经蓝牙连上设备拿到设备编码、确认切换时蓝牙写入设备；浏览器无蓝牙，
 * 设备编码由右侧「模拟蓝牙已连接」输入，确认切换只提示不执行（见 README 与原页面差异）。
 */

/** 供测试钩子读取的页面状态（__t.factory.state） */
export const factoryPageState: {
  deviceCode: string;
  envs: CloudEnv[];
  online: EnvOnlineResult[];
  loading: boolean;
  dialogOpen: boolean;
  selected: string | null;
  error: string | null;
} = { deviceCode: '', envs: [], online: [], loading: false, dialogOpen: false, selected: null, error: null };

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
  const [error, setError] = useState<string | null>(null);

  Object.assign(factoryPageState, { deviceCode, envs, online, loading, dialogOpen, selected, error });

  const refresh = useCallback(async () => {
    if (!deviceCode || !factoryToken) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchCloudEnvList();
      setEnvs(list);
      setOnline(await fetchOnlineAll(list, deviceCode));
    } catch (e) {
      const b = e as { retCode?: string; retMsg?: string; message?: string };
      setError(b?.retCode ? `[${b.retCode}] ${b.retMsg ?? ''}` : b?.message || '查询失败');
      setEnvs([]);
      setOnline([]);
    } finally {
      setLoading(false);
    }
  }, [deviceCode, factoryToken, currentEnv]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onlineEnv = envs.find((e) => online.find((o) => o.code === e.code)?.status === 'online');
  const statusText = !deviceCode ? '未知' : loading ? '查询中' : onlineEnv ? onlineEnv.name : '未知';

  const openDialog = () => {
    setSelected(null);
    setDialogOpen(true);
    refresh();
  };

  const confirm = () => {
    if (!selected) return;
    message.info('需通过蓝牙写入设备，自测 UI 不执行');
    setDialogOpen(false);
  };

  const dialog = dialogOpen && (
    <div className="fx-mask" data-testid="factory-env-mask" onClick={() => setDialogOpen(false)}>
      <div className="fx-dialog" data-testid="factory-env-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="fx-dialog-icon">
          <CloudSyncOutlined />
        </div>
        <div className="fx-dialog-title">云端环境切换</div>
        <div className="fx-dialog-sub">选择设备要连接的云端环境</div>
        <div className="fx-env-list">
          {envs.map((e) => {
            const isOnline = online.find((o) => o.code === e.code)?.status === 'online';
            return (
              <div
                key={e.code}
                className="fx-env-item"
                data-testid={`factory-env-option-${e.code}`}
                onClick={() => setSelected(e.code)}
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
        <button
          className={`fx-confirm${selected ? ' active' : ''}`}
          data-testid="factory-env-confirm"
          disabled={!selected}
          onClick={confirm}
        >
          确认切换
        </button>
      </div>
    </div>
  );

  const controls = (
    <Space direction="vertical" size={10} style={{ display: 'flex' }}>
      {!factoryToken && <Alert type="warning" showIcon message="未设置出厂工具身份：点顶部身份 →「出厂工具」登录或粘贴 token" />}
      <div style={{ fontSize: 12, color: '#888' }}>模拟蓝牙已连接的设备编码（真实 App 由蓝牙读取）</div>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          data-testid="factory-device-code-input"
          placeholder="设备编码，如 0400015"
          value={codeDraft}
          onChange={(e) => setCodeDraft(e.target.value.trim())}
          onPressEnter={() => {
            setDeviceCode(codeDraft);
            localStorage.setItem(DEVICE_KEY, codeDraft);
          }}
        />
        <Button
          type="primary"
          data-testid="factory-device-connect"
          onClick={() => {
            setDeviceCode(codeDraft);
            localStorage.setItem(DEVICE_KEY, codeDraft);
          }}
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
        <div className="fx-func-item" data-testid="factory-env-switch-item" onClick={() => deviceCode && openDialog()}>
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
