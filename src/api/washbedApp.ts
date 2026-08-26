/**
 * App 端「洗头床控制」页接口（dye-service，全部为已有接口，无新增）。
 *
 * 后端出处（只读参考）：
 *  - WashbedController#controlDevice（POST /dye/apiCraftsman/device/op）——指令下发，
 *    **入参全在 query string**（后端裸 String/@RequestParam，body 收不到）
 *  - DyeBedRecordController#getDyeBedRecordDetailByDeviceCode
 *    （GET /dye/apiCraftsman/dyeBedRecord/getDyeBedRecordDetailByDeviceCode）——设备状态详情，
 *    deviceCode 传 XTC 码（后端经 SN→deviceId 索引翻译）
 *  - DyeBedRecordController#getRinseTypeConfig（GET /dye/apiCraftsman/dyeBedRecord/getRinseTypeConfig）
 *    ——洗头模式按钮配置（Nacos rinse_type_config，配置缺条目时页面本地兜底）
 */
import { http } from './client';
import type { Resp } from '../types';

/** AI 洗头床型号码，DyeConstant.Model.DEVICE_XTC(25) */
export const MODEL_WASHBED_XTC = 25;

/** 洗头床状态详情（WashbedDeviceStatusVO，只列页面用到的字段） */
export interface WashbedDetail {
  dyeBedRecordId?: string;
  deviceId?: string;
  /** idle / running / paused / error */
  status?: string;
  /** 当前水温（后端保留 String 兼容历史） */
  waterTemperature?: string;
  settingTemperature?: number;
  washCount?: number;
  wifiName?: string;
  firmwareVersion?: string;
  osVersion?: string;
  sn?: string;
  executionProgress?: number;
  /** 洗头模式 0-4，5-速冲(90秒) */
  rinseType?: number;
  screenOn?: number;
  waterPressure?: number;
  craftsmanName?: string;
  /** 上次洗头时间（LocalDateTime 序列化） */
  washingStartTime?: string;
  /** 0=离线 1=在线 */
  connectionStatus?: number;
  /** 设备排水状态：0=关闭 1=开启 */
  drainStatus?: number;
}

export async function fetchWashbedDetail(deviceCode: string): Promise<WashbedDetail> {
  const res = await http.get<Resp<WashbedDetail>>(
    '/dye/apiCraftsman/dyeBedRecord/getDyeBedRecordDetailByDeviceCode',
    { params: { deviceCode } },
  );
  return (res.data?.result ?? res.data?.data ?? {}) as WashbedDetail;
}

/** 洗头模式按钮配置（RinseTypeConfigVO） */
export interface RinseTypeConfig {
  rinseTypeName?: string;
  /** 0-4，5-速冲(90秒) */
  rinseType?: number;
  commandType?: number;
  rinseTypeMinute?: number;
  sort?: number;
}

export async function fetchRinseTypeConfig(): Promise<RinseTypeConfig[]> {
  const res = await http.get<Resp<RinseTypeConfig[]>>(
    '/dye/apiCraftsman/dyeBedRecord/getRinseTypeConfig',
  );
  return (res.data?.result ?? res.data?.data ?? []) as RinseTypeConfig[];
}

/** 洗头床指令下发（App 端口）。deviceId 传 XTC 码即可（后端 issueCommand 做 SN 翻译）。 */
export async function washbedOp(params: {
  deviceId: string;
  /** start / stop / screen_on / screen_off / get_status / set_temp / drain_on / drain_off */
  action: string;
  /** 模式 0-4，5-速冲(90秒)：start 时传 */
  model?: number;
  /** 水压强度 1-4：start 时传 */
  waterPressure?: number;
  /** 目标水温（set_temp / start 时传） */
  waterTemperature?: number;
}): Promise<void> {
  await http.post<Resp<unknown>>('/dye/apiCraftsman/device/op', null, { params });
}
