/**
 * 设备列表「批量升级」旁的当前批次状态条。
 *
 * 同一时刻只允许一个活跃批次（后端 batchPush 会拒绝第二个），所以这里：
 *  - 进页面拉一次 ota/batch/current，**不轮询**；推送完由父组件 refreshSeq 触发重拉，
 *    其余靠「刷新」文字按钮手动拉，进度看「设备升级记录」页；
 *  - 有活跃批次：展示 固件 / 待推 / 进行中 / 成功 / 失败 计数 + 「取消升级」+「查看记录」；
 *  - 取消只取消「待升级且未 ack」的设备（指令未送达），已开始的让其走完，二次确认里写明。
 * 父组件靠 onActiveChange 决定「批量升级」按钮是否置灰。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Space, Tooltip, Typography, message } from 'antd';
import { CHIP_LABEL } from '../api/firmware';
import { cancelBatch, fetchCurrentBatch, type OtaBatchSummary } from '../api/otaPush';
import { setOtaRecordPreset } from '../api/otaRecord';
import { navigateTo } from '../nav';

const { Text } = Typography;

interface Props {
  /** 外部触发刷新（比如刚推送完）的计数器，变了就立即重拉 */
  refreshSeq?: number;
  onActiveChange?: (active: boolean) => void;
}

export function OtaBatchStatusBar({ refreshSeq = 0, onActiveChange }: Props) {
  const [batch, setBatch] = useState<OtaBatchSummary | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await fetchCurrentBatch();
      setBatch(b);
      onActiveChange?.(!!b);
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setLoading(false);
    }
  }, [onActiveChange]);

  useEffect(() => { void load(); }, [load, refreshSeq]);

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
    // 只回填 版本/芯片/设备类型 到记录页表单，不按 batchId 隐藏过滤
    setOtaRecordPreset({
      targetVersion: batch.targetVersion,
      chip: batch.chip,
      deviceModel: 4,
    });
    navigateTo('pcOtaRecord');
  };

  // 长条卡片：左侧版本/台数，中间四个计数（全部显示，0 为灰色，非 0 按状态着色），右侧三个文字操作
  const linkStyle = { padding: 0, height: 'auto', fontSize: 12 } as const;
  const counts: Array<{ key: string; label: string; n: number; color: string; tip: string }> = [
    { key: 'pending', label: '待推', n: batch.pendingCount, color: '#faad14', tip: '待升级且指令未送达（离线 / 运行中，等补推）' },
    { key: 'progress', label: '进行中', n: batch.inProgressCount, color: '#1677ff', tip: '指令已到设备，下载 / 安装 / 重启中' },
    { key: 'success', label: '成功', n: batch.successCount, color: '#52c41a', tip: '已升级成功' },
    { key: 'failed', label: '失败', n: batch.failedCount, color: '#ff4d4f', tip: '失败 / 超时 / 人工取消' },
  ];

  return (
    <div
      data-testid="otaBatch.bar"
      style={{
        marginTop: 8,
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
        fontSize: 12,
        background: '#f0f5ff',
        border: '1px solid #adc6ff',
        borderRadius: 6,
      }}
    >
      <Space size={6}>
        <Text style={{ fontSize: 12 }}>升级中</Text>
        <Text strong style={{ fontSize: 12 }}>{batch.targetVersion}</Text>
        {batch.chip ? <Text type="secondary" style={{ fontSize: 12 }}>{CHIP_LABEL[batch.chip] ?? batch.chip}</Text> : null}
        <Text type="secondary" style={{ fontSize: 12 }}>· 共 {batch.total} 台</Text>
      </Space>
      <Space size={14}>
        {counts.map((c) => (
          <Tooltip key={c.key} title={c.tip}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: c.n > 0 ? c.color : '#d9d9d9' }} />
              <Text type={c.n > 0 ? undefined : 'secondary'} style={{ fontSize: 12 }}>{c.label}</Text>
              <Text strong={c.n > 0} type={c.n > 0 ? undefined : 'secondary'} style={{ fontSize: 12 }}>{c.n}</Text>
            </span>
          </Tooltip>
        ))}
      </Space>
      <Space size={12} style={{ marginLeft: 'auto' }}>
        <Button type="link" size="small" style={linkStyle} data-testid="otaBatch.refresh" loading={loading} onClick={() => void load()}>
          刷新
        </Button>
        <Button type="link" size="small" style={linkStyle} data-testid="otaBatch.records" onClick={viewRecords}>查看记录</Button>
        <Tooltip title={batch.pendingCount === 0 ? '没有可取消的设备：指令已送达的无法撤回' : `取消 ${batch.pendingCount} 台尚未送达指令的设备`}>
          <Button type="link" size="small" danger style={linkStyle} data-testid="otaBatch.cancel" loading={cancelling}
            disabled={batch.pendingCount === 0} onClick={onCancel}>
            取消升级
          </Button>
        </Tooltip>
      </Space>
    </div>
  );
}
