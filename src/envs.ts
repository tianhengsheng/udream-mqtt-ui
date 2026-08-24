/**
 * 可切换的后端环境预设。所有环境（含本地）都经各自的网关，路由语义一致。
 *
 * 工作方式：vite.config.ts 根据这里定义的 key 注册多个 proxy（/env/{key}/* → target）。
 * 浏览器端 axios 请求时把 `/env/{currentEnv}` 拼到 URL 前缀，命中对应的 proxy 即可走对应后端。
 *
 * 加新环境 = 在这里加一项 + 重启 vite（写一次后就不动了）。
 *
 * pathPrefix（转发给网关时补的前缀）：
 *  - 默认根路径 '' —— 前端调的 /order、/market、/uc、/basics、/apiCraftsman、/apiCustomer、/pay 等
 *    全部是网关根路由，一律走 catch-all 的 '' 默认值，无需逐个列 override。
 *  - 仅老 franchise 管理端控制器 /franchise/** 自带 /mgt → 显式 override '/mgt'。
 *  - 新增前缀默认即根路由；只有确认走 /mgt 管理端时才加显式 '/mgt' override（不要反过来）。
 *
 * serviceOverrides：vite 按 key 长度从长到短匹配（更具体优先）。
 *  - /franchise/apiCraftsman、/franchise/apiUnified → 网关根路径 '（必须比 /franchise 更长以抢先匹配）
 *  - /franchise（老控制器） → '/mgt'
 *
 * 注：dye-service 的控制面板走 iframe 直连（见 pages/ControlPanelPage.tsx），不经 vite proxy，
 * 所以这里不需要 /dye 的 serviceOverride。
 */
export const ENV_PRESETS = [
  {
    key: 'local',
    label: '本地',
    // local 与 dev 同库同 Redis，token 互通，账号共用一个桶
    group: 'devShared',
    target: 'http://localhost:20000', // 本地网关
    pathPrefix: '',
    serviceOverrides: [
      { prefix: '/franchise/apiCraftsman', target: 'http://localhost:20000', pathPrefix: '' },
      { prefix: '/franchise/apiUnified', target: 'http://localhost:20000', pathPrefix: '' },
      { prefix: '/franchise', target: 'http://localhost:20000', pathPrefix: '/mgt' },
    ],
  },
  {
    key: 'dev',
    label: '开发-newdevi',
    group: 'devShared',
    target: 'https://api-newdevi.51yxm.com',
    pathPrefix: '',
    serviceOverrides: [
      { prefix: '/franchise/apiCraftsman', target: 'https://api-newdevi.51yxm.com', pathPrefix: '' },
      { prefix: '/franchise/apiUnified', target: 'https://api-newdevi.51yxm.com', pathPrefix: '' },
      { prefix: '/franchise', target: 'https://api-newdevi.51yxm.com', pathPrefix: '/mgt' },
    ],
  },
  {
    key: 'test',
    label: '测试',
    target: 'https://m-test2.51yxm.com',
    pathPrefix: '',
    serviceOverrides: [
      { prefix: '/franchise/apiCraftsman', target: 'https://m-test2.51yxm.com', pathPrefix: '' },
      { prefix: '/franchise/apiUnified', target: 'https://m-test2.51yxm.com', pathPrefix: '' },
      { prefix: '/franchise', target: 'https://m-test2.51yxm.com', pathPrefix: '/mgt' },
    ],
  },
  {
    key: 'newdev',
    label: '测试-newdev',
    target: 'https://api-newdev.51yxm.com',
    pathPrefix: '',
    serviceOverrides: [
      { prefix: '/franchise/apiCraftsman', target: 'https://api-newdev.51yxm.com', pathPrefix: '' },
      { prefix: '/franchise/apiUnified', target: 'https://api-newdev.51yxm.com', pathPrefix: '' },
      { prefix: '/franchise', target: 'https://api-newdev.51yxm.com', pathPrefix: '/mgt' },
    ],
  },
] as const;

export type EnvKey = (typeof ENV_PRESETS)[number]['key'];

export const DEFAULT_ENV: EnvKey = 'local';

export function getEnv(key: EnvKey) {
  return ENV_PRESETS.find((e) => e.key === key) || ENV_PRESETS[0];
}

/**
 * 账号分桶键：同 group 的环境共用一个账号桶（如 local/dev 同库互通），未配 group 的按自身 key 隔离。
 */
export function bucketKey(key: EnvKey): string {
  const env = getEnv(key) as { group?: string };
  return env.group ?? key;
}
