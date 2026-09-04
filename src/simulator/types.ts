export type DeviceType = 'washbed' | 'dyemachine'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type DeviceStatus = '0' | '1' | '2' // 0=空闲 1=运行 2=暂停

export interface WashbedBizData {
  /** 当前水温（°C，整数） */
  waterTemperature: number
  washCount: number
  waterLevel: string
  /** 当前执行步骤（1-based，由设备按模式步骤表上报） */
  executionProgress: number
  /** 0-男士速洗 1-女士速洗 2-洗护模式 3-养护模式 4-消毒模式 */
  washMode: number
  /** 0=锁屏 1=解屏 */
  screenOn: number
  /** 水压强度：1/2/3/4 */
  waterPressure: number
  /** 设备排水状态：0=关闭 1=开启 */
  drainStatus: number
}

export interface DyemachinePump {
  pump: number
  colorCode: string
  gram: number
  actualGram?: number
  targetGram?: number
}

export interface DyemachineBizData {
  makeState: 'IDLE' | 'BUSY'
  calibState: 'IDLE' | 'BUSY'
  refillState: 'IDLE' | 'BUSY'
  orderId: number
  pumps: DyemachinePump[]
}

/** 四代染色仪双芯片当前固件版本 */
export interface ChipVersions {
  p4: string
  c5: string
}

/** OTA 升级阶段（与 ota/progress 报文 step 同值） */
export type OtaStep = 'downloading' | 'installing' | 'rebooting' | 'success' | 'failed'

/**
 * 设备当前 OTA 升级进程（模拟器内部态，随 ota/progress 上报同步刷新）。
 * null/缺省 = 没在升级；终态（success/failed）会保留几秒供观察后由服务端清空。
 */
export interface OtaState {
  taskId: string
  /** 芯片短码 p4 / c5 */
  chip: string
  /** 目标版本（指令带的 version，可能为空） */
  version: string
  step: OtaStep
  /** 当前阶段内进度 0-100 */
  progress: number
  updatedAt: number
}

export interface LogEntry {
  id: string
  timestamp: number
  direction: 'up' | 'down' | 'info' | 'error' | 'warn'
  topic: string
  message: string
}

export interface DeviceInstance {
  deviceId: string
  deviceType: DeviceType
  displayName: string
  connectionStatus: ConnectionStatus
  deviceStatus: DeviceStatus
  firmwareVersion: string
  /** 四代染色仪双芯片版本（2026-09-04 协议：status 报 p4Version/c5Version，不再报 firmwareVersion）；洗头床无 */
  chipVersions?: ChipVersions
  osVersion: string
  sn: string
  wifiName: string
  bizData: WashbedBizData | DyemachineBizData | Record<string, unknown>
  /** OTA 升级进程；不在升级时为 null */
  ota?: OtaState | null
  logs: LogEntry[]
  mqttHost: string
  mqttPort: number
}

// -------- WebSocket 消息协议 --------
export interface WsBaseMessage {
  type: string
}

export interface WsDeviceListMessage extends WsBaseMessage {
  type: 'device_list'
  devices: DeviceInstance[]
}

export interface WsDeviceUpdateMessage extends WsBaseMessage {
  type: 'device_update'
  deviceId: string
  data: Partial<Omit<DeviceInstance, 'logs'>>
}

export interface WsLogMessage extends WsBaseMessage {
  type: 'log'
  deviceId: string
  entry: LogEntry
}

export interface WsDeviceRemovedMessage extends WsBaseMessage {
  type: 'device_removed'
  deviceId: string
}

export interface CertDeviceInfo {
  deviceId: string
  deviceType: string
}

export interface WsCertDevicesUpdateMessage extends WsBaseMessage {
  type: 'cert_devices_update'
  devices: CertDeviceInfo[]
}

export type WsMessage =
  | WsDeviceListMessage
  | WsDeviceUpdateMessage
  | WsLogMessage
  | WsDeviceRemovedMessage
  | WsCertDevicesUpdateMessage

// -------- API 请求/响应 --------
export interface AddDeviceRequest {
  deviceId: string
  deviceType: DeviceType
  displayName?: string
  mqttHost: string
  mqttPort: number
  certs: {
    ca: string
    cert: string
    key: string
  }
}

export interface ActionRequest {
  action: string
  bizData?: Record<string, unknown>
}

export interface ApiResponse<T = null> {
  success: boolean
  message?: string
  data?: T
}
