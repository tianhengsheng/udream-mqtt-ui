import type { MqttCmdResp } from '../types.js'
import type { DeviceHandler, DeviceRef, HandlerCtx } from './types.js'

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
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
  4: 4,
  // 5 速冲模式（90 秒）：真实步骤表由固件定义，模拟器按 3 步演示
  5: 3
}

/**
 * 预热排水模拟参数（2026-09-04 简化）：开启后每拍 +2°C 升到 DRAIN_TARGET_TEMP 就停在那里，
 * 不再模拟达温后的 36↔38°C 震荡；drainStatus 一直为 1，直到 drain_off / 洗头启动 / 设备超时。
 * 达温后不再每 3s 推状态，回到常规心跳节奏。
 */
const DRAIN_TARGET_TEMP = 38
const DRAIN_TICK_MS = 3000
const DRAIN_TEMP_STEP = 2

/** 常温（°C）：停止排水/洗头后水温以 1°C/拍（8s 空闲拍）逐渐回落到该值附近 */
const AMBIENT_TEMP = 18

export class WashbedHandler implements DeviceHandler {
  onConnected(device: DeviceRef, ctx: HandlerCtx): void {
    const { deviceId } = device.opts
    // 模拟器已移除推送式 OTA（ota/notify），不再订阅
    // 空闲水温模型（8s 间隔）：无加热源时向常温逐渐回落（1°C/拍），
    // 到常温后保持不动（不再模拟环境波动）；新协议水温为整数 °C
    const timer = setInterval(() => {
      try {
        if (device.deviceStatus !== '0') return
        // 预热排水期间水温由 drainTimer 驱动（达温后保持），此处让位，跳过
        if (device.bizData.drainStatus === 1) return
        const temp = device.bizData.waterTemperature as number
        if (Math.abs(temp - AMBIENT_TEMP) <= 2) {
          if (temp === AMBIENT_TEMP) return
          device.bizData.waterTemperature = AMBIENT_TEMP
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
        this.startDrain(device, ctx, bizData.timeoutMinutes)
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
    const drainTimeoutTimer = device.handlerState.drainTimeoutTimer as ReturnType<typeof setTimeout> | undefined
    if (drainTimeoutTimer) clearTimeout(drainTimeoutTimer)
  }

  /**
   * 开启预热排水：加热到 DRAIN_TARGET_TEMP 后保持，直到 stopDrain。
   * 幂等：已在排水中时重复 drain_on 只置位不重启升温定时器，但会按新值重挂超时。
   *
   * @param timeoutMinutes 协议 bizData.timeoutMinutes：设备到点自动关闭排水（分钟，[0,600]），
   *                       0/缺省 = 永不自动关闭（缺省视同 0，便于观察云端兜底扫描是否生效）
   */
  private startDrain(device: DeviceRef, ctx: HandlerCtx, timeoutMinutes?: unknown): void {
    const bd = device.bizData
    bd.drainStatus = 1
    this.armDrainTimeout(device, ctx, timeoutMinutes)
    if (device.handlerState.drainTimer) return

    const { deviceId } = device.opts
    if ((bd.waterTemperature as number) >= DRAIN_TARGET_TEMP) return
    // 升温定时器：到目标温度即自清，之后只靠常规心跳上报，状态保持排水中
    const timer = setInterval(() => {
      try {
        const next = Math.min((bd.waterTemperature as number) + DRAIN_TEMP_STEP, DRAIN_TARGET_TEMP)
        bd.waterTemperature = next
        if (next >= DRAIN_TARGET_TEMP) {
          clearInterval(timer)
          device.handlerState.drainTimer = undefined
        }
        ctx.broadcastDeviceUpdate(deviceId, { bizData: { ...bd } })
        ctx.publishStatus(device, false)
      } catch { /* ignore */ }
    }, DRAIN_TICK_MS)
    device.handlerState.drainTimer = timer
  }

  /**
   * 设备端排水超时自关：按 timeoutMinutes 挂一次性定时器，到点 stopDrain 并立即上报状态。
   * 重复 drain_on 以最新值为准（先清旧定时器）；0/非法值不挂。
   */
  private armDrainTimeout(device: DeviceRef, ctx: HandlerCtx, timeoutMinutes: unknown): void {
    const prev = device.handlerState.drainTimeoutTimer as ReturnType<typeof setTimeout> | undefined
    if (prev) {
      clearTimeout(prev)
      device.handlerState.drainTimeoutTimer = undefined
    }
    const minutes = Number(timeoutMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) return
    const { deviceId } = device.opts
    device.handlerState.drainTimeoutTimer = setTimeout(() => {
      try {
        device.handlerState.drainTimeoutTimer = undefined
        if (device.bizData.drainStatus !== 1) return
        this.stopDrain(device)
        ctx.broadcastDeviceUpdate(deviceId, { bizData: { ...device.bizData } })
        ctx.publishStatus(device, false)
      } catch { /* ignore */ }
    }, minutes * 60 * 1000)
  }

  /** 关闭预热排水循环（drain_off / 洗头启动 / 设备超时自关 / 断连复用），幂等。 */
  private stopDrain(device: DeviceRef): void {
    device.bizData.drainStatus = 0
    const timer = device.handlerState.drainTimer as ReturnType<typeof setInterval> | undefined
    if (timer) {
      clearInterval(timer)
      device.handlerState.drainTimer = undefined
    }
    const timeoutTimer = device.handlerState.drainTimeoutTimer as ReturnType<typeof setTimeout> | undefined
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      device.handlerState.drainTimeoutTimer = undefined
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
