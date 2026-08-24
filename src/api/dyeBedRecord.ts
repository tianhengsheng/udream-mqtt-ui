/**
 * AI 洗头床记录（洗头记录）管理端接口。字段严格对齐后端 VO/Req，勿凭空加字段。
 *
 * 后端出处（只读参考，勿改后端仓库 udream-micro-service）：
 *  - controller：dye/dye-service/.../controller/DyeBedRecordController.java
 *  - 入参：dye/dye-service/.../req/DyeBedRecordQueryReq.java（继承 common-base PageReq）
 *  - 出参：dye/dye-service/.../vo/DyeBedRecordVO.java
 *  - 枚举：dye/dye-api/.../contants/DyeConstant.java（Model / Gender / RinseType /
 *          WaterPressure / BedStatus / ConnectionType / IsDisinfect）
 *  - 门店类型：base 的 StoreConstantEnum（key='type'）
 *  - 列口径：DyeBedRecordServiceImpl#excelDyeBedRecord 的 headers/fields 数组（导出表头即列定义）
 *
 * ⚠️ 前缀是 `/dye/apiUnified/...`，不是设备列表页那套 `/mgtDye`。
 * 该前缀未登记在后端 .claude/conventions/api-route-naming.md，但 dev 网关实测放行（见 test-playbook）。
 *
 * ⚠️ **dev 部署版本比 feat_mqtt_dye 分支新**：dev 的 DyeBedRecordVO/QueryReq 多一个 `orderNo`
 * （订单号），且导出列「关联订单」取的是 orderNo 而非 orderId。以 dev 实测响应为准，
 * 本文件按「有 orderNo 用 orderNo，没有回退 orderId」写，两个版本都能跑。
 *
 * 后端全局 Jackson 把 Long 序列化成 String（common-web DefaultWebMvcConfigurer），
 * 这里仍挂 bigIntSafeParse 兜底，防 19 位 orderId 掉精度。
 * LocalDateTime 收发格式统一 `yyyy-MM-dd HH:mm:ss`（同上配置类）。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import type { PageResp } from '../types';

/** 后端 LocalDateTime 的收发格式 */
export const DATETIME_FMT = 'YYYY-MM-DD HH:mm:ss';

/** 设备型号（DyeConstant.Model）。洗头记录里恒为 25，但筛选项按枚举全量给。 */
export const BED_MODEL_OPTIONS = [
  { value: 0, label: '非自研二代机(第三方00)' },
  { value: 2, label: '自研二代机(02)' },
  { value: 3, label: '三代机(03)' },
  { value: 4, label: '四代机(04)' },
  { value: 10, label: '护理机(HL)' },
  { value: 15, label: '底色识别枪(DS)' },
  { value: 20, label: '发质检测仪(FZ)' },
  { value: 25, label: 'AI洗头床(XTC)' },
] as const;

/**
 * 执行状态（DyeConstant.BedStatus）。
 *
 * ⚠️ dev 上 63 条里有 **34 条 `bedStatus=10`**（均为 2026-04-29 的老数据），
 * 该值在**任何分支的 BedStatus 枚举里都不存在**（现枚举「已开始」是 15），推断是枚举改值前的历史数据。
 * 后端 `getDesc(10)` 返回 empty → 导出列会是空串；前端 `enumLabel` 按约定**原样显示 `10`**，
 * 便于一眼看出是脏数据，别擅自映射成「已开始」。
 */
export const BED_STATUS_OPTIONS = [
  { value: 15, label: '已开始' },
  { value: 30, label: '已完成' },
  { value: 35, label: '手动终止' },
  { value: 40, label: '异常结束' },
] as const;

/**
 * 操作项目 / 洗头模式（DyeConstant.RinseType，原「冲洗类型」字段复用）。
 * 括号里是 RinseType.minutes（预计总洗头分钟数的来源）。
 */
export const RINSE_TYPE_OPTIONS = [
  { value: 0, label: '男士速洗' }, // 5min
  { value: 1, label: '女士速洗' }, // 8min
  { value: 2, label: '洗护模式' }, // 13min
  { value: 3, label: '养护模式' }, // 15min
  { value: 4, label: '消毒模式' }, // 0min
] as const;

/** 操作类型 / 连接下料方式（DyeConstant.ConnectionType） */
export const CONNECTION_TYPE_OPTIONS = [
  { value: 0, label: 'wifi' },
  { value: 1, label: '蓝牙' },
  { value: 2, label: '推送' },
] as const;

/** 性别（DyeConstant.Gender） */
export const GENDER_OPTIONS = [
  { value: 0, label: '未知' },
  { value: 1, label: '男' },
  { value: 2, label: '女' },
] as const;

/** 水压强度（DyeConstant.WaterPressure），本页表格未展示，留给后续详情用 */
export const WATER_PRESSURE_OPTIONS = [
  { value: 1, label: '1档' },
  { value: 2, label: '2档' },
  { value: 3, label: '3档' },
  { value: 4, label: '4档' },
] as const;

/** 是否消毒（DyeConstant.IsDisinfect） */
export const IS_DISINFECT_OPTIONS = [
  { value: 0, label: '否' },
  { value: 1, label: '是' },
] as const;

/**
 * 门店类型（base StoreConstantEnum，key='type'）。
 * 后端导出走 `StoreConstantEnum.getValueByKey("type", storeType)`，这里 1:1 抄 type 那一组
 * （newType 组另有 51/52/53，本字段用不到）。
 */
export const STORE_TYPE_OPTIONS = [
  { value: 0, label: '单剪店' },
  { value: 1, label: '优剪Plus店' },
  { value: 2, label: '优剪空间' },
  { value: 3, label: '一代店' },
  { value: 4, label: 'TRACE HAIR' },
  { value: 5, label: '三代店' },
  { value: 6, label: '中庭优剪店' },
  { value: 7, label: 'ORANGE HAIR' },
  { value: 8, label: '型刻' },
] as const;

/** 枚举 options → { code: desc } 查表 */
const toLabelMap = (opts: ReadonlyArray<{ value: number; label: string }>): Record<number, string> =>
  Object.fromEntries(opts.map((o) => [o.value, o.label]));

export const BED_MODEL_LABEL = toLabelMap(BED_MODEL_OPTIONS);
export const BED_STATUS_LABEL = toLabelMap(BED_STATUS_OPTIONS);
export const RINSE_TYPE_LABEL = toLabelMap(RINSE_TYPE_OPTIONS);
export const CONNECTION_TYPE_LABEL = toLabelMap(CONNECTION_TYPE_OPTIONS);
export const GENDER_LABEL = toLabelMap(GENDER_OPTIONS);
export const WATER_PRESSURE_LABEL = toLabelMap(WATER_PRESSURE_OPTIONS);
export const IS_DISINFECT_LABEL = toLabelMap(IS_DISINFECT_OPTIONS);
export const STORE_TYPE_LABEL = toLabelMap(STORE_TYPE_OPTIONS);

/**
 * 枚举取名：查不到的值原样显示数字（不猜、不吞），null/undefined 显示 '-'。
 * 后端 getDesc 查不到返回 Optional.empty()→导出成空串，前端保留原值更利于排查脏数据。
 */
export function enumLabel(map: Record<number, string>, code?: number | null): string {
  if (code === null || code === undefined) return '-';
  return map[code] ?? String(code);
}

/** 洗头记录行（DyeBedRecordVO），字段名与后端 1:1 */
export interface DyeBedRecordItem {
  /** 19 位雪花 id，字符串 */
  id?: string;
  createTime?: string;
  updateTime?: string;
  /** 设备 MAC 码 */
  deviceCode?: string;
  /** 设备型号 @see DyeConstant.Model（洗头床恒 25） */
  model?: number;
  /**
   * 设备名称。保存记录时后端写死 `"洗头床"`（DyeBedRecordServiceImpl#saveDyeBedRecord
   * `setModelName("洗头床")`），所以列表「设备名称」列直接取它。
   */
  modelName?: string;
  storeId?: string;
  storeName?: string;
  /** 门店类型 @see StoreConstantEnum key='type' */
  storeType?: number;
  craftsmanId?: string;
  craftsmanName?: string;
  /** 服务订单主键 id，19 位雪花 id，**必须字符串**。注意它不是页面展示的「关联订单」 */
  orderId?: string;
  /**
   * 订单号，19 位，**列表「关联订单」列展示的就是它**（后端导出 fields 第一项也是 orderNo）。
   * 表里只存 orderId，orderNo 由 fillOrderNo() 走服务订单缓存批量回填。
   */
  orderNo?: string;
  customerId?: string;
  customerName?: string;
  itemId?: string;
  /** 服务项目名称 */
  itemName?: string;
  /** 性别 @see DyeConstant.Gender */
  gender?: number;
  /** 是否消毒 @see DyeConstant.IsDisinfect */
  isDisinfect?: number;
  /** 水压强度 @see DyeConstant.WaterPressure */
  waterPressure?: number;
  /** 操作项目/洗头模式 @see DyeConstant.RinseType */
  rinseType?: number;
  /** 实际洗头分钟数 */
  actualWashingMinute?: number;
  /** 预计总洗头分钟数（= RinseType.minutes） */
  expectTotalTime?: number;
  /** 过程水温（字符串，设备上报原文） */
  waterTemperature?: string;
  /**
   * 洗头时间。**注意：实体 DyeBedRecord 上没有 washingTime 字段**
   * （只有 washingStartTime / washingEndTime），MapStruct 按名映射不到 → 该字段恒为 null。
   * 后端导出的「洗头时间」列取的是 createTime，前端同口径：`washingTime ?? createTime`。
   */
  washingTime?: string;
  /** 执行状态 @see DyeConstant.BedStatus */
  bedStatus?: number;
  /** 操作类型/连接下料方式 @see DyeConstant.ConnectionType */
  connectionType?: number;
  orgId?: string;
  orgName?: string;
  cityOrgId?: string;
  cityOrgName?: string;
  /** 城市 id */
  city?: string;
  cityName?: string;
  createUserId?: string;
  createUserName?: string;
  updateUserId?: string;
  updateUserName?: string;
}

/** 列表/导出共用查询条件（DyeBedRecordQueryReq） */
export interface DyeBedRecordQuery {
  pageNum?: number;
  pageSize?: number;
  /** PageReq.counted 默认 false；要显示「共 N 条」必须显式传 true */
  counted?: boolean;
  storeName?: string;
  /** 服务订单主键 id 精确匹配。后端是 Long，19 位雪花 id 走字符串传，Jackson 能正常转 */
  orderId?: string;
  /**
   * 订单号精确匹配。**页面「订单编号」筛选用这个**——列表展示的「关联订单」就是 orderNo，
   * 用户复制粘贴的必然是它。后端拿 orderNo 反查服务订单缓存得到 orderId 再过滤。
   * 实测 dev 两个字段都能查（同一单结果一致）。
   */
  orderNo?: string;
  deviceCode?: string;
  model?: number;
  customerName?: string;
  bedStatus?: number;
  /** LocalDateTime，格式 `yyyy-MM-dd HH:mm:ss`，按 create_time 过滤 */
  startTime?: string;
  endTime?: string;
}

/** 分页查询洗头记录。筛选口径：storeName/customerName 模糊，其余精确等值。 */
export async function fetchBedRecordPage(
  query: DyeBedRecordQuery,
): Promise<{ list: DyeBedRecordItem[]; total: number }> {
  const res = await http.post<PageResp<DyeBedRecordItem>>(
    '/dye/apiUnified/dyeBedRecord/pageDyeBedRecord',
    { counted: true, ...query },
    { transformResponse: [bigIntSafeParse] },
  );
  const body = res.data || {};
  const list = body.result ?? body.data ?? body.records ?? [];
  const total = body.page?.total ?? body.pageInfo?.total ?? body.total ?? list.length;
  return { list, total };
}

/**
 * 导出洗头记录。**入参走 query string，不是 body**（后端形参没有 @RequestBody）。
 *
 * 契约写 `Resp<Void>`，实现（DyeBedRecordServiceImpl#excelDyeBedRecord）是把 xlsx 直接写进
 * HttpServletResponse，所以实际拿到文件二进制；无数据时 BizAssert 抛业务异常回 JSON。
 * 两种形态都兼容，与 exportDyeDevice 同套路。
 */
export async function exportBedRecord(query: DyeBedRecordQuery): Promise<{ downloaded: boolean; msg?: string }> {
  // 导出后端会 setIsPage(false) 全量拉，分页参数没意义，剔掉避免误导
  const { pageNum: _p, pageSize: _s, counted: _c, ...rest } = query;
  void _p;
  void _s;
  void _c;
  const res = await http.get('/dye/apiUnified/dyeBedRecord/excelDyeBedRecord', {
    params: rest,
    responseType: 'blob',
  });
  const blob = res.data as Blob;
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
  a.download = `洗头记录_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { downloaded: true };
}
