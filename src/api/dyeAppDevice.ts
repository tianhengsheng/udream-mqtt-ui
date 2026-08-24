/**
 * App 端「智染设备」页接口（dye-service）。字段/入参严格对齐后端源码，勿凭空加字段。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/DyeController.java#queryDyeByModel（GET /apiDye/base/dye/queryDyeByModel）
 *  - dye/dye-service/.../mqtt/controller/DyeMachineController.java#creamCapacity
 *    （POST /dye/apiCraftsman/dyemachine/creamCapacity）
 *  - dye/dye-api/.../vo/DyeCreamCapacityVO.java、dye/dye-service/.../entity/DyeDeviceStore.java
 *  - dye/dye-api/.../contants/DyeConstant.java（Model / State 枚举）
 *
 * 两个接口的**入参都在 query string**（后端 @RequestParam），不是 JSON body：
 *  - queryDyeByModel：参数名是 `storeIds`（单数 Long，名字带 s 是历史遗留），`model` 选填。
 *  - creamCapacity：POST 但 macCode / storeId 仍是 @RequestParam，body 发过去后端收不到。
 *
 * 后端全局 Jackson 把 Long 序列化成 String（common-web DefaultWebMvcConfigurer），
 * 所以 id/storeId 回来就是字符串；本文件仍按字符串处理 19 位雪花 id，禁止落进 JS number。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import type { Resp } from '../types';

/** 四代机（调色仪）型号码，DyeConstant.Model.DEVICE_MODEL_FOUR(4, "四代机(04)") */
export const MODEL_DYE_MACHINE_4 = 4;

/** 绑定状态 DyeConstant.State：1-已绑定、2-已解绑（queryDyeByModel 只回已绑定的） */
export const DEVICE_STATE_BOUND = 1;

/**
 * 门店已绑定设备（后端直接返回实体 DyeDeviceStore，字段 1:1，只列页面用得到的）。
 * 注意 deviceCode = 设备 MAC 码 = `dye_device_cream.device_code`，也就是模拟器里那个「设备 SN」，
 * 不是 MQTT 的 deviceId（dm04-xxxx）。
 */
export interface DyeDeviceStoreItem {
  /** dye_device_store 主键，19 位雪花 id（字符串） */
  id?: string;
  /** 门店 id（字符串） */
  storeId?: string;
  /** 设备型号，见 DyeConstant.Model */
  model?: number;
  /** 设备 MAC 码（= 余量表 device_code） */
  deviceCode?: string;
  /** 设备名称（后端按「门店内第 N 台」生成） */
  deviceName?: string;
  /** 蓝牙开关 0-关闭 1-开启 */
  bluetooth?: number;
  /** 绑定状态 1-已绑定 2-已解绑 */
  state?: number;
  /** 设备连接状态 0-未连接 1-已连接 */
  status?: number;
  /** 联网方式 0-WiFi */
  type?: number;
  /** WiFi 名称 */
  typeName?: string;
  /** 设备信号 */
  deviceSignal?: number;
  ip?: string;
  address?: string;
  version?: string;
  allocateTime?: string;
  /** 上次通讯时间 */
  usageTime?: string;
  /** 运行状态 / 描述 */
  runState?: number;
  runDesc?: string;
  createTime?: string;
  updateTime?: string;
}

/**
 * [App] 按门店 + 型号查已绑定设备。
 *
 * 后端实现（DyeServiceImpl#queryDyeByModel）：读门店设备缓存 → 过滤 state=已绑定
 * →（model 非空时）按 model 精确过滤 → 按 updateTime 倒序。
 * 特例：`model=0` 会被当成「二代机」分支返回 model∈{0,2} 的设备，本页只用 model=4，不受影响。
 */
export async function queryDyeByModel(
  storeId: string,
  model: number = MODEL_DYE_MACHINE_4,
): Promise<DyeDeviceStoreItem[]> {
  const res = await http.get<Resp<DyeDeviceStoreItem[]>>('/apiDye/base/dye/queryDyeByModel', {
    // 参数名 storeIds 照抄后端 @RequestParam("storeIds")，别改成 storeId
    params: { storeIds: storeId, model },
    transformResponse: [bigIntSafeParse],
  });
  return res.data?.result ?? res.data?.data ?? [];
}

/** 单个出料口余量（DyeCreamCapacityVO.Item） */
export interface DyeCreamPump {
  /** 出料口序号（1~8） */
  devicePort?: number;
  /** 名称：染膏色号 / 双氧浓度 */
  name?: string;
  /** 类型 0-染膏、1-双氧 */
  type?: number;
  /** 余量(克) */
  weight?: number;
  /** 已用(克) */
  usedWeight?: number;
  /** 满载(克) */
  totalWeight?: number;
  /** 余量占比 0~1（后端 BigDecimal，JSON 里可能是字符串） */
  proportion?: string | number;
  /** 余量百分比 0~100（后端按 weight/totalWeight 四舍五入实时算） */
  percent?: number;
  /** 状态 0-正常、1-预警(<=45g)、2-阻断(<=5g)，后端 calcStatus 实时算 */
  status?: number;
}

/** 染膏容量监控（DyeCreamCapacityVO） */
export interface DyeCreamCapacity {
  /** 设备 MAC 码 */
  deviceCode?: string;
  /** 容量更新时间 = 各槽位最近一次上报 last_sync_time（无上报时为 null） */
  lastSyncTime?: string;
  /** 各出料口余量，后端按 devicePort 升序 */
  pumps?: DyeCreamPump[];
}

/** 余量状态文案/配色（0-正常 1-预警 2-阻断），与后端 calcStatus 阈值一一对应 */
export const CREAM_STATUS_META: Record<number, { text: string; color: string; tag: string }> = {
  0: { text: '正常', color: '#52c41a', tag: 'success' },
  1: { text: '预警', color: '#faad14', tag: 'warning' },
  2: { text: '阻断', color: '#ff4d4f', tag: 'error' },
};

/**
 * [App] 四代机染膏容量监控。
 *
 * 后端 DyeDeviceCreamServiceImpl#queryCapacity：先按 device_code + store_id 定位 dye_device_store 绑定行，
 * 再用它的 id 过滤 dye_device_cream（避免历史残留行）。**查不到绑定关系时不报错**，
 * 返回 pumps=[] 且 lastSyncTime=null —— 所以空列表要当「无数据」展示，别当异常。
 */
export async function fetchCreamCapacity(macCode: string, storeId: string): Promise<DyeCreamCapacity> {
  // POST 但入参走 query string（@RequestParam），body 置 null
  const res = await http.post<Resp<DyeCreamCapacity>>(
    '/dye/apiCraftsman/dyemachine/creamCapacity',
    null,
    { params: { macCode, storeId }, transformResponse: [bigIntSafeParse] },
  );
  return res.data?.result ?? res.data?.data ?? {};
}

/**
 * 与「下料(App)」页的交接契约：选中设备写这个 localStorage key，下料页读它拿设备上下文。
 * **key 名与字段名是两页共同约定，改动必须两边同步**。
 */
export const SELECTED_DEVICE_KEY = 'mqtt-app-selected-device';

export interface SelectedDevicePayload {
  /** 设备 MAC 码（= dye_device_cream.device_code） */
  deviceCode: string;
  deviceName: string;
  /** 门店 id，字符串 */
  storeId: string;
  /** dye_device_store 主键（可空），字符串 */
  dyeDeviceStoreId?: string;
}

export function saveSelectedDevice(payload: SelectedDevicePayload) {
  localStorage.setItem(SELECTED_DEVICE_KEY, JSON.stringify(payload));
}

/** 「上次选中设备」按门店记忆（只存 deviceCode，设备详情每次重新拉，避免拿到过期快照） */
export const lastPickKey = (storeId: string) => `mqtt-app-dye-device-${storeId}`;
