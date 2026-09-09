import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { message, Modal } from 'antd';
import { useSession, SLOT_KEY, type Account } from '../store/useSession';

// 给请求 config 加四个内部标记：
//  _skipReauth：登录请求自身带，避免续登逻辑对它生效（防自我递归/死锁）。
//  _retried：已为续登重试过一次，防 401→续登→又 401 的无限循环。
//  _silent：接口预期可能未实现/允许失败（如 MALL-05 价格试算，调用方自带本地兜底），失败时不弹全局错误提示；
//    遇到 token 过期码 / 401 / 403 也不续登、不弹「重新登录」（借用身份过期不该打断当前身份）。
//  _useStaffToken：网关对小程序顾客 token 是「全拦 + 白名单放行」（见 common-at PlatformTypeEnum.APPLETS），
//    非白名单前缀会报 50140；App/PC 端 token 无此限制。个别接口（模拟支付等调试专用）不管当前身份是谁都
//    借用 App/PC token 调，避免踩这个限制。
//  _useMiniToken：反向借用小程序顾客 token。个别 base 接口 api_auth 只放行顾客端（pass_token=[2]，如
//    getStoreCraftsman 查库读手艺人工作状态），App/PC token 调会 50140；未登录小程序时不改身份，由调用方自行兜底。
declare module 'axios' {
  export interface AxiosRequestConfig {
    _skipReauth?: boolean;
    _retried?: boolean;
    _silent?: boolean;
    _useStaffToken?: boolean;
    _useMiniToken?: boolean;
  }
}

// 单例 axios。/unified 前缀走 vite proxy 转发到真实后端。
export const http = axios.create({
  baseURL: '',
  timeout: 30_000,
});

// token 过期/鉴权失败、且「可通过重新登录恢复」的业务码（见后端 RespCode AT_*）。
// 50110 黑名单 / 50132 已注销 / 50140 无权限 不在此列：续登也救不了，直接提示。
const TOKEN_EXPIRY_CODES = new Set(['50120', '50130', '50131', '000002']);

const activeAccount = (): Account | undefined => {
  const s = useSession.getState();
  const slotId = s[SLOT_KEY[s.clientMode]];
  return s.users.find((u) => u.id === slotId);
};

// token 过期且无法静默续登（粘贴账号/续登失败）时的提示，弹窗去重避免刷屏。
let tokenExpiredModalOpen = false;
function showTokenExpired(url?: string, status?: number, backendMsg?: string) {
  if (tokenExpiredModalOpen) return;
  tokenExpiredModalOpen = true;
  const isPaste = !activeAccount()?.password;
  const hint = isPaste
    ? '当前是「粘贴 token」身份，无账号密码无法自动续登。请在顶部重新粘贴新 token，或改用账号密码登录。'
    : status === 403
      ? '当前 token 对该接口无权限（如用手艺人 token 访问后台 apiUnified 接口）。'
      : '自动续登未成功，请在顶部重新登录。';
  Modal.warning({
    title: status === 403 ? '无权限（403）' : 'Token 过期 / 鉴权失败',
    content: `接口：${url || ''}\n${backendMsg ? `后端：${backendMsg}\n` : ''}${hint}`,
    styles: { body: { whiteSpace: 'pre-wrap', fontSize: 13, wordBreak: 'break-all' } },
    onOk: () => {
      tokenExpiredModalOpen = false;
    },
  });
}

/**
 * 静默续登并重试原请求。
 * 返回重试后的响应（成功）；返回 null 表示无法续登（粘贴账号 / 已重试过 / 续登失败，错误已由登录拦截器提示）。
 */
async function reloginAndRetry(config?: InternalAxiosRequestConfig): Promise<AxiosResponse | null> {
  if (!config || config._retried || config._skipReauth) return null;
  const acc = activeAccount();
  if (!acc?.account || !acc?.password) return null; // 粘贴账号 / 无凭据
  const { silentRelogin } = await import('./auth'); // 动态引入打破 client↔auth 静态环
  let newToken: string | null = null;
  try {
    newToken = await silentRelogin(acc);
  } catch {
    newToken = null; // 续登失败：登录接口拦截器已弹错
  }
  if (!newToken) return null;
  config._retried = true;
  config.headers.set('att', newToken);
  return http(config);
}

// 请求拦截：注入当前 token + 拼当前环境前缀 + 预判式续登 + 简单 logging
http.interceptors.request.use(async (cfg) => {
  const s = useSession.getState();
  const { currentEnv } = s;
  let acc = activeAccount();
  // 预判式续登：密码账号 token 已过期/临近(30s) → 先静默续登再发，避免那一次必失败的请求。
  // 登录请求自身 (_skipReauth) 跳过，否则会递归。
  if (
    !cfg._skipReauth &&
    acc?.account &&
    acc?.password &&
    acc.expiresAt &&
    acc.expiresAt < Date.now() + 30_000
  ) {
    try {
      const { silentRelogin } = await import('./auth');
      await silentRelogin(acc);
      acc = activeAccount(); // 取刷新后的 token
    } catch {
      /* 续登失败留给后端 401 反应式再处理 */
    }
  }
  if (cfg._useStaffToken) {
    acc = s.appUser() || s.pcUser(); // 借用 App/PC token（该权限档不受小程序端白名单限制，见文件头注释）
  }
  if (cfg._useMiniToken && s.miniUser()) {
    acc = s.miniUser(); // 借用小程序顾客 token（仅顾客端放行的接口，见文件头注释）
  }
  const token = acc?.token || '';
  if (token && cfg.headers) {
    cfg.headers.set('att', token);
  }
  // 命中 vite proxy /env/{currentEnv}/* → 对应后端；跳过已带 /env/ 前缀或绝对 URL
  if (cfg.url && !cfg.url.startsWith(`/env/`) && !/^https?:\/\//.test(cfg.url)) {
    cfg.url = `/env/${currentEnv}${cfg.url}`;
  }
  const attStr = (cfg.headers && (cfg.headers as any).get?.('att')) || '';
  const attPreview = attStr ? `${attStr.slice(0, 8)}...${attStr.slice(-8)} (len=${attStr.length})` : '(empty)';
  // eslint-disable-next-line no-console
  console.debug('[req]', cfg.method?.toUpperCase(), cfg.url, 'env', currentEnv, 'as', acc?.name || 'no-user', 'att', attPreview, cfg.data);
  return cfg;
});

// 响应拦截：token 过期→静默续登重试；其余 401/业务失败按原逻辑
http.interceptors.response.use(
  async (res) => {
    // 防退化：网关一旦下发 Set-Cookie 立刻告警（我们只走 att header，cookie 会污染下次请求）
    const setCookie = (res.headers as any)?.['set-cookie'] || (res.headers as any)?.get?.('set-cookie');
    if (setCookie) {
      // eslint-disable-next-line no-console
      console.warn('[resp.set-cookie-detected]', res.config.url, '响应含 Set-Cookie，检查 vite.config 是否仍剥离 cookie。', setCookie);
    }
    const body = res.data;
    if (body && typeof body === 'object') {
      // udream Resp：{ success, retCode, retInfo, result }；兼容旧 { code, msg, data }
      const c = body.retCode ?? body.code;
      const ok = body.success === true || c === '000000' || c === 0 || c === '0' || c === 200 || c === '200';
      if (c !== undefined && !ok) {
        // token 过期/鉴权失败 → 静默续登并重试
        if (TOKEN_EXPIRY_CODES.has(String(c))) {
          // _silent 的尽力而为请求（如借小程序 token 查库）：借用身份过期不该弹「重新登录」打断当前身份，直接失败交给调用方兜底
          if (res.config._silent) {
            // eslint-disable-next-line no-console
            console.debug('[resp.token-expired(silent)]', res.config.url, c);
            return Promise.reject(body);
          }
          const retried = await reloginAndRetry(res.config);
          if (retried) return retried;
          showTokenExpired(res.config?.url, undefined, body.retInfo || body.msg);
          return Promise.reject(body);
        }
        // eslint-disable-next-line no-console
        console.warn('[resp.biz-fail]', res.config.url, body);
        if (!res.config._silent) message.error(`[${c}] ${body.retInfo || body.msg || '业务异常'}`);
        return Promise.reject(body);
      }
    }
    return res;
  },
  async (err) => {
    const status = err?.response?.status;
    // _silent 请求（接口预期可能未实现/允许失败，调用方自带兜底）降级为 debug 日志，避免控制台红色噪音
    // eslint-disable-next-line no-console
    if (err?.config?._silent) console.debug('[resp.err(silent)]', err?.config?.url, status);
    // eslint-disable-next-line no-console
    else console.error('[resp.err]', err?.config?.url, status, err?.response?.data);
    if ((status === 401 || status === 403) && err?.config?._silent) {
      // 同上：_silent 请求鉴权失败不弹窗、不续登
      return Promise.reject(err);
    }
    if (status === 401 || status === 403) {
      // 401 优先尝试静默续登重试（403 多为无权限，续登也无效，但统一走一次：无凭据/已重试会直接返回 null）
      if (status === 401) {
        const retried = await reloginAndRetry(err.config);
        if (retried) return retried;
      }
      const body = err?.response?.data;
      const backendMsg = (body && (body.retInfo || body.retMsg || body.msg || body.message)) || '';
      showTokenExpired(err?.config?.url, status, backendMsg);
    } else if (!err?.config?._silent) {
      message.error(`[${status || 'NET'}] ${err?.message || '网络异常'}`);
    }
    return Promise.reject(err);
  },
);
