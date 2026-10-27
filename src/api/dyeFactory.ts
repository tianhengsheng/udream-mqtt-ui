/**
 * APP智染出厂工具接口（dye-service DyeFactoryController，token 类型 DYE_FACTORY）。
 *
 *  - POST /dye/apiCraftsman/factory/login               → 见 auth.ts loginFactory
 *  - GET  /dye/apiCraftsman/factory/cloudEnvList        → 环境列表（config_const dye_factory_cloud_env_cnf）
 *  - GET  /dye/apiCraftsman/factory/deviceOnlineStatus  → 设备在「本环境」是否在线
 *
 * 在线判断（方案 A）：每个环境后端只知道设备在不在自己那，所以要按环境并发查，
 * 哪个环境返回 online=true 就是设备当前所在环境。真实 App 按 apiBaseUrl 直连各环境网关；
 * 本 UI 映射到同名环境预设走 vite proxy，uat / prod 不访问（标「未接入」）。
 * 目标环境用它自己的出厂 token：该环境已有出厂账号用之，否则用当前出厂账号的账号密码隐式登录（同 App）。
 */
import { http } from './client';
import { loginFactory } from './auth';
import { bucketKey, ENV_PRESETS, type EnvKey } from '../envs';
import { useSession, type Account } from '../store/useSession';
import type { Resp } from '../types';

/** 云端环境（后端 DyeFactoryCloudEnvVO） */
export interface CloudEnv {
  code: string;
  name: string;
  host: string;
  port: number;
  apiBaseUrl: string;
}

/** 设备在线状态（后端 DyeFactoryDeviceOnlineVO；lastReportTime 为毫秒字符串） */
export interface DeviceOnline {
  deviceCode: string;
  online: boolean;
  lastReportTime: string | null;
}

/** 某环境的查询结果：online / offline / 不可用（未接入、未登录、接口失败） */
export interface EnvOnlineResult {
  code: string;
  uiEnv: EnvKey | null;
  status: 'online' | 'offline' | 'unavailable';
  reason?: string;
  lastReportTime?: string | null;
}

const BASE = '/dye/apiCraftsman/factory';

export async function fetchCloudEnvList(): Promise<CloudEnv[]> {
  const res = await http.get<Resp<CloudEnv[]>>(`${BASE}/cloudEnvList`);
  return res.data?.result ?? [];
}

/**
 * 环境编码 → 本 UI 环境预设。dev 编码在「本地」下映射到 local（本地与 dev 共用 Redis，在线状态一致）；
 * uat / prod 无预设返回 null。
 */
export function uiEnvOf(code: string): EnvKey | null {
  const current = useSession.getState().currentEnv;
  if (code === 'dev') return current === 'local' ? ('local' as EnvKey) : ('dev' as EnvKey);
  const hit = ENV_PRESETS.find((e) => e.key === code);
  return hit ? (hit.key as EnvKey) : null;
}

/** 目标环境桶里激活的出厂账号 */
function factoryAccountOf(env: EnvKey): Account | undefined {
  const s = useSession.getState();
  const bk = bucketKey(env);
  const id = s.activeByEnv[bk]?.factoryUserId;
  return (s.accountsByEnv[bk] || []).find((u) => u.id === id);
}

/** 隐式登录得到的跨环境 token，仅内存保存（不写入其他环境账号桶） */
const implicitTokens = new Map<string, string>();

async function tokenFor(env: EnvKey): Promise<string> {
  const own = factoryAccountOf(env);
  if (own?.token && (!own.expiresAt || own.expiresAt > Date.now())) return own.token;
  const cached = implicitTokens.get(env);
  if (cached) return cached;
  const cur = useSession.getState().factoryUser();
  if (!cur?.account || !cur?.password) throw new Error('该环境无出厂账号，且当前账号无密码无法隐式登录');
  const { token } = await loginFactory(cur.account, cur.password, env);
  implicitTokens.set(env, token);
  return token;
}

/** 查设备在指定 UI 环境是否在线 */
export async function fetchDeviceOnline(env: EnvKey, deviceCode: string): Promise<DeviceOnline> {
  const att = await tokenFor(env);
  const res = await http.get<Resp<DeviceOnline>>(`/env/${env}${BASE}/deviceOnlineStatus`, {
    params: { deviceCode },
    _att: att,
    _silent: true,
  });
  const r = res.data?.result;
  if (!r) throw new Error('无返回');
  return r;
}

/** 按环境列表并发查在线 */
export async function fetchOnlineAll(envs: CloudEnv[], deviceCode: string): Promise<EnvOnlineResult[]> {
  return Promise.all(
    envs.map(async (e): Promise<EnvOnlineResult> => {
      const uiEnv = uiEnvOf(e.code);
      if (!uiEnv) return { code: e.code, uiEnv, status: 'unavailable', reason: '未接入' };
      try {
        const r = await fetchDeviceOnline(uiEnv, deviceCode);
        return { code: e.code, uiEnv, status: r.online ? 'online' : 'offline', lastReportTime: r.lastReportTime };
      } catch (err) {
        implicitTokens.delete(uiEnv); // token 可能失效，下次重登
        const body = err as { retCode?: string; retMsg?: string; message?: string; response?: { status?: number } };
        const reason = body?.retCode
          ? `[${body.retCode}] ${body.retMsg ?? ''}`
          : body?.response?.status
            ? `HTTP ${body.response.status}`
            : body?.message || '查询失败';
        return { code: e.code, uiEnv, status: 'unavailable', reason };
      }
    }),
  );
}
