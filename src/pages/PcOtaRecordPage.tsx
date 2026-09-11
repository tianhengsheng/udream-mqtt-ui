/**
 * 设备升级记录（PC 管理端页，走 PC token）。
 *
 * 对接 dye-service /dye/apiUnified/ota/record/*（见 src/api/otaRecord.ts）。
 * 原型：筛选 MAC码 / 版本号(下拉) / 升级时间 / 升级状态 / 设备类型，列 版本号 / MAC码 / 设备类型 /
 * 升级状态(失败带原因) / 升级时间，按钮 查询 / 重置 / 导出。
 * 记录按芯片粒度，一台四代机升一次会出 P4、C5 两行，所以版本号列附带芯片标签区分。
 * 页面保持**浅色**（模拟器那套深色 theme.ts 不要往这里套）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, Select, Space, Table, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { ChipVersionSelect } from '../components/ChipVersionSelect';
import { CHIP_SHORT_LABEL, decodeCV, encodeCV, toShortChip, type ChipVersion } from '../api/chipVersion';
import {
  DEVICE_MODELS,
  MODEL_LABEL,
  OTA_STATUS_LABEL,
  OTA_STATUS_OPTIONS,
  exportOtaRecord,
  fetchOtaRecordPage,
  takeOtaRecordPreset,
  type OtaRecordItem,
  type OtaRecordPreset,
  type OtaRecordQuery,
} from '../api/otaRecord';

const DATETIME_FMT = 'YYYY-MM-DD HH:mm:ss';
/** 设备类型默认四代机：本期只有四代机走 MQTT 远程升级，记录表里也只有它 */
const DEFAULT_MODEL = 4;
const dash = (v?: string | number | null) => (v === undefined || v === null || v === '' ? '-' : v);


interface FilterValues {
  deviceCode?: string;
  /** 版本号多选，`chip|version` 编码串（见 ChipVersionSelect） */
  version?: string[];
  pushRange?: [Dayjs, Dayjs];
  status?: number;
  deviceModel?: number;
}

function toQuery(v: FilterValues): OtaRecordQuery {
  return {
    deviceCode: v.deviceCode?.trim() || undefined,
    version: v.version?.length ? v.version.map(decodeCV) : undefined,
    status: v.status,
    deviceModel: v.deviceModel,
    startTime: v.pushRange?.[0]?.startOf('day').format(DATETIME_FMT),
    endTime: v.pushRange?.[1]?.endOf('day').format(DATETIME_FMT),
  };
}

export function PcOtaRecordPage() {
  const [form] = Form.useForm<FilterValues>();
  // 固件管理「查看升级详情」/ 状态条「查看记录」跳来时的预置筛选：版本/芯片/型号回填表单，就是普通的表单条件
  const [preset] = useState<OtaRecordPreset | null>(() => takeOtaRecordPreset());
  // 预置的版本 + 芯片合成一个 ChipVersion（芯片长码转短码；非四代机不带芯片）
  const presetCV: ChipVersion | null = preset?.targetVersion
    ? { chip: (preset.deviceModel ?? DEFAULT_MODEL) === DEFAULT_MODEL ? toShortChip(preset.chip) : '', version: preset.targetVersion }
    : null;
  const [query, setQuery] = useState<OtaRecordQuery>(() => (preset ? {
    version: presetCV ? [presetCV] : undefined,
    deviceModel: preset.deviceModel ?? DEFAULT_MODEL,
  } : { deviceModel: DEFAULT_MODEL }));
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<OtaRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const { list, total: t } = await fetchOtaRecordPage({ ...query, pageNum, pageSize });
      if (seq !== seqRef.current) return;
      setRows(list);
      setTotal(t);
    } catch {
      if (seq !== seqRef.current) return;
      setRows([]);
      setTotal(0);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [query, pageNum, pageSize]);

  useEffect(() => { void load(); }, [load]);

  // 预置筛选回填到表单（只在首次挂载）
  useEffect(() => {
    if (!preset) return;
    form.setFieldsValue({
      version: presetCV ? [encodeCV(presetCV)] : undefined,
      deviceModel: preset.deviceModel ?? DEFAULT_MODEL,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, form]);

  const onSearch = () => {
    setPageNum(1);
    setQuery(toQuery(form.getFieldsValue()));
  };
  const onReset = () => {
    form.resetFields();
    setPageNum(1);
    setQuery({ deviceModel: DEFAULT_MODEL });
  };
  const onExport = async () => {
    setExporting(true);
    try {
      const r = await exportOtaRecord(query);
      if (r.downloaded) message.success('导出文件已下载');
      else message.info(r.msg || '导出任务已提交');
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setExporting(false);
    }
  };

  const columns: ColumnsType<OtaRecordItem> = useMemo(
    () => [
      { title: '序号', width: 50, render: (_v, _r, i) => (pageNum - 1) * pageSize + i + 1 },
      {
        title: '版本号',
        dataIndex: 'targetVersion',
        width: 150,
        // 芯片用灰字弱化跟在版本号后面（一台四代机一次升级出 P4/C5 两行，靠它区分）
        render: (v: string, r) => (
          <span>
            {dash(v)}
            {r.chip && <span style={{ color: '#8c8c8c', marginLeft: 6 }}>（{CHIP_SHORT_LABEL[r.chip] ?? r.chip}）</span>}
          </span>
        ),
      },
      { title: '升级前版本', dataIndex: 'currentVersion', width: 100, render: (v: string) => dash(v) },
      { title: 'MAC码', dataIndex: 'deviceCode', width: 110, render: (v: string) => dash(v) },
      {
        title: '设备类型',
        dataIndex: 'deviceModel',
        width: 110,
        render: (v: number) => (v == null ? '-' : MODEL_LABEL[v] ?? v),
      },
      {
        title: '升级状态',
        dataIndex: 'status',
        // 原型是纯文本：下载中 / 安装中 / 重启中 / 成功 / 失败（原因：xxx），不用标签、不画进度条；
        // 不定宽吃剩余宽度，失败原因过长时单行省略不撑高，悬浮看全文
        ellipsis: { showTitle: false },
        render: (v: number, r) => {
          if (v == null) return '-';
          const label = OTA_STATUS_LABEL[v] ?? String(v);
          if (v === 5 && r.errorMessage) {
            const text = `${label}（原因：${r.errorMessage}）`;
            return <Tooltip title={text} placement="topLeft">{text}</Tooltip>;
          }
          return label;
        },
      },
      { title: '升级时间', dataIndex: 'pushTime', width: 150, render: (v: string) => dash(v) },
      { title: '最后上报', dataIndex: 'lastReportTime', width: 150, render: (v: string) => dash(v) },
    ],
    [pageNum, pageSize],
  );

  return (
    <div style={{ padding: 12 }}>
      <Card size="small" style={{ marginBottom: 8 }}>
        <Form
          form={form}
          layout="inline"
          size="small"
          onFinish={onSearch}
          style={{ rowGap: 8 }}
          initialValues={{ deviceModel: DEFAULT_MODEL }}
        >
          <Form.Item label="MAC码" name="deviceCode">
            <Input data-testid="otaRecord.deviceCode" placeholder="请输入MAC码" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="版本号" name="version">
            <ChipVersionSelect testid="otaRecord.version" extra={presetCV ? [presetCV] : undefined} />
          </Form.Item>
          <Form.Item label="升级时间" name="pushRange">
            <DatePicker.RangePicker data-testid="otaRecord.pushRange" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item label="升级状态" name="status">
            <Select
              data-testid="otaRecord.status"
              placeholder="请选择"
              allowClear
              options={OTA_STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
              style={{ width: 120 }}
            />
          </Form.Item>
          <Form.Item label="设备类型" name="deviceModel">
            <Select
              data-testid="otaRecord.model"
              placeholder="请选择"
              allowClear
              options={DEVICE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
              style={{ width: 160 }}
            />
          </Form.Item>
        </Form>
        <Space style={{ marginTop: 8 }} wrap>
          <Button data-testid="otaRecord.search" type="primary" icon={<SearchOutlined />} onClick={onSearch}>查询</Button>
          <Button data-testid="otaRecord.reset" icon={<ReloadOutlined />} onClick={onReset}>重置</Button>
          <Button data-testid="otaRecord.export" loading={exporting} onClick={onExport}>导出</Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<OtaRecordItem>
          data-testid="otaRecord.table"
          size="small"
          rowKey={(r) => String(r.id ?? r.taskId)}
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 960 }}
          pagination={{
            current: pageNum,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => { setPageNum(p); setPageSize(s); },
          }}
        />
      </Card>
    </div>
  );
}
