/**
 * 【OTA】批量固件推送确认弹窗（设备列表「批量升级」入口）。
 *
 * 按原型：选中台数汇总（在线立即推送 / 离线待补推 / 型号不兼容）→ 选目标固件（四代机上架固件，
 * 一颗芯片一个包）→ 立即推送。2026-09-04 任务化：勾选的兼容设备**全部**建任务，离线的等上线补推或
 * job 重扫，所以确认按钮按兼容总数计。本期不做升级模式（静默升级），弹窗里不出现该项。
 * 推送后展示后端受理结果（立即推送 / 待补推 / 跳过及原因），ack 与进度在「设备升级记录」页看。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { DyeDeviceItem } from '../api/dye';
import { CHIP_LABEL, type FirmwareItem } from '../api/firmware';
import { batchPushOta, fetchPushableFirmwares, type OtaBatchPushResult } from '../api/otaPush';
import { navigateTo } from '../nav';

const { Text } = Typography;
const MODEL_FOUR = 4;

interface Props {
  open: boolean;
  devices: DyeDeviceItem[];
  onClose: () => void;
}

export function OtaBatchPushModal({ open, devices, onClose }: Props) {
  const [firmwares, setFirmwares] = useState<FirmwareItem[]>([]);
  const [loadingFw, setLoadingFw] = useState(false);
  const [firmwareId, setFirmwareId] = useState<string | number | undefined>();
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<OtaBatchPushResult | null>(null);

  // 每次打开重新拉一遍上架固件，并清掉上次的选择/结果
  useEffect(() => {
    if (!open) return;
    setFirmwareId(undefined);
    setResult(null);
    setLoadingFw(true);
    fetchPushableFirmwares()
      .then(setFirmwares)
      .catch(() => setFirmwares([]))
      .finally(() => setLoadingFw(false));
  }, [open]);

  // 汇总：型号不兼容（非四代机）优先剔除，其余按连接状态分在线/离线；只推在线且兼容的
  const groups = useMemo(() => {
    const incompatible = devices.filter((d) => d.model !== MODEL_FOUR);
    const compatible = devices.filter((d) => d.model === MODEL_FOUR);
    const online = compatible.filter((d) => d.deviceStatus === 1);
    const offline = compatible.filter((d) => d.deviceStatus !== 1);
    return { incompatible, online, offline };
  }, [devices]);

  // 兼容的全推：在线的后端立刻发，离线的建任务等补推
  const targets = [...groups.online, ...groups.offline].map((d) => d.macCode).filter((c): c is string => !!c);
  const selectedFw = firmwares.find((f) => String(f.id) === String(firmwareId));

  const fwOptions = firmwares.map((f) => ({
    value: String(f.id),
    label: `${f.version ?? '-'}（${CHIP_LABEL[f.chip ?? ''] ?? f.chip}）· ${f.createTime ?? ''}`,
  }));

  async function doPush() {
    if (!firmwareId) { message.warning('请选择目标固件'); return; }
    if (targets.length === 0) { message.warning('没有可推送的四代机'); return; }
    setPushing(true);
    try {
      const r = await batchPushOta(firmwareId, targets);
      setResult(r);
      message.success(`已受理：立即推送 ${r.pushedCount} 台，离线待补推 ${r.pendingCount} 台，跳过 ${r.skippedCount} 台`);
    } catch {
      /* 全局拦截器已提示 */
    } finally {
      setPushing(false);
    }
  }

  const footer = result
    ? [
        <Button key="records" type="link" onClick={() => { onClose(); navigateTo('pcOtaRecord'); }}>
          去设备升级记录查看进度
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>关闭</Button>,
      ]
    : [
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button
          key="push"
          type="primary"
          data-testid="otaPush.confirm"
          loading={pushing}
          disabled={!firmwareId || targets.length === 0}
          onClick={doPush}
        >
          立即推送（{targets.length} 台）
        </Button>,
      ];

  return (
    <Modal
      title="【OTA】批量固件推送确认"
      open={open}
      onCancel={onClose}
      footer={footer}
      width={640}
      destroyOnClose
      data-testid="otaPush.modal"
    >
      {!result ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            您即将对以下 <Text strong>{devices.length}</Text> 台设备进行固件推送：
          </div>
          <Space size={8} wrap>
            <Tag color="green">在线立即推送：{groups.online.length} 台</Tag>
            <Tag color="gold">离线待补推：{groups.offline.length} 台</Tag>
            <Tag color={groups.incompatible.length ? 'red' : 'default'}>型号不兼容：{groups.incompatible.length} 台</Tag>
          </Space>
          {groups.incompatible.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              不兼容：{groups.incompatible.map((d) => `${d.macCode}(${d.modelName ?? d.model})`).join('、')}
            </Text>
          )}
          {groups.offline.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              离线设备会先建任务，上线后自动补推：{groups.offline.map((d) => d.macCode).join('、')}
            </Text>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ whiteSpace: 'nowrap' }}>选择目标固件：</span>
            <Select
              data-testid="otaPush.firmware"
              style={{ flex: 1 }}
              placeholder={loadingFw ? '加载中…' : '请选择四代机上架固件（一颗芯片一个包）'}
              loading={loadingFw}
              value={firmwareId == null ? undefined : String(firmwareId)}
              onChange={(v) => setFirmwareId(v)}
              options={fwOptions}
              showSearch
              optionFilterProp="label"
            />
          </div>
          {selectedFw && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              md5：{selectedFw.md5 ?? '-'}　大小：{selectedFw.size != null ? `${(selectedFw.size / 1024 / 1024).toFixed(2)} MB` : '-'}
            </Text>
          )}
          <Alert
            type="warning"
            showIcon
            message="警告：升级会导致设备自动重启，云端只在设备空闲时下发，运行中的设备等空闲后自动重推。同一时刻只允许一个批量升级任务，同设备同芯片已有进行中任务的会被跳过。"
          />
        </Space>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8} wrap>
            <Tag color="green">立即推送：{result.pushedCount} 台</Tag>
            <Tag color="gold">离线待补推：{result.pendingCount} 台</Tag>
            <Tag color={result.skippedCount ? 'orange' : 'default'}>跳过：{result.skippedCount} 台</Tag>
          </Space>
          {result.pending.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>待补推：{result.pending.join('、')}</Text>
          )}
          {result.skipped.length > 0 && (
            <Table
              size="small"
              pagination={false}
              rowKey="deviceCode"
              dataSource={result.skipped}
              columns={[
                { title: 'MAC码', dataIndex: 'deviceCode', width: 140 },
                { title: '跳过原因', dataIndex: 'reason' },
              ]}
            />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            推送已受理，设备 ack 与升级进度异步回写；离线 / 运行中的设备由云端自动补推，到「设备升级记录」页查看。
          </Text>
        </Space>
      )}
    </Modal>
  );
}
