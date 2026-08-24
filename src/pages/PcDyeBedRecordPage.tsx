/**
 * 洗头记录（AI 洗头床记录，PC 管理端页，走 PC token）。
 *
 * 对接 dye-service 管理端接口（前缀 `/dye/apiUnified`，见 src/api/dyeBedRecord.ts）：
 *  列表 dyeBedRecord/pageDyeBedRecord（POST JSON body）
 *  导出 dyeBedRecord/excelDyeBedRecord（GET query string，回 xlsx 二进制）
 *
 * 列定义与后端导出表头严格对齐（DyeBedRecordServiceImpl#excelDyeBedRecord 的 headers/fields），
 * 枚举文案全部取自 DyeConstant，映射表集中在 src/api/dyeBedRecord.ts，页面只负责渲染。
 *
 * 页面保持**浅色**：模拟器页那套深色 theme.ts 是模拟器专用，不要往这里套。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FilterOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import {
  BED_MODEL_LABEL,
  BED_MODEL_OPTIONS,
  BED_STATUS_LABEL,
  BED_STATUS_OPTIONS,
  CONNECTION_TYPE_LABEL,
  DATETIME_FMT,
  GENDER_LABEL,
  RINSE_TYPE_LABEL,
  STORE_TYPE_LABEL,
  enumLabel,
  exportBedRecord,
  fetchBedRecordPage,
  type DyeBedRecordItem,
  type DyeBedRecordQuery,
} from '../api/dyeBedRecord';

/** 空值统一占位 */
const dash = (v?: string | number | null) => (v === null || v === undefined || v === '' ? '-' : String(v));

/**
 * id 类字段占位：除空值外，**'0' 也当没有**。
 * dev 上 18 条记录 orderNo 为 null、orderId 落的是 0（无关联订单的自测数据），
 * 直接渲染会在「关联订单」列显示一个没意义的 0。
 */
const dashId = (v?: string | number | null) => (v === '0' || v === 0 ? '-' : dash(v));

/** 执行状态色：已完成绿 / 已开始蓝 / 手动终止灰 / 异常结束红 */
const BED_STATUS_COLOR: Record<number, string> = {
  15: 'processing',
  30: 'green',
  35: 'default',
  40: 'red',
};

/** 筛选表单草稿值（提交时再转成 DyeBedRecordQuery） */
interface FilterValues {
  dateRange?: [Dayjs, Dayjs];
  storeName?: string;
  /** 「订单编号」输入框，对应后端 orderNo（列表展示的就是 orderNo，见下 toQuery 注释） */
  orderNo?: string;
  deviceCode?: string;
  // —— 「更多筛选」里的字段 ——
  customerName?: string;
  bedStatus?: number;
  model?: number;
}

/**
 * 表单值 → 查询条件。
 * 时间按 create_time 过滤；后端只在 start/end 同时存在时才补 00:00:00 / 23:59:59，
 * 所以这里自己把两端补齐到整天，避免只选一天却查不到当天下午的记录。
 *
 * 「订单编号」发 **orderNo** 而不是 orderId：列表「关联订单」列展示的是 orderNo，
 * 用户复制粘贴的必然是那串数字；发 orderId 会永远查不中（两者是不同的 19 位 id）。
 */
function toQuery(v: FilterValues): DyeBedRecordQuery {
  return {
    storeName: v.storeName?.trim() || undefined,
    orderNo: v.orderNo?.trim() || undefined,
    deviceCode: v.deviceCode?.trim() || undefined,
    customerName: v.customerName?.trim() || undefined,
    bedStatus: v.bedStatus,
    model: v.model,
    startTime: v.dateRange?.[0]?.startOf('day').format(DATETIME_FMT),
    endTime: v.dateRange?.[1]?.endOf('day').format(DATETIME_FMT),
  };
}

export function PcDyeBedRecordPage() {
  const [form] = Form.useForm<FilterValues>();

  const [query, setQuery] = useState<DyeBedRecordQuery>({});
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<DyeBedRecordItem[]>([]);
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
      const { list, total: t } = await fetchBedRecordPage({ ...query, pageNum, pageSize });
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
      const r = await exportBedRecord(query);
      if (r.downloaded) message.success('导出文件已下载');
      else message.info(r.msg || '导出任务已提交');
    } catch {
      /* 全局拦截器已提示（如无数据时后端 BizAssert「暂无数据」） */
    } finally {
      setExporting(false);
    }
  };

  const columns: ColumnsType<DyeBedRecordItem> = useMemo(
    () => [
      {
        title: '序号',
        width: 56,
        render: (_v, _r, i) => (pageNum - 1) * pageSize + i + 1,
      },
      {
        title: '关联订单',
        dataIndex: 'orderNo',
        width: 180,
        // 展示订单号 orderNo（与后端导出「关联订单」列同源）；老版本后端无该字段时回退 orderId。
        // 19 位雪花 id：接口层已用 bigIntSafeParse 转字符串，这里原样渲染，切勿做数值运算
        render: (v: string, r) => dashId(v || r.orderId),
      },
      { title: '设备名称', dataIndex: 'modelName', width: 90, render: (v: string) => dash(v) },
      { title: 'MAC码', dataIndex: 'deviceCode', width: 130, render: (v: string) => dash(v) },
      {
        title: '设备类型',
        dataIndex: 'model',
        width: 130,
        render: (v: number) => enumLabel(BED_MODEL_LABEL, v),
      },
      { title: '所属店铺', dataIndex: 'storeName', width: 170, ellipsis: true, render: (v: string) => dash(v) },
      {
        title: '店铺类型',
        dataIndex: 'storeType',
        width: 100,
        render: (v: number) => enumLabel(STORE_TYPE_LABEL, v),
      },
      { title: '所在城市', dataIndex: 'cityName', width: 90, render: (v: string) => dash(v) },
      { title: '发型师', dataIndex: 'craftsmanName', width: 100, ellipsis: true, render: (v: string) => dash(v) },
      {
        title: '操作类型',
        dataIndex: 'connectionType',
        width: 90,
        render: (v: number) => enumLabel(CONNECTION_TYPE_LABEL, v),
      },
      {
        title: '操作项目',
        dataIndex: 'rinseType',
        width: 110,
        render: (v: number) => enumLabel(RINSE_TYPE_LABEL, v),
      },
      {
        title: '实际洗头时间',
        dataIndex: 'actualWashingMinute',
        width: 110,
        // 后端存的是分钟数（actualWashingMinute），加单位便于和「预计总洗头分钟数」对齐看
        render: (v: number) => (v === null || v === undefined ? '-' : `${v}分钟`),
      },
      { title: '服务项目', dataIndex: 'itemName', width: 130, ellipsis: true, render: (v: string) => dash(v) },
      { title: '过程水温', dataIndex: 'waterTemperature', width: 100, render: (v: string) => dash(v) },
      {
        title: '性别',
        dataIndex: 'gender',
        width: 70,
        render: (v: number) => enumLabel(GENDER_LABEL, v),
      },
      {
        title: '操作时间',
        dataIndex: 'washingTime',
        width: 160,
        // washingTime 在实体上无对应字段（恒 null），后端导出取的就是 createTime，这里同口径回退
        render: (v: string, r) => dash(v || r.createTime),
      },
      {
        title: '执行状态',
        dataIndex: 'bedStatus',
        width: 90,
        fixed: 'right',
        render: (v: number) =>
          v === null || v === undefined ? '-' : (
            <Tag color={BED_STATUS_COLOR[v] ?? 'default'}>{enumLabel(BED_STATUS_LABEL, v)}</Tag>
          ),
      },
    ],
    [pageNum, pageSize],
  );

  return (
    <div style={{ padding: 12 }}>
      <Card size="small" style={{ marginBottom: 8 }}>
        <Form form={form} layout="inline" size="small" onFinish={onQuery} style={{ rowGap: 8 }}>
          <Form.Item label="日期" name="dateRange">
            <DatePicker.RangePicker data-testid="bedRecord.dateRange" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item label="店铺名称" name="storeName">
            <Input data-testid="bedRecord.storeName" placeholder="请输入门店名称" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="订单编号" name="orderNo">
            <Input data-testid="bedRecord.orderNo" placeholder="请输入订单编号" allowClear style={{ width: 180 }} />
          </Form.Item>
          {/* 原型这格 placeholder 写的是「请输入门店名称」，是原型自身文案 bug，这里按语义写「请输入MAC码」 */}
          <Form.Item label="MAC码" name="deviceCode">
            <Input data-testid="bedRecord.deviceCode" placeholder="请输入MAC码" allowClear style={{ width: 150 }} />
          </Form.Item>

          {moreFilter && (
            <>
              <Form.Item label="顾客名称" name="customerName">
                <Input
                  data-testid="bedRecord.customerName"
                  placeholder="请输入顾客名称"
                  allowClear
                  style={{ width: 150 }}
                />
              </Form.Item>
              <Form.Item label="执行状态" name="bedStatus">
                <Select
                  data-testid="bedRecord.bedStatus"
                  placeholder="请选择执行状态"
                  allowClear
                  options={BED_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  style={{ width: 130 }}
                />
              </Form.Item>
              <Form.Item label="设备类型" name="model">
                <Select
                  data-testid="bedRecord.model"
                  placeholder="请选择设备类型"
                  allowClear
                  options={BED_MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  style={{ width: 170 }}
                />
              </Form.Item>
            </>
          )}
        </Form>

        <Space style={{ marginTop: 8 }} wrap>
          <Tooltip title={moreFilter ? '收起更多筛选' : '更多筛选（顾客名称/执行状态/设备类型）'}>
            <Button
              data-testid="bedRecord.filter-toggle"
              icon={<FilterOutlined />}
              type={moreFilter ? 'primary' : 'default'}
              ghost={moreFilter}
              onClick={() => setMoreFilter((v) => !v)}
            />
          </Tooltip>
          <Button data-testid="bedRecord.query" type="primary" icon={<SearchOutlined />} onClick={onQuery}>
            查询
          </Button>
          <Button data-testid="bedRecord.reset" icon={<ReloadOutlined />} onClick={onReset}>
            重置
          </Button>
          <Button data-testid="bedRecord.export" loading={exporting} onClick={onExport}>
            导出
          </Button>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<DyeBedRecordItem>
          rowKey={(r) => r.id || `${r.deviceCode}-${r.createTime}`}
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
