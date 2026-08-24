/**
 * App 端「下料」页接口（dye-service 智染调色仪选色订单服务）。字段/入参严格对齐后端源码，勿凭空加字段。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/OrderColorController.java
 *      getDyeConfigConstVO / getDyeColorRecordPortResult / savaOrUpdateColorRecordsV2 /
 *      executeColorRecord / getNewDyeColorRecordsStatus
 *  - dye/dye-service/.../service/impl/OrderColorServiceImpl.java
 *      savaOrUpdateColorRecordsByModelV4（四代机分支）/ processSingleColorRecord / saveOrCreamDyeColorRecord /
 *      createHydrogenDyeColorRecord / createBasicColor / createColor / executeColorRecord
 *  - dye/dye-api/.../req/DyeColorRecordsDTO.java、vo/DyeFormulaColorRecordVO.java、
 *    vo/DyeConfigConstVO.java、vo/DyeColorRecordPortResultVO.java、vo/DyeColorStatusVO.java
 *  - dye/dye-service/.../mqtt/controller/DyeMachineController.java#op（直发 MQTT dispense 兜底）
 *
 * 与 dyeAppDevice.ts 的分工：那边是「设备维度」（门店设备列表 / 染膏余量监控），
 * 本文件是「调色记录维度」（配方组建 → 几号管 → 保存 → 执行 → 状态），两者 VO 完全不同，别混。
 *
 * 后端全局 Jackson 把 Long 序列化成 String（common-web DefaultWebMvcConfigurer），
 * 且 **FAIL_ON_UNKNOWN_PROPERTIES 已关闭**（同文件 104 行）——所以真实 App 抓包里那些
 * DTO 上不存在的字段（colorCode/icon/modeVal/type/formulaType/dioxyDegree/combinationNum/hydrogen）
 * 发过去只会被忽略，不会报错；本文件按 DTO 真实字段发，不抄无效字段。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import type { Resp } from '../types';

/** 四代机型号码（DyeConstant.Model.DEVICE_MODEL_FOUR） */
export const MODEL_FOUR = 4;

/** 出料类型 DyeConstant.OutType：0-染膏、1-双氧 */
export const OUT_TYPE = { CREAM: 0, HYDROGEN: 1 } as const;

/** 出料模式 DyeConstant.OutModel：0-手动（默认）、1-智能。本页是手调，恒 0 */
export const OUT_MODEL_MANUAL = 0;

/** 是否已执行 DyeColorRecordsDTO.isExecute（@NotNull）：0-未执行、1-执行中、2-已执行。新建恒 0 */
export const IS_EXECUTE_NEW = 0;

/**
 * 标签 DyeColorRecordsDTO.tag：0-打底，1-预染，2-染色，3-发根，4-发中，5-发尾。
 * 注释写「手动模式必传」，但四代机分支（savaOrUpdateColorRecordsByModelV4）实际不校验它，
 * 只是 BeanUtils 拷进记录表。抓包样例传 0，这里同样默认 0。
 */
export const TAG_OPTIONS = [
  { value: 0, label: '打底' },
  { value: 1, label: '预染' },
  { value: 2, label: '染色' },
  { value: 3, label: '发根' },
  { value: 4, label: '发中' },
  { value: 5, label: '发尾' },
];

/**
 * 调色记录执行场景 DyeColorRecordsDTO.sceneType：0-单条执行、1-同订单号批量执行。
 * 抓包样例是 1；四代机保存分支只是原样落库（entity.setSceneType），不影响保存成败。
 */
export const SCENE_TYPE = { SINGLE: 0, BATCH: 1 } as const;

/** 操作结果代号（与 PC 调色记录页 STATUS_LABEL 同一套，DyeConstant.DyeChangeStatus） */
export const COLOR_STATUS_LABEL: Record<number, string> = {
  0: '失败',
  11: '等待中',
  12: '执行中',
  13: '待取走',
  20: '已取消',
  21: '已完成',
};

/** 展示状态 showStatus（比 status 多 1-未执行 / 2-执行中 两档，见 DyeFormulaColorRecordVO） */
export const SHOW_STATUS_LABEL: Record<number, string> = {
  ...COLOR_STATUS_LABEL,
  1: '未执行',
  2: '执行中',
};

// ── 1. 可选颜色 / 双氧（getDyeConfigConstVO）────────────────────────────────

/** 基础配置项（DyeColorConfigConstResultVO） */
export interface DyeColorConst {
  /**
   * colorId：**四代机下就是 `dye_color_config.id`（19 位雪花，字符串）**。
   *
   * 后端 getDyeConfigConstVO 的四代机分支把 `dye_device_cream_config_four` 的每个管子名（33/0 等）
   * 拿去 `dye_color_config`（type=6 畅想模式、model_color_type=4）按 `combination` 反查 id 填进来；
   * **查不到时会退化成配置里的小 id（1~8）**——那种 id 保存时在 dye_color_config 查不到，
   * 记录会被静默丢弃（saveOrCreamDyeColorRecord 返回 null），所以前端把 <100 的 colorId 视为不可用。
   */
  colorId?: string;
  /** 值：染膏是「1号口」这类出料口文案，双氧是浓度数字字符串（"3"/"12"） */
  value?: string;
  /** 名称：染膏 = 管子色号（33/0、0/00…），双氧 = 浓度（3%、6%、9%、12%） */
  colorName?: string;
  /** 描述（染膏为 NO.1 这类槽位别名，dye_color_config.name 同值） */
  desc?: string;
  /** 图片 */
  url?: string;
}

/** 色系分组（DyeColorConfigInfoVO），四代机才有；本页手调不用，仅透出备查 */
export interface DyeColorConfigInfo {
  typeName?: string;
  dyeConstList?: DyeColorConst[];
}

/** getDyeConfigConstVO 返回（DyeConfigConstVO） */
export interface DyeConfigConst {
  /**
   * 基础染膏配置 = **各管子颜色**（四代机分支来自 config `dye_device_cream_config_four`）。
   * 注意后端 `if (!StringUtils.hasText(url)) continue;` —— **url 为空的槽位会被过滤掉**，
   * dev 上 7 号口(3%)/8 号口(12%) 正是空 url，所以这里天然只剩 6 个染膏管，双氧走 dioxygenConstList。
   */
  dyeConstList?: DyeColorConst[];
  /** 基础双氧配置（config `dye_dioxygen_config_four`，dev 为 3%/6%/9%/12%） */
  dioxygenConstList?: DyeColorConst[];
  /** 四代机色系分组（色板选色用，本页不用） */
  dyeColorConfigInfoList?: DyeColorConfigInfo[];
}

/**
 * [APP|H5] 基础染膏和双氧配置。**POST 但 model 走 query string**（@RequestParam），body 空。
 * 四代机传 model=4。
 */
export async function fetchDyeConfigConst(model: number = MODEL_FOUR): Promise<DyeConfigConst> {
  const res = await http.post<Resp<DyeConfigConst>>('/apiDye/order/dye/getDyeConfigConstVO', null, {
    params: { model },
    transformResponse: [bigIntSafeParse],
  });
  return res.data?.result ?? res.data?.data ?? {};
}

/** colorId 可用性判定：后端反查不到 dye_color_config 时会退化成 1~8 的配置小 id，保存必被丢弃 */
export const isUsableColorId = (colorId?: string) => !!colorId && colorId.length > 6;

// ── 2. 调色记录入参（DyeColorRecordsDTO）───────────────────────────────────

/**
 * 保存/预览共用入参，字段与 DyeColorRecordsDTO 1:1（只列本页会用到的）。
 *
 * 必填（@NotNull，缺了直接参数校验失败）：storeId、deviceCode、deviceName、weight、isExecute。
 * orderId **可以为 null**：四代机分支 getVirtuallyOrderIdVO 会先用 storeId+employeeId 找进行中的
 * 染发服务单，找不到就生成虚拟订单 id（isVirtuallyOrderId=1），所以自测场景放心传 null。
 * colorId 对**染膏行必填**（见下 outType 说明）。
 */
export interface DyeColorRecordDTO {
  /** 主键 id：编辑传、新增不传 */
  id?: string;
  /** 订单 id，可为 null（后端会造虚拟订单 id） */
  orderId?: string | null;
  /** 单机模式 0-否 1-是。四代机分支不校验它，仅入库；抓包样例传 1 */
  isSingle?: number;
  /** 门店 id（必填，19 位字符串） */
  storeId: string;
  /** 员工 id（手艺人 uid，用于反查进行中服务单） */
  employeeId?: string;
  /** 设备 MAC 码（必填，= dye_device_cream.device_code） */
  deviceCode: string;
  /** 设备名称（必填） */
  deviceName: string;
  /**
   * 色板/色系 id。四代机下 = `dye_color_config.id`。
   * **染膏行（outType=0）必须有值且能查到配置**，否则 processSingleColorRecord 会拐进双氧分支；
   * 双氧行（outType=1）不传。
   */
  colorId?: string;
  /** 标签，见 TAG_OPTIONS */
  tag?: number;
  /** 配方 id / 名称（本页手调无配方，配方名传空串与抓包一致） */
  recipeColorId?: string;
  recipeName?: string;
  /** 重量（克，必填，整数） */
  weight: number;
  /** 是否已执行（必填），新增恒 0 */
  isExecute: number;
  /** 出料模式 0-手动 1-智能 */
  outModel?: number;
  /** 出料类型 0-染膏 1-双氧 */
  outType?: number;
  /** 染膏名称（落库进 color_name；四代机 saveOrCreamDyeColorRecord 直接用它，不覆写） */
  colorName?: string;
  /**
   * 双氧名称（双氧行必填）。**必须命中配置 `device_dioxygen_four` 的 name**
   * （dev：3% / 4.5% / 6% / 7.5% / 9% / 10.5% / 12%），否则 createHydrogenDyeColorRecordPort4
   * 返回空列表，记录会存下来但没有任何管子，等于白发。
   * 页面用的 dioxygenConstList（3/6/9/12%）是它的子集，安全。
   */
  hydrogenName?: string;
  /** 执行场景，见 SCENE_TYPE */
  sceneType?: number;
}

/** 保存返回行（DyeFormulaColorRecordVO，只列本页用得到的字段） */
export interface DyeColorRecordVO {
  /** 调色记录 id —— **执行调色的入参 colorRecordId 就是它** */
  id?: string;
  /** 订单 id（新增时后端已填好，可能是虚拟订单 id）——轮询状态要用它 */
  orderId?: string;
  storeId?: string;
  employeeId?: string;
  deviceCode?: string;
  deviceName?: string;
  colorId?: string;
  colorCode?: string;
  colorName?: string;
  hydrogenName?: string;
  icon?: string;
  weight?: number;
  outType?: number;
  outModel?: number;
  tag?: number;
  model?: number;
  isExecute?: number;
  executeTime?: string;
  executeResult?: string;
  /** 操作结果代号，见 COLOR_STATUS_LABEL */
  status?: number;
  statusName?: string;
  /** 展示状态，见 SHOW_STATUS_LABEL */
  showStatus?: number;
  progressRate?: number;
  hex?: string;
  createTime?: string;
  /** 四代机几号管下料明细 */
  dyeColorRecordPort?: DyeColorRecordPortResult[];
}

/** 几号管下料结果（DyeColorRecordPortResultVO） */
export interface DyeColorRecordPortResult {
  /** 出料口序号 1~12 */
  devicePort?: number;
  /** 染膏/双氧名称 */
  name?: string;
  /** 该管重量（克） */
  weight?: number;
}

// ── 3. 几号管预览（getDyeColorRecordPortResult）────────────────────────────

/**
 * [APP] 四代机获取几号管下料。**这才是能拿到管号的接口**。
 *
 * ⚠️ 与需求描述的出入（以源码为准）：`/apiDye/order/dye/getDyeColorRecordPortName`
 * 入参是 `DyeColorRecordPortNameReq`（colorId + model + weight，colorId @NotNull 且是**色板 id**），
 * 返回 `DyeColorRecordPortNameVO`，**里面根本没有 devicePort 字段**，拿不到「几号管」。
 * 所以预览走本接口（入参就是保存用的同一份 List<DyeColorRecordsDTO>）。
 *
 * ⚠️ **染膏行是纯只读、双氧行不是**：impl 里染膏走 createCreamDyeColorRecord（只 new 对象不落库），
 * 而双氧走 createHydrogenDyeColorRecord —— 那个方法**真的 insert 一条 dye_formula_color_record**。
 * 因此本函数默认只发染膏行（见调用方），双氧的管号按固定规则本地推算，避免预览污染数据。
 */
export async function fetchColorRecordPortResult(
  dtoList: DyeColorRecordDTO[],
): Promise<DyeColorRecordPortResult[]> {
  const res = await http.post<Resp<DyeColorRecordPortResult[]>>(
    '/apiDye/order/dye/getDyeColorRecordPortResult',
    dtoList,
    { transformResponse: [bigIntSafeParse] },
  );
  return res.data?.result ?? res.data?.data ?? [];
}

/**
 * 双氧管号本地推算（对齐后端 createHydrogenDyeColorRecordPort4 + config `device_dioxygen_four`）：
 * 7 号管 = 3% 双氧、8 号管 = 12% 双氧，按浓度配比拆分总克数（HALF_UP 取整）。
 * 只用于「不落库的预览」，真实拆分仍以保存后的 dyeColorRecordPort 为准。
 */
export const HYDROGEN_PROPORTION: Record<string, { '3%'?: number; '12%'?: number }> = {
  '3%': { '3%': 1 },
  '4.5%': { '3%': 0.84, '12%': 0.15 },
  '6%': { '3%': 0.7, '12%': 0.33 },
  '7.5%': { '3%': 0.5, '12%': 0.5 },
  '9%': { '3%': 0.33, '12%': 0.7 },
  '10.5%': { '3%': 0.14, '12%': 0.86 },
  '12%': { '12%': 1 },
};

export function previewHydrogenPorts(hydrogenName: string, weight: number): DyeColorRecordPortResult[] {
  const p = HYDROGEN_PROPORTION[hydrogenName];
  if (!p || !weight) return [];
  const out: DyeColorRecordPortResult[] = [];
  if (p['3%']) out.push({ devicePort: 7, name: '3%', weight: Math.round(p['3%'] * weight) });
  if (p['12%']) out.push({ devicePort: 8, name: '12%', weight: Math.round(p['12%'] * weight) });
  return out;
}

// ── 4. 保存 / 执行 / 状态 ──────────────────────────────────────────────────

/**
 * [APP] 保存/更新调色记录（四代机走 savaOrUpdateColorRecordsByModelV4）。body = List<DTO>。
 *
 * 返回 `List<DyeFormulaColorRecordVO>`，每行带 **id（执行用）** 和 **orderId（轮询状态用）**。
 * 注意：后端**先按 orderId 清理「同订单未执行且不在本次列表里」的旧记录**（cleanInvalidRecords），
 * 所以同一虚拟订单下反复保存不会堆垃圾；但染膏行若 colorId 查不到 dye_color_config，
 * 该行会被静默丢弃（返回列表里就少一条），不报错——前端要按返回条数比对提示。
 */
export async function saveColorRecords(dtoList: DyeColorRecordDTO[]): Promise<DyeColorRecordVO[]> {
  const res = await http.post<Resp<DyeColorRecordVO[]>>(
    '/apiDye/order/dye/savaOrUpdateColorRecordsV2',
    dtoList,
    { transformResponse: [bigIntSafeParse] },
  );
  return res.data?.result ?? res.data?.data ?? [];
}

/**
 * [APP] 执行调色。**colorRecordId 走 query string**（@RequestParam），body 空。
 *
 * ⚠️ 现状（OrderColorServiceImpl#executeColorRecord + ZmgServiceImpl#changeDyeDevice 源码核实）：
 * 它调的是老智麦哥（zmg）HTTP 接口，而 `ZmgServiceImpl.changeDyeDevice` **整段实现已被注释掉**，
 * 只 `return new Resp<>()`（success 且 data=null）→ executeColorRecord 必定走进
 * 「设备遇到问题，暂时拿出染膏调配并申请故障上报！」分支返回业务失败，**不会向 EMQX 下发 dispense**。
 * 四代机真正的 MQTT 下料入口是 DyeMachineController#op（见 dispatchDispense）。
 * 这里仍按契约保留本接口，用于验证链路与错误展示。
 */
export async function executeColorRecord(colorRecordId: string): Promise<string | undefined> {
  const res = await http.post<Resp<string>>('/apiDye/order/dye/executeColorRecord', null, {
    params: { colorRecordId },
  });
  return res.data?.result ?? res.data?.data;
}

/** 调色状态（DyeColorStatusVO） */
export interface DyeColorStatus {
  /** 整单状态，见 COLOR_STATUS_LABEL */
  status?: number;
  executeResult?: string;
  records?: DyeColorRecordVO[];
}

/**
 * [APP] 新获取调色记录状态。**orderId @NotNull**，为空后端直接参数校验失败，
 * 所以必须先保存拿到返回里的 orderId（虚拟订单 id 也能查）再轮询。
 */
export async function fetchColorRecordsStatus(orderId: string): Promise<DyeColorStatus> {
  const res = await http.get<Resp<DyeColorStatus>>('/apiDye/order/dye/getNewDyeColorRecordsStatus', {
    params: { orderId },
    transformResponse: [bigIntSafeParse],
  });
  return res.data?.result ?? res.data?.data ?? {};
}

// ── 5. 直发 MQTT dispense（兜底，真正驱动设备的路径）───────────────────────

/** dispense 指令的单管参数（对接文档 §设备章节 / 模拟器 deviceTypes.ts 的 pumps 定义一致） */
export interface DispensePump {
  pump: number;
  colorCode: string;
  /** 下料克数（整数） */
  gram: number;
}

/**
 * 四代染色仪指令下发（DyeMachineController#op）。
 * **deviceId 是 MQTT 设备 ID（dm04-xxxx），不是 MAC 码**；deviceId/action 走 query string，
 * bizData 走 body（后端 `@RequestBody Map params` → 封进 payload.bizData）。
 *
 * 云端会同步等设备 cmdresp（超时按 DEVICE_NO_RESPONSE 失败），返回 Resp<Object>。
 */
export async function dispatchDispense(
  deviceId: string,
  bizData: { taskId: string; orderId?: string; formulaName?: string; pumps: DispensePump[] },
): Promise<unknown> {
  const res = await http.post<Resp<unknown>>('/dye/apiCraftsman/dyemachine/op', bizData, {
    params: { deviceId, action: 'dispense' },
  });
  return res.data?.result ?? res.data?.data;
}
