/**
 * dye-service 管理端（/mgtDye）接口。字段严格对齐后端 DTO/VO，勿凭空加字段。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/DyeController.java
 *  - dye/dye-api/.../req/DyeDeviceItemQueryDTO.java、req/RemoteStoreDeviceReq.java
 *  - dye/dye-api/.../vo/DyeDeviceItemsVO.java、vo/DyeCreamCapacityVO.java
 *
 * 注意：后端全局 Jackson 把 Long 统一序列化成 String（common-web DefaultWebMvcConfigurer），
 * 所以 id/storeId 回来就是字符串；这里仍挂 bigIntSafeParse 兜底，防某接口漏配。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import type { PageResp, Resp } from '../types';

/** 设备型号（DyeConstant.Model，与导入模板表头一致） */
export const DEVICE_MODELS = [
  { value: 0, label: '非自研二代机(第三方)' },
  { value: 2, label: '自研二代机(02)' },
  { value: 3, label: '三代机(03)' },
  { value: 4, label: '四代机(04)' },
  { value: 10, label: '护理机(05)' },
  { value: 15, label: '底色识别枪(DS)' },
  { value: 20, label: '发质检测仪(FZ)' },
  { value: 25, label: 'AI洗头床(XTC)' },
] as const;

export const MODEL_LABEL: Record<number, string> = Object.fromEntries(
  DEVICE_MODELS.map((m) => [m.value, m.label]),
);

/** 设备连接状态 0-未连接 / 1-已连接 */
export const DEVICE_STATUS_OPTIONS = [
  { value: 0, label: '未连接' },
  { value: 1, label: '已连接' },
];

/** 划拨状态 0-未划拨 / 1-已划拨 */
export const TRANSFER_STATUS_OPTIONS = [
  { value: 0, label: '未划拨' },
  { value: 1, label: '已划拨' },
];

/** 绑定状态 0-绑定 / 1-已解绑 */
export const BINDING_STATUS_OPTIONS = [
  { value: 0, label: '绑定' },
  { value: 1, label: '已解绑' },
];

/** 四代机单个出料口余量（DyeCreamCapacityVO.Item） */
export interface DyeCreamItem {
  devicePort?: number;
  /** 染膏色号 / 双氧浓度 */
  name?: string;
  /** 0-染膏、1-双氧 */
  type?: number;
  /** 余量(克) */
  weight?: number;
  usedWeight?: number;
  totalWeight?: number;
  /** 余量占比 0~1（BigDecimal，可能是字符串） */
  proportion?: string | number;
  /** 余量百分比 0~100 */
  percent?: number;
  /** 0-正常、1-预警(<=45g)、2-阻断(<=5g) */
  status?: number;
}

/** 设备列表行（DyeDeviceItemsVO），字段名与后端 1:1 */
export interface DyeDeviceItem {
  id?: string;
  storeId?: string;
  deviceName?: string;
  macCode?: string;
  model?: number;
  modelName?: string;
  storeName?: string;
  storeType?: number;
  storeTypeStr?: string;
  cityName?: string;
  transferStatus?: number;
  deviceStatus?: number;
  xtcStatus?: string;
  /** 联网方式 0-WiFi */
  type?: number;
  /** 设备联网方式名称（列表里这列叫「WIFI名称」） */
  typeName?: string;
  creamCapacityList?: DyeCreamItem[];
  creamLastSyncTime?: string;
  runState?: number;
  runDesc?: string;
  /** 设备所在地（列表里这列叫「联网所在地」） */
  address?: string;
  usageTime?: string;
  createTime?: string;
  transferTime?: string;
  bindingStatus?: number;
  bindingTime?: string;
  trackUserName?: string;
  costStatus?: number;
  startTime?: string;
  endTime?: string;
  bizType?: number;
  versionType?: number;
  /** 同门店同型号设备台数（>=2 时后端置 mark=true） */
  count?: number;
  /** 整行标红标记 */
  mark?: boolean;
}

/** 列表/导出共用查询条件（DyeDeviceItemQueryDTO 的前端可用子集） */
export interface DyeDeviceQuery {
  pageNum?: number;
  pageSize?: number;
  /** 是否统计总条数，PageReq 默认 false；本页要显示「共 N 条」，统一传 true */
  counted?: boolean;
  storeName?: string;
  macCode?: string;
  deviceStatus?: number;
  transferStatus?: number;
  model?: number;
  cityId?: number;
  bindingStatus?: number;
  trackUserName?: string;
  /** yyyy-MM-dd（后端 LocalDate） */
  transferStartTime?: string;
  transferEndTime?: string;
  bindingStartTime?: string;
  bindingEndTime?: string;
  costStatus?: number;
}

/**
 * 设备列表分页。
 * 注意后端是「先全量查再内存分页」（DyeServiceImpl.dyeDevicePage），total 恒返回，
 * counted 实际不影响结果；仍按契约显式传 true，避免后端将来改成 SQL 分页后总数变 0。
 */
export async function fetchDyeDevicePage(
  query: DyeDeviceQuery,
): Promise<{ list: DyeDeviceItem[]; total: number }> {
  const res = await http.post<PageResp<DyeDeviceItem>>(
    '/mgtDye/dye/device/dyeDevicePage',
    { counted: true, ...query },
    { transformResponse: [bigIntSafeParse] },
  );
  const body = res.data || {};
  const list = body.result ?? body.data ?? body.records ?? [];
  const total = body.page?.total ?? body.pageInfo?.total ?? body.total ?? list.length;
  return { list, total };
}

/** 管理端通用附加参数（用户给的真实调用示例带的，照抄；DTO 上没有这些字段，后端绑定时会忽略） */
const MGT_EXTRA_PARAMS = {
  uid: 1,
  userId: 1,
  routepath:
    '/sassSupport/deviceManage/deviceList,/sassSupport/deviceManage/entrancePermissionConfiguration',
};

/**
 * 导出设备列表。**入参走 query string，不是 body**。
 *
 * 契约上写的是 `Resp<Boolean>`，但实现（DyeServiceImpl.exportStaffDye）是直接把 xlsx
 * 写进 HttpServletResponse 的 attachment 流里 —— 实际拿到的是**文件二进制**。
 * 所以这里用 blob 收，命中文件就直接下载；万一后端换成异步/返回 JSON，就把 JSON 里的
 * 提示透出来（两种形态都兼容，避免单押一边）。
 */
export async function exportDyeDevice(query: DyeDeviceQuery): Promise<{ downloaded: boolean; msg?: string }> {
  const res = await http.get('/mgtDye/dye/device/exportStaffDye', {
    params: { ...MGT_EXTRA_PARAMS, ...query },
    responseType: 'blob',
  });
  const blob = res.data as Blob;
  // 后端把错误也可能以 JSON 形式吐在 blob 里（此时 content-type 是 application/json）
  const isJson = (blob.type || '').includes('json') || (blob.type || '').includes('text');
  if (isJson) {
    const text = await blob.text();
    try {
      const body = JSON.parse(text);
      return { downloaded: false, msg: body.retInfo || body.retMsg || body.msg || text.slice(0, 200) };
    } catch {
      return { downloaded: false, msg: text.slice(0, 200) };
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.download = `设备列表_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { downloaded: true };
}

/** 设备导入：只收 excel 文件流，FormData 字段名固定 `file`（@RequestParam("file")）。 */
export async function importDyeDevice(file: File): Promise<Resp<void>> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await http.post<Resp<void>>('/mgtDye/base/dye/import', fd);
  return res.data;
}

/** 远程控制业务类型（RemoteStoreDeviceReq.type；1~5 染色仪、8~14 洗头床，对应后端 DyeRemoteType） */
export const REMOTE_TYPE = {
  /** 开始校准 */
  CALIBRATE: 1,
  /** 确认换料 */
  REFILL: 2,
  /** 恢复出厂设置 */
  FACTORY_RESET: 3,
  /** 关机 */
  SHUTDOWN: 4,
  /** 重启设备 */
  REBOOT: 5,
  /** 刷新设备状态（洗头床，get_status） */
  REFRESH_STATUS: 8,
  /** 屏幕解锁（洗头床，screen_on） */
  SCREEN_UNLOCK: 9,
  /** 屏幕锁定（洗头床，screen_off） */
  SCREEN_LOCK: 10,
  /** 控制水温（洗头床，set_temp，需带 waterTemperature） */
  SET_TEMP: 12,
  /** 开启预热排水（洗头床，drain_on） */
  DRAIN_ON: 13,
  /** 关闭预热排水（洗头床，drain_off） */
  DRAIN_OFF: 14,
} as const;

export interface RemoteStoreDeviceReq {
  /** 设备MAC码（必填） */
  code: string;
  type: number;
  /** 目标水温（°C，仅 SET_TEMP 必填） */
  waterTemperature?: number;
  operatorId?: string;
  operatorName?: string;
}

/** 远程控制下发（管理端口，与 App 端 /apiDye/dye/remoteAppStoreDevice 同一实现）。 */
export async function remoteStoreDevice(req: RemoteStoreDeviceReq): Promise<boolean> {
  const res = await http.post<Resp<boolean>>('/mgtDye/dye/remoteStoreDevice', req);
  return (res.data?.result ?? res.data?.data) === true;
}

/**
 * 解绑（回收设备）。
 *
 * **坑：POST 但入参是 `@RequestParam("code")`，不是 JSON body** —— 必须拼在 query string 上
 * （`?code=xxx`），发 body 后端收不到会直接 400/参数缺失。故这里 data 传 null、参数走 params。
 *
 * 后端做两件事（DyeServiceImpl#recycleDevice）：
 *  ① dye_device 划拨状态置「未划拨」并清掉 ip/信号/wifi名/最后通讯时间；
 *  ② dye_device_store 绑定关系置「已解绑」，同时清设备缓存。
 * 返回 `Resp<Boolean>`，result 为「是否更新到绑定行」——设备本就没绑店时会返回 false。
 */
/** 洗头床当前水温/排水状态（云端 MQTT 状态缓存；deviceId 传 XTC 码即可，后端做 SN 翻译） */
export interface WaterTemperatureVO {
  waterTemperature?: number;
  settingTemperature?: number;
  /** 设备排水状态：0=关闭 1=开启，未上报为 null */
  drainStatus?: number;
}

/** 坑：POST 但入参是普通 `String deviceId`（非 @RequestBody），参数须走 query string。 */
export async function getWashbedWaterTemperature(deviceId: string): Promise<WaterTemperatureVO> {
  const res = await http.post<Resp<WaterTemperatureVO>>(
    '/dye/apiUnified/device/waterTemperature', null, { params: { deviceId } },
  );
  return (res.data?.result ?? res.data?.data ?? {}) as WaterTemperatureVO;
}

/** 远程控制操作日志（SystemLog，bizType=1=设备列表远程控制，bizId=设备 MAC 码） */
export interface SystemLogItem {
  id?: string;
  beforeVal?: string;
  afterVal?: string;
  operationDate?: string;
  operatorName?: string;
}

export async function getSystemLog(bizId: string): Promise<SystemLogItem[]> {
  const res = await http.get<Resp<SystemLogItem[]>>('/mgtDye/dye/getSystemLog', {
    params: { bizType: 1, bizId },
  });
  return (res.data?.result ?? res.data?.data ?? []) as SystemLogItem[];
}

export async function recycleDevice(code: string): Promise<boolean> {
  const res = await http.post<Resp<boolean>>('/mgtDye/base/dye/recycleDevice', null, {
    params: { code },
  });
  return (res.data?.result ?? res.data?.data) === true;
}

/** 划拨入参（TransferDeviceDTO 的前端可用子集，其余字段本页用不上不传） */
export interface TransferDeviceReq {
  /** 设备码（@NotNull），就是列表行的 macCode */
  code: string;
  /**
   * 门店id（@NotNull）。19 位雪花 ID，**前端全程当字符串传**：
   * 一旦落进 JS number 就超 Number.MAX_SAFE_INTEGER 丢末位，会划拨到别的门店去。
   * JSON 里发字符串数字，后端 Jackson 能正常转 Long。
   */
  storeId: string;
}

/**
 * 划拨设备（把未划拨设备绑到门店）。
 *
 * 后端 `@Validated @RequestBody`，走 JSON body。返回 `Resp<String>`（成功时 result="划拨成功"）。
 * 注意后端是**新插一条 dye_device_store 绑定行**（deviceName 会重新按「门店内第 N 台」生成），
 * 老的解绑行保留为 state=2；四代机的染膏余量走「跟随设备」原地改绑，不会被清零。
 * 设备已绑店时后端直接返回业务失败「该设备已绑定xxx」，由全局拦截器弹提示。
 */
export async function transferDevice(req: TransferDeviceReq): Promise<string | undefined> {
  const res = await http.post<Resp<string>>('/mgtDye/base/dye/transferDevice', req);
  return res.data?.result ?? res.data?.data;
}
