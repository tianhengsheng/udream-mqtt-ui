/**
 * 设备升级记录（PC 管理端）接口，对接 dye-service OTA 升级记录：
 *  列表 /dye/apiUnified/ota/record/list（POST，DyeOtaRecordListReq）
 *  版本下拉 /dye/apiUnified/ota/record/versions（GET，记录表出现过的目标版本）
 *  导出 /dye/apiUnified/ota/record/export（GET query string，直写 xls 流）
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/DyeOtaUpgradeController.java
 *  - dye/dye-api/.../req/DyeOtaRecordListReq.java、vo/DyeOtaRecordVO.java
 *
 * 口径（2026-09-03 拍板）：一条记录 = 一颗芯片一次升级；「升级时间」= 推送时间 push_time；
 * 本期只有四代机（二/三代 App 蓝牙刷机不上报）；失败原因原样透传设备 failed 报文的 message。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import { DEVICE_MODELS, MODEL_LABEL } from './dye';
import { CHIP_LABEL } from './firmware';
import type { PageResp, Resp } from '../types';

export { DEVICE_MODELS, MODEL_LABEL, CHIP_LABEL };

/**
 * 升级状态（dye_ota_upgrade_record.status，后端 DyeConstant.OtaStatus，2026-09-03 重定义）：
 * 1~5 与设备 ota/progress 的 step 一一对应，0 是云端建记录初始值。
 */
export const OTA_STATUS_OPTIONS = [
  { value: 0, label: '待升级' },
  { value: 1, label: '下载中' },
  { value: 2, label: '安装中' },
  { value: 3, label: '重启中' },
  { value: 4, label: '成功' },
  { value: 5, label: '失败' },
] as const;

/** 终态 */
export const OTA_FINAL_STATUS = [4, 5];
/** 带进度条的过程态 */
export const OTA_IN_FLIGHT_STATUS = [1, 2, 3];

export const OTA_STATUS_LABEL: Record<number, string> = Object.fromEntries(
  OTA_STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

/** 升级记录行（DyeOtaRecordVO），字段名与后端 1:1 */
export interface OtaRecordItem {
  /** 19 位雪花 id，按字符串处理 */
  id?: string;
  deviceId?: string;
  /** 设备 MAC 码 */
  deviceCode?: string;
  deviceModel?: number;
  taskId?: string;
  /** esp32p4 / esp32c5 */
  chip?: string;
  currentVersion?: string;
  targetVersion?: string;
  firmwareId?: string;
  status?: number;
  progress?: number;
  /** 推送时间 = 页面「升级时间」 */
  pushTime?: string;
  lastReportTime?: string;
  errorMessage?: string;
}

/** 列表/导出共用查询条件（DyeOtaRecordListReq） */
export interface OtaRecordQuery {
  pageNum?: number;
  pageSize?: number;
  counted?: boolean;
  /** MAC 码，后端 eq 精确匹配 */
  deviceCode?: string;
  targetVersion?: string;
  chip?: string;
  status?: number;
  deviceModel?: number;
  /** 固件包 id（后端保留的精确过滤项，页面当前不传） */
  firmwareId?: string | number;
  /** 批次 id（后端保留，页面当前不传） */
  batchId?: string;
  /** 推送时间区间，yyyy-MM-dd HH:mm:ss（后端 LocalDateTime） */
  startTime?: string;
  endTime?: string;
}

/**
 * 跳到「设备升级记录」时的预置筛选：固件管理「查看升级详情」/ 设备列表状态条「查看记录」都只带
 * 版本 + 芯片 + 设备类型 回填到表单（不带 firmwareId / batchId 做隐藏过滤，用户进来可随意改条件继续查）。
 * 跳页只是切菜单、没有路由参数，所以用模块级变量交接：跳前 set，记录页挂载时 take（取一次即清）。
 */
export interface OtaRecordPreset {
  targetVersion?: string;
  /** 芯片长码（esp32p4 / esp32c5），只有四代机固件有 */
  chip?: string;
  deviceModel?: number;
}
let pendingPreset: OtaRecordPreset | null = null;
export const setOtaRecordPreset = (p: OtaRecordPreset) => { pendingPreset = p; };
export const takeOtaRecordPreset = (): OtaRecordPreset | null => {
  const p = pendingPreset;
  pendingPreset = null;
  return p;
};

export async function fetchOtaRecordPage(
  query: OtaRecordQuery,
): Promise<{ list: OtaRecordItem[]; total: number }> {
  const res = await http.post<PageResp<OtaRecordItem>>(
    '/dye/apiUnified/ota/record/list',
    { counted: true, ...query },
    { transformResponse: [bigIntSafeParse] },
  );
  const body = res.data || {};
  const list = body.result ?? body.data ?? body.records ?? [];
  const total = body.page?.total ?? body.pageInfo?.total ?? body.total ?? list.length;
  return { list, total };
}

/** 版本号下拉：记录表出现过的目标版本（最近推送的在前） */
export async function fetchOtaVersions(deviceModel?: number): Promise<string[]> {
  const res = await http.get<Resp<string[]>>('/dye/apiUnified/ota/record/versions', {
    params: deviceModel == null ? {} : { deviceModel },
  });
  return res.data?.result ?? [];
}

/** 导出：后端直写 xls 流，blob 收；回 JSON 就把提示透出来（套路同 dye.ts#exportDyeDevice） */
export async function exportOtaRecord(query: OtaRecordQuery): Promise<{ downloaded: boolean; msg?: string }> {
  const res = await http.get('/dye/apiUnified/ota/record/export', {
    params: query,
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
  // 后端 writeExcel 出的是 application/vnd.ms-excel 的 .xls
  a.download = `设备升级记录_${stamp}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { downloaded: true };
}
