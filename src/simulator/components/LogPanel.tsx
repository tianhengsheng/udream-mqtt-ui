import React, { useEffect, useRef, useState } from 'react'
import { Tag, Typography, Empty, Button, Space, Select } from 'antd'
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  ClearOutlined,
  DownOutlined,
  UpOutlined
} from '@ant-design/icons'
import { useDeviceStore } from '../store/useDeviceStore'
import type { LogEntry } from '../types'
import {
  BG_CARD, BG_PAGE, BG_SUBTLE, BORDER, BORDER_WEAK,
  DANGER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WARNING
} from '../theme'

const { Text } = Typography

// -------- 日志分类 --------
type LogCategory = 'all' | 'cmd' | 'req' | 'status' | 'event' | 'system'

function getCategory(entry: LogEntry): LogCategory {
  const t = entry.topic
  if (!t) return 'system'
  if (t.includes('/cmd/') || t.includes('/cmdresp/')) return 'cmd'
  // 设备主动请求/响应：device/{type}/req/{id}、device/{type}/resp/{id}
  if (t.includes('/req/') || t.includes('/resp/')) return 'req'
  if (t.includes('/status/')) return 'status'
  if (t.includes('/event/')) return 'event'
  return 'system'
}

/** 从 topic 提取末段类型，如 device/washbed/cmd/xx → cmd */
function topicType(topic: string): string {
  if (!topic) return ''
  const parts = topic.split('/')
  return parts[2] ?? ''
}

/** 从 JSON 消息提取一行摘要 */
function getSummary(message: string, tType: string): string {
  try {
    const p = JSON.parse(message)
    switch (tType) {
      case 'cmd':      return `action=${p.action ?? '?'}${p.cmdId ? ` · id=${p.cmdId.slice(0, 8)}` : ''}`
      case 'cmdresp':  return `opStatus=${p.opStatus}${p.message ? ` · ${p.message}` : ''}${p.cmdId ? ` · id=${p.cmdId.slice(0, 8)}` : ''}`
      case 'req':      return `action=${p.action ?? '?'}${p.reqId ? ` · id=${p.reqId.slice(0, 8)}` : ''}`
      case 'resp':     return `opStatus=${p.opStatus}${p.message ? ` · ${p.message}` : ''}${p.reqId ? ` · id=${p.reqId.slice(0, 8)}` : ''}`
      case 'status':   return `status=${p.status ?? '?'}${p.bizData ? ` · ${JSON.stringify(p.bizData).slice(0, 60)}` : ''}`
      case 'event':    return `${p.eventType ?? '?'}${p.taskId ? ` · task=${p.taskId.slice(0, 8)}` : ''}`
      default: return ''
    }
  } catch {
    return ''
  }
}

// -------- 每个 topic 类型的样式 --------
// 深色版：语义色照旧（指令蓝 / 响应绿 / 请求粉 / 状态青 / 事件黄），
// 但全部提亮，底色换成该色的低透明度——在 BG_SUBTLE 这种偏亮的底上，
// 透明度低于 0.18 色块就看不出来了。
const TOPIC_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  cmd:           { color: '#58a6ff', bg: 'rgba(88,166,255,0.18)',  label: '指令' },
  cmdresp:       { color: '#3fb950', bg: 'rgba(63,185,80,0.18)',   label: '响应' },
  req:           { color: '#f778ba', bg: 'rgba(247,120,186,0.18)', label: '请求' },
  resp:          { color: '#db61a2', bg: 'rgba(219,97,162,0.20)',  label: '应答' },
  status:        { color: '#39c5cf', bg: 'rgba(57,197,207,0.18)',  label: '状态' },
  event:         { color: '#e3b341', bg: 'rgba(227,179,65,0.18)',  label: '事件' },
}

const DIR_ICON: Record<string, React.ReactNode> = {
  up:    <ArrowUpOutlined style={{ fontSize: 10 }} />,
  down:  <ArrowDownOutlined style={{ fontSize: 10 }} />,
  info:  <InfoCircleOutlined style={{ fontSize: 10 }} />,
  warn:  <WarningOutlined style={{ fontSize: 10 }} />,
  error: <CloseCircleOutlined style={{ fontSize: 10 }} />,
}
const DIR_COLOR: Record<string, string> = {
  up: '#3fb950', down: '#58a6ff', info: TEXT_MUTED, warn: WARNING, error: DANGER
}

function formatTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8)
}

function formatPayload(msg: string, expanded: boolean): string {
  if (!msg) return ''
  try {
    const parsed = JSON.parse(msg)
    if (expanded) return JSON.stringify(parsed, null, 2)
    const compact = JSON.stringify(parsed)
    return compact.length > 200 ? compact.slice(0, 200) + '...' : compact
  } catch {
    return msg.length > 200 && !expanded ? msg.slice(0, 200) + '...' : msg
  }
}

// -------- LogRow --------
const LogRow: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false)
  const tType = topicType(entry.topic)
  const topicStyle = TOPIC_STYLE[tType]
  const summary = getSummary(entry.message, tType)
  const isSystem = !entry.topic || entry.direction === 'info' || entry.direction === 'warn' || entry.direction === 'error'

  return (
    <div
      style={{
        borderBottom: `1px solid ${BORDER_WEAK}`,
        padding: '4px 12px',
        display: 'grid',
        gridTemplateColumns: '60px 20px auto 1fr',
        gap: 6,
        alignItems: 'baseline',
        cursor: 'pointer',
        fontFamily: 'monospace',
        // 展开行提亮一档，跟未展开的行区分
        background: expanded ? BG_SUBTLE : undefined
      }}
      onClick={() => setExpanded((v) => !v)}
    >
      {/* 时间 */}
      <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>{formatTime(entry.timestamp)}</Text>

      {/* 方向图标 */}
      <span style={{ color: DIR_COLOR[entry.direction] ?? TEXT_MUTED, fontSize: 11 }}>
        {DIR_ICON[entry.direction]}
      </span>

      {/* 类型标签 + 摘要 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
        {isSystem ? (
          <Tag
            style={{ margin: 0, fontSize: 10, padding: '0 4px' }}
            color={entry.direction === 'error' ? 'error' : entry.direction === 'warn' ? 'warning' : 'default'}
          >
            系统
          </Tag>
        ) : topicStyle ? (
          <Tag
            style={{
              margin: 0, fontSize: 10, padding: '0 4px',
              color: topicStyle.color, background: topicStyle.bg,
              border: `1px solid ${topicStyle.color}40`
            }}
          >
            {topicStyle.label}
          </Tag>
        ) : (
          <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{tType}</Tag>
        )}
        {summary && !expanded && (
          <Text style={{ fontSize: 11, color: TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary}
          </Text>
        )}
      </div>

      {/* payload（展开时单独一行） */}
      {expanded ? (
        <pre
          style={{
            gridColumn: '1 / -1',
            margin: '4px 0 0',
            fontSize: 11,
            color: entry.direction === 'error' ? DANGER : TEXT_PRIMARY,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            // 等宽代码块比所在行更暗，做出「凹进去」的层次
            background: BG_PAGE,
            border: `1px solid ${BORDER_WEAK}`,
            padding: '6px 8px',
            borderRadius: 4,
            maxHeight: 200,
            overflow: 'auto'
          }}
        >
          {entry.topic && <div style={{ color: TEXT_MUTED, marginBottom: 4 }}>{entry.topic}</div>}
          {formatPayload(entry.message, true)}
        </pre>
      ) : (
        <Text
          style={{
            fontSize: 11,
            color: entry.direction === 'error' ? DANGER : entry.direction === 'warn' ? WARNING : TEXT_MUTED,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}
        >
          {/* 收起时仅在无摘要时展示原始消息 */}
          {!summary && formatPayload(entry.message, false)}
        </Text>
      )}
    </div>
  )
}

// -------- LogPanel --------
export const LogPanel: React.FC = () => {
  const { devices, selectedDeviceId, logPanelOpen, toggleLogPanel, selectDevice } = useDeviceStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<LogCategory>('all')

  const allLogs: LogEntry[] = selectedDeviceId
    ? (devices.find((d) => d.deviceId === selectedDeviceId)?.logs ?? [])
    : []

  const filtered = activeTab === 'all'
    ? allLogs
    : allLogs.filter((e) => getCategory(e) === activeTab)

  // 自动滚动到底部
  useEffect(() => {
    if (logPanelOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered.length, logPanelOpen, activeTab])

  const counts: Record<LogCategory, number> = {
    all:    allLogs.length,
    cmd:    allLogs.filter((e) => getCategory(e) === 'cmd').length,
    req:    allLogs.filter((e) => getCategory(e) === 'req').length,
    status: allLogs.filter((e) => getCategory(e) === 'status').length,
    event:  allLogs.filter((e) => getCategory(e) === 'event').length,
    system: allLogs.filter((e) => getCategory(e) === 'system').length,
  }

  // pill 栏配色与 TOPIC_STYLE 同源（深色提亮版），保证「筛哪类」和「日志里那类」同色
  const TAB_DEFS: { key: LogCategory; label: string; color: string }[] = [
    { key: 'all',    label: '全部',    color: TEXT_PRIMARY },
    { key: 'cmd',    label: '指令',    color: '#58a6ff' },
    { key: 'req',    label: '请求响应', color: '#f778ba' },
    { key: 'status', label: '状态上报', color: '#39c5cf' },
    { key: 'event',  label: '事件',    color: '#e3b341' },
    { key: 'system', label: '系统',    color: TEXT_SECONDARY },
  ]

  const deviceOptions = devices.map((d) => ({
    label: `${d.displayName} (${d.deviceId})`,
    value: d.deviceId
  }))

  return (
    <div
      style={{
        // 页面内卡片（原为 fixed 钉满视口底部；现由 SimulatorPage 的 flex 布局钉在内容区底部）
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 16,
        flexShrink: 0,
        transition: 'height 0.25s ease',
        height: logPanelOpen ? 320 : 40,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          height: 40, flexShrink: 0,
          display: 'flex', alignItems: 'center',
          padding: '0 16px', gap: 12,
          cursor: 'pointer', background: BG_SUBTLE, userSelect: 'none'
        }}
        onClick={toggleLogPanel}
      >
        {/* 面板收进页面后宽度只有内容区那么宽，标题必须 nowrap + 不参与收缩，否则会被挤成竖排 */}
        <Space style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
          {logPanelOpen ? <DownOutlined style={{ fontSize: 11 }} /> : <UpOutlined style={{ fontSize: 11 }} />}
          <Text strong style={{ fontSize: 13, color: TEXT_PRIMARY }}>MQTT 日志</Text>
          {selectedDeviceId && (
            <Tag
              color="blue"
              style={{ margin: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {devices.find((d) => d.deviceId === selectedDeviceId)?.displayName ?? selectedDeviceId}
            </Tag>
          )}
        </Space>

        <div
          style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Select
            size="small"
            style={{ width: 220 }}
            placeholder="选择设备"
            allowClear
            value={selectedDeviceId}
            options={deviceOptions}
            onChange={(v) => selectDevice(v ?? null)}
            onClick={(e) => e.stopPropagation()}
          />
          {selectedDeviceId && allLogs.length > 0 && (
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                useDeviceStore.setState((s) => ({
                  devices: s.devices.map((d) =>
                    d.deviceId === selectedDeviceId ? { ...d, logs: [] } : d
                  )
                }))
              }}
            >
              清空
            </Button>
          )}
        </div>
      </div>

      {/* 内容区：分类 Tab + 日志列表 */}
      {logPanelOpen && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 分类过滤 pill 栏 */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: BG_SUBTLE,
              borderBottom: `1px solid ${BORDER}`,
              overflowX: 'auto'
            }}
          >
            {TAB_DEFS.map(({ key, label, color }) => {
              const isActive = activeTab === key
              const count = counts[key]
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '2px 10px',
                    borderRadius: 20,
                    border: `1px solid ${isActive ? color : BORDER}`,
                    // 未选中的 pill 比 pill 栏底更暗，避免整排糊成一片
                    background: isActive ? `${color}33` : BG_CARD,
                    color: isActive ? color : TEXT_SECONDARY,
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                    outline: 'none'
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 16,
                        height: 16,
                        padding: '0 4px',
                        borderRadius: 8,
                        // 选中时数字底是亮色，文字反过来用页面底色才读得清
                        background: isActive ? color : BORDER,
                        color: isActive ? BG_PAGE : TEXT_SECONDARY,
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: 1
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 日志正文区比面板底更暗，做出「内嵌终端」的层次 */}
          <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', background: BG_PAGE }}>
            {filtered.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span style={{ color: TEXT_MUTED }}>
                    {selectedDeviceId ? '暂无日志' : '请在上方选择设备查看日志'}
                  </span>
                }
                style={{ padding: '16px 0' }}
              />
            ) : (
              filtered.map((entry, i) => <LogRow key={`${entry.id}-${i}`} entry={entry} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}
