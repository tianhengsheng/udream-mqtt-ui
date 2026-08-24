import type { MqttClient } from 'mqtt'
import type { AddDeviceOptions, MqttCmdResp, LogEntry, DeviceStateSnapshot } from '../types.js'
import type { DeviceStatus } from '../../src/simulator/types.js'

/** Handler 能访问的设备最小接口（避免与 deviceManager 循环依赖） */
export interface DeviceRef {
  opts: AddDeviceOptions
  bizData: Record<string, unknown>
  deviceStatus: DeviceStatus
  /** Handler 私有状态（替代原来各设备特有字段，如 currentTaskId / dispensePaused） */
  handlerState: Record<string, unknown>
  client: MqttClient | null
}

/** 设备请求（req）的响应（resp）载荷 */
export interface ReqResp {
  reqId: string
  opStatus: number
  message?: string
  bizData?: Record<string, unknown>
}

/** Handler 可调用的 deviceManager 能力 */
export interface HandlerCtx {
  appendLog(deviceId: string, entry: Omit<LogEntry, 'id'>): void
  publishMqtt(device: DeviceRef, topic: string, payload: unknown): void
  publishStatus(device: DeviceRef, full: boolean): void
  broadcastDeviceUpdate(deviceId: string, data: Partial<DeviceStateSnapshot>): void
  /** 设备主动向云端发起请求（规范 4.6，发布到 device/{type}/req/{id}，订阅 resp 回处理） */
  sendReq(device: DeviceRef, action: string, bizData: Record<string, unknown>): void
  now(): number
}

/** 每种设备类型实现此接口 */
export interface DeviceHandler {
  /** 连接成功后初始化（订阅额外 topic、启动定时器等） */
  onConnected(device: DeviceRef, ctx: HandlerCtx): void
  /** 处理 MQTT cmd 指令，通过修改 resp 表示结果 */
  executeAction(
    action: string,
    bizData: Record<string, unknown>,
    device: DeviceRef,
    resp: MqttCmdResp,
    ctx: HandlerCtx
  ): void
  /** 收到 req 对应的 resp 时回调（可选，规范 4.6） */
  onReqResp?(action: string, resp: ReqResp, device: DeviceRef, ctx: HandlerCtx): void
  /** 断开时清理（可选） */
  onDisconnected?(device: DeviceRef): void
}
