import { useState } from 'react'
import { AutoComplete, Button, Popover, Space, Typography } from 'antd'
import { SwapOutlined } from '@ant-design/icons'
import type { DeviceInstance } from '../types'
import { BROKER_PRESETS, FORBIDDEN_HOSTS, brokerName, parseBroker } from '../config/brokers'
import { ACCENT, DANGER, TEXT_MUTED } from '../theme'

const { Text } = Typography

/**
 * 设备卡片「切换环境」：按 host:port 改连 broker（证书 / SN 不变），模拟出厂 App 经蓝牙给设备下发新环境。
 * 可选预设环境，也可直接输入域名如 device-dev.51yxm.com:8085。不弹提示：成功即关弹层、卡片原地显示连接中→已连接，错误显示在弹层内。
 */
export function BrokerSwitch({ device }: { device: DeviceInstance }) {
  const current = `${device.mqttHost}:${device.mqttPort}`
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const target = parseBroker(draft)
    if (!target) {
      setError('格式应为 域名:端口，如 device-dev.51yxm.com:8085')
      return
    }
    if (FORBIDDEN_HOSTS.has(target.host)) {
      setError('不允许切到生产环境')
      return
    }
    if (`${target.host}:${target.port}` === current) {
      setOpen(false)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/simapi/devices/${encodeURIComponent(device.deviceId)}/switch-broker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mqttHost: target.host, mqttPort: target.port })
      })
      const data = (await res.json()) as { success: boolean; message?: string }
      if (!data.success) throw new Error(data.message || '切换失败')
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const content = (
    <Space direction="vertical" size={8} style={{ width: 340 }}>
      <Text style={{ fontSize: 12, color: TEXT_MUTED }}>当前：{brokerName(device.mqttHost, device.mqttPort) ?? '自定义'} · {current}</Text>
      <AutoComplete
        data-testid={`sim.broker-input-${device.deviceId}`}
        style={{ width: '100%' }}
        value={draft}
        onChange={(v) => {
          setDraft(v)
          setError(null)
        }}
        placeholder="域名:端口，如 device-dev.51yxm.com:8085"
        options={BROKER_PRESETS.map((b) => ({
          value: `${b.host}:${b.port}`,
          label: `${b.name}　${b.host}:${b.port}`
        }))}
        filterOption={(input, opt) => String(opt?.label ?? '').includes(input)}
      />
      {error && (
        <Text style={{ fontSize: 12, color: DANGER }} data-testid={`sim.broker-error-${device.deviceId}`}>
          {error}
        </Text>
      )}
      <Button
        type="primary"
        block
        loading={loading}
        data-testid={`sim.broker-submit-${device.deviceId}`}
        onClick={submit}
      >
        切换并重连
      </Button>
    </Space>
  )

  return (
    <Popover
      title="切换云端环境"
      trigger="click"
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          setDraft('')
          setError(null)
        }
      }}
      content={content}
    >
      <Button
        size="small"
        type="link"
        icon={<SwapOutlined />}
        style={{ padding: 0, height: 'auto', fontSize: 11, color: ACCENT }}
        data-testid={`sim.broker-switch-${device.deviceId}`}
      >
        切换环境
      </Button>
    </Popover>
  )
}
