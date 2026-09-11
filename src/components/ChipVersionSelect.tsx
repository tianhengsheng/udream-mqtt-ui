/**
 * 「版本号」多选下拉（升级记录 / 设备列表共用）：选项 = 记录表出现过的芯片 + 目标版本，
 * 展开时才拉、只拉一次（接口仅 feat_mqtt_dye 分支有，进页就请求会在其他环境弹 404）。
 * 表单里的值是 `chip|version` 编码串数组，提交前用 decodeCV 转回对象数组。
 */
import { useState } from 'react';
import { Select } from 'antd';
import {
  chipVersionLabel,
  decodeCV,
  encodeCV,
  fetchChipVersions,
  type ChipVersion,
} from '../api/chipVersion';

interface Props {
  value?: string[];
  onChange?: (v: string[]) => void;
  testid?: string;
  /** 预置项（跳页带来的版本）不在下拉里时也要能显示 */
  extra?: ChipVersion[];
  width?: number;
}

export function ChipVersionSelect({ value, onChange, testid, extra, width = 220 }: Props) {
  const [options, setOptions] = useState<ChipVersion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = () => {
    if (loaded) return;
    setLoaded(true);
    fetchChipVersions().then(setOptions).catch(() => setOptions([]));
  };
  const known = new Set(options.map(encodeCV));
  const merged = [...(extra || []).filter((e) => !known.has(encodeCV(e))), ...options];
  // 已选但不在选项里的（比如选项还没拉）也要能显示出文案
  const chosen = (value || []).filter((v) => !merged.some((m) => encodeCV(m) === v)).map(decodeCV);
  const all = [...chosen, ...merged];
  return (
    <Select
      data-testid={testid}
      mode="multiple"
      placeholder="请选择"
      allowClear
      showSearch
      maxTagCount="responsive"
      value={value}
      onChange={onChange}
      onOpenChange={(open) => { if (open) load(); }}
      optionFilterProp="label"
      options={all.map((cv) => ({ value: encodeCV(cv), label: chipVersionLabel(cv) }))}
      style={{ width }}
    />
  );
}
