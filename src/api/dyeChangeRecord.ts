/**
 * dye-service 管理端「换料记录」接口（/mgtDye/order/dye/*）。字段严格对齐后端 DTO/VO，勿凭空加字段。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/DyeOrderController.java:79-89（列表 + 导出两个端点）
 *  - dye/dye-service/.../service/impl/DyeOrderServiceImpl.java:671（dyeChangeRecordsStaff 实现）
 *  - dye/dye-api/.../req/DyeChangeStaffQueryDTO.java、vo/DyeChangeRecordsStaffVO.java
 *  - dye/dye-api/.../contants/DyeConstant.java:649（DyeChangeStatus 换料状态枚举）
 *
 * 设备型号枚举与设备列表页共用，直接复用 dye.ts 的 DEVICE_MODELS/MODEL_LABEL（只读引用，不改那个文件）。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import { DEVICE_MODELS, MODEL_LABEL } from './dye';
import type { PageResp } from '../types';

export { DEVICE_MODELS, MODEL_LABEL };

/**
 * 换料状态（后端 DyeConstant.DyeChangeStatus，dye-api/.../contants/DyeConstant.java:649）：
 * 0-失败、11-等待中、12-执行中、13-待取走、20-已取消、21-已完成。
 * 落库字段 dye_change_record.status，筛选参数是 dyeChangeStatus（`eq` 精确匹配）。
 */
export const DYE_CHANGE_STATUS_OPTIONS = [
  { value: 0, label: '失败' },
  { value: 11, label: '等待中' },
  { value: 12, label: '执行中' },
  { value: 13, label: '待取走' },
  { value: 20, label: '已取消' },
  { value: 21, label: '已完成' },
] as const;

export const DYE_CHANGE_STATUS_LABEL: Record<number, string> = Object.fromEntries(
  DYE_CHANGE_STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

/** 换料记录行（DyeChangeRecordsStaffVO），字段名与后端 1:1，这个 VO 很精简就这些字段 */
export interface DyeChangeRecordItem {
  /**
   * 注意后端这里塞的是**换料记录自身的 id**（`setStoreId(record.getId())`，
   * DyeOrderServiceImpl.java:711），不是门店 id。前端只拿它当 rowKey 用，别当门店 id 传给别的接口。
   * 19 位雪花 ID，全程按字符串处理。
   */
  storeId?: string;
  /** 所属店铺名 */
  storeName?: string;
  /** MAC码（dye_change_record.device_code） */
  macCode?: string;
  /** 设备名称（取自 dye_device_store 缓存） */
  deviceName?: string;
  /** 所在城市 */
  cityName?: string;
  /** 换料状态，见 DYE_CHANGE_STATUS_OPTIONS */
  status?: number;
  /** 换料时间，后端已格式化成 'yyyy-MM-dd HH:mm' 字符串（取的是 update_time） */
  changeDate?: string;
  /** 设备型号，见 DEVICE_MODELS */
  model?: number;
  modelName?: string;
  /** 店铺类型码 / 中文（StoreConstantEnum newType） */
  storeType?: number;
  storeTypeStr?: string;
}

/** 列表/导出共用查询条件（DyeChangeStaffQueryDTO 的前端可用子集） */
export interface DyeChangeRecordQuery {
  pageNum?: number;
  pageSize?: number;
  /** 是否统计总条数，PageReq 默认 false；本页要显示「共 N 条」，统一传 true */
  counted?: boolean;
  /** 城市ID */
  cityId?: number;
  /** 门店名称（后端拿去 base 服务模糊查门店，再按 storeId 集合过滤） */
  storeName?: string;
  /** MAC码，后端是 **eq 精确匹配**，不是模糊 */
  macCode?: string;
  /** yyyy-MM-dd（后端 LocalDate），比对的是 **create_time** 的日期部分 */
  dyeChangeStartDate?: string;
  dyeChangeEndDate?: string;
  /** 换料状态，见 DYE_CHANGE_STATUS_OPTIONS */
  dyeChangeStatus?: number;
  /** 业务类型：0=新美店，1=优剪店 */
  bizType?: number;
  /** 合作版本：0=基础版，1=品牌版，2=染发版 */
  versionType?: number;
  /** 设备型号，见 DEVICE_MODELS */
  model?: number;
}

/**
 * 换料记录分页。
 *
 * **后端既有行为（不是前端 bug，别去「修」）**：
 * 门店信息（所属店铺/店铺类型/所在城市）只有在**传了 storeName 或 cityId** 时才有值 ——
 * 实现里 `fetchStores(storeIds)` 用的是「筛选条件反查出来的 storeIds」，
 * 不传门店筛选时 storeIds 为空集合，storeMap 就是空的，这三列全部回 null。
 * 所以默认全量列表下这几列大面积为空是正常的，页面统一显示 `-`。
 */
export async function fetchDyeChangePage(
  query: DyeChangeRecordQuery,
): Promise<{ list: DyeChangeRecordItem[]; total: number }> {
  const res = await http.post<PageResp<DyeChangeRecordItem>>(
    '/mgtDye/order/dye/dyeChangeRecordsStaff',
    { counted: true, ...query },
    { transformResponse: [bigIntSafeParse] },
  );
  const body = res.data || {};
  const list = body.result ?? body.data ?? body.records ?? [];
  const total = body.page?.total ?? body.pageInfo?.total ?? body.total ?? list.length;
  return { list, total };
}

/**
 * 导出换料记录。**GET + query string**（后端 `@GetMapping` 无 `@RequestBody`），
 * 端点 `/mgtDye/order/dye/exportDyeChangeRecordsStaff`（DyeOrderController.java:86）。
 *
 * 契约上写 `Resp<Boolean>`，但实现（DyeOrderServiceImpl#exportDyeChangeRecordsStaff）是把 xlsx
 * 直接写进 HttpServletResponse 的 attachment 流 —— 实际拿到的是**文件二进制**，
 * 与设备列表页导出同一套路，所以这里同样用 blob 收、两种形态都兼容。
 *
 * 注意后端导出会 `setIsPage(false)` 拉**全量**（当前 dev 六万多条），无筛选条件直接点会很慢，
 * 页面侧对「无任何筛选」加了二次确认。
 */
export async function exportDyeChangeRecord(
  query: DyeChangeRecordQuery,
): Promise<{ downloaded: boolean; msg?: string }> {
  const res = await http.get('/mgtDye/order/dye/exportDyeChangeRecordsStaff', {
    params: { ...query },
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
  a.download = `换料记录_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { downloaded: true };
}
