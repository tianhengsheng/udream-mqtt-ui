/**
 * 设备列表（PC 管理端页，走 PC token）。
 *
 * 对接 dye-service 管理端接口（前缀 /mgtDye，见 src/api/dye.ts）：
 *  列表 dyeDevicePage / 导出 exportStaffDye / 导入 base/dye/import / 远程控制 remoteStoreDevice
 *  / 解绑 base/dye/recycleDevice / 划拨 base/dye/transferDevice。
 * 划拨弹窗的门店搜索走 base 服务 /basics/store/getStoreListByFuzzyName（见 src/api/store.ts）。
 *
 * 页面保持**浅色**：模拟器页那套深色 theme.ts 是模拟器专用，不要往这里套。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadProps } from 'antd';
import {
  FilterOutlined,
  QuestionCircleFilled,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useSession } from '../store/useSession';
import {
  BINDING_STATUS_OPTIONS,
  DEVICE_MODELS,
  DEVICE_STATUS_OPTIONS,
  MODEL_LABEL,
  REMOTE_TYPE,
  TRANSFER_STATUS_OPTIONS,
  exportDyeDevice,
  fetchDyeDevicePage,
  importDyeDevice,
  recycleDevice,
  remoteStoreDevice,
  transferDevice,
  type DyeCreamItem,
  type DyeDeviceItem,
  type DyeDeviceQuery,
} from '../api/dye';
import { searchStoreByFuzzyName, type StoreBrief } from '../api/store';

/** 整行标红色值（后端 mark=true：同门店同型号 >=2 台） */
const MARK_COLOR = '#ff4d4f';
const DATE_FMT = 'YYYY-MM-DD';

/** 筛选表单草稿值（提交时再转成 DyeDeviceQuery） */
interface FilterValues {
  storeName?: string;
  macCode?: string;
  deviceStatus?: number;
  transferStatus?: number;
  model?: number;
  transferRange?: [Dayjs, Dayjs];
  // —— 「更多筛选」里的字段 ——
  bindingStatus?: number;
  trackUserName?: string;
  bindingRange?: [Dayjs, Dayjs];
}

function toQuery(v: FilterValues): DyeDeviceQuery {
  return {
    storeName: v.storeName?.trim() || undefined,
    macCode: v.macCode?.trim() || undefined,
    deviceStatus: v.deviceStatus,
    transferStatus: v.transferStatus,
    model: v.model,
    bindingStatus: v.bindingStatus,
    trackUserName: v.trackUserName?.trim() || undefined,
    transferStartTime: v.transferRange?.[0]?.format(DATE_FMT),
    transferEndTime: v.transferRange?.[1]?.format(DATE_FMT),
    bindingStartTime: v.bindingRange?.[0]?.format(DATE_FMT),
    bindingEndTime: v.bindingRange?.[1]?.format(DATE_FMT),
  };
}

/** 染膏余量状态色：0-正常 / 1-预警(<=45g) / 2-阻断(<=5g) */
const creamColor = (status?: number) => (status === 2 ? MARK_COLOR : status === 1 ? '#fa8c16' : '#52c41a');

/**
 * 染膏容量单元格：整行 18 列已横向滚动，逐口平铺会把列撑爆，
 * 所以只在列内显示「口数 + 最差余量百分比（按最差状态着色）」，明细放 Popover 悬浮展开。
 */
function CreamCell({ row }: { row: DyeDeviceItem }) {
  const list = row.creamCapacityList;
  if (!list || !list.length) return <span style={{ color: '#bfbfbf' }}>-</span>;
  const worst = list.reduce((a, b) => ((b.status ?? 0) > (a.status ?? 0) ? b : a), list[0]);
  const minPercent = Math.min(...list.map((i) => i.percent ?? 0));
  const content = (
    <div style={{ maxWidth: 320 }}>
      <div style={{ marginBottom: 4, color: '#8c8c8c' }}>更新时间：{row.creamLastSyncTime || '—'}</div>
      {list.map((i: DyeCreamItem) => (
        <div key={i.devicePort} style={{ display: 'flex', gap: 8, lineHeight: '20px' }}>
          <span style={{ width: 40 }}>{i.devicePort}号</span>
          <span style={{ width: 90 }}>{i.name || (i.type === 1 ? '双氧' : '染膏')}</span>
          <span style={{ width: 90 }}>
            {i.weight ?? '-'}g / {i.totalWeight ?? '-'}g
          </span>
          <span style={{ color: creamColor(i.status) }}>{i.percent ?? '-'}%</span>
        </div>
      ))}
    </div>
  );
  return (
    <Popover content={content} title="四代机染膏余量" placement="left">
      <span style={{ cursor: 'pointer' }}>
        {list.length}口 <span style={{ color: creamColor(worst.status) }}>最低 {minPercent}%</span>
      </span>
    </Popover>
  );
}

/** antd 的 ButtonProps 类型不含 data-*，用展开的方式给 Modal 底部按钮挂 testid（绕过 TS 多余属性检查） */
const testid = (id: string) => ({ 'data-testid': id }) as Record<string, string>;

/** 划拨弹窗里只读展示行（原型：门店ID/名称/地址三行，未选时显示 -） */
function InfoRow({ label, value, required, testid }: { label: string; value?: string; required?: boolean; testid: string }) {
  return (
    <Row style={{ marginBottom: 12 }} align="middle">
      <Col flex="90px" style={{ textAlign: 'right', paddingRight: 8 }}>
        {required && <span style={{ color: MARK_COLOR, marginRight: 2 }}>*</span>}
        {label}：
      </Col>
      <Col flex="auto">
        <span data-testid={testid} style={{ color: value ? undefined : '#bfbfbf' }}>{value || '-'}</span>
      </Col>
    </Row>
  );
}

/**
 * 划拨弹窗。
 *
 * 门店搜索用 Select 的 showSearch + 防抖远程搜索（比纯 Input 好用：能直接选中一条拿到 id），
 * 但展示区仍按原型保留「门店ID / 门店名称 / 门店地址」三行只读信息。
 * 后端搜索接口 `like(store_name) OR eq(id)`，所以纯数字的 19 位门店 ID 也原样当关键词传即可。
 */
function TransferModal({
  row,
  onClose,
  onDone,
}: {
  row: DyeDeviceItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [options, setOptions] = useState<StoreBrief[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<StoreBrief | null>(null);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  // 防抖后仍可能乱序返回，用 seq 丢弃过期响应
  const seqRef = useRef(0);

  // 每次打开重置，避免上次选的门店残留导致误划拨
  useEffect(() => {
    if (row) {
      setKeyword('');
      setOptions([]);
      setPicked(null);
    }
  }, [row]);

  const doSearch = (kw: string) => {
    setKeyword(kw);
    clearTimeout(timerRef.current);
    if (!kw.trim()) {
      setOptions([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setSearching(true);
      try {
        const list = await searchStoreByFuzzyName(kw.trim());
        if (seq !== seqRef.current) return;
        // 接口无分页，关键词太宽会回一大坨，截断展示
        setOptions(list.slice(0, 50));
      } catch {
        if (seq === seqRef.current) setOptions([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 400);
  };

  const onSave = async () => {
    if (!row?.macCode || !picked?.id) return;
    setSaving(true);
    try {
      await transferDevice({ code: row.macCode, storeId: picked.id });
      message.success(`已划拨到「${picked.storeName || picked.id}」`);
      onClose();
      onDone();
    } catch {
      /* 全局拦截器已提示（如「该设备已绑定xxx」） */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!row}
      title="划拨"
      width={520}
      onCancel={onClose}
      onOk={onSave}
      okText="保存"
      cancelText="取消"
      okButtonProps={{ disabled: !picked?.id, loading: saving, ...testid('transferModal.save') }}
      cancelButtonProps={{ ...testid('transferModal.cancel') }}
    >
      <div style={{ marginBottom: 12, color: '#8c8c8c' }}>
        设备：{row?.deviceName || '-'}（{row?.macCode}）
      </div>
      <Row style={{ marginBottom: 12 }} align="middle">
        <Col flex="90px" style={{ textAlign: 'right', paddingRight: 8 }}>门店搜索：</Col>
        <Col flex="auto">
          <Select<string>
            data-testid="transferModal.search"
            showSearch
            allowClear
            style={{ width: '100%' }}
            placeholder="请输入门店名称或ID搜索"
            // 远程搜索：关掉本地过滤，否则 antd 会拿 label 再筛一遍把结果吃掉
            filterOption={false}
            searchValue={keyword}
            onSearch={doSearch}
            value={picked?.id}
            onChange={(v) => setPicked(options.find((o) => o.id === v) || null)}
            onClear={() => setPicked(null)}
            notFoundContent={searching ? <Spin size="small" /> : keyword ? '无匹配门店' : null}
            options={options.map((s) => ({ value: s.id!, label: `${s.storeName || '(无名)'}(${s.id})` }))}
          />
        </Col>
      </Row>
      <InfoRow label="门店ID" required value={picked?.id} testid="transferModal.storeId" />
      <InfoRow label="门店名称" value={picked?.storeName} testid="transferModal.storeName" />
      <InfoRow label="门店地址" value={picked?.storeAddress} testid="transferModal.storeAddress" />
    </Modal>
  );
}

/** 默认筛选：设备类型=四代机(04)。本自测 UI 围着四代机转，进页直接聚焦，重置也回到它 */
const DEFAULT_FILTER = { model: 4 } as const;

export function PcDeviceListPage() {
  const [form] = Form.useForm<FilterValues>();
  const user = useSession((s) => s.currentUser());

  const [query, setQuery] = useState<DyeDeviceQuery>({ ...DEFAULT_FILTER });
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<DyeDeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [moreFilter, setMoreFilter] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  /** 远程控制目标设备（null = 弹窗关闭） */
  const [remoteRow, setRemoteRow] = useState<DyeDeviceItem | null>(null);
  const [remoting, setRemoting] = useState(false);
  /** 划拨目标设备（null = 弹窗关闭） */
  const [transferRow, setTransferRow] = useState<DyeDeviceItem | null>(null);

  // 严格模式下 effect 会跑两次，用 seq 丢弃过期响应，避免翻页快点时数据错位
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const { list, total: t } = await fetchDyeDevicePage({ ...query, pageNum, pageSize });
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
    form.setFieldsValue({ model: DEFAULT_FILTER.model });
    setPageNum(1);
    setQuery({ ...DEFAULT_FILTER });
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const r = await exportDyeDevice(query);
      if (r.downloaded) message.success('导出文件已下载');
      else message.info(r.msg || '导出任务已提交');
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setExporting(false);
    }
  };

  // antd Upload 自定义上传：只走我们自己的 FormData(file)，不用它的默认 action
  const uploadProps: UploadProps = {
    accept: '.xls,.xlsx',
    showUploadList: false,
    maxCount: 1,
    beforeUpload: async (file) => {
      setImporting(true);
      try {
        await importDyeDevice(file as File);
        message.success('导入成功');
        void load();
      } catch {
        /* 全局拦截器已提示 */
      } finally {
        setImporting(false);
      }
      return Upload.LIST_IGNORE; // 阻止 antd 自己发请求
    },
  };

  const doRemote = async (type: number, label: string) => {
    if (!remoteRow?.macCode) return;
    setRemoting(true);
    try {
      await remoteStoreDevice({
        code: remoteRow.macCode,
        type,
        operatorId: user?.uid,
        operatorName: user?.name,
      });
      message.success(`${label} 指令已下发`);
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setRemoting(false);
    }
  };

  /**
   * 解绑（回收设备）：原型是确认框 → 确定后调接口 → 刷新列表（该行按钮随之变「划拨」）。
   * 刷新走 load()，保持当前筛选条件与页码不回到第一页。
   */
  const onUnbind = useCallback((r: DyeDeviceItem) => {
    if (!r.macCode) return;
    Modal.confirm({
      title: '回收设备',
      content: '回收后设备状态变为未划拨，可二次划拨',
      icon: <QuestionCircleFilled style={{ color: '#faad14' }} />,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { ...testid('unbindConfirm.ok') },
      onOk: async () => {
        try {
          await recycleDevice(r.macCode!);
          message.success(`设备 ${r.macCode} 已回收`);
          void load();
        } catch {
          /* 全局拦截器已提示 */
        }
      },
    });
  }, [load]);

  const columns: ColumnsType<DyeDeviceItem> = useMemo(
    () => [
      // 左侧固定组：横向滚动时 MAC码 必须始终可见（否则右侧列对不上是哪台设备）。
      // antd 的 fixed:'left' 必须从最左连续，只固定 MAC码 会告警+错位，故连带前两列一起钉住。
      {
        title: '序号',
        width: 56,
        fixed: 'left',
        render: (_v, _r, i) => (pageNum - 1) * pageSize + i + 1,
      },
      { title: '设备名称', dataIndex: 'deviceName', width: 120, ellipsis: true, fixed: 'left' },
      { title: 'MAC码', dataIndex: 'macCode', width: 140, fixed: 'left' },
      {
        title: '设备类型',
        dataIndex: 'model',
        width: 130,
        render: (v: number, r) => r.modelName || MODEL_LABEL[v] || (v == null ? '-' : v),
      },
      { title: '所属店铺', dataIndex: 'storeName', width: 160, ellipsis: true },
      { title: '服务类型', dataIndex: 'storeTypeStr', width: 90, render: (v: string) => v || '-' },
      { title: '所在城市', dataIndex: 'cityName', width: 90, render: (v: string) => v || '-' },
      {
        title: '划拨状态',
        dataIndex: 'transferStatus',
        width: 80,
        render: (v: number) => (v === 1 ? '已划拨' : v === 0 ? '未划拨' : '-'),
      },
      {
        title: '设备连接状态',
        dataIndex: 'deviceStatus',
        width: 100,
        render: (v: number) =>
          v === 1 ? <Tag color="green">已连接</Tag> : v === 0 ? <Tag>未连接</Tag> : '-',
      },
      {
        title: '联网方式',
        dataIndex: 'type',
        width: 80,
        render: (v: number) => (v === 0 ? 'WIFI' : v == null ? '-' : v),
      },
      { title: 'WIFI名称', dataIndex: 'typeName', width: 120, ellipsis: true, render: (v: string) => v || '-' },
      { title: '染膏容量', width: 130, render: (_v, r) => <CreamCell row={r} /> },
      { title: '运行状态', dataIndex: 'runState', width: 80, render: (v: number) => v ?? '-' },
      { title: '运行状态描述', dataIndex: 'runDesc', width: 160, ellipsis: true, render: (v: string) => v || '-' },
      { title: '联网所在地', dataIndex: 'address', width: 140, ellipsis: true, render: (v: string) => v || '-' },
      { title: '上次通讯时间', dataIndex: 'usageTime', width: 150, render: (v: string) => v || '-' },
      { title: '入库时间', dataIndex: 'createTime', width: 150, render: (v: string) => v || '-' },
      { title: '划拨时间', dataIndex: 'transferTime', width: 150, render: (v: string) => v || '-' },
      {
        title: '操作',
        width: 96,
        fixed: 'right',
        // 按划拨状态二选一：已划拨(1)→解绑（红），未划拨(0)→划拨（蓝）；状态缺失时两个都不给，只留远程
        render: (_v, r) => (
          <Space size={4}>
            {r.transferStatus === 1 && (
              <Typography.Link
                data-testid={`deviceList.unbind-${r.macCode}`}
                style={{ color: MARK_COLOR }}
                onClick={() => onUnbind(r)}
              >
                解绑
              </Typography.Link>
            )}
            {r.transferStatus === 0 && (
              <Typography.Link
                data-testid={`deviceList.transfer-${r.macCode}`}
                onClick={() => setTransferRow(r)}
              >
                划拨
              </Typography.Link>
            )}
            <Typography.Link
              data-testid={`deviceList.remote-${r.macCode}`}
              onClick={() => setRemoteRow(r)}
            >
              远程
            </Typography.Link>
          </Space>
        ),
      },
    ],
    // onUnbind 必须进依赖：它闭包了 load（含当前 query/页码），漏了会用过期条件刷新
    [pageNum, pageSize, onUnbind],
  );

  /** 远程控制按钮：danger 的三个要二次确认（原型没有，防误触打真机） */
  const remoteButtons: { key: string; label: string; type: number; danger: boolean }[] = [
    { key: 'calibrate', label: '开始校准', type: REMOTE_TYPE.CALIBRATE, danger: false },
    { key: 'refill', label: '确认换料', type: REMOTE_TYPE.REFILL, danger: false },
    { key: 'reboot', label: '重启设备', type: REMOTE_TYPE.REBOOT, danger: true },
    { key: 'shutdown', label: '关机', type: REMOTE_TYPE.SHUTDOWN, danger: true },
    { key: 'factory-reset', label: '恢复出厂设置', type: REMOTE_TYPE.FACTORY_RESET, danger: true },
  ];

  return (
    <div style={{ padding: 12 }}>
      <Card size="small" style={{ marginBottom: 8 }}>
        <Form
          form={form}
          layout="inline"
          size="small"
          onFinish={onQuery}
          style={{ rowGap: 8 }}
          initialValues={{ model: DEFAULT_FILTER.model }}
        >
          <Form.Item label="店铺名称" name="storeName">
            <Input data-testid="deviceList.storeName" placeholder="请输入店铺名称" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="MAC码" name="macCode">
            <Input data-testid="deviceList.macCode" placeholder="请输入MAC码" allowClear style={{ width: 150 }} />
          </Form.Item>
          <Form.Item label="设备状态" name="deviceStatus">
            <Select
              data-testid="deviceList.deviceStatus"
              placeholder="请选择设备状态"
              allowClear
              options={DEVICE_STATUS_OPTIONS}
              style={{ width: 130 }}
            />
          </Form.Item>
          <Form.Item label="划拨状态" name="transferStatus">
            <Select
              data-testid="deviceList.transferStatus"
              placeholder="请选择划拨状态"
              allowClear
              options={TRANSFER_STATUS_OPTIONS}
              style={{ width: 130 }}
            />
          </Form.Item>
          <Form.Item label="设备类型" name="model">
            <Select
              data-testid="deviceList.model"
              placeholder="请选择设备类型"
              allowClear
              options={DEVICE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item label="划拨时间" name="transferRange">
            <DatePicker.RangePicker data-testid="deviceList.transferRange" style={{ width: 220 }} />
          </Form.Item>

          {moreFilter && (
            <>
              <Form.Item label="绑定状态" name="bindingStatus">
                <Select
                  data-testid="deviceList.bindingStatus"
                  placeholder="请选择绑定状态"
                  allowClear
                  options={BINDING_STATUS_OPTIONS}
                  style={{ width: 130 }}
                />
              </Form.Item>
              <Form.Item label="销售人" name="trackUserName">
                <Input data-testid="deviceList.trackUserName" placeholder="请输入销售人" allowClear style={{ width: 130 }} />
              </Form.Item>
              <Form.Item label="绑定时间" name="bindingRange">
                <DatePicker.RangePicker data-testid="deviceList.bindingRange" style={{ width: 220 }} />
              </Form.Item>
            </>
          )}
        </Form>

        <Space style={{ marginTop: 8 }} wrap>
          <Tooltip title={moreFilter ? '收起更多筛选' : '更多筛选（绑定状态/销售人/绑定时间）'}>
            <Button
              data-testid="deviceList.filter-toggle"
              icon={<FilterOutlined />}
              type={moreFilter ? 'primary' : 'default'}
              ghost={moreFilter}
              onClick={() => setMoreFilter((v) => !v)}
            />
          </Tooltip>
          <Button data-testid="deviceList.query" type="primary" icon={<SearchOutlined />} onClick={onQuery}>
            查询
          </Button>
          <Button data-testid="deviceList.reset" icon={<ReloadOutlined />} onClick={onReset}>
            重置
          </Button>
          <Button data-testid="deviceList.export" loading={exporting} onClick={onExport}>
            导出
          </Button>
          <Upload {...uploadProps}>
            <Button data-testid="deviceList.import" icon={<UploadOutlined />} loading={importing}>
              导入
            </Button>
          </Upload>
          {/* public/ 下的静态文件，vite 直接按根路径提供 */}
          <a data-testid="deviceList.template" href="/设备导入模板.xls" download>
            模板下载
          </a>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<DyeDeviceItem>
          rowKey={(r) => r.id || r.macCode || Math.random().toString(36)}
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 2200 }}
          // mark=true 整行标红（后端口径：同门店同型号 >=2 台）
          onRow={(r) => (r.mark ? { style: { color: MARK_COLOR } } : {})}
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

      <Modal
        open={!!remoteRow}
        title="请谨慎使用远程控制"
        footer={null}
        width={420}
        onCancel={() => setRemoteRow(null)}
      >
        <div style={{ marginBottom: 12, color: '#8c8c8c' }}>
          设备：{remoteRow?.deviceName || '-'}（{remoteRow?.macCode}）
        </div>
        <Row gutter={[8, 8]}>
          {remoteButtons.map((b) => (
            <Col span={8} key={b.key}>
              {b.danger ? (
                <Popconfirm
                  title={`确认${b.label}？`}
                  description="该操作会直接影响真实设备，请确认已选对设备。"
                  okText="确认下发"
                  cancelText="取消"
                  onConfirm={() => doRemote(b.type, b.label)}
                >
                  <Button
                    data-testid={`deviceList.remote-${b.key}`}
                    type="primary"
                    block
                    loading={remoting}
                  >
                    {b.label}
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  data-testid={`deviceList.remote-${b.key}`}
                  type="primary"
                  block
                  loading={remoting}
                  onClick={() => doRemote(b.type, b.label)}
                >
                  {b.label}
                </Button>
              )}
            </Col>
          ))}
        </Row>
      </Modal>

      <TransferModal row={transferRow} onClose={() => setTransferRow(null)} onDone={() => void load()} />
    </div>
  );
}
