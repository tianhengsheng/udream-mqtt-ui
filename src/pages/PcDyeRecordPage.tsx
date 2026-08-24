/**
 * 调色记录（PC 管理端页，走 PC token）。
 *
 * 对接 dye-service 管理端接口（前缀 /mgtDye，见 src/api/dyeColorRecord.ts）：
 *  列表 order/dye/getDyeRecord / 导出 order/dye/exportDyeRecord。
 *
 * 页面保持**浅色**：模拟器页那套深色 theme.ts 是模拟器专用，不要往这里套。
 * 布局与交互对齐同类页 PcDeviceListPage（筛选行 + 漏斗「更多筛选」+ 查询/重置/导出 + 底部分页）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FilterOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import {
  CONNECTION_TYPE_LABEL,
  DEVICE_MODELS,
  MODEL_LABEL,
  STATUS_LABEL,
  STATUS_OPTIONS,
  exportDyeRecord,
  fetchDyeRecordPage,
  type DyeColorRecordItem,
  type DyeColorRecordQuery,
} from '../api/dyeColorRecord';

const DATE_FMT = 'YYYY-MM-DD';

/** 空值统一占位（后端大量字段可空：颜色/物料/城市/提示等） */
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? <span style={{ color: '#bfbfbf' }}>-</span> : String(v));

/** 执行状态标签色：已完成绿 / 失败红 / 等待中蓝 / 已取消灰 */
const STATUS_COLOR: Record<number, string> = { 0: 'red', 11: 'blue', 12: 'blue', 13: 'gold', 20: 'default', 21: 'green' };

/** 筛选表单草稿值（提交时再转成 DyeColorRecordQuery） */
interface FilterValues {
  storeName?: string;
  deviceCode?: string;
  status?: number;
  model?: number;
  // —— 「更多筛选」里的字段 ——
  executeRange?: [Dayjs, Dayjs];
}

/**
 * 表单值 → 查询条件。
 *
 * 时间边界要**自己补到时分秒**：后端字段是 LocalDateTime（`yyyy-MM-dd HH:mm:ss`），
 * 且比较用的是开区间 `gt(startTime)` / `lt(endTime)`。只传日期（默认 00:00:00）会把
 * 结束当天整天的数据全漏掉，所以结束时间补 23:59:59。
 */
function toQuery(v: FilterValues): DyeColorRecordQuery {
  return {
    storeName: v.storeName?.trim() || undefined,
    deviceCode: v.deviceCode?.trim() || undefined,
    status: v.status,
    model: v.model,
    startTime: v.executeRange?.[0] ? `${v.executeRange[0].format(DATE_FMT)} 00:00:00` : undefined,
    endTime: v.executeRange?.[1] ? `${v.executeRange[1].format(DATE_FMT)} 23:59:59` : undefined,
  };
}

export function PcDyeRecordPage() {
  const [form] = Form.useForm<FilterValues>();

  const [query, setQuery] = useState<DyeColorRecordQuery>({});
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<DyeColorRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [moreFilter, setMoreFilter] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 严格模式下 effect 会跑两次，用 seq 丢弃过期响应，避免翻页快点时数据错位
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const { list, total: t } = await fetchDyeRecordPage({ ...query, pageNum, pageSize });
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

  useEffect(() => {
    void load();
  }, [load]);

  const onQuery = () => {
    setPageNum(1);
    setQuery(toQuery(form.getFieldsValue()));
  };

  const onReset = () => {
    form.resetFields();
    setPageNum(1);
    setQuery({});
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const r = await exportDyeRecord(query);
      if (r.downloaded) message.success('导出文件已下载');
      // 后端超 3 万条会回 JSON 提示「导出数据需小于3万」，原样透出让用户去收窄筛选
      else message.warning(r.msg || '导出未返回文件');
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setExporting(false);
    }
  };

  const columns: ColumnsType<DyeColorRecordItem> = useMemo(
    () => [
      { title: '序号', width: 56, render: (_v, _r, i) => (pageNum - 1) * pageSize + i + 1 },
      { title: '设备名称', dataIndex: 'deviceName', width: 120, ellipsis: true, render: dash },
      { title: 'MAC码', dataIndex: 'deviceCode', width: 140, render: dash },
      {
        title: '设备类型',
        dataIndex: 'model',
        width: 130,
        // 后端给了 modelName（DyeConstant.Model 翻译），为空时用本地映射兜底，再不行显示原始值
        render: (v: number, r) => r.modelName || r.deviceModelName || MODEL_LABEL[v] || dash(v),
      },
      { title: '所属店铺', dataIndex: 'storeName', width: 160, ellipsis: true, render: dash },
      { title: '服务类型', dataIndex: 'storeTypeStr', width: 90, render: dash },
      { title: '所在城市', dataIndex: 'cityName', width: 90, render: dash },
      { title: '手艺人', dataIndex: 'employeeName', width: 90, ellipsis: true, render: dash },
      {
        title: '下料类型',
        dataIndex: 'connectionType',
        width: 90,
        // -1 是建表默认值（未记录连接方式，dev 实测约占 1/3），枚举里没有它，
        // 和 null 一样按空值渲染成 -，别把裸的「-1」怼给用户。详见 api 层 CONNECTION_TYPE_LABEL 注释。
        render: (v: number) => CONNECTION_TYPE_LABEL[v] ?? dash(null),
      },
      { title: '下料颜色', dataIndex: 'colorName', width: 100, ellipsis: true, render: dash },
      {
        title: '下料重量',
        dataIndex: 'weight',
        width: 90,
        // 0 克是合法值，不能被 dash 的空判吃掉，所以这里单独判 null/undefined
        render: (v: number) => (v == null ? dash(v) : `${v}克`),
      },
      { title: '物料1名称', dataIndex: 'materialNameOne', width: 110, ellipsis: true, render: dash },
      { title: '物料2名称', dataIndex: 'materialNameTwo', width: 110, ellipsis: true, render: dash },
      { title: '物料3名称', dataIndex: 'materialNameThree', width: 110, ellipsis: true, render: dash },
      { title: '下料时间', dataIndex: 'executeTime', width: 150, render: dash },
      {
        title: '执行状态',
        dataIndex: 'status',
        width: 90,
        render: (v: number) =>
          v == null ? dash(v) : <Tag color={STATUS_COLOR[v] ?? 'default'}>{STATUS_LABEL[v] ?? v}</Tag>,
      },
      {
        title: '提示',
        dataIndex: 'executeResult',
        width: 160,
        ellipsis: true,
        // 失败原因文案可能很长，截断后靠 Tooltip 看全文
        render: (v: string) => (v ? <Tooltip title={v}>{v}</Tooltip> : dash(v)),
      },
    ],
    [pageNum, pageSize],
  );

  return (
    <div style={{ padding: 12 }}>
      <Card size="small" style={{ marginBottom: 8 }}>
        <Form form={form} layout="inline" size="small" onFinish={onQuery} style={{ rowGap: 8 }}>
          <Form.Item label="店铺名称" name="storeName">
            <Input data-testid="dyeRecord.storeName" placeholder="请输入店铺名称" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="MAC码" name="deviceCode">
            <Input data-testid="dyeRecord.deviceCode" placeholder="请输入MAC码" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="执行状态" name="status">
            <Select
              data-testid="dyeRecord.status"
              placeholder="请选择执行状态"
              allowClear
              options={STATUS_OPTIONS}
              style={{ width: 130 }}
            />
          </Form.Item>
          <Form.Item label="设备类型" name="model">
            <Select
              data-testid="dyeRecord.model"
              placeholder="请选择设备类型"
              allowClear
              options={DEVICE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
              style={{ width: 160 }}
            />
          </Form.Item>

          {moreFilter && (
            <Form.Item label="下料时间" name="executeRange">
              <DatePicker.RangePicker data-testid="dyeRecord.executeRange" style={{ width: 220 }} />
            </Form.Item>
          )}
        </Form>

        <Space style={{ marginTop: 8 }} wrap>
          <Tooltip title={moreFilter ? '收起更多筛选' : '更多筛选（下料时间）'}>
            <Button
              data-testid="dyeRecord.filter-toggle"
              icon={<FilterOutlined />}
              type={moreFilter ? 'primary' : 'default'}
              ghost={moreFilter}
              onClick={() => setMoreFilter((v) => !v)}
            />
          </Tooltip>
          <Button data-testid="dyeRecord.query" type="primary" icon={<SearchOutlined />} onClick={onQuery}>
            查询
          </Button>
          <Button data-testid="dyeRecord.reset" icon={<ReloadOutlined />} onClick={onReset}>
            重置
          </Button>
          <Tooltip title="后端全量导出，超 3 万条会被拒绝，建议先收窄筛选条件">
            <Button data-testid="dyeRecord.export" loading={exporting} onClick={onExport}>
              导出
            </Button>
          </Tooltip>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<DyeColorRecordItem>
          rowKey={(r) => r.id || `${r.deviceCode}-${r.executeTime}`}
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1900 }}
          pagination={{
            current: pageNum,
            pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPageNum(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>
    </div>
  );
}
