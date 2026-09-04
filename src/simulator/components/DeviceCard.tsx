import React, { useRef, useState } from 'react'
import {
  Card,
  Tag,
  Button,
  Space,
  Popconfirm,
  Tooltip,
  message,
  Badge,
  Divider,
  Typography
} from 'antd'
import {
  DeleteOutlined,
  CopyOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useDeviceStore } from '../store/useDeviceStore'
import { getDeviceTypeConfig } from '../config/deviceTypes'
import { ActionFormModal } from './ActionFormModal'
import { OtaProgress, isOtaTerminal } from './OtaProgress'
import type { DeviceInstance } from '../types'
import type { ActionConfig } from '../config/deviceTypes'
import {
  ACCENT, BG_CARD, BG_SUBTLE, BORDER, DANGER, OFFLINE, SUCCESS,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WARNING, getTypeTheme
} from '../theme'

const { Text } = Typography

interface Props {
  device: DeviceInstance
}

const STATUS_COLOR: Record<string, string> = {
  connected: SUCCESS,
  connecting: WARNING,
  disconnected: OFFLINE,
  error: DANGER
}

const STATUS_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '已断开',
  error: '连接错误'
}

const DEVICE_STATUS_LABEL: Record<string, string> = {
  '0': '空闲',
  '1': '运行中',
  '2': '已暂停'
}

/** 状态值里代表"在忙"的文案（statusFields.format 出来的结果） */
const BUSY_TEXTS = ['执行中', '运行中', '进行中']

/**
 * 按水温取色：常温(≤18°C)为类型青，趋近 38°C 连续过渡到暖橙——排水管道用它上色。
 */
function tempColor(temp: number, alpha = 1): string {
  const t = Math.max(0, Math.min(1, (temp - 18) / 20))
  const h = Math.round(175 - 145 * t)
  return `hsla(${h}, 70%, 62%, ${alpha})`
}

export const DeviceCard: React.FC<Props> = ({ device }) => {
  const [actionModal, setActionModal] = useState<ActionConfig | null>(null)
  const { selectDevice, selectedDeviceId } = useDeviceStore()
  const config = getDeviceTypeConfig(device.deviceType)
  const isSelected = selectedDeviceId === device.deviceId

  async function sendAction(action: string) {
    const res = await fetch(`/simapi/devices/${device.deviceId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, bizData: {} })
    })
    const data = await res.json()
    if (data.success) {
      message.success(`指令已发送: ${action}`)
    } else {
      message.error(data.message)
    }
  }

  async function removeDevice() {
    await fetch(`/simapi/devices/${device.deviceId}`, { method: 'DELETE' })
  }

  async function triggerWarn(code: number) {
    const res = await fetch(`/simapi/devices/${device.deviceId}/warn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warnCode: code })
    })
    const data = await res.json()
    if (data.success) {
      message.warning(`已触发告警 ${code}`)
    }
  }

  // 手动触发设备 req（规范 4.6）：拉取/同步余量、拉取 OTA 固件信息，便于联调
  async function triggerReq(action: string, bizData: Record<string, unknown> = {}) {
    const res = await fetch(`/simapi/devices/${device.deviceId}/req`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, bizData })
    })
    const data = await res.json()
    if (data.success) {
      message.success(`已发送请求: ${action}`)
    } else {
      message.error(data.message || '请求失败')
    }
  }

  // 修改设备本地固件版本：OTA 指令下发时设备拿它与目标版本比对，一致就跳过升级，
  // 所以联调重测升级要能把它调回旧版本
  async function saveFirmwareVersion(value: string, chip?: 'p4' | 'c5') {
    const version = value.trim()
    const current = chip ? device.chipVersions?.[chip] : device.firmwareVersion
    if (!version || version === current) return
    try {
      const res = await fetch(`/simapi/devices/${device.deviceId}/firmware`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chip ? { version, chip } : { version })
      })
      const data = await res.json()
      if (data.success) {
        message.success(`本地${chip ? ' ' + chip.toUpperCase() : ''}固件版本已改为 ${version}`)
      } else {
        message.error(data.message || '修改失败')
      }
    } catch {
      message.error('修改失败')
    }
  }

  // 模拟升级失败：打断 sim-server 里排队的进度步骤，立刻上报 failed（本地版本不变）
  async function failOta() {
    try {
      const res = await fetch(`/simapi/devices/${device.deviceId}/ota/fail`, { method: 'POST' })
      const data = await res.json()
      if (data.success) message.warning('已上报 OTA 升级失败')
      else message.error(data.message || '操作失败')
    } catch {
      message.error('操作失败')
    }
  }

  function copyDeviceId() {
    navigator.clipboard.writeText(device.deviceId)
    message.success('已复制设备 ID')
  }

  function copySn() {
    if (!device.sn) return
    navigator.clipboard.writeText(device.sn)
    message.success(`已复制 SN ${device.sn}`)
  }

  function handleActionClick(action: ActionConfig) {
    if (!action.params || action.params.length === 0) {
      sendAction(action.action)
    } else {
      setActionModal(action)
    }
  }

  // 过滤可见 action（根据 showWhen）
  const visibleActions = config.actions.filter(
    (a) => !a.showWhen || a.showWhen(device.bizData as Record<string, unknown>)
  )

  const bizData = device.bizData as Record<string, unknown>

  const curTemp = bizData.waterTemperature

  // 是否在跑：deviceStatus=1（运行中）或任一 *State 字段不是 IDLE
  // （染色仪 makeState/calibState/refillState、洗头床 runState 等一并覆盖，不写死字段名）
  const isRunning =
    device.connectionStatus === 'connected' &&
    (device.deviceStatus === '1' ||
      Object.entries(bizData).some(
        ([k, v]) => /State$/i.test(k) && typeof v === 'string' && v !== '' && v !== 'IDLE'
      ))

  // 预热排水中（drainStatus 为功能态：达温暂停期间仍为 1）；运行态优先展示，两者卡面光晕互斥
  const isDraining =
    device.connectionStatus === 'connected' && bizData.drainStatus === 1

  // OTA 升级中：sim-server 随每条 ota/progress 上报广播 device.ota，卡片据此播动效；
  // 终态（success/failed）会停留几秒再由服务端清空。升级态光晕优先于运行/排水
  const ota = device.ota ?? null
  const otaActive = !!ota && !isOtaTerminal(ota.step)
  const otaDoneClass = ota && isOtaTerminal(ota.step)
    ? (ota.step === 'success' ? 'sim-card--ota-success' : 'sim-card--ota-failed')
    : null
  // 升级前版本：success 那一帧本地版本已被服务端刷成新版，所以在过程中记一下旧值（按被升级的芯片取）
  const otaFromVersion = useRef<string>('')
  if (otaActive && ota) {
    otaFromVersion.current = device.chipVersions?.[ota.chip as 'p4' | 'c5'] ?? device.firmwareVersion
  }
  // 动效收敛（2026-09-04）：排水不再给卡片加光晕，只有运行中/OTA 才变描边
  const cardClass = otaActive
    ? 'sim-card--ota'
    : otaDoneClass ?? (isRunning ? 'sim-card--running' : undefined)

  // 设备类型主题色（深色版统一在 ../theme 里维护）：多台设备并排时靠颜色区分类型
  const theme = getTypeTheme(device.deviceType)
  const isOffline = device.connectionStatus !== 'connected'

  return (
    <>
      <Card
        size="small"
        className={cardClass}
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 12,
          background: BG_CARD,
          // 选中态仍跟随类型色：深色下描边 + 同色光晕比浅色更需要，否则选中几乎看不出来
          // 未选中也带一点类型色描边：只靠顶部 3px 色条区分类型太弱；离线才退回中性边框
          border: isSelected
            ? `2px solid ${theme.main}`
            : `1px solid ${isOffline ? BORDER : theme.cardBorder}`,
          boxShadow: isSelected
            ? `0 4px 20px ${theme.main}40`
            : '0 2px 8px rgba(0,0,0,0.35)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onClick={() => selectDevice(device.deviceId)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* 顶部类型色条：离线置灰，一眼区分设备类型与在线与否 */}
            <span
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 3,
                borderRadius: '12px 12px 0 0',
                background: isOffline
                  ? OFFLINE
                  : `linear-gradient(90deg, ${theme.main}, ${theme.main}55)`
              }}
            />
            <Space>
              <Badge color={STATUS_COLOR[device.connectionStatus]} />
              <Text strong style={{ fontSize: 15, color: isOffline ? TEXT_SECONDARY : TEXT_PRIMARY }}>
                {device.displayName}
              </Text>
              <Tag color={isOffline ? 'default' : theme.tag} style={{ margin: 0 }}>
                {config.displayName}
              </Tag>
            </Space>
            <Tag
              color={
                otaActive
                  ? 'purple'
                  : isRunning
                  ? 'processing'
                  : device.deviceStatus === '2'
                  ? 'warning'
                  : 'default'
              }
              className={otaActive || isRunning ? 'sim-running-tag' : undefined}
              style={{ margin: 0 }}
            >
              {otaActive
                ? '升级中'
                : isRunning
                ? DEVICE_STATUS_LABEL['1']
                : DEVICE_STATUS_LABEL[device.deviceStatus] ?? device.deviceStatus}
            </Tag>
          </div>
        }
        extra={null}
      >
        {/* 设备 ID + SN 徽章 */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12, color: TEXT_SECONDARY }}>
              {device.deviceId}
            </Text>
            <Tooltip title="复制设备 ID">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={(e) => { e.stopPropagation(); copyDeviceId() }}
                style={{ color: TEXT_MUTED }}
              />
            </Tooltip>
            {/* SN 单独成徽章：它就是余量表 dye_device_cream.device_code，联调时最常用来对数据；
                设备在跑时加流光+脉冲，一眼看出哪台在工作 */}
            {device.sn && (
              <Tooltip title={`设备 SN（余量表 device_code）：${device.sn}${isRunning ? ' · 运行中' : ''}　点击复制`}>
                <span
                  className={`sim-sn${isRunning ? ' sim-sn--running' : ''}`}
                  onClick={(e) => { e.stopPropagation(); copySn() }}
                >
                  <span className="sim-sn__label">SN</span>
                  {device.sn}
                </span>
              </Tooltip>
            )}
          </div>
          {/* 固件版本：OTA 比对依据，点笔可改（改完设备立刻上报一次 status）。
              四代染色仪按芯片各一份（status 报 p4Version/c5Version），洗头床仍是整机一份 */}
          <div style={{ marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            {device.chipVersions ? (
              (['p4', 'c5'] as const).map((chip) => (
                <Tooltip key={chip} title={`本地 ${chip.toUpperCase()} 固件版本。收到该芯片 ota 指令时与目标版本比对，一致则跳过；点击可改，用于重测升级`}>
                  <Text style={{ fontSize: 11, color: TEXT_SECONDARY }}>
                    <span style={{ color: TEXT_MUTED, marginRight: 3 }}>{chip.toUpperCase()}</span>
                    <Text
                      style={{ fontSize: 11, color: TEXT_SECONDARY }}
                      editable={{
                        onChange: (v) => saveFirmwareVersion(v, chip),
                        tooltip: `修改 ${chip.toUpperCase()} 本地版本`,
                        maxLength: 32
                      }}
                    >
                      {device.chipVersions?.[chip] || '-'}
                    </Text>
                  </Text>
                </Tooltip>
              ))
            ) : (
              <Tooltip title="设备本地固件版本。收到 ota 指令时与目标版本比对，一致则跳过升级；点击可改，用于重测升级">
                <Text
                  style={{ fontSize: 11, color: TEXT_SECONDARY }}
                  editable={{
                    onChange: (v) => saveFirmwareVersion(v),
                    tooltip: '修改本地固件版本',
                    maxLength: 32
                  }}
                >
                  {device.firmwareVersion || '-'}
                </Text>
              </Tooltip>
            )}
          </div>
          <div>
            <Text style={{ fontSize: 11, color: TEXT_MUTED }}>
              {STATUS_LABEL[device.connectionStatus]} · {device.mqttHost}:{device.mqttPort}
            </Text>
          </div>
          {/* OTA 升级进程（收到 ota 指令到终态停留结束之间可见） */}
          {ota && (
            <div onClick={(e) => e.stopPropagation()}>
              <OtaProgress
                ota={ota}
                deviceType={device.deviceType}
                fromVersion={otaFromVersion.current}
              />
            </div>
          )}
        </div>

        {/* 状态信息 */}
        {device.connectionStatus === 'connected' && (
          <div
            style={{
              // 状态区按类型色淡染（深色下用同色低透明度），跟卡面拉开层次
              background: theme.soft,
              border: `1px solid ${theme.softBorder}`,
              borderRadius: 8,
              padding: '8px 12px',
              marginBottom: 12,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '4px 16px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {config.statusFields.map((field) => {
              const val = bizData[field.key]
              if (val === undefined || val === null) return null
              const display = field.format
                ? field.format(val)
                : String(val) + (field.unit ? ` ${field.unit}` : '')
              // 「执行中」这类忙态值标蓝加粗并带脉冲点，扫一眼就知道这台在干什么
              const busy = BUSY_TEXTS.includes(display)
              const row = (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: TEXT_SECONDARY }}>
                    {field.label}
                  </Text>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: busy ? 600 : 500,
                      color: busy ? ACCENT : TEXT_PRIMARY,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    {busy && (
                      <span
                        className="sim-running-tag"
                        style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: ACCENT, display: 'inline-block'
                        }}
                      />
                    )}
                    {display}
                  </span>
                </div>
              )
              // 洗头床：排水管道与水温同排（右列格），流动水流即预热排水中
              if (field.key === 'waterTemperature' && 'drainStatus' in bizData) {
                return (
                  <React.Fragment key={field.key}>
                    {row}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 12, color: TEXT_SECONDARY }}>排水</Text>
                      {/* 排水管道：排水中按水温上色填满，静态无流动动画 */}
                      <div
                        className="sim-pipe"
                        style={isDraining && typeof curTemp === 'number'
                          ? { borderColor: tempColor(curTemp, 0.45), background: tempColor(curTemp, 0.5) }
                          : undefined}
                      />
                      <span style={{
                        fontSize: 12,
                        fontWeight: isDraining ? 600 : 500,
                        color: isDraining && typeof curTemp === 'number' ? tempColor(curTemp) : TEXT_MUTED
                      }}>
                        {isDraining ? '预热中' : '关闭'}
                      </span>
                    </div>
                  </React.Fragment>
                )
              }
              return <React.Fragment key={field.key}>{row}</React.Fragment>
            })}
          </div>
        )}

        {/* 操作按钮 */}
        {device.connectionStatus === 'connected' && (
          <div style={{ marginBottom: 10 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {visibleActions.map((action) => {
                // 查询类是只读操作，保持中性灰；其余下发指令的用类型色描边，跟只读区分开
                const readOnly = /查询|状态/.test(action.label)
                return (
                  <Button
                    key={action.action}
                    size="small"
                    danger={action.danger}
                    type={action.danger ? 'primary' : 'default'}
                    ghost={action.danger}
                    onClick={() => handleActionClick(action)}
                    style={
                      !action.danger && !readOnly
                        ? { borderColor: theme.main, color: theme.main }
                        : undefined
                    }
                  >
                    {action.label}
                  </Button>
                )
              })}

              {/* 染色仪额外的测试按钮 */}
              {device.deviceType === 'dyemachine' &&
                (device.bizData as { makeState?: string }).makeState === 'BUSY' && (
                  <Tooltip title="模拟缺料告警（warnCode: 104）">
                    <Button
                      size="small"
                      icon={<WarningOutlined />}
                      onClick={() => triggerWarn(104)}
                      style={{ borderColor: WARNING, color: WARNING }}
                    >
                      触发告警
                    </Button>
                  </Tooltip>
                )}

              {/* 染色仪余量请求（规范 4.6 REMAIN，设备主动 req） */}
              {device.deviceType === 'dyemachine' && (
                <>
                  <Tooltip title="向云端拉取各泵余量（get_remain）">
                    <Button size="small" onClick={() => triggerReq('get_remain')}>
                      拉取余量
                    </Button>
                  </Tooltip>
                  <Tooltip title="上报各泵当前余量到云端（sync_remain）">
                    <Button size="small" onClick={() => triggerReq('sync_remain')}>
                      同步余量
                    </Button>
                  </Tooltip>
                  <Tooltip title="拉取最新固件信息（get_ota_info，targets=esp32c5+esp32p4），响应见日志">
                    <Button size="small" data-testid={`sim.get-ota-info-${device.deviceId}`}
                      onClick={() => triggerReq('get_ota_info', { targets: ['esp32c5', 'esp32p4'] })}>
                      拉取OTA
                    </Button>
                  </Tooltip>
                  <Tooltip title={otaActive
                    ? '打断当前升级，设备立即上报 failed（本地版本不变）'
                    : '先从控制面板/PC 推一条 OTA 指令，升级进行中时可点'}>
                    <Button
                      size="small"
                      danger
                      ghost={otaActive}
                      disabled={!otaActive}
                      data-testid={`sim.ota-fail-${device.deviceId}`}
                      onClick={failOta}
                    >
                      模拟升级失败
                    </Button>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        )}

        <Divider style={{ margin: '8px 0', borderColor: BORDER }} />

        {/* 底部操作 */}
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Popconfirm
            title="确定断开并删除该设备？"
            onConfirm={removeDevice}
            okText="确定"
            cancelText="取消"
          >
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
            >
              移除
            </Button>
          </Popconfirm>
        </div>
      </Card>

      <ActionFormModal
        open={!!actionModal}
        action={actionModal}
        deviceId={device.deviceId}
        onClose={() => setActionModal(null)}
      />
    </>
  )
}
