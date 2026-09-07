/**
 * 设备固件升级管理（PC 管理端页，走 PC token）。
 *
 * 对接 dye-service /dye/apiUnified/firmwareUpgrade/*（见 src/api/firmware.ts）：
 *  列表 listDyeFirmwareUpgrade / 保存 saveOrUpdateDyeFirmwareUpgrade / 上下架 updateDyeFirmwareUpgradeStatus。
 * 固件包走 base 服务 getUploadSign 的 OSS 直传，前端算 md5（spark-md5）+ File.size 回填。
 *
 * 芯片维度（2026-08-28 定稿）：一行 = 一颗芯片的一个固件包。四代机(model=4)必须选芯片
 * （P4 主控 / C5），两颗芯片各自独立版本号、独立上下架、独立升级；其他型号不区分芯片。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
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
import { CheckOutlined, FileZipOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import {
  CHIPS,
  CHIP_LABEL,
  fetchFirmwarePage,
  fileMd5,
  saveFirmware,
  updateFirmwareStatus,
  uploadFirmwareToOss,
  type FirmwareItem,
} from '../api/firmware';
import { MODEL_LABEL } from '../api/dye';
import { setOtaRecordPreset } from '../api/otaRecord';
import { navigateTo } from '../nav';

const { Text } = Typography;
const DATETIME_FMT = 'YYYY-MM-DD HH:mm:ss';

/** 固件管理支持的设备类型（DyeConstant.Model.CODE_TO_ENUM） */
const FIRMWARE_MODELS = [0, 2, 3, 4].map((v) => ({ value: v, label: MODEL_LABEL[v] ?? String(v) }));
const MODEL_FOUR = 4;

const STATUS_OPTIONS = [
  { value: 0, label: '下架' },
  { value: 1, label: '上架' },
];

/** 单个固件包的上传态（url/md5/size 由上传流程回填，version 用户手填） */
interface PkgState {
  url?: string;
  md5?: string;
  size?: number;
  uploading?: boolean;
}

function fmtSize(size?: number): string {
  if (size == null) return '-';
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

/**
 * 固件包单元格：单行「v0.1.3（C5）+ 固件图标」，芯片灰字弱化（与升级记录页一致）；
 * url / md5 / 大小不占行，悬浮图标查看。
 */
function PkgCell({ version, chip, url, md5, size }: { version?: string; chip?: string; url?: string; md5?: string; size?: number }) {
  if (!version && !url) return <span style={{ color: '#bfbfbf' }}>-</span>;
  const detail = (
    <div style={{ fontSize: 12, maxWidth: 420, wordBreak: 'break-all' }}>
      <div>地址：{url || '-'}</div>
      <div>md5：{md5 || '-'}</div>
      <div>大小：{fmtSize(size)}</div>
    </div>
  );
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <Text strong>{version || '-'}</Text>
      {chip && <span style={{ color: '#8c8c8c', marginLeft: 6 }}>（{CHIP_LABEL[chip] ?? chip}）</span>}
      <Tooltip title={detail} placement="topLeft">
        <FileZipOutlined style={{ marginLeft: 8, color: '#1677ff', cursor: 'pointer' }} />
      </Tooltip>
    </span>
  );
}

export default function PcFirmwareUpgradePage() {
  const [list, setList] = useState<FirmwareItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState<number | undefined>();
  const [filterRange, setFilterRange] = useState<[Dayjs, Dayjs] | null>(null);

  // 弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FirmwareItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [pkg, setPkg] = useState<PkgState>({});
  const model = Form.useWatch('model', form);

  const load = useCallback(async (pn = pageNum, ps = pageSize) => {
    setLoading(true);
    try {
      const res = await fetchFirmwarePage({
        pageNum: pn,
        pageSize: ps,
        status: filterStatus,
        startTime: filterRange?.[0]?.format(DATETIME_FMT),
        endTime: filterRange?.[1]?.format(DATETIME_FMT),
      });
      setList(res.list);
      setTotal(res.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }, [pageNum, pageSize, filterStatus, filterRange]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditing(null);
    setPkg({});
    form.resetFields();
    form.setFieldsValue({ status: 0, sort: 0 });
    setModalOpen(true);
  }

  function openEdit(row: FirmwareItem) {
    setEditing(row);
    setPkg({ url: row.firmwareUpgradeUrl, md5: row.md5, size: row.size });
    form.setFieldsValue({
      model: row.model,
      chip: row.chip,
      sort: row.sort,
      status: row.status,
      version: row.version,
    });
    setModalOpen(true);
  }

  /** 上传固件包 → OSS 直传 + 前端算 md5/size 回填 */
  async function uploadPkg(file: File) {
    setPkg((p) => ({ ...p, uploading: true }));
    try {
      const [{ url }, md5] = await Promise.all([uploadFirmwareToOss(file), fileMd5(file)]);
      setPkg({ url, md5, size: file.size, uploading: false });
      message.success(`固件包上传成功（${file.name}）`);
    } catch (e) {
      setPkg((p) => ({ ...p, uploading: false }));
      message.error(e instanceof Error ? e.message : '上传失败');
    }
  }

  async function submit() {
    const values = await form.validateFields();
    const isFour = values.model === MODEL_FOUR;
    if (!pkg.url) { message.warning('请上传固件包'); return; }
    setSaving(true);
    try {
      await saveFirmware({
        id: editing?.id,
        model: values.model,
        // 四代机一条记录只维护一颗芯片；其他型号不传 chip（后端会校验拒绝）
        chip: isFour ? values.chip : undefined,
        sort: values.sort,
        status: values.status,
        version: values.version?.trim(),
        firmwareUpgradeUrl: pkg.url,
        md5: pkg.md5,
        size: pkg.size,
      });
      // 业务失败由全局拦截器弹错并 reject，走到这里即成功
      message.success(editing ? '已更新' : '已新增');
      setModalOpen(false);
      setPageNum(1);
      load(1, pageSize);
    } catch {
      /* 校验失败或全局拦截器已提示 */
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(row: FirmwareItem) {
    const next = row.status === 1 ? 0 : 1;
    try {
      await updateFirmwareStatus(row.id!, next);
      message.success(next === 1 ? '已上架' : '已下架');
      load();
    } catch {
      /* 全局拦截器已提示 */
    }
  }

  const columns: ColumnsType<FirmwareItem> = [
    { title: '排序', dataIndex: 'sort', width: 60 },
    { title: '配置时间', dataIndex: 'createTime', width: 150 },
    {
      title: '设备类型', dataIndex: 'model', width: 120,
      render: (m: number) => MODEL_LABEL[m] ?? m,
    },
    {
      // 芯片并入固件包列的灰字（与升级记录页一致），不再单独一列
      title: '固件包', key: 'pkg',
      render: (_, r) => <PkgCell version={r.version} chip={r.chip} url={r.firmwareUpgradeUrl} md5={r.md5} size={r.size} />,
    },
    {
      title: '状态', dataIndex: 'status', width: 70,
      render: (s: number) => (s === 1 ? <Tag color="green">上架</Tag> : <Tag>下架</Tag>),
    },
    { title: '创建人', dataIndex: 'createUserName', width: 90 },
    {
      title: '操作', key: 'op', width: 190, fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Popconfirm
            title={r.status === 1 ? '确定下架该固件？' : '确定上架该固件？设备将拉取到此版本'}
            onConfirm={() => toggleStatus(r)}
            okText="确定" cancelText="取消"
          >
            <Button type="link" size="small" danger={r.status === 1}>
              {r.status === 1 ? '下架' : '上架'}
            </Button>
          </Popconfirm>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          {/* 跳「设备升级记录」并把本条固件的 版本/芯片/设备类型 回填到筛选表单；记录表只有四代机走 MQTT 推送才有数据 */}
          <Button
            type="link"
            size="small"
            data-testid={`firmware.viewRecords-${r.id}`}
            onClick={() => {
              setOtaRecordPreset({ targetVersion: r.version, chip: r.chip, deviceModel: r.model });
              navigateTo('pcOtaRecord');
            }}
          >
            查看升级详情
          </Button>
        </Space>
      ),
    },
  ];

  const isFour = model === MODEL_FOUR;

  /** 固件包上传控件：与 admin 原型一致的 "+" 方块（picture-card 风格），不限文件类型 */
  const pkgUploader = () => (
    <div>
      <Upload
        beforeUpload={(f) => { uploadPkg(f as unknown as File); return false; }}
        showUploadList={false}
      >
        <div
          data-testid="firmware.upload"
          style={{
            width: 102, height: 102, border: '1px dashed #d9d9d9', borderRadius: 8,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', background: '#fafafa', fontSize: 13,
            color: pkg.url ? '#52c41a' : '#595959',
          }}
        >
          {pkg.uploading
            ? <Spin size="small" />
            : pkg.url
              ? <><CheckOutlined style={{ fontSize: 22 }} /><div style={{ marginTop: 6 }}>已上传</div></>
              : <><PlusOutlined style={{ fontSize: 22, color: '#8c8c8c' }} /><div style={{ marginTop: 6, color: '#8c8c8c' }}>上传</div></>}
        </div>
      </Upload>
      {pkg.url && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#8c8c8c', maxWidth: 380, wordBreak: 'break-all' }}>
          <div style={{ color: '#1677ff' }}>{pkg.url}</div>
          <div>md5: {pkg.md5 || '-'} · {fmtSize(pkg.size)}</div>
        </div>
      )}
    </div>
  );

  return (
    <Card
      title="设备固件升级管理"
      extra={
        <Space>
          <DatePicker.RangePicker
            value={filterRange}
            onChange={(v) => setFilterRange(v as [Dayjs, Dayjs] | null)}
            placeholder={['配置开始', '配置结束']}
          />
          <Select
            allowClear placeholder="状态" style={{ width: 100 }}
            options={STATUS_OPTIONS} value={filterStatus}
            onChange={setFilterStatus}
            data-testid="firmware.filter-status"
          />
          <Button icon={<SearchOutlined />} onClick={() => { setPageNum(1); load(1, pageSize); }}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { setFilterStatus(undefined); setFilterRange(null); setPageNum(1); }}>重置</Button>
          <Button type="primary" onClick={openAdd}>添加</Button>
        </Space>
      }
    >
      <Table
        rowKey={(r) => String(r.id)}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={{ x: 860 }}
        pagination={{
          current: pageNum,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (pn, ps) => { setPageNum(pn); setPageSize(ps); },
        }}
      />

      <Modal
        title={editing ? '编辑固件' : '生成固件下载链接'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText="确认" cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={form} labelCol={{ span: 6 }} wrapperCol={{ span: 17 }} colon={false}>
          <Form.Item label="上传固件包" required>
            {pkgUploader()}
          </Form.Item>
          <Form.Item label="设备类型" name="model" rules={[{ required: true, message: '请选择设备类型' }]}>
            <Select
              placeholder="请选择" options={FIRMWARE_MODELS}
              disabled={!!editing}
              data-testid="firmware.model-select"
            />
          </Form.Item>
          {isFour && (
            <Form.Item
              label="芯片" name="chip"
              rules={[{ required: true, message: '请选择固件所属芯片' }]}
              extra="P4/C5 独立升级：一条记录只维护一颗芯片，各自版本号互不影响"
            >
              <Select
                placeholder="请选择" options={[...CHIPS]}
                disabled={!!editing}
                data-testid="firmware.chip-select"
              />
            </Form.Item>
          )}
          <Form.Item label="排序" name="sort">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="请输入排序" />
          </Form.Item>
          <Form.Item
            label="版本号"
            name="version"
            rules={isFour ? [{ required: true, message: '请输入版本号' }] : []}
            extra={isFour ? '仅该芯片的版本号' : undefined}
          >
            <Input placeholder="请输入版本号" />
          </Form.Item>
          <Form.Item label="是否上架" name="status">
            <Radio.Group>
              <Radio value={0}>否</Radio>
              <Radio value={1}>是</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
