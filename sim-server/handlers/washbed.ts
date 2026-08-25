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

/**
 * 预热排水循环模拟参数（drainStatus 为功能态口径：暂停期间仍上报 1，
 * 阀门间歇开合只通过水温 36↔38°C 震荡体现）：
 *   阀开加热 → 每拍 +1°C，到 DRAIN_PAUSE_TEMP 暂停；
 *   阀停降温 → 每拍 -1°C，降到 DRAIN_RESUME_TEMP 恢复排水，循环往复直到 drain_off / 洗头启动。
 */
const DRAIN_PAUSE_TEMP = 38
const DRAIN_RESUME_TEMP = 36
const DRAIN_TICK_MS = 3000
const DRAIN_TEMP_STEP = 2

/** 常温（°C）：停止排水/洗头后水温以 1°C/拍（8s 空闲拍）逐渐回落到该值附近 */
const AMBIENT_TEMP = 18

export class WashbedHandler implements DeviceHandler {
  onConnected(device: DeviceRef, ctx: HandlerCtx): void {
    const { deviceId } = device.opts
    // 模拟器已移除推送式 OTA（ota/notify），不再订阅
    // 空闲水温模型（8s 间隔）：无加热源时向常温逐渐回落（1°C/拍），
    // 到常温后仅在 ±1°C 内微抖动模拟环境波动；新协议水温为整数 °C
    const timer = setInterval(() => {
      try {
        if (device.deviceStatus !== '0') return
        // 预热排水循环期间水温由 drainTimer 按曲线驱动，此处让位，跳过
        if (device.bizData.drainStatus === 1) return
        const temp = device.bizData.waterTemperature as number
        if (Math.abs(temp - AMBIENT_TEMP) <= 2) {
          device.bizData.waterTemperature = AMBIENT_TEMP + randInt(-1, 1)
        } else {
          device.bizData.waterTemperature = temp > AMBIENT_TEMP ? temp - 2 : temp + 2
        }
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
        // 洗头启动即停预热排水（对应需求"洗头启动信号止水"）
        this.stopDrain(device)
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
      case 'drain_on':
        this.startDrain(device, ctx)
        break
      case 'drain_off':
        this.stopDrain(device)
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
    const drainTimer = device.handlerState.drainTimer as ReturnType<typeof setInterval> | undefined
    if (drainTimer) clearInterval(drainTimer)
  }

  /**
   * 开启预热排水循环：阀开加热到 38°C 暂停、降回 36°C 恢复，往复直到 stopDrain。
   * 幂等：已在排水中时重复 drain_on 只置位不重启定时器（避免曲线抖动）。
   */
  private startDrain(device: DeviceRef, ctx: HandlerCtx): void {
    const bd = device.bizData
    bd.drainStatus = 1
    if (device.handlerState.drainTimer) return

    const { deviceId } = device.opts
    // 阀门内部态：true=排水加热中 false=达温暂停降温中（不上协议，仅驱动水温曲线）。
    // 起始按当前水温判定，避免开启瞬间水温已 ≥38 时曲线跳变
    let valveOpen = (bd.waterTemperature as number) < DRAIN_PAUSE_TEMP
    const timer = setInterval(() => {
      try {
        const temp = bd.waterTemperature as number
        if (valveOpen) {
          bd.waterTemperature = temp + DRAIN_TEMP_STEP
          if ((bd.waterTemperature as number) >= DRAIN_PAUSE_TEMP) {
            bd.waterTemperature = DRAIN_PAUSE_TEMP
            valveOpen = false
          }
        } else {
          bd.waterTemperature = temp - DRAIN_TEMP_STEP
          if ((bd.waterTemperature as number) <= DRAIN_RESUME_TEMP) {
            bd.waterTemperature = DRAIN_RESUME_TEMP
            valveOpen = true
          }
        }
        ctx.broadcastDeviceUpdate(deviceId, { bizData: { ...bd } })
        ctx.publishStatus(device, false)
      } catch { /* ignore */ }
    }, DRAIN_TICK_MS)
    device.handlerState.drainTimer = timer
  }

  /** 关闭预热排水循环（drain_off / 洗头启动 / 断连复用），幂等。 */
  private stopDrain(device: DeviceRef): void {
    device.bizData.drainStatus = 0
    const timer = device.handlerState.drainTimer as ReturnType<typeof setInterval> | undefined
    if (timer) {
      clearInterval(timer)
      device.handlerState.drainTimer = undefined
    }
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
