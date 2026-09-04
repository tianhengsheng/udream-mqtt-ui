/**
 * 排水配置（洗头床预热排水相关的 config_const，PC token）。
 *
 * 可改：`washbed_drain_timeout_cnf`（dye-service 读）。写接口会主动删配置缓存，
 * 且 dye 不带本地缓存，**保存后立刻生效**，不用刷缓存也不用重启服务。
 *
 * 只读：`shampoo_bed_store_id` / `shampoo_bed_item_id`（order-service 读）。
 * 预热不触发时八成是门店或项目不在名单里，这里能直接看到。这两项**故意不给改**：
 * order-service 在 BASIC_CONFIG_CONS 本地缓存白名单内，改完最长 15 分钟才生效，
 * 在自测 UI 上改会造成"改了没反应"的误判，要改请走 DB + 等缓存过期。
 *
 * ⚠️ 配置是整个环境共享的，改动会影响同环境其他人的联调。
 *
 * 页面保持**浅色**：模拟器那套深色 theme.ts 是模拟器专用，不要往这里套。
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, InputNumber, Space, Spin, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  DRAIN_CNF_DEFAULT,
  DRAIN_TIMEOUT_MAX,
  KEY_SHAMPOO_BED_ITEM,
  KEY_SHAMPOO_BED_STORE,
  KEY_WASHBED_DRAIN_TIMEOUT,
  buildDrainCnfValue,
  parseDrainCnf,
  queryConfigConst,
  splitIdList,
  updateConfigConst,
  type ConfigConstItem,
  type WashbedDrainCnf,
} from '../api/configConst';

/** 只读白名单配置的展示卡片数据 */
interface ReadonlyCnf {
  key: string;
  title: string;
  hint: string;
  item?: ConfigConstItem;
}

export function PcDrainConfigPage() {
  const [form] = Form.useForm<WashbedDrainCnf>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drainItem, setDrainItem] = useState<ConfigConstItem>();
  const [storeItem, setStoreItem] = useState<ConfigConstItem>();
  const [itemItem, setItemItem] = useState<ConfigConstItem>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [drain, store, item] = await Promise.all([
        queryConfigConst(KEY_WASHBED_DRAIN_TIMEOUT),
        queryConfigConst(KEY_SHAMPOO_BED_STORE),
        queryConfigConst(KEY_SHAMPOO_BED_ITEM),
      ]);
      setDrainItem(drain);
      setStoreItem(store);
      setItemItem(item);
      form.setFieldsValue(parseDrainCnf(drain?.value));
    } catch {
      /* 错误提示由 http 拦截器统一弹出 */
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const cnf = await form.validateFields();
    setSaving(true);
    try {
      // 两个字段一起写回：更新接口整体覆盖 value，漏一个就把另一个丢了
      await updateConfigConst(KEY_WASHBED_DRAIN_TIMEOUT, buildDrainCnfValue(cnf));
      message.success('已保存，dye-service 立即生效');
      await load();
    } catch {
      /* 错误提示由 http 拦截器统一弹出 */
    } finally {
      setSaving(false);
    }
  };

  const readonlyCnfs: ReadonlyCnf[] = [
    {
      key: KEY_SHAMPOO_BED_STORE,
      title: '洗头床生效门店白名单',
      hint: '空表示不限门店；门店不在名单内，叫号不会发预热事件',
      item: storeItem,
    },
    {
      key: KEY_SHAMPOO_BED_ITEM,
      title: '洗头床项目 id 白名单',
      hint: '订单需含其中任一项目才发预热事件；为空则预热永不触发',
      item: itemItem,
    },
  ];

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message="配置为整个环境共享，修改会影响同环境其他人的联调，改完记得说一声。"
        />

        <Card
          title="排水超时配置（washbed_drain_timeout_cnf）"
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => void load()} data-testid="drainConfig.reload">
                刷新
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                onClick={() => void save()}
                data-testid="drainConfig.save"
              >
                保存
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="两个超时相互独立：设备端到点自关，云端只在设备没关时兜底。设备端置 0 + 云端给个小值（如 3），可单独验证云端兜底链路。"
          />

          <Form form={form} layout="vertical" initialValues={DRAIN_CNF_DEFAULT} style={{ maxWidth: 560 }}>
            <Form.Item
              name="deviceTimeoutMinutes"
              label="设备端超时关闭（分钟）"
              extra={`随 drain_on 的 bizData.timeoutMinutes 下发给设备，设备到点自关。0 = 设备永不自关。取值 0-${DRAIN_TIMEOUT_MAX}。控制面板的超时输入框覆盖的就是这个值。`}
              rules={[
                { required: true, message: '请填写设备端超时分钟数' },
                {
                  type: 'integer',
                  min: 0,
                  max: DRAIN_TIMEOUT_MAX,
                  message: `须为 0-${DRAIN_TIMEOUT_MAX} 的整数，越界后端会静默回退默认 ${DRAIN_CNF_DEFAULT.deviceTimeoutMinutes}`,
                },
              ]}
            >
              <InputNumber min={0} max={DRAIN_TIMEOUT_MAX} precision={0} style={{ width: 200 }} data-testid="drainConfig.deviceTimeoutMinutes" />
            </Form.Item>

            <Form.Item
              name="timeoutMinutes"
              label="云端兜底超时（分钟）"
              extra={`设备没自关时的兜底：xxl-job 每 5 分钟扫一次，超过该值且仍在排水就强制下发 drain_off，故实际关闭落在「该值 ~ 该值+5 分钟」。0 = 云端不兜底。取值 0-${DRAIN_TIMEOUT_MAX}。`}
              rules={[
                { required: true, message: '请填写云端兜底超时分钟数' },
                {
                  type: 'integer',
                  min: 0,
                  max: DRAIN_TIMEOUT_MAX,
                  message: `须为 0-${DRAIN_TIMEOUT_MAX} 的整数，越界后端会静默回退默认 ${DRAIN_CNF_DEFAULT.timeoutMinutes}`,
                },
              ]}
            >
              <InputNumber min={0} max={DRAIN_TIMEOUT_MAX} precision={0} style={{ width: 200 }} data-testid="drainConfig.timeoutMinutes" />
            </Form.Item>

            <Form.Item
              name="warmPipeMinutes"
              label="管道尚热阈值（分钟）"
              extra="距上次洗头小于该值视为「管道尚热」，仅影响叫号选床的优先级（尚热的床优先被选中预热），与超时关闭无关。"
              rules={[
                { required: true, message: '请填写尚热阈值' },
                { type: 'integer', min: 1, message: `须为正整数，非法值后端回退默认 ${DRAIN_CNF_DEFAULT.warmPipeMinutes}` },
              ]}
            >
              <InputNumber min={1} precision={0} style={{ width: 200 }} data-testid="drainConfig.warmPipeMinutes" />
            </Form.Item>
          </Form>

          {/* 读接口只回 key/value，没有 updateTime/remark，故只展示原始值 */}
          <Descriptions size="small" column={1} bordered style={{ marginTop: 8 }}>
            <Descriptions.Item label="当前生效原始值">
              <Typography.Text code copyable data-testid="drainConfig.rawValue">
                {drainItem?.value || '(未配置，代码兜底 云端30/设备30/尚热10)'}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {readonlyCnfs.map((c) => {
          const ids = splitIdList(c.item?.value);
          return (
            <Card key={c.key} title={`${c.title}（${c.key}）`} size="small">
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={`${c.hint}。只读：order-service 有 15 分钟本地缓存，在此修改会「改了没反应」，要改请走 DB。`}
              />
              {ids.length === 0 ? (
                <Typography.Text type="secondary">（空）</Typography.Text>
              ) : (
                <Space size={[4, 8]} wrap>
                  {ids.map((id) => (
                    <Tag key={id} style={{ fontFamily: 'monospace' }}>
                      {id}
                    </Tag>
                  ))}
                </Space>
              )}
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                共 {ids.length} 项
              </Typography.Paragraph>
            </Card>
          );
        })}
      </Space>
    </Spin>
  );
}
