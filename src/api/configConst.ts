/**
 * base-service 配置中心（udream_basics.config_const）读写。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - base/base-service/.../controller/craftsman/ConfigConstController.java
 *      读 GET  /basics/area/query?key=xxx                 → apiQuery
 *      写 POST /basics/configConst/updateConfigConst      → 体 {key, value}
 *  - base/base-service/.../service/craftsman/impl/ConfigConstServiceImpl.java
 *      updateConfigConst 校验 key 存在 → 更新 value → iConfigCacheService.delConfigConsCache(key)
 *
 * 生效时机：写接口会主动删 Redis 配置缓存。dye-service **不在** BASIC_CONFIG_CONS 的
 * 本地缓存服务白名单（gateway/basics/order/market/eep）内，每次现读 Redis，
 * 所以排水配置改完对 dye 立刻生效，不用刷缓存也不用重启。
 * ⚠️ order-service 在白名单内，它读的门店/项目白名单配置最长有 15 分钟本地缓存延迟，
 * 故本模块只读展示那两项、不提供修改入口。
 *
 * 权限：两条接口都走 PC 端 token（api_auth pass_token 含 8），统一带 _useStaffToken。
 */
import { http } from './client';
import type { Resp } from '../types';

/**
 * 读接口返回的配置项。
 *
 * ⚠️ 只有 key/value 两个字段有值：apiQuery 是从 ConfigConstCache 拷贝出来的，
 * 而那个缓存 PO 只存了 key+value（见 common-cache business/basic/po/ConfigConstCache），
 * ConfigConst VO 上的 remark/updateTime/id 一律回 null，页面别指望展示它们。
 */
export interface ConfigConstItem {
  key?: string;
  value?: string;
}

/** 洗头床预热排水统一配置 key（后端 CommonConfigConstant.WASHBED_DRAIN_TIMEOUT_CONFIG） */
export const KEY_WASHBED_DRAIN_TIMEOUT = 'washbed_drain_timeout_cnf';
/** 洗头床功能生效门店白名单 key（order-service 读，空表示不限门店） */
export const KEY_SHAMPOO_BED_STORE = 'shampoo_bed_store_id';
/** 洗头床项目 id 白名单 key（order-service 读，订单含其中项目才发预热事件） */
export const KEY_SHAMPOO_BED_ITEM = 'shampoo_bed_item_id';

/** 排水超时分钟数取值上限（两个超时同上限，协议 bizData.timeoutMinutes 范围 [0,600]） */
export const DRAIN_TIMEOUT_MAX = 600;

/**
 * washbed_drain_timeout_cnf 的 value 结构（后端 WashbedDrainConfig）。
 *
 * 两个超时**相互独立**（2026-09-02 从单值拆分）：设备值只管设备自关、云端值只管 job 兜底，
 * 互不派生。联调技巧：设备值置 0（永不自关）+ 云端值给个小正数，可单独验证云端兜底真的下发 drain_off。
 */
export interface WashbedDrainCnf {
  /** 云端兜底超时分钟数 [0,600]，0=云端不兜底；xxl-job 每 5 分钟扫描按此判定是否强制关水 */
  timeoutMinutes: number;
  /** 设备端超时分钟数 [0,600]，0=设备永不自关；随 drain_on 的 bizData.timeoutMinutes 下发 */
  deviceTimeoutMinutes: number;
  /** "管道尚热"阈值（分钟）：距上次洗头小于该值视为尚热，仅用于选床优先级 */
  warmPipeMinutes: number;
}

/** 后端默认值（WashbedDrainConfig 缺配置/越界时的兜底），页面解析失败时同步展示这套 */
export const DRAIN_CNF_DEFAULT: WashbedDrainCnf = {
  timeoutMinutes: 30,
  deviceTimeoutMinutes: 30,
  warmPipeMinutes: 10,
};

/** 按 key 查配置（走缓存，返回整行） */
export async function queryConfigConst(key: string): Promise<ConfigConstItem | undefined> {
  const res = await http.get<Resp<ConfigConstItem>>('/basics/area/query', {
    params: { key },
    _useStaffToken: true,
  });
  return res.data?.result ?? res.data?.data;
}

/** 按 key 改配置 value（后端整体覆盖 value 并删缓存） */
export async function updateConfigConst(key: string, value: string): Promise<void> {
  await http.post<Resp<boolean>>(
    '/basics/configConst/updateConfigConst',
    { key, value },
    { _useStaffToken: true },
  );
}

/**
 * 解析排水配置 value。
 * 后端对越界/缺字段一律回退默认值，这里保持同一口径，保证页面显示的就是实际生效值。
 */
export function parseDrainCnf(value?: string): WashbedDrainCnf {
  if (!value) return { ...DRAIN_CNF_DEFAULT };
  try {
    const raw = JSON.parse(value) as Partial<WashbedDrainCnf>;
    const t = Number(raw.timeoutMinutes);
    const d = Number(raw.deviceTimeoutMinutes);
    const w = Number(raw.warmPipeMinutes);
    // deviceTimeoutMinutes 缺失时回退默认 30，**不**跟随 timeoutMinutes（与后端 load() 同口径）
    return {
      timeoutMinutes:
        Number.isInteger(t) && t >= 0 && t <= DRAIN_TIMEOUT_MAX ? t : DRAIN_CNF_DEFAULT.timeoutMinutes,
      deviceTimeoutMinutes:
        Number.isInteger(d) && d >= 0 && d <= DRAIN_TIMEOUT_MAX
          ? d
          : DRAIN_CNF_DEFAULT.deviceTimeoutMinutes,
      warmPipeMinutes: Number.isInteger(w) && w > 0 ? w : DRAIN_CNF_DEFAULT.warmPipeMinutes,
    };
  } catch {
    return { ...DRAIN_CNF_DEFAULT };
  }
}

/**
 * 组装排水配置 value。
 * 必须写全三个字段：更新接口整体覆盖 value，漏传一个就把它丢掉、后端回退默认值。
 */
export function buildDrainCnfValue(cnf: WashbedDrainCnf): string {
  return JSON.stringify({
    timeoutMinutes: cnf.timeoutMinutes,
    deviceTimeoutMinutes: cnf.deviceTimeoutMinutes,
    warmPipeMinutes: cnf.warmPipeMinutes,
  });
}

/** 逗号分隔 id 串 → 数组（门店/项目白名单展示用），空串表示不限制 */
export function splitIdList(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
