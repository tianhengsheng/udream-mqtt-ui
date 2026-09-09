/**
 * 设备列表「批量升级」（PC 管理端）：选设备 → 选四代机上架固件（一颗芯片一个包）→ 批量推送 ota 指令。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/DyeOtaUpgradeController.java  POST /dye/apiUnified/ota/batchPush
 *  - dye/dye-api/.../req/DyeOtaBatchPushReq.java（firmwareId + deviceCodes）
 *  - dye/dye-api/.../vo/DyeOtaBatchPushResultVO.java（pushed / skipped[{deviceCode, reason}]）
 *
 * 2026-09-04 任务化口径：勾选即落库（离线/从未上线的也建待升级记录），在线的立刻推一次，
 * 其余等 status 上线补推或 job（5 分钟）重扫；同一时刻只允许一个活跃批次，人工「取消」只取消
 * 待升级且未 ack 的设备。后端校验：仅四代机 / 固件带 chip / 型号匹配 / 同设备同芯片未终态去重。
 * 本期不做静默升级（upgrade_mode 恒 0）。
 */
import { http } from './client';
import { bigIntSafeParse } from './common';
import { fetchFirmwarePage, type FirmwareItem } from './firmware';
import type { Resp } from '../types';

export interface OtaBatchPushResult {
  batchId?: string;
  pushedCount: number;
  skippedCount: number;
  /** 已建任务但设备离线，等上线补推 / job 重扫 */
  pendingCount: number;
  pushed: string[];
  pending: string[];
  skipped: { deviceCode: string; reason: string }[];
}

/** 当前活跃批次汇总（DyeOtaBatchSummaryVO）；batchId 为空 = 没有活跃批次 */
export interface OtaBatchSummary {
  batchId?: string | null;
  firmwareId?: string;
  targetVersion?: string;
  chip?: string;
  pushTime?: string;
  createUserName?: string;
  total: number;
  /** 待升级且未 ack（可取消） */
  pendingCount: number;
  /** 已 ack 等进度 + 下载/安装/重启中 */
  inProgressCount: number;
  successCount: number;
  failedCount: number;
}

export async function batchPushOta(firmwareId: string | number, deviceCodes: string[]): Promise<OtaBatchPushResult> {
  const res = await http.post<Resp<OtaBatchPushResult>>(
    '/dye/apiUnified/ota/batchPush',
    { firmwareId, deviceCodes },
    { transformResponse: [bigIntSafeParse] },
  );
  const r = res.data?.result;
  return {
    batchId: r?.batchId == null ? undefined : String(r.batchId),
    pushedCount: r?.pushedCount ?? 0,
    skippedCount: r?.skippedCount ?? 0,
    pendingCount: r?.pendingCount ?? 0,
    pushed: r?.pushed ?? [],
    pending: r?.pending ?? [],
    skipped: r?.skipped ?? [],
  };
}

export async function fetchCurrentBatch(): Promise<OtaBatchSummary | null> {
  const res = await http.get<Resp<OtaBatchSummary>>('/dye/apiUnified/ota/batch/current', {
    transformResponse: [bigIntSafeParse],
    _silent: true, // 接口仅 feat_mqtt_dye 分支有，其他环境 404，状态条按"无活跃批次"处理
  });
  const r = res.data?.result;
  if (!r || r.batchId == null) return null;
  return { ...r, batchId: String(r.batchId) };
}

/** 取消批次：只取消待升级且未 ack 的设备，返回取消台数 */
export async function cancelBatch(batchId: string): Promise<number> {
  const res = await http.post<Resp<number>>('/dye/apiUnified/ota/batch/cancel', null, { params: { batchId } });
  return res.data?.result ?? 0;
}

/** 可推送的固件：四代机(model=4) + 上架(status=1)，两颗芯片各自的包都列出来 */
export async function fetchPushableFirmwares(): Promise<FirmwareItem[]> {
  const { list } = await fetchFirmwarePage({ pageNum: 1, pageSize: 200, status: 1 });
  return list.filter((f) => f.model === 4 && !!f.chip);
}
