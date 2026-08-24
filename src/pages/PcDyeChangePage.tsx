/**
 * 换料记录（PC 管理端页，走 PC token）。
 *
 * 对接 dye-service 管理端接口（前缀 /mgtDye，见 src/api/dyeChangeRecord.ts）：
 *  列表 order/dye/dyeChangeRecordsStaff / 导出 order/dye/exportDyeChangeRecordsStaff。
 *
 * 页面保持**浅色**：模拟器页那套深色 theme.ts 是模拟器专用，不要往这里套。
 * 原型上本页**没有**设备列表页那个「更多筛选」漏斗按钮，主按钮文案是「搜索」不是「查询」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import {
  DEVICE_MODELS,
  DYE_CHANGE_STATUS_LABEL,
  DYE_CHANGE_STATUS_OPTIONS,
  MODEL_LABEL,
  exportDyeChangeRecord,
  fetchDyeChangePage,
  type DyeChangeRecordItem,
  type DyeChangeRecordQuery,
} from '../api/dyeChangeRecord';

const DATE_FMT = 'YYYY-MM-DD';
/** 空值统一占位（原型里门店/城市列大面积为空，见 api 文件注释里的后端口径说明） */
const dash = (v?: string | number | null) => (v === undefined || v === null || v === '' ? '-' : v);

/** 筛选表单草稿值（提交时再转成 DyeChangeRecordQuery） */
interface FilterValues {
  storeName?: string;
  macCode?: string;
  dyeChangeStatus?: number;
  model?: number;
  changeRange?: [Dayjs, Dayjs];
}

function toQuery(v: FilterValues): DyeChangeRecordQuery {
  return {
    storeName: v.storeName?.trim() || undefined,
    macCode: v.macCode?.trim() || undefined,
    dyeChangeStatus: v.dyeChangeStatus,
    model: v.model,
    dyeChangeStartDate: v.changeRange?.[0]?.format(DATE_FMT),
    dyeChangeEndDate: v.changeRange?.[1]?.format(DATE_FMT),
  };
}

export function PcDyeChangePage() {
  const [form] = Form.useForm<FilterValues>();

  const [query, setQuery] = useState<DyeChangeRecordQuery>({});
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<DyeChangeRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 严格模式下 effect 会跑两次，用 seq 丢弃过期响应，避免翻页快点时数据错位
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const { list, total: t } = await fetchDyeChangePage({ ...query, pageNum, pageSize });
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

  const onSearch = () => {
    setPageNum(1);
    setQuery(toQuery(form.getFieldsValue()));
  };

  const onReset = () => {
    form.resetFields();
    setPageNum(1);
    setQuery({});
  };

  const doExport = useCallback(async () => {
    setExporting(true);
    try {
      const r = await exportDyeChangeRecord(query);
      if (r.downloaded) message.success('导出文件已下载');
      else message.info(r.msg || '导出任务已提交');
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setExporting(false);
    }
  }, [query]);

  /**
   * 导出：后端拉全量（isPage=false），无筛选条件时是六万多条，很容易把 dev 拖死，
   * 所以「一个筛选条件都没有」时加一道二次确认（原型没有，防误触）。
   */
  const onExport = () => {
    const hasFilter = Object.values(query).some((v) => v !== undefined && v !== '');
    if (hasFilter) {
      void doExport();
      return;
    }
    Modal.confirm({
      title: '确认导出全量换料记录？',
      content: `当前无任何筛选条件，后端会拉取全部约 ${total} 条记录，耗时较长。建议先按门店/时间筛选。`,
      okText: '仍然导出',
      cancelText: '取消',
      okButtonProps: { 'data-testid': 'dyeChange.export-confirm' },
      onOk: doExport,
    });
  };

  const columns: ColumnsType<DyeChangeRecordItem> = useMemo(
    () => [
      {
        title: '序号',
        width: 56,
        render: (_v, _r, i) => (pageNum - 1) * pageSize + i + 1,
      },
      { title: '所属店铺', dataIndex: 'storeName', width: 180, ellipsis: true, render: (v: string) => dash(v) },
      { title: '店铺类型', dataIndex: 'storeTypeStr', width: 100, render: (v: string) => dash(v) },
      { title: 'MAC码', dataIndex: 'macCode', width: 140, render: (v: string) => dash(v) },
      { title: '设备名称', dataIndex: 'deviceName', width: 140, ellipsis: true, render: (v: string) => dash(v) },
      {
        title: '设备类型',
        dataIndex: 'model',
        width: 140,
        // modelName 后端已按 DyeConstant.Model 填好，兜底再按 model 码映射一次
        render: (v: number, r) => r.modelName || MODEL_LABEL[v] || dash(v),
      },
      { title: '所在城市', dataIndex: 'cityName', width: 100, render: (v: string) => dash(v) },
      {
        title: '换料状态',
        dataIndex: 'status',
        width: 100,
        // 枚举外的码原样显示数字，不猜
        render: (v: number) => (v == null ? '-' : DYE_CHANGE_STATUS_LABEL[v] ?? v),
      },
      { title: '换料时间', dataIndex: 'changeDate', width: 150, render: (v: string) => dash(v) },
    ],
    [pageNum, pageSize],
  );

  return (
    <div style={{ padding: 12 }}>
      <Card size="small" style={{ marginBottom: 8 }}>
        <Form form={form} layout="inline" size="small" onFinish={onSearch} style={{ rowGap: 8 }}>
          <Form.Item label="店铺名称" name="storeName">
            <Input data-testid="dyeChange.storeName" placeholder="请输入店铺名称" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="MAC码" name="macCode">
            <Input data-testid="dyeChange.macCode" placeholder="请输入MAC码" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="换料状态" name="dyeChangeStatus">
            <Select
              data-testid="dyeChange.status"
              placeholder="请选择换料状态"
              allowClear
              options={DYE_CHANGE_STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
              style={{ width: 130 }}
            />
          </Form.Item>
          <Form.Item label="换料时间" name="changeRange">
            <DatePicker.RangePicker data-testid="dyeChange.changeRange" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item label="设备类型" name="model">
            <Select
              data-testid="dyeChange.model"
              placeholder="请选择设备类型"
              allowClear
              options={DEVICE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
              style={{ width: 160 }}
            />
          </Form.Item>
        </Form>

        <Space style={{ marginTop: 8 }} wrap>
          <Button data-testid="dyeChange.search" type="primary" icon={<SearchOutlined />} onClick={onSearch}>
            搜索
          </Button>
          <Button data-testid="dyeChange.reset" icon={<ReloadOutlined />} onClick={onReset}>
            重置
          </Button>
          <Button data-testid="dyeChange.export" loading={exporting} onClick={onExport}>
            导出
          </Button>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<DyeChangeRecordItem>
          // storeId 实际是换料记录自身 id（见 api 文件注释），当行 key 够用
          rowKey={(r) => r.storeId || `${r.macCode}-${r.changeDate}`}
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1100 }}
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
