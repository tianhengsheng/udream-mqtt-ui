/**
 * 各环境设备接入地址（MQTT broker），与后端 config_const dye_factory_cloud_env_cnf 的 host/port 同口径。
 * 设备卡片「切换环境」用：模拟设备收到新环境地址后用同一证书重连（出厂 App 蓝牙下发的模拟）。
 * 生产不列、不允许切（自测不连生产）。
 */
export interface BrokerPreset {
  code: string
  name: string
  host: string
  port: number
}

export const BROKER_PRESETS: BrokerPreset[] = [
  { code: 'dev', name: '联调', host: 'device-dev.51yxm.com', port: 8085 },
  { code: 'test', name: '测试', host: 'device-test.51yxm.com', port: 8085 },
  { code: 'test2', name: '测试2', host: 'device-test2.51yxm.com', port: 8085 },
  { code: 'uat', name: '验收', host: 'device-uat.51yxm.com', port: 8085 }
]

/** 禁止切换的 host（生产） */
export const FORBIDDEN_HOSTS = new Set(['dyelot.udream.com'])

/** 解析「host:port」；不合法返回 null */
export function parseBroker(text: string): { host: string; port: number } | null {
  const m = /^\s*([a-zA-Z0-9.-]+):(\d{1,5})\s*$/.exec(text)
  if (!m) return null
  const port = Number(m[2])
  return port > 0 && port < 65536 ? { host: m[1], port } : null
}

/** host:port → 预设环境名（未知返回 null） */
export function brokerName(host: string, port: number): string | null {
  return BROKER_PRESETS.find((b) => b.host === host && b.port === port)?.name ?? null
}
