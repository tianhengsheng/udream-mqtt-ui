import React from 'react'
import { Tooltip, Typography } from 'antd'
import {
  CheckCircleFilled, CloseCircleFilled, CloudDownloadOutlined,
  ReloadOutlined, ToolOutlined
} from '@ant-design/icons'
import type { OtaState, OtaStep } from '../types'
import { DANGER, SUCCESS, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, getTypeTheme } from '../theme'

const { Text } = Typography

/** 过程阶段顺序（终态不在轨迹上） */
const FLOW: OtaStep[] = ['downloading', 'installing', 'rebooting']

const STEP_LABEL: Record<OtaStep, string> = {
  downloading: '下载固件',
  installing: '写入固件',
  rebooting: '重启生效',
  success: '升级成功',
  failed: '升级失败'
}

/**
 * 各阶段在整体进度条上占的区间：下载最耗时占前半，写入次之，重启只剩一小段收尾。
 * 阶段内 progress 按区间线性映射，整条进度只增不减。
 */
const STEP_RANGE: Record<OtaStep, [number, number]> = {
  downloading: [0, 55],
  installing: [55, 88],
  rebooting: [88, 99],
  success: [100, 100],
  failed: [100, 100]
}

export function otaOverallPercent(ota: OtaState): number {
  const [from, to] = STEP_RANGE[ota.step] ?? [0, 0]
  const p = Math.max(0, Math.min(100, ota.progress))
  return Math.round(from + ((to - from) * p) / 100)
}

export const isOtaTerminal = (step: OtaStep) => step === 'success' || step === 'failed'

interface Props {
  ota: OtaState
  deviceType: string
  /** 升级前的本地版本，成功时展示 旧 → 新 */
  fromVersion?: string
}

/**
 * 设备卡片上的 OTA 升级进程：芯片 + 阶段轨迹 + 整体进度条 + 目标版本。
 * 数据完全来自 sim-server 随 ota/progress 上报同步广播的 device.ota，
 * 卡片看到的就是设备刚发出去的那一条。
 */
export const OtaProgress: React.FC<Props> = ({ ota, deviceType, fromVersion }) => {
  const theme = getTypeTheme(deviceType)
  const terminal = isOtaTerminal(ota.step)
  const failed = ota.step === 'failed'
  const percent = otaOverallPercent(ota)
  const color = failed ? DANGER : ota.step === 'success' ? SUCCESS : theme.main
  const nowIdx = FLOW.indexOf(ota.step)

  const stepIcon = (() => {
    switch (ota.step) {
      case 'downloading': return <CloudDownloadOutlined />
      case 'installing': return <ToolOutlined />
      case 'rebooting': return <ReloadOutlined className="sim-ota__spin" />
      case 'success': return <CheckCircleFilled />
      case 'failed': return <CloseCircleFilled />
    }
  })()

  return (
    <div
      data-testid="sim.ota"
      data-step={ota.step}
      className={terminal ? 'sim-ota__done' : undefined}
      style={{
        marginTop: 6,
        marginBottom: 10,
        padding: '8px 10px',
        borderRadius: 8,
        background: theme.soft,
        border: `1px solid ${terminal ? color : theme.softBorder}`,
        transition: 'border-color 0.3s'
      }}
    >
      {/* 标题行：芯片 + 阶段 + 百分比 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '0 5px', borderRadius: 3,
          background: color, color: '#1c2128', lineHeight: '16px'
        }}>
          {ota.chip.toUpperCase()}
        </span>
        <span style={{ color, fontSize: 13, display: 'inline-flex' }}>{stepIcon}</span>
        <Text strong style={{ fontSize: 12, color: terminal ? color : TEXT_PRIMARY }}>
          {terminal ? STEP_LABEL[ota.step] : `OTA · ${STEP_LABEL[ota.step]}`}
        </Text>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: terminal ? color : TEXT_SECONDARY, fontWeight: 600 }}>
          {terminal ? (failed ? '—' : '100%') : `${percent}%`}
        </span>
      </div>

      {/* 整体进度条 */}
      <div className="sim-ota__bar" style={{ marginTop: 6 }}>
        <div
          className={`sim-ota__fill${terminal ? '' : ' sim-ota__fill--active'}`}
          style={{ width: `${failed ? 100 : percent}%`, background: color }}
        />
      </div>

      {/* 阶段轨迹 + 版本 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {FLOW.map((s, i) => {
            const done = terminal ? !failed : i < nowIdx
            const now = !terminal && i === nowIdx
            return (
              <Tooltip key={s} title={STEP_LABEL[s]}>
                <span
                  className={`sim-ota__dot${done ? ' sim-ota__dot--done' : now ? ' sim-ota__dot--now' : ''}`}
                  style={done && ota.step === 'success' ? { background: SUCCESS, borderColor: SUCCESS } : undefined}
                />
              </Tooltip>
            )
          })}
          <Text style={{ fontSize: 11, color: TEXT_MUTED, marginLeft: 2 }}>
            {terminal ? '' : `${ota.progress}%`}
          </Text>
        </div>
        <Text style={{ marginLeft: 'auto', fontSize: 11, color: TEXT_SECONDARY, fontVariantNumeric: 'tabular-nums' }}>
          {ota.step === 'success' && fromVersion && fromVersion !== ota.version
            ? <>{fromVersion} <span style={{ color: SUCCESS }}>→ {ota.version}</span></>
            : ota.version ? `→ ${ota.version}` : ota.taskId}
        </Text>
      </div>
    </div>
  )
}
