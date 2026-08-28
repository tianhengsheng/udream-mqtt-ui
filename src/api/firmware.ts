/**
 * 设备固件升级管理（PC 管理端）接口 + OSS 直传固件包。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - dye/dye-service/.../controller/DyeFirmwareUpgradeController.java
 *  - dye/dye-api/.../req/DyeFirmwareUpgradeSaveReq.java、vo/DyeFirmwareUpgradeListVO.java
 *  - base/base-service/.../controller/common/CommOssController.java（getUploadSign 直传签名）
 *
 * 芯片维度（与后端 DyeFirmwareUpgrade 实体一致）：一行 = 一颗芯片的一个固件包。
 *  四代机(model=4)：chip 必填（esp32p4-P4主控 / esp32c5-C5），两颗芯片各自独立版本号、独立上下架；
 *  其他型号不区分芯片，chip 为空。
 */
import SparkMD5 from 'spark-md5';
import { http } from './client';
import { bigIntSafeParse, pick } from './common';
import type { PageResp, Resp } from '../types';

/** 芯片枚举，code 与后端 DyeConstant.Chip、MQTT 协议 targets 完全一致 */
export const CHIPS = [
  { value: 'esp32p4', label: 'P4 主控' },
  { value: 'esp32c5', label: 'C5' },
] as const;

export const CHIP_LABEL: Record<string, string> = Object.fromEntries(
  CHIPS.map((c) => [c.value, c.label]),
);

export interface FirmwareItem {
  id?: string | number;
  createTime?: string;
  sort?: number;
  model?: number;
  /** 四代机必填：esp32p4 / esp32c5；其他型号为空 */
  chip?: string;
  firmwareUpgradeUrl?: string;
  status?: number;
  version?: string;
  md5?: string;
  size?: number;
  createUserId?: string | number;
  createUserName?: string;
}

export interface FirmwareQuery {
  pageNum?: number;
  pageSize?: number;
  startTime?: string;
  endTime?: string;
  status?: number;
}

export async function fetchFirmwarePage(
  query: FirmwareQuery,
): Promise<{ list: FirmwareItem[]; total: number }> {
  const res = await http.post<PageResp<FirmwareItem>>(
    '/dye/apiUnified/firmwareUpgrade/listDyeFirmwareUpgrade',
    { counted: true, ...query },
    { transformResponse: [bigIntSafeParse] },
  );
  const body = res.data || {};
  const list = body.result ?? body.data ?? body.records ?? [];
  const total = body.page?.total ?? body.pageInfo?.total ?? body.total ?? list.length;
  return { list, total };
}

/** 保存/更新固件（后端按 id 是否存在区分新增/编辑；四代机必须带 chip，由后端校验兜底） */
export async function saveFirmware(payload: FirmwareItem): Promise<Resp<void>> {
  const res = await http.post<Resp<void>>(
    '/dye/apiUnified/firmwareUpgrade/saveOrUpdateDyeFirmwareUpgrade',
    payload,
  );
  return res.data;
}

/** 上下架 */
export async function updateFirmwareStatus(id: string | number, status: number): Promise<Resp<void>> {
  const res = await http.post<Resp<void>>(
    '/dye/apiUnified/firmwareUpgrade/updateDyeFirmwareUpgradeStatus',
    { id, status },
  );
  return res.data;
}

// ---- OSS 直传（PostObject）----

interface UploadSignOut {
  uploadName?: string;
  expire?: string;
  outHost?: string;
  outPolicy?: string;
  outAccessKeyId?: string;
  outSignature?: string;
  outSuccessActionStatus?: string;
}

/** 浏览器端分片算 md5（固件包 2~3MB 毫秒级），供设备下载后校验完整性 */
export function fileMd5(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const CHUNK = 2 * 1024 * 1024;
    const spark = new SparkMD5.ArrayBuffer();
    const reader = new FileReader();
    let offset = 0;
    reader.onload = (e) => {
      spark.append(e.target?.result as ArrayBuffer);
      offset += CHUNK;
      if (offset < file.size) readNext();
      else resolve(spark.end());
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    const readNext = () => reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK));
    readNext();
  });
}

/**
 * 固件包 OSS 直传：getUploadSign 取 PostObject 签名 → 表单直传 → 返回可下载 url。
 * bucketNameType=0（NORMAL 通用桶，与后端 dev 面板上传一致）。
 */
export async function uploadFirmwareToOss(file: File): Promise<{ url: string }> {
  const signRes = await http.get<Resp<UploadSignOut>>('/basics/common/oss/getUploadSign', {
    params: { bucketNameType: 0, tt: Date.now() },
  });
  const sign = pick(signRes.data);
  if (!sign?.outHost || !sign.uploadName || !sign.outPolicy) {
    throw new Error('获取上传签名失败');
  }
  // 保留扩展名（uploadName 本身是 uuid 无后缀，固件下载不依赖后缀，带上便于人工辨认）
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const key = sign.uploadName + ext;
  const fd = new FormData();
  fd.append('key', key);
  fd.append('policy', sign.outPolicy);
  fd.append('OSSAccessKeyId', sign.outAccessKeyId ?? '');
  fd.append('signature', sign.outSignature ?? '');
  fd.append('success_action_status', sign.outSuccessActionStatus ?? '200');
  fd.append('file', file);
  const resp = await fetch(sign.outHost, { method: 'POST', body: fd });
  if (!resp.ok && resp.status !== 200 && resp.status !== 204) {
    throw new Error(`OSS 上传失败: HTTP ${resp.status}`);
  }
  return { url: `${sign.outHost}/${key}` };
}
