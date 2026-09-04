/**
 * 设备列表「批量升级」旁的当前批次状态条。
 *
 * 同一时刻只允许一个活跃批次（后端 batchPush 会拒绝第二个），所以这里：
 *  - 进页面拉一次 ota/batch/current，有活跃批次时每 30s 轮询；
 *  - 有活跃批次：展示 固件 / 待推 / 进行中 / 成功 / 失败 计数 + 「取消升级」+「查看记录」；
 *  - 取消只取消「待升级且未 ack」的设备（指令未送达），已开始的让其走完，二次确认里写明。
 * 父组件靠 onActiveChange 决定「批量升级」按钮是否置灰。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Space, Tag, Tooltip, Typography, message } from 'antd';
import { CHIP_LABEL } from '../api/firmware';
import { cancelBatch, fetchCurrentBatch, type OtaBatchSummary } from '../api/otaPush';
import { setOtaRecordPreset } from '../api/otaRecord';
import { navigateTo } from '../nav';

const { Text } = Typography;
const POLL_MS = 30_000;

interface Props {
  /** 外部触发刷新（比如刚推送完）的计数器，变了就立即重拉 */
  refreshSeq?: number;
  onActiveChange?: (active: boolean) => void;
}

export function OtaBatchStatusBar({ refreshSeq = 0, onActiveChange }: Props) {
  const [batch, setBatch] = useState<OtaBatchSummary | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await fetchCurrentBatch();
      setBatch(b);
      onActiveChange?.(!!b);
    } catch {
      /* 全局拦截器已提示 */
    }
  }, [onActiveChange]);

  useEffect(() => { void load(); }, [load, refreshSeq]);

  // 只在有活跃批次时轮询，没任务不打扰后端
  useEffect(() => {
    if (!batch) return undefined;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [batch, load]);

  if (!batch?.batchId) return null;

  const onCancel = () => {
    Modal.confirm({
      title: '取消本次批量升级？',
      content: `将取消 ${batch.pendingCount} 台尚未开始（指令未送达）的设备；已开始的 ${batch.inProgressCount} 台指令已到设备，无法撤回，会继续升级到终态。`,
      okText: '确认取消',
      okButtonProps: { danger: true, 'data-testid': 'otaBatch.cancel-confirm' },
      cancelText: '再想想',
      onOk: async () => {
        setCancelling(true);
        try {
          const n = await cancelBatch(batch.batchId as string);
          message.success(`已取消 ${n} 台`);
          await load();
        } finally {
          setCancelling(false);
        }
      },
    });
  };

  const viewRecords = () => {
    setOtaRecordPreset({
      batchId: batch.batchId ?? undefined,
      firmwareId: batch.firmwareId,
      targetVersion: batch.targetVersion,
      chip: batch.chip,
      deviceModel: 4,
    });
    navigateTo('pcOtaRecord');
  };

  return (
    <Space size={6} wrap data-testid="otaBatch.bar" style={{ alignItems: 'center' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        进行中：{batch.targetVersion}{batch.chip ? `（${CHIP_LABEL[batch.chip] ?? batch.chip}）` : ''} · 共 {batch.total} 台
      </Text>
      <Tooltip title="待升级且指令未送达（离线 / 运行中，等补推）"><Tag>待推 {batch.pendingCount}</Tag></Tooltip>
      <Tooltip title="指令已到设备，下载 / 安装 / 重启中"><Tag color="processing">进行中 {batch.inProgressCount}</Tag></Tooltip>
      <Tag color="success">成功 {batch.successCount}</Tag>
      <Tag color={batch.failedCount ? 'error' : 'default'}>失败 {batch.failedCount}</Tag>
      <Button size="small" danger data-testid="otaBatch.cancel" loading={cancelling}
        disabled={batch.pendingCount === 0} onClick={onCancel}>
        取消升级
      </Button>
      <Button size="small" type="link" data-testid="otaBatch.records" onClick={viewRecords}>查看记录</Button>
    </Space>
  );
}
