/**
 * 调色记录（PC 管理端，dye-service /mgtDye）接口。字段严格对齐后端 DTO/VO，勿凭空加字段。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/DyeOrderController.java#listDyeColorRecord / #exportDyeRecord
 *  - dye/dye-api/.../req/DyeRecordReq.java（继承 common-base PageReq）
 *  - dye/dye-api/.../vo/DyeRecordResp.java
 *  - dye/dye-service/.../service/impl/DyeOrderServiceImpl.java#listDyeColorRecord / #buildLambdaQuery
 *
 * 单独成文件而不是塞进 dye.ts：dye.ts 的定位是「设备维度」（设备列表/划拨/远程控制），
 * 本文件是「下料流水维度」，两者 VO 完全不同，混在一起会误导后来人。
 *
 * 注意：后端全局 Jackson 把 Long 统一序列化成 String（common-web DefaultWebMvcConfigurer），
 * 所以 id/storeId/employeeId 回来就是字符串；这里仍挂 bigIntSafeParse 兜底，防某接口漏配。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import type { PageResp } from '../types';

/**
 * 操作结果代号（DyeConstant.DyeChangeStatus）。
 *
 * **注意 12/13 查不到**：后端 buildLambdaQuery 里写死了 `.in(status, 0, 11, 20, 21)`，
 * 「执行中(12)/待取走(13)」被硬过滤掉，永远不会出现在列表里。所以：
 *  - 渲染映射（STATUS_LABEL）保留全部 6 个，防将来后端放开过滤时列表显示成裸数字；
 *  - 筛选下拉（STATUS_OPTIONS）只给能查出数据的 4 个，避免用户选了 12/13 永远空列表。
 */
export const STATUS_LABEL: Record<number, string> = {
  0: '失败',
  11: '等待中',
  12: '执行中',
  13: '待取走',
  20: '已取消',
  21: '已完成',
};

/** 执行状态筛选项（只列后端实际会返回的 4 个，原因见 STATUS_LABEL 注释） */
export const STATUS_OPTIONS = [0, 11, 20, 21].map((v) => ({ value: v, label: STATUS_LABEL[v] }));

/**
 * 连接下料方式（DyeConstant.ConnectionType：0-wifi、1-蓝牙、2-推送）。
 *
 * **实测还有 -1**：`dye_formula_color_record.connection_type` 的**建表默认值就是 -1**，
 * 代表「未记录连接方式」（老数据 / 下料回调没带这个字段）。dev 环境实测占比约 1/3。
 * 枚举里没有 -1，后端 `ConnectionType.getDesc(-1)` 返回 `Optional.empty()`，
 * 所以前端也**统一按空值渲染成 `-`**，与后端口径一致，别显示成裸的「-1」。
 */
export const CONNECTION_TYPE_LABEL: Record<number, string> = {
  0: 'WIFI',
  1: '蓝牙',
  2: '推送',
};

/**
 * 设备型号（DyeConstant.Model）。
 * 复用 dye.ts 已有定义，避免同一份值域抄两遍后走样（那边被设备列表页用着，是同一个后端枚举）。
 */
export { DEVICE_MODELS, MODEL_LABEL } from './dye';

/** 调色记录行（DyeRecordResp），字段名与后端 1:1 */
export interface DyeColorRecordItem {
  id?: string;
  storeId?: string;
  storeName?: string;
  /** 门店类型：0=单剪店，1=优剪Plus店，2=优剪空间，3=优剪店，4=TRACE HAIR，5=精剪店，6=中庭优剪店，7=ORANGE HAIR */
  storeType?: number;
  /** 门店类型中文（列表里这列叫「服务类型」，后端按品牌/服务类型枚举翻译） */
  storeTypeStr?: string;
  deviceName?: string;
  /** 设备代码（MAC码） */
  deviceCode?: string;
  /** 颜色名称（列表里这列叫「下料颜色」） */
  colorName?: string;
  employeeId?: string;
  /** 员工名称（列表里这列叫「手艺人」） */
  employeeName?: string;
  cityName?: string;
  /** 重量（克） */
  weight?: number;
  /** 下料时间 yyyy-MM-dd HH:mm:ss */
  executeTime?: string;
  /** 操作结果代号，见 STATUS_LABEL */
  status?: number;
  /** 执行结果（列表里这列叫「提示」，失败原因等文案） */
  executeResult?: string;
  /** 业务类型：0=新美店，1=优剪店 */
  bizType?: number;
  /** 合作版本：0=基础版，1=品牌版，2=染发版 */
  versionType?: number;
  model?: number;
  /** 设备型号中文（后端 DyeConstant.Model.getValue 翻译） */
  modelName?: string;
  /** 设备型号中文（旧字段，后端 BeanUtils 拷贝来的，可能为空，展示时排在 modelName 后兜底） */
  deviceModelName?: string;
  /** 类型 0-染膏、1=双氧（已是中文） */
  typeName?: string;
  /** 连接下料方式，见 CONNECTION_TYPE_LABEL */
  connectionType?: number;
  materialNameOne?: string;
  materialNameTwo?: string;
  materialNameThree?: string;
}

/** 列表/导出共用查询条件（DyeRecordReq 的前端可用子集） */
export interface DyeColorRecordQuery {
  pageNum?: number;
  pageSize?: number;
  /** 是否统计总条数，PageReq 默认 false；本页要显示「共 N 条」，统一传 true */
  counted?: boolean;
  cityId?: number;
  storeName?: string;
  /** 设备代码（MAC码），后端是 like 模糊匹配 */
  deviceCode?: string;
  status?: number;
  /**
   * 下料开始/结束时间，格式 `yyyy-MM-dd HH:mm:ss`（后端 LocalDateTime，
   * 全局 Jackson 格式化器见 common-web DefaultWebMvcConfigurer）。
   *
   * **边界是开区间**：后端用的是 `gt(startTime)` / `lt(endTime)`，不是 ge/le。
   * 所以选「某天」时结束时间要给到 23:59:59（调用方 toQuery 已按此拼），否则会漏当天的数据。
   */
  startTime?: string;
  endTime?: string;
  bizType?: number;
  versionType?: number;
  model?: number;
}

/**
 * 调色记录分页。
 *
 * 后端走 MyBatis-Plus selectPage 真分页（数据量 20w+，务必别改成一次性拉全量）。
 * `counted` 不传时 PageReq 默认 false → 总数为 0，「共 N 条」会显示成 0，所以这里强制补 true。
 */
export async function fetchDyeRecordPage(
  query: DyeColorRecordQuery,
): Promise<{ list: DyeColorRecordItem[]; total: number }> {
  const res = await http.post<PageResp<DyeColorRecordItem>>(
    '/mgtDye/order/dye/getDyeRecord',
    { counted: true, ...query },
    { transformResponse: [bigIntSafeParse] },
  );
  const body = res.data || {};
  const list = body.result ?? body.data ?? body.records ?? [];
  const total = body.page?.total ?? body.pageInfo?.total ?? body.total ?? list.length;
  return { list, total };
}

/**
 * 导出调色记录。**入参走 query string，不是 body**（后端 `@GetMapping` 且形参无 `@RequestBody`）。
 *
 * 契约上写的是 `Resp<Boolean>`，但实现（DyeOrderServiceImpl#exportDyeRecord）是直接把 xlsx
 * 写进 HttpServletResponse 的 attachment 流里 —— 实际拿到的是**文件二进制**。
 * 这里按 dye.ts#exportDyeDevice 同款套路用 blob 收，命中文件就下载，回 JSON 就把提示透出来。
 *
 * 后端限制：导出会把 isPage 置 false 全量查，**超过 3 万条直接返回业务失败「导出数据需小于3万」**
 * （此时是 JSON 不是文件，走下面的 isJson 分支透出提示），所以导出前建议先收窄筛选条件。
 */
export async function exportDyeRecord(
  query: DyeColorRecordQuery,
): Promise<{ downloaded: boolean; msg?: string }> {
  // 导出不分页，别把 pageNum/pageSize/counted 带过去污染
  const { pageNum: _p, pageSize: _s, counted: _c, ...filters } = query;
  const res = await http.get('/mgtDye/order/dye/exportDyeRecord', {
    params: filters,
    responseType: 'blob',
  });
  const blob = res.data as Blob;
  // 后端把错误（如超 3 万条）以 JSON 形式吐在 blob 里，此时 content-type 是 application/json
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
  a.download = `调色记录_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { downloaded: true };
}
