import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useSession } from '../store/useSession';
import { fetchPcRoleName } from '../api/role';

/**
 * 框架自检页（hidden，需要时在 App.tsx 的 PAGES 里去掉 hidden 或用 __t.nav('框架自检') 进）。
 * 验证三条链路是否通：
 *  1. 环境代理 /env/{env}/** → 各环境网关；
 *  2. 当前端 token 注入（att 头）+ Resp 解包 + 50120/50130 静默续登；
 *  3. 设备模拟器本地服务 /simapi → sim-server(3001)。
 */
export function SmokePage() {
  const { currentEnv, clientMode } = useSession();
  const user = useSession((s) => s.currentUser());

  const [roleResult, setRoleResult] = useState('');
  const [simResult, setSimResult] = useState('');
  const [loading, setLoading] = useState<'role' | 'sim' | null>(null);

  // 带鉴权接口：验证 att 注入 + Resp 解包 + 续登
  const testRole = async () => {
    if (!user) {
      message.warning('先在右上角添加账号');
      return;
    }
    setLoading('role');
    try {
      const name = await fetchPcRoleName(user.uid);
      setRoleResult(`✅ ${dayjs().format('HH:mm:ss')} 角色：${name || '(空)'}`);
    } catch (e: any) {
      setRoleResult(`❌ ${e?.retInfo || e?.message || JSON.stringify(e)}`);
    } finally {
      setLoading(null);
    }
  };

  // 模拟器本地服务：验证 vite proxy /simapi → localhost:3001
  const testSim = async () => {
    setLoading('sim');
    try {
      const r = await fetch('/simapi/devices');
      const body = await r.json();
      setSimResult(`✅ ${dayjs().format('HH:mm:ss')} 在线设备 ${body?.data?.length ?? 0} 个`);
    } catch (e: any) {
      setSimResult(`❌ ${e?.message || '请求失败（sim-server 未启动？）'}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="框架自检页"
        description="验证自测 UI 的基础设施：环境切换、账号登录、token 注入、代理路由、模拟器本地服务。"
      />
      <Card size="small" title="当前会话" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="环境">
            <Tag color="blue">{currentEnv}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="当前端">
            <Tag color={clientMode === 'pc' ? 'geekblue' : clientMode === 'app' ? 'green' : 'orange'}>
              {clientMode}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="账号">
            {user ? `${user.name}（${user.uid}）` : <Typography.Text type="secondary">未登录</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="token 过期">
            {user?.expiresAt ? dayjs(user.expiresAt).format('MM-DD HH:mm') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="token type(iss)">{user?.type ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="默认门店">
            {user?.defaultStoreName ? `${user.defaultStoreName}（${user.defaultStoreId}）` : '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card size="small" title="连通性自检">
        <Space direction="vertical" style={{ display: 'flex' }}>
          <Space>
            <Button type="primary" loading={loading === 'role'} onClick={testRole}>
              带鉴权接口（/uc 查本人角色）
            </Button>
            <span>{roleResult}</span>
          </Space>
          <Space>
            <Button loading={loading === 'sim'} onClick={testSim}>
              模拟器服务（/simapi/devices）
            </Button>
            <span>{simResult}</span>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
