import type { DeviceType, ConnectionStatus, DeviceStatus, LogEntry } from '../src/simulator/types.js'

export type { DeviceType, ConnectionStatus, DeviceStatus, LogEntry }

export interface CertBundle {
  ca: string    // PEM 内容
  cert: string  // PEM 内容
  key: string   // PEM 内容
}

export interface AddDeviceOptions {
  deviceId: string
  deviceType: DeviceType
  displayName: string
  mqttHost: string
  mqttPort: number
  /** 设备 SN（= dye_device_cream.device_code）；不填则取 deviceId 末段 */
  sn?: string
  certs: CertBundle
}

export interface DeviceStateSnapshot {
  deviceId: string
  deviceType: DeviceType
  displayName: string
  connectionStatus: ConnectionStatus
  deviceStatus: DeviceStatus
  firmwareVersion: string
  osVersion: string
  sn: string
  wifiName: string
  bizData: Record<string, unknown>
  mqttHost: string
  mqttPort: number
}

export interface MqttCmd {
  cmdId: string
  action: string
  timestamp: number
  bizData?: Record<string, unknown>
}

export interface MqttCmdResp {
  cmdId: string
  ack: 'received'
  opStatus: 0 | 1 | 2 | 3
  message?: string
}

export interface MqttStatusPayload {
  deviceId: string
  deviceType: string
  timestamp: number
  status: string
  firmwareVersion: string
  osVersion: string
  sn: string
  wifiName: string
  bizData: Record<string, unknown>
}

export interface MqttEventPayload {
  deviceId: string
  deviceType: string
  taskId: string
  eventType: string
  timestamp: number
  bizData: Record<string, unknown>
}
