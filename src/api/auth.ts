import type { AxiosResponse } from 'axios';
import { http } from './client';
import { bigIntSafeParse } from './common';
import { decodeAtToken } from '../utils/jwt';
import { useSession, type Account } from '../store/useSession';
import type { Resp } from '../types';

/**
 * 账号密码登录。两端登录接口不同：
 *  - PC 后台：POST /uc/user/login（account+pwd，@RequestParam，form body 即可）
 *  - APP 手艺人：POST /basics/craftsman/login（JSON：mobile+password+deviceId）
 *
 * 两端密码均为「明文上送、服务端 MD5 比对」，手机号由服务端 @EncryptMethod AOP 自行 DES 加密匹配库，
 * 故前端无需任何加解密。成功响应里的 result.token 就是完整 att 值（DES前缀+bearer_+JWT），
 * 直接交给 decodeAtToken 解析、作为后续请求头 att，与「粘贴 token」完全同一收口。
 */

/** 登录返回里关心的字段：token + APP 登录时的默认门店（storeId 为 19 位雪花 id，需 bigint-safe 保精度）。 */
interface LoginResult {
  token?: string;
  storeId?: string;
  defaultStore?: {
    storeId?: string;
    storeName?: string;
    storeType?: number; // 门店类别（工作台 storeType 参数）
    storeRoleType?: number; // 该手艺人在此门店的角色：1 店长 / 0 手艺人
    newStoreRoleType?: number;
  };
  storeName?: string;
  isLeadStores?: number; // 是否 M1
}

/**
 * 登录结果：token + (APP) 默认门店及角色/门店信息。
 * 供 useCraftsmanStore 直接用门店，App 页用 storeType/isLeadStores/storeRoleType 推默认参数。
 */
export interface LoginOutcome {
  token: string;
  storeId?: string;
  storeName?: string;
  storeType?: number;
  isLeadStores?: number;
  storeRoleType?: number;
}

/**
 * 从登录响应取 att token。两条来源：
 *  - PC：在 body 的 result.token（user.setToken 写入）
 *  - APP：body 里没有，token 只通过 Set-Cookie(att=...) 下发；vite proxy 已把它抽成可读响应头 x-app-token
 * 优先 body，回落 header，兼容两端。
 */
function extractToken(res: AxiosResponse<Resp<LoginResult>>): string {
  const body = res.data;
  const fromBody = (body?.result ?? body?.data)?.token;
  const fromHeader = (res.headers as Record<string, string> | undefined)?.['x-app-token'];
  const token = fromBody || fromHeader;
  if (!token) throw new Error('登录成功但未取到 token（body 无 token 且响应头 x-app-token 缺失）');
  return token;
}

/** PC 后台登录 → 仅 token（PC 页不需要门店）。account/pwd 用 form body 发，避免密码出现在 URL/请求日志里。 */
export async function loginPc(account: string, pwd: string): Promise<LoginOutcome> {
  const form = new URLSearchParams();
  form.set('account', account);
  form.set('pwd', pwd);
  const res = await http.post<Resp<LoginResult>>('/uc/user/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    _skipReauth: true,
  });
  return { token: extractToken(res) };
}

/**
 * APP 手艺人登录 → token（来自响应头 x-app-token）+ 默认门店。mobile/password 明文，deviceId 必填。
 * 顺带取出 LoginInfo 的默认门店(storeId/storeName)，供前端直接用作操作门店，避免再调会被网关拦的 getCraftsmanToStore。
 * 用 bigint-safe 解析保 storeId 19 位雪花 id 精度。
 */
export async function loginApp(mobile: string, password: string, deviceId: string): Promise<LoginOutcome> {
  const res = await http.post<Resp<LoginResult>>(
    '/basics/craftsman/login',
    { mobile, password, deviceId },
    { transformResponse: [bigIntSafeParse], _skipReauth: true },
  );
  const r = (res.data?.result ?? res.data?.data) as LoginResult | undefined;
  const ds = r?.defaultStore;
  const storeId = r?.storeId != null ? String(r.storeId) : ds?.storeId != null ? String(ds.storeId) : undefined;
  const storeName = ds?.storeName ?? r?.storeName ?? undefined;
  return {
    token: extractToken(res),
    storeId,
    storeName,
    storeType: ds?.storeType,
    isLeadStores: r?.isLeadStores,
    storeRoleType: ds?.storeRoleType ?? ds?.newStoreRoleType,
  };
}

/**
 * APP 登录必填的 deviceId（自测场景无真实设备号）：首次随机生成一个稳定值存 localStorage，
 * 之后固定复用，避免每次登录变化触发后端按设备的风控/挤下线逻辑。
 */
export function getSelfTestDeviceId(): string {
  const KEY = 'udream-mqtt-ui-deviceId';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'mqtt-ui-selftest-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(KEY, id);
  }
  return id;
}

// 单飞去重：同一账号并发的多个 401/过期共用一次续登，避免登录风暴 & 自我递归
const reloginInFlight = new Map<string, Promise<string | null>>();

/**
 * 静默续登：用 Account 已存的账号密码重新登录，更新 session 里该账号的 token/expiresAt(+门店)，返回新 token。
 * - 粘贴账号（无账号密码）→ 返回 null（无法续登，过期就过期）。
 * - 登录失败（账号/密码错、网络）→ 透出异常（loginPc/loginApp 的响应拦截器已弹错），调用方据此提示。
 * - 不改 clientMode，只刷新该账号 token（upsertUser 合并保留角色等字段）。
 */
export function silentRelogin(acc: Account): Promise<string | null> {
  if (!acc.account || !acc.password) return Promise.resolve(null);
  const existing = reloginInFlight.get(acc.id);
  if (existing) return existing;
  const run = (async () => {
    const outcome =
      acc.mode === 'pc'
        ? await loginPc(acc.account!, acc.password!)
        : await loginApp(acc.account!, acc.password!, getSelfTestDeviceId());
    const v = decodeAtToken(outcome.token);
    useSession.getState().upsertUser(
      {
        id: acc.id,
        uid: acc.uid,
        name: v.name,
        type: v.type,
        token: outcome.token,
        expiresAt: v.expiresAt,
        account: acc.account,
        password: acc.password,
        role: acc.role,
        defaultStoreId: outcome.storeId ?? acc.defaultStoreId,
        defaultStoreName: outcome.storeName ?? acc.defaultStoreName,
        defaultStoreType: outcome.storeType ?? acc.defaultStoreType,
        isLeadStores: outcome.isLeadStores ?? acc.isLeadStores,
        storeRoleType: outcome.storeRoleType ?? acc.storeRoleType,
      },
      acc.mode,
    );
    return outcome.token;
  })();
  const wrapped = run.finally(() => reloginInFlight.delete(acc.id));
  reloginInFlight.set(acc.id, wrapped);
  return wrapped;
}
