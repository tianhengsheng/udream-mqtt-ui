import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Input, Modal, Popover, Radio, Space, Tabs, Tag, message } from 'antd';
import dayjs from 'dayjs';
import {
  DeleteOutlined,
  DownloadOutlined,
  GlobalOutlined,
  PlusOutlined,
  UploadOutlined,
  UserOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { useSession, type Account, type AccountSnapshot, type ClientMode } from '../store/useSession';
import { ENV_PRESETS } from '../envs';
import { decodeAtToken, isAtTokenExpired, type DecodedAtToken } from '../utils/jwt';
import { loginApp, loginPc, getSelfTestDeviceId } from '../api/auth';
import { fetchCraftsmanRole, fetchPcRoleName, roleLabel } from '../api/role';

const MODE_LABEL: Record<ClientMode, string> = { pc: '后台(PC)', app: 'App(手艺人)', mini: '小程序(mini)' };
const CLIENT_TAG: Record<ClientMode, { color: string; text: string }> = {
  pc: { color: 'geekblue', text: 'PC' },
  app: { color: 'green', text: 'App' },
  mini: { color: 'orange', text: '小程序' },
};
const isExpired = (u?: Account) => !!u?.expiresAt && u.expiresAt < Date.now();

export function TopBar() {
  const {
    currentEnv, setCurrentEnv, setClientMode, users, clientMode,
    pcUserId, appUserId, miniUserId, upsertUser, removeUser, assignSlot, setAccountRole, setAccountRoleName, importSnapshot,
  } = useSession();

  // ---- 账号导出 / 导入（备份、换机器、分享标准测试号；含明文密码，属敏感文件）----
  const fileRef = useRef<HTMLInputElement>(null);
  const doExport = () => {
    const s = useSession.getState();
    const snap = { accountsByEnv: s.accountsByEnv, activeByEnv: s.activeByEnv, _exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `udream-accounts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file) return;
    try {
      const snap = JSON.parse(await file.text()) as AccountSnapshot;
      if (!snap || typeof snap.accountsByEnv !== 'object') throw new Error('文件格式不对（缺 accountsByEnv）');
      importSnapshot(snap, true); // 默认合并（同 id 以导入为准），不清空已有
      const n = Object.values(snap.accountsByEnv).reduce((a, b) => a + (b?.length || 0), 0);
      message.success(`已导入 ${n} 个账号（合并）`);
    } catch (err) {
      message.error('导入失败：' + (err as Error).message);
    }
  };

  const byId = (id: string | null) => users.find((u) => u.id === id);
  const slotUserId = clientMode === 'pc' ? pcUserId : clientMode === 'app' ? appUserId : miniUserId;
  const activeU = byId(slotUserId);
  const activeExpired = isExpired(activeU);

  // ---- 身份弹窗（Tab：PC / App / 小程序） ----
  const [idOpen, setIdOpen] = useState(false);
  const [idTab, setIdTab] = useState<ClientMode>('pc');
  const openIdentity = () => {
    setIdTab(clientMode);
    setIdOpen(true);
  };

  // ---- 新增账号弹窗（Tab：登录 / 粘贴） ----
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<'login' | 'paste'>('login');
  const [slot, setSlot] = useState<ClientMode>('pc');
  const [draft, setDraft] = useState('');
  const [account, setAccount] = useState('');
  const [pwd, setPwd] = useState('');
  const [logging, setLogging] = useState(false);
  const decoded = useMemo<{ ok: true; v: DecodedAtToken } | { ok: false; err: string } | null>(() => {
    if (!draft.trim()) return null;
    try {
      return { ok: true, v: decodeAtToken(draft) };
    } catch (e) {
      return { ok: false, err: (e as Error).message };
    }
  }, [draft]);

  const currentEnvPreset = ENV_PRESETS.find((e) => e.key === currentEnv) || ENV_PRESETS[0];

  const openAdd = (s: ClientMode) => {
    setSlot(s);
    setDraft('');
    setAccount('');
    setPwd('');
    // mini 顾客端自测暂无账号密码登录接口，只能粘贴 token
    setAddTab(s === 'mini' ? 'paste' : 'login');
    setAddOpen(true);
  };

  // 落库 + 切端（clientMode 跟随）；creds=账号密码（登录），store=APP 默认门店；app 端登录后拉一次角色缓存
  const saveIdentity = (
    token: string,
    store?: { storeId?: string; storeName?: string; storeType?: number; isLeadStores?: number; storeRoleType?: number },
    creds?: { account?: string; password?: string },
  ) => {
    const v = decodeAtToken(token);
    // 账号身份 = 端 + uid 复合键：同一 uid 在 PC / App 各占一条，互不覆盖（否则两端会互挤）。
    // uid 仍保留原始雪花值供接口调用；角色回填等按 acctId 定位记录。
    const acctId = `${slot}:${v.uid}`;
    upsertUser(
      {
        id: acctId,
        uid: v.uid,
        name: v.name,
        type: v.type,
        token,
        expiresAt: v.expiresAt,
        account: creds?.account,
        password: creds?.password,
        defaultStoreId: store?.storeId,
        defaultStoreName: store?.storeName,
        defaultStoreType: store?.storeType,
        isLeadStores: store?.isLeadStores,
        storeRoleType: store?.storeRoleType,
      },
      slot,
    );
    setClientMode(slot);
    setAddOpen(false);
    message.success(`已设为「${MODE_LABEL[slot]}」当前身份：${v.name}`);
    // 登录后拉一次角色缓存（此时该 token 已是激活 token，失败静默）：App 取数字角色，PC 取角色名；mini 顾客无角色概念，跳过
    if (slot === 'app') {
      fetchCraftsmanRole(v.uid)
        .then((role) => {
          if (role != null) setAccountRole(acctId, role);
        })
        .catch(() => {});
    } else if (slot === 'pc') {
      fetchPcRoleName(v.uid)
        .then((name) => {
          if (name) setAccountRoleName(acctId, name);
        })
        .catch(() => {});
    }
  };

  const confirmAdd = () => {
    if (!decoded || !decoded.ok) {
      message.error('token 无法解析');
      return;
    }
    saveIdentity(draft.trim());
  };

  const doLogin = async () => {
    if (!account.trim() || !pwd) {
      message.error(slot === 'pc' ? '请输入账号和密码' : '请输入手机号和密码');
      return;
    }
    setLogging(true);
    try {
      const outcome =
        slot === 'pc'
          ? await loginPc(account.trim(), pwd)
          : await loginApp(account.trim(), pwd, getSelfTestDeviceId());
      saveIdentity(
        outcome.token,
        {
          storeId: outcome.storeId,
          storeName: outcome.storeName,
          storeType: outcome.storeType,
          isLeadStores: outcome.isLeadStores,
          storeRoleType: outcome.storeRoleType,
        },
        { account: account.trim(), password: pwd },
      );
    } catch (e) {
      if (e instanceof Error && e.message && !/^\[/.test(e.message)) message.error(e.message);
    } finally {
      setLogging(false);
    }
  };

  // ============ 环境切换 Popover ============
  const envContent = (
    <Radio.Group
      value={currentEnv}
      onChange={(e) => {
        setCurrentEnv(e.target.value);
        message.success(`已切到 ${ENV_PRESETS.find((p) => p.key === e.target.value)?.label}`);
      }}
    >
      <Space direction="vertical" size={4}>
        {ENV_PRESETS.map((e) => (
          <Radio key={e.key} value={e.key}>
            <Space size={6}>
              <strong>{e.label}</strong>
              <span style={{ color: '#999', fontSize: 12 }}>{e.target}</span>
            </Space>
          </Radio>
        ))}
      </Space>
    </Radio.Group>
  );

  // ============ 某端账号面板（Tab 内容，单端独占整行） ============
  const SlotPanel = ({ mode }: { mode: ClientMode }) => {
    const list = users.filter((u) => u.mode === mode);
    const activeId = mode === 'pc' ? pcUserId : mode === 'app' ? appUserId : miniUserId;
    return (
      <div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          {mode === 'pc' ? 'PC 后台页用该端 token。' : mode === 'app' ? 'App 手艺人页用该端 token。' : '小程序顾客端用该端 token（无账号密码，仅支持粘贴 token）；未设置时门店商城页自动借用 App/PC token。'}
          单选选中即设为该端激活账号。
        </div>
        {list.length === 0 ? (
          <Alert type="info" showIcon message={`未添加${MODE_LABEL[mode]}账号`} style={{ marginBottom: 8 }} />
        ) : (
          <Radio.Group
            value={activeId ?? undefined}
            style={{ display: 'block', width: '100%' }}
            onChange={(e) => {
              assignSlot(mode, e.target.value);
              message.success(`「${MODE_LABEL[mode]}」已切到：${byId(e.target.value)?.name ?? ''}`);
            }}
          >
            <Space direction="vertical" size={8} style={{ display: 'flex' }}>
              {list.map((u) => {
                const active = activeId === u.id;
                return (
                  <div
                    key={u.id}
                    style={{
                      border: `1px solid ${active ? '#1677ff' : '#f0f0f0'}`,
                      background: active ? '#f0f7ff' : '#fff',
                      borderRadius: 8,
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <Radio value={u.id} style={{ marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0, lineHeight: 1.6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 13 }}>{u.name}</b>
                        {mode === 'app' && u.role != null && <Tag color="purple">{roleLabel(u.role)}</Tag>}
                        {mode === 'pc' && u.roleName && <Tag color="geekblue">{u.roleName}</Tag>}
                        {active && clientMode === mode && <Tag color="blue">当前页用</Tag>}
                        {isExpired(u) && <Tag color="warning">过期</Tag>}
                      </div>
                      <div style={{ color: '#999', fontSize: 11, fontFamily: 'monospace' }}>{u.uid}</div>
                      {mode === 'app' && u.defaultStoreName && (
                        <div style={{ color: '#666', fontSize: 12 }}>
                          <ShopOutlined style={{ marginRight: 4 }} />
                          {u.defaultStoreName}
                        </div>
                      )}
                      {u.account && (
                        <div style={{ color: '#999', fontSize: 12 }}>
                          {mode === 'pc' ? '账号' : '手机号'}：{u.account}
                          {u.password ? '　密码：' + u.password : ''}
                        </div>
                      )}
                    </div>
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeUser(u.id)}
                    />
                  </div>
                );
              })}
            </Space>
          </Radio.Group>
        )}
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          block
          style={{ marginTop: 10 }}
          onClick={() => openAdd(mode)}
        >
          新增{MODE_LABEL[mode]}账号
        </Button>
      </div>
    );
  };

  return (
    <div
      style={{
        padding: '8px 16px',
        borderBottom: '1px solid #f0f0f0',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Popover content={envContent} title="切换环境" trigger="click" placement="bottomLeft">
        <Button size="small" icon={<GlobalOutlined />}>
          {currentEnvPreset.label}
        </Button>
      </Popover>

      <Button size="small" icon={<UserOutlined />} danger={activeExpired} style={{ marginLeft: 'auto' }} onClick={openIdentity}>
        <Tag color={CLIENT_TAG[clientMode].color} style={{ marginRight: 4 }}>
          {CLIENT_TAG[clientMode].text}
        </Tag>
        {activeU ? (
          <>
            {activeU.name}
            {activeExpired && <span style={{ marginLeft: 4 }}>⚠</span>}
          </>
        ) : (
          <span style={{ color: '#999' }}>未设置{MODE_LABEL[clientMode]}token</span>
        )}
      </Button>

      {/* 身份与角色：Tab 分 PC / App，单端独占整行 */}
      <Modal title="身份与角色（双端 token）" open={idOpen} onCancel={() => setIdOpen(false)} footer={null} width={460} destroyOnHidden>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Button size="small" icon={<DownloadOutlined />} onClick={doExport}>
            导出
          </Button>
          <Button size="small" icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
            导入
          </Button>
          <span style={{ color: '#999', fontSize: 12 }}>按环境分桶，含明文密码，妥善保管</span>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={onImportFile} />
        </div>
        <Tabs
          activeKey={idTab}
          onChange={(k) => setIdTab(k as ClientMode)}
          items={[
            {
              key: 'pc',
              label: (
                <span>
                  <Tag color="geekblue" style={{ marginInlineEnd: 4 }}>PC</Tag>后台
                </span>
              ),
              children: <SlotPanel mode="pc" />,
            },
            {
              key: 'app',
              label: (
                <span>
                  <Tag color="green" style={{ marginInlineEnd: 4 }}>App</Tag>手艺人
                </span>
              ),
              children: <SlotPanel mode="app" />,
            },
            {
              key: 'mini',
              label: (
                <span>
                  <Tag color="orange" style={{ marginInlineEnd: 4 }}>小程序</Tag>顾客
                </span>
              ),
              children: <SlotPanel mode="mini" />,
            },
          ]}
        />
      </Modal>

      {/* 新增账号：Tab 登录 / 粘贴 token */}
      <Modal
        title={`设置「${MODE_LABEL[slot]}」身份`}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        footer={null}
        width={560}
        destroyOnHidden
      >
        <Tabs
          activeKey={addTab}
          onChange={(k) => setAddTab(k as 'login' | 'paste')}
          items={[
            // mini 顾客端自测暂无账号密码登录接口，只保留「粘贴 token」
            ...(slot === 'mini' ? [] : [{
              key: 'login',
              label: '账号密码登录',
              children: (
                <div>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={`调用 ${slot === 'pc' ? '/uc/user/login' : '/basics/craftsman/login'}，成功后自动解析 token、拉角色，并设为「${MODE_LABEL[slot]}」当前身份。`}
                  />
                  <Space direction="vertical" size={10} style={{ display: 'flex' }}>
                    <Input
                      placeholder={slot === 'pc' ? '账号' : '手机号'}
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      onPressEnter={doLogin}
                      allowClear
                      autoFocus
                    />
                    <Input.Password
                      placeholder="密码"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      onPressEnter={doLogin}
                    />
                    <Button type="primary" block loading={logging} onClick={doLogin}>
                      登录并设为「{MODE_LABEL[slot]}」当前身份
                    </Button>
                  </Space>
                </div>
              ),
            }]),
            {
              key: 'paste',
              label: '粘贴 token',
              children: (
                <div>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="从浏览器/App 登录态抓 att header 的值粘贴。前端只 base64 decode payload 展示，不验签。"
                  />
                  <Input.TextArea
                    rows={4}
                    placeholder="xxx.yyy.zzz"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {decoded && decoded.ok === false && (
                    <Alert type="error" style={{ marginTop: 12 }} message="解析失败" description={decoded.err} />
                  )}
                  {decoded && decoded.ok === true && (
                    <Descriptions size="small" column={2} bordered style={{ marginTop: 12 }} title="解析结果">
                      <Descriptions.Item label="uid">{decoded.v.uid}</Descriptions.Item>
                      <Descriptions.Item label="name">{decoded.v.name}</Descriptions.Item>
                      <Descriptions.Item label="type">{decoded.v.type}</Descriptions.Item>
                      <Descriptions.Item label="过期时间">
                        {decoded.v.expiresAt
                          ? dayjs(decoded.v.expiresAt).format('YYYY-MM-DD HH:mm:ss') +
                            (isAtTokenExpired(draft) ? ' ⚠️ 已过期' : '')
                          : '—'}
                      </Descriptions.Item>
                    </Descriptions>
                  )}
                  <Button
                    type="primary"
                    block
                    style={{ marginTop: 12 }}
                    disabled={!decoded || !decoded.ok}
                    onClick={confirmAdd}
                  >
                    保存为「{MODE_LABEL[slot]}」当前身份
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}
