/**
 * 顾客取号（小程序端页，走小程序顾客 token）。
 *
 * 为「叫号触发洗头床预热排水」联调造数：顾客取一个含洗头床项目的号，
 * 再到 App「排队叫号」页叫号，即可触发 order → Kafka → dye 调度器 → MQTT drain_on 全链路。
 *
 * 为哪位手艺人取号：直接读 session 里 mode='app' 的账号（双端 token 模型自带
 * uid=craftsmanId 与 defaultStoreId=门店），不需要额外接口，也不用跨页 localStorage 契约。
 *
 * 页面保持**浅色**（业务端页约定，模拟器深色 theme.ts 不往这里套）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Select, Space, Spin, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { PhoneFrame } from '../app-mobile/PhoneFrame';
import { AppSimLayout } from '../app-mobile/AppSimLayout';
import { useSession } from '../store/useSession';
import {
  SHAMPOO_BED_ITEM_IDS,
  listItemDetails,
  udreamAdd,
  type ItemDetail,
  type QueuedWaitingStatus,
} from '../api/queuedSim';

const errText = (e: any): string =>
  e?.retInfo || e?.retMsg || e?.msg || e?.message || (typeof e === 'string' ? e : '请求失败');

/** 是否洗头床项目（决定这次取号叫号后会不会触发预热） */
const isShampooBed = (itemId?: string) => !!itemId && SHAMPOO_BED_ITEM_IDS.includes(itemId);

export function MiniQueuedAddPage() {
  // 顾客身份 = 当前小程序端激活账号（顶部账号栏已展示，页面内不重复展示）
  const customer = useSession((s) => s.users.find((u) => u.id === s.miniUserId));
  // 候选手艺人 = session 里全部 App 端账号（自带 uid + 默认门店）
  const craftsmen = useSession((s) => s.users.filter((u) => u.mode === 'app'));

  const [craftsmanKey, setCraftsmanKey] = useState<string>('');
  const craftsman = useMemo(
    () => craftsmen.find((c) => c.id === craftsmanKey) || craftsmen[0],
    [craftsmen, craftsmanKey],
  );
  const storeId = craftsman?.currentStoreId || craftsman?.defaultStoreId || '';

  const [items, setItems] = useState<ItemDetail[]>([]);
  const [itemLoading, setItemLoading] = useState(false);
  const [pickedItemId, setPickedItemId] = useState('');
  const [pickedPriceId, setPickedPriceId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QueuedWaitingStatus | null>(null);

  const pickedItem = useMemo(
    () => items.find((i) => i.itemId === pickedItemId),
    [items, pickedItemId],
  );

  /** 拉门店项目清单；洗头床项目自动排前面，省得在长列表里找 */
  const loadItems = useCallback(async () => {
    if (!storeId || !craftsman?.uid) {
      setItems([]);
      return;
    }
    setItemLoading(true);
    try {
      const list = await listItemDetails(storeId, craftsman.uid);
      const sorted = [...list].sort(
        (a, b) => Number(isShampooBed(b.itemId)) - Number(isShampooBed(a.itemId)),
      );
      setItems(sorted);
      // 默认选中第一个洗头床项目（预热联调的主用例）
      const hit = sorted.find((i) => isShampooBed(i.itemId)) || sorted[0];
      setPickedItemId(hit?.itemId || '');
      setPickedPriceId(hit?.itemPrices?.[0]?.id || '');
    } catch (e) {
      setItems([]);
      message.error(`项目清单读取失败：${errText(e)}`);
    } finally {
      setItemLoading(false);
    }
  }, [storeId, craftsman?.uid]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  /** 切项目时价格跟着切到第一档 */
  const onPickItem = (itemId: string) => {
    setPickedItemId(itemId);
    const it = items.find((i) => i.itemId === itemId);
    setPickedPriceId(it?.itemPrices?.[0]?.id || '');
  };

  const submit = async () => {
    if (!customer?.uid) {
      message.warning('请先在顶部登录小程序（顾客）账号');
      return;
    }
    if (!craftsman?.uid || !storeId) {
      message.warning('请先选择手艺人（需先登录 App 端账号）');
      return;
    }
    if (!pickedItemId) {
      message.warning('请选择服务项目');
      return;
    }
    setSubmitting(true);
    try {
      const res = await udreamAdd({
        uid: customer.uid,
        storeId,
        craftsmanId: craftsman.uid,
        items: [{ itemId: pickedItemId, priceId: pickedPriceId || undefined }],
      });
      setResult(res);
      message.success(`取号成功：${res.queuedNo || res.queuedId || ''}`);
    } catch (e) {
      message.error(`取号失败：${errText(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<ItemDetail> = [
    {
      title: '项目',
      dataIndex: 'itemName',
      render: (v: string, r) => (
        <Space size={4}>
          {v}
          {isShampooBed(r.itemId) && <Tag color="cyan">洗头床</Tag>}
        </Space>
      ),
    },
    { title: '价格', dataIndex: 'price', width: 80, render: (v?: number) => (v != null ? `¥${v}` : '-') },
    {
      title: '',
      width: 64,
      render: (_, r) => (
        <Button
          size="small"
          type={r.itemId === pickedItemId ? 'primary' : 'default'}
          data-testid={`queuedAdd.item-${r.itemId}`}
          onClick={() => onPickItem(r.itemId || '')}
        >
          {r.itemId === pickedItemId ? '已选' : '选择'}
        </Button>
      ),
    },
  ];

  /* ── 手机壳内：取号单 ─────────────────────────────────────────────── */
  const phoneView = (
    <div style={{ background: '#f5f6f8', minHeight: '100%', padding: 12 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>门店</div>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>
          {craftsman?.defaultStoreName || '-'}
        </div>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>手艺人</div>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{craftsman?.name || '-'}</div>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>服务项目</div>
        <div style={{ fontWeight: 600 }}>
          {pickedItem?.itemName || '-'}
          {isShampooBed(pickedItemId) && (
            <Tag color="cyan" style={{ marginLeft: 6 }}>
              洗头床
            </Tag>
          )}
        </div>
      </div>

      {result && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <div style={{ textAlign: 'center', color: '#2aa1e8', fontSize: 30, fontWeight: 600 }}>
            {result.queuedNo || '-'}
          </div>
          <div style={{ textAlign: 'center', fontSize: 12, color: '#8c8c8c', marginBottom: 10 }}>
            取号成功
          </div>
          <div style={{ display: 'flex', textAlign: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{result.waitingCount ?? '-'}</div>
              <div style={{ fontSize: 11, color: '#8c8c8c' }}>前面等待</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{result.waitingMinutes ?? '-'}</div>
              <div style={{ fontSize: 11, color: '#8c8c8c' }}>预计分钟</div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#bfbfbf', wordBreak: 'break-all' }}>
            queuedId: {result.queuedId || '-'}
          </div>
        </div>
      )}

      <Button
        type="primary"
        block
        size="large"
        loading={submitting}
        data-testid="queuedAdd.submit"
        onClick={submit}
      >
        立即取号
      </Button>
      {isShampooBed(pickedItemId) && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#8c8c8c', textAlign: 'center' }}>
          该项目为洗头床项目，叫号后将触发预热排水
        </div>
      )}
    </div>
  );

  return (
    <AppSimLayout
      controls={
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Card size="small" title="取号参数">
            <Space direction="vertical" style={{ width: '100%' }}>
              {!customer && (
                <Alert type="warning" showIcon message="未登录小程序（顾客）账号，取号会失败" />
              )}
              {craftsmen.length === 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="没有可选手艺人：请先在顶部登录至少一个 App（手艺人）账号"
                />
              )}
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="顾客">
                  {customer ? `${customer.name}（${customer.uid}）` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="手艺人">
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={craftsman?.id}
                    placeholder="选择手艺人"
                    options={craftsmen.map((c) => ({
                      value: c.id,
                      label: `${c.name}（${c.defaultStoreName || '无默认门店'}）`,
                    }))}
                    onChange={(v) => setCraftsmanKey(v)}
                  />
                </Descriptions.Item>
                <Descriptions.Item label="门店 id">{storeId || '-'}</Descriptions.Item>
                <Descriptions.Item label="itemId / priceId">
                  {pickedItemId || '-'} / {pickedPriceId || '（不传）'}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>

          <Card
            size="small"
            title="门店项目（洗头床项目置顶）"
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void loadItems()} />}
          >
            {itemLoading ? (
              <Spin />
            ) : (
              <Table
                size="small"
                rowKey={(r) => r.itemId || ''}
                columns={columns}
                dataSource={items}
                pagination={{ pageSize: 8, size: 'small' }}
                locale={{ emptyText: '无项目（检查门店/手艺人或接口权限）' }}
              />
            )}
          </Card>

          <Alert
            type="info"
            showIcon
            message="取号走小程序顾客 token（被测链路）；项目清单借 App token 查询，避开网关对小程序 token 的白名单限制。取号后到 App「排队叫号」页叫号即可触发预热。"
          />
        </Space>
      }
    >
      <PhoneFrame title="取号">{phoneView}</PhoneFrame>
    </AppSimLayout>
  );
}
