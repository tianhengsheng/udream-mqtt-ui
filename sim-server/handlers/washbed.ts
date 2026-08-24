import type { MqttCmdResp } from '../types.js'
import type { DeviceHandler, DeviceRef, HandlerCtx } from './types.js'

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * 各 washMode 对应的展示步骤总数（1-based，与设备协议一致）：
 *   0 男士速洗 5 步 / 1 女士速洗 7 步 / 2 洗护 10 步 / 3 养护 12 步
 *   4 消毒模式由设备方定义，本模拟器暂按 4 步演示
 */
const WASH_MODE_TOTAL_STEPS: Record<number, number> = {
  0: 5,
  1: 7,
  2: 10,
  3: 12,
  4: 4
}

export class WashbedHandler implements DeviceHandler {
  onConnected(device: DeviceRef, ctx: HandlerCtx): void {
    const { deviceId } = device.opts
    // 模拟器已移除推送式 OTA（ota/notify），不再订阅
    // 水温微小波动（8s 间隔）；新协议水温为整数 °C
    const timer = setInterval(() => {
      try {
        if (device.deviceStatus !== '0') return
        device.bizData.waterTemperature = randInt(36, 41)
        ctx.broadcastDeviceUpdate(deviceId, { bizData: { ...device.bizData } })
      } catch { /* ignore */ }
    }, 8000)
    device.handlerState.idleTimer = timer
  }

  executeAction(
    action: string,
    bizData: Record<string, unknown>,
    device: DeviceRef,
    resp: MqttCmdResp,
    ctx: HandlerCtx
  ): void {
    const bd = device.bizData
    switch (action) {
      case 'start':
        device.deviceStatus = '1'
        bd.washMode = bizData.model ?? 0
        if (bizData.waterPressure != null) bd.waterPressure = bizData.waterPressure
        if (bizData.waterTemperature != null) bd.waterTemperature = bizData.waterTemperature
        bd.executionProgress = 0
        this.startRun(device, ctx)
        break
      case 'stop':
        device.deviceStatus = '0'
        bd.executionProgress = 0
        break
      case 'screen_on':
        bd.screenOn = 1
        break
      case 'screen_off':
        bd.screenOn = 0
        break
      case 'get_status':
        break
      default:
        resp.opStatus = 1
        resp.message = `未知指令: ${action}`
    }
  }

  onDisconnected(device: DeviceRef): void {
    const timer = device.handlerState.idleTimer as ReturnType<typeof setInterval> | undefined
    if (timer) clearInterval(timer)
    const runTimer = device.handlerState.runTimer as ReturnType<typeof setInterval> | undefined
    if (runTimer) clearInterval(runTimer)
  }

  private startRun(device: DeviceRef, ctx: HandlerCtx): void {
    const { deviceId } = device.opts
    const bd = device.bizData

    // 清除之前的运行定时器
    const prev = device.handlerState.runTimer as ReturnType<typeof setInterval> | undefined
    if (prev) clearInterval(prev)

    const totalSteps = WASH_MODE_TOTAL_STEPS[bd.washMode as number] ?? 10
    const timer = setInterval(() => {
      if (device.deviceStatus !== '1') {
        clearInterval(timer)
        return
      }
      const progress = (bd.executionProgress as number) + 1
      if (progress > totalSteps) {
        device.deviceStatus = '0'
        bd.executionProgress = 0
        bd.washCount = (bd.washCount as number) + 1
        clearInterval(timer)
        device.handlerState.runTimer = undefined
      } else {
        bd.executionProgress = progress
      }
      ctx.broadcastDeviceUpdate(deviceId, {
        deviceStatus: device.deviceStatus,
        bizData: { ...device.bizData }
      })
      ctx.publishStatus(device, false)
    }, 5000)

    device.handlerState.runTimer = timer
  }
}
