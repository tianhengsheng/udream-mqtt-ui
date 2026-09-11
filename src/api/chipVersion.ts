/**
 * 「芯片 + 版本号」公共结构（后端 ChipVersionVO），三处共用：
 *  - 版本号下拉 /dye/apiUnified/ota/record/versions 的选项
 *  - 升级记录 / 设备列表的版本筛选入参 `version: ChipVersion[]`（多选为或关系）
 *  - 设备列表行的 `version: ChipVersion[]`（前端自行拼接展示）
 * 芯片一律短码 p4 / c5，非四代机为空串。
 */
import { http } from './client';
import type { Resp } from '../types';

export interface ChipVersion {
  /** p4 / c5；非四代机 '' */
  chip: string;
  version: string;
}

export const CHIP_SHORT_LABEL: Record<string, string> = { p4: 'P4 主控', c5: 'C5' };

/** 长码(esp32p4) / 短码(p4) 都归一成短码；空或不认识的返回 '' */
export const toShortChip = (code?: string | null): string => {
  const c = (code || '').trim().toLowerCase();
  if (c === 'esp32p4' || c === 'p4') return 'p4';
  if (c === 'esp32c5' || c === 'c5') return 'c5';
  return '';
};

/** Select 的 value 用字符串：`chip|version`（chip 可为空） */
export const encodeCV = (cv: ChipVersion) => `${toShortChip(cv.chip)}|${cv.version}`;
export const decodeCV = (s: string): ChipVersion => {
  const i = s.indexOf('|');
  return i < 0 ? { chip: '', version: s } : { chip: s.slice(0, i), version: s.slice(i + 1) };
};

/** 下拉 / 列表展示：`v0.2.5（P4 主控）`，无芯片就裸版本号 */
export const chipVersionLabel = (cv: ChipVersion) =>
  cv.chip ? `${cv.version}（${CHIP_SHORT_LABEL[cv.chip] ?? cv.chip}）` : cv.version;

/** 设备列表版本号列拼接：`P4:x C5:y`（空格分隔），无芯片直接版本号；空数组返回 '' */
export const joinChipVersions = (list?: ChipVersion[] | null) =>
  (list || []).map((v) => (v.chip ? `${v.chip.toUpperCase()}:${v.version}` : v.version)).join(' ');

/** 版本号下拉：记录表出现过的芯片 + 目标版本（最近推送的在前），两个页面共用 */
export async function fetchChipVersions(deviceModel?: number): Promise<ChipVersion[]> {
  const res = await http.get<Resp<ChipVersion[]>>('/dye/apiUnified/ota/record/versions', {
    params: deviceModel == null ? {} : { deviceModel },
    _silent: true, // 接口仅 feat_mqtt_dye 分支有，其他环境 404，调用方自带空数组兜底
  });
  return (res.data?.result ?? []).map((v) => ({ chip: toShortChip(v.chip), version: v.version }));
}

/**
 * GET 导出的 query string 序列化：`version` 是对象数组，axios 默认会写成 `version[0][chip]`，
 * Spring 只认 `version[0].chip` 索引写法，这里手动拼；其余标量参数照常。
 */
export function serializeWithChipVersions(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (k === 'version' && Array.isArray(v)) {
      (v as ChipVersion[]).forEach((cv, i) => {
        sp.append(`version[${i}].chip`, cv.chip ?? '');
        sp.append(`version[${i}].version`, cv.version ?? '');
      });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => sp.append(k, String(x)));
      return;
    }
    sp.append(k, String(v));
  });
  return sp.toString();
}
