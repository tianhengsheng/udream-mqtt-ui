import type { MqttCmdResp, MqttEventPayload } from '../types.js'
import type { DeviceHandler, DeviceRef, HandlerCtx, ReqResp } from './types.js'

interface DyemachinePump {
  pump: number
  colorCode: string
  gram: number
}

/** 每罐满载初始容量（g），与对接文档 initCapacity 一致 */
const INIT_CAPACITY = 450

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
}

/** 读取设备本地余量表（pump → remain 绝对克重），不存在则初始化为空表 */
function getRemains(device: DeviceRef): Record<number, number> {
  let remains = device.handlerState.remains as Record<number, number> | undefined
  if (!remains) {
    remains = {}
    device.handlerState.remains = remains
  }
  return remains
}

export class DyemachineHandler implements DeviceHandler {
  onConnected(device: DeviceRef, ctx: HandlerCtx): void {
    // 四代机 OTA 已改拉取式（get_ota_info req），不再订阅 ota/notify 推送
    // 增量用量模型（协议 2026-08 变更）：设备不再上电拉取 get_remain 恢复本地，
    // 只在下料结束后 sync_remain 上报本次用量；本地余量表仅作 UI 展示，满载 450 起步。
    void device; void ctx
  }

  executeAction(
    action: string,
    bizData: Record<string, unknown>,
    device: DeviceRef,
    resp: MqttCmdResp,
    ctx: HandlerCtx
  ): void {
    const bd = device.bizData
    const { deviceId, deviceType } = device.opts

    switch (action) {
      case 'dispense': {
        if (this.rejectIfBusy(bd, resp)) return
        const taskId = bizData.taskId as string
        // 原样透传:19 位订单 id 用 Number() 会丢精度,dispense 事件带错 orderId 后端就更新不到记录
        const orderId = (bizData.orderId ?? 0) as string | number
        const pumps = (bizData.pumps as DyemachinePump[]) ?? []
        bd.makeState = 'BUSY'
        bd.orderId = orderId
        bd.pumps = pumps
        device.deviceStatus = '1'
        device.handlerState.currentTaskId = taskId
        device.handlerState.dispensePaused = false
        this.startDispenseSimulation(device, taskId, orderId, pumps, ctx)
        break
      }
      case 'dispense_continue': {
        if (device.handlerState.dispensePaused) {
          device.handlerState.dispensePaused = false
          ctx.appendLog(deviceId, {
            timestamp: ctx.now(),
            direction: 'info',
            topic: '',
            message: '收到继续下料指令，恢复执行'
          })
        }
        break
      }
      case 'dispense_cancel': {
        device.handlerState.dispensePaused = false
        device.handlerState.currentTaskId = null
        bd.makeState = 'IDLE'
        bd.orderId = 0
        bd.pumps = []
        device.deviceStatus = '0'
        ctx.appendLog(deviceId, {
          timestamp: ctx.now(),
          direction: 'info',
          topic: '',
          message: '下料任务已取消'
        })
        break
      }
      case 'calibrate_start': {
        if (this.rejectIfBusy(bd, resp)) return
        const taskId = bizData.taskId as string
        bd.calibState = 'BUSY'
        device.deviceStatus = '1'
        device.handlerState.currentCalibTaskId = taskId
        this.startCalibrateSimulation(device, taskId, ctx)
        break
      }
      case 'calibrate_cancel': {
        device.handlerState.currentCalibTaskId = null
        bd.calibState = 'IDLE'
        // 下料未在进行时才回到空闲
        if (bd.makeState !== 'BUSY') device.deviceStatus = '0'
        ctx.appendLog(deviceId, {
          timestamp: ctx.now(),
          direction: 'info',
          topic: '',
          message: '校准任务已取消'
        })
        break
      }
      case 'refill_start': {
        if (this.rejectIfBusy(bd, resp)) return
        const taskId = bizData.taskId as string
        const pump = Number(bizData.pump)
        const colorCode = (bizData.colorCode as string) ?? ''
        const capacity = Number(bizData.capacity) || INIT_CAPACITY
        if (!pump) {
          resp.opStatus = 1
          resp.message = 'refill_start 缺少 pump'
          return
        }
        bd.refillState = 'BUSY'
        device.deviceStatus = '1'
        device.handlerState.currentRefillTaskId = taskId
        this.startRefillSimulation(device, taskId, pump, colorCode, capacity, ctx)
        break
      }
      case 'refill_cancel': {
        device.handlerState.currentRefillTaskId = null
        bd.refillState = 'IDLE'
        // 下料/校准未在进行时才回到空闲
        if (bd.makeState !== 'BUSY' && bd.calibState !== 'BUSY') device.deviceStatus = '0'
        ctx.appendLog(deviceId, {
          timestamp: ctx.now(),
          direction: 'info',
          topic: '',
          message: '换料任务已取消'
        })
        break
      }
      case 'get_status':
        break
      default:
        resp.opStatus = 1
        resp.message = `未知指令: ${action}`
    }

    // 抑制未使用警告
    void deviceType
  }

  onDisconnected(device: DeviceRef): void {
    device.handlerState.currentTaskId = null
    device.handlerState.dispensePaused = false
    device.handlerState.currentCalibTaskId = null
    device.handlerState.currentRefillTaskId = null
  }

  /** 收到 req 的 resp 回调：失败记告警；get_ota_info 成功时展示云端固件信息（联调可见） */
  onReqResp(action: string, resp: ReqResp, device: DeviceRef, ctx: HandlerCtx): void {
    const { deviceId, deviceType } = device.opts
    if (resp.opStatus !== 0) {
      ctx.appendLog(deviceId, {
        timestamp: ctx.now(),
        direction: 'warn',
        topic: '',
        message: `req(${action}) 响应失败: opStatus=${resp.opStatus} ${resp.message ?? ''}`
      })
      return
    }
    if (action === 'get_ota_info') {
      const biz = (resp as { bizData?: Record<string, unknown> }).bizData ?? {}
      const empty = Object.keys(biz).length === 0
      ctx.appendLog(deviceId, {
        timestamp: ctx.now(),
        direction: 'down',
        topic: `device/${deviceType}/resp/${deviceId}`,
        message: empty
          ? 'get_ota_info: 云端无上架固件（无更新）'
          : `get_ota_info 固件信息: ${JSON.stringify(biz)}`
      })
    }
  }

  /** 设备处于任一长耗时操作（下料/校准/换料）时，置 opStatus=3 并返回 true */
  private rejectIfBusy(bd: Record<string, unknown>, resp: MqttCmdResp): boolean {
    if (bd.makeState === 'BUSY') {
      resp.opStatus = 3
      resp.message = '设备忙，正在执行下料任务'
      return true
    }
    if (bd.calibState === 'BUSY') {
      resp.opStatus = 3
      resp.message = '设备忙，正在执行校准任务'
      return true
    }
    if (bd.refillState === 'BUSY') {
      resp.opStatus = 3
      resp.message = '设备忙，正在执行换料任务'
      return true
    }
    return false
  }

  /**
   * 发布 sync_remain：上报本次使用克数（增量模型，字段沿用 remain 但语义 = 用量）。
   * 云端按 reqId 幂等后扣减落库；本地余量表另行扣减仅作 UI 展示。
   */
  private syncRemain(device: DeviceRef, usage: Array<{ pump: number; used: number }>, ctx: HandlerCtx): void {
    const payloadPumps = usage
      .filter((u) => u.used > 0)
      .map((u) => ({ pump: u.pump, remain: u.used }))
    if (payloadPumps.length === 0) return
    ctx.sendReq(device, 'sync_remain', { pumps: payloadPumps })
  }

  private startDispenseSimulation(
    device: DeviceRef,
    taskId: string,
    orderId: string | number,
    pumps: DyemachinePump[],
    ctx: HandlerCtx
  ): void {
    const { deviceId, deviceType } = device.opts
    const eventTopic = `device/${deviceType}/event/${deviceId}`

    setTimeout(() => {
      if (device.handlerState.currentTaskId !== taskId) return
      ctx.publishMqtt(device, eventTopic, {
        deviceId, deviceType, taskId,
        eventType: 'dispense_start',
        timestamp: ctx.now(),
        // 与 progress/done 一致携带 orderId，否则后端更新下料记录时报"缺少 orderId"WARN
        bizData: { orderId }
      } as MqttEventPayload)
      ctx.appendLog(deviceId, {
        timestamp: ctx.now(),
        direction: 'up',
        topic: eventTopic,
        message: JSON.stringify({ eventType: 'dispense_start', taskId })
      })
      this.simulatePumpProgress(device, taskId, orderId, pumps, eventTopic, 0, ctx)
    }, 500)
  }

  private simulatePumpProgress(
    device: DeviceRef,
    taskId: string,
    orderId: string | number,
    pumps: DyemachinePump[],
    eventTopic: string,
    pumpIndex: number,
    ctx: HandlerCtx
  ): void {
    const { deviceId, deviceType } = device.opts

    if (pumpIndex >= pumps.length) {
      const actualPumps = pumps.map((p) => ({
        pump: p.pump,
        colorCode: p.colorCode,
        targetGram: p.gram,
        actualGram: parseFloat((p.gram * randFloat(0.98, 1.02, 3)).toFixed(1))
      }))
      ctx.publishMqtt(device, eventTopic, {
        deviceId, deviceType, taskId,
        eventType: 'dispense_done',
        timestamp: ctx.now(),
        bizData: { orderId, pumps: actualPumps }
      } as MqttEventPayload)
      ctx.appendLog(deviceId, {
        timestamp: ctx.now(),
        direction: 'up',
        topic: eventTopic,
        message: JSON.stringify({ eventType: 'dispense_done', taskId, orderId })
      })
      device.handlerState.currentTaskId = null
      device.bizData.makeState = 'IDLE'
      device.bizData.orderId = 0
      device.bizData.pumps = []
      device.deviceStatus = '0'
      ctx.broadcastDeviceUpdate(deviceId, {
        deviceStatus: '0',
        bizData: { ...device.bizData }
      })
      ctx.publishStatus(device, true)

      // 下料任务结束：sync_remain 上报本次用量（remain 字段 = 使用克数，保留 1 位小数，云端扣减）；
      // 本地余量表同步扣减仅作 UI 展示（满载 450 起步）
      const remains = getRemains(device)
      const usage = actualPumps.map((p) => {
        const used = Math.max(0, Math.round(p.actualGram * 10) / 10)
        const prev = remains[p.pump] ?? INIT_CAPACITY
        remains[p.pump] = Math.max(0, Math.round((prev - used) * 10) / 10)
        return { pump: p.pump, used }
      })
      this.syncRemain(device, usage, ctx)
      return
    }

    const pump = pumps[pumpIndex]
    const steps = Math.ceil(pump.gram / 10)
    let currentGram = 0
    let step = 0

    const progressInterval = setInterval(() => {
      if (device.handlerState.currentTaskId !== taskId) {
        clearInterval(progressInterval)
        return
      }
      if (device.handlerState.dispensePaused) return

      step++
      currentGram = Math.min(pump.gram, parseFloat((step * 10).toFixed(1)))

      ctx.publishMqtt(device, eventTopic, {
        deviceId, deviceType, taskId,
        eventType: 'dispense_progress',
        timestamp: ctx.now(),
        bizData: {
          orderId,
          pump: pump.pump,
          colorCode: pump.colorCode,
          currentGram,
          targetGram: pump.gram
        }
      } as MqttEventPayload)
      ctx.appendLog(deviceId, {
        timestamp: ctx.now(),
        direction: 'up',
        topic: eventTopic,
        message: JSON.stringify({
          eventType: 'dispense_progress',
          taskId,
          pump: pump.pump,
          currentGram,
          targetGram: pump.gram
        })
      })

      if (currentGram >= pump.gram || step >= steps) {
        clearInterval(progressInterval)
        setTimeout(() => {
          this.simulatePumpProgress(device, taskId, orderId, pumps, eventTopic, pumpIndex + 1, ctx)
        }, 300)
      }
    }, 1000)
  }

  /**
   * 校准流程模拟：去皮 → 20g → 50g → 200g → 完成。
   * 每个阶段上报一次 calibrate_progress（stepCode 201~204），全部完成后上报 calibrate_done。
   */
  private startCalibrateSimulation(device: DeviceRef, taskId: string, ctx: HandlerCtx): void {
    const { deviceId, deviceType } = device.opts
    const eventTopic = `device/${deviceType}/event/${deviceId}`

    const steps = [
      { step: 'tare', stepCode: 201, message: '去皮完成，请放置 20g 砑码' },
      { step: 'weight_20g', stepCode: 202, message: '20g 校准完成，请放置 50g 砑码' },
      { step: 'weight_50g', stepCode: 203, message: '50g 校准完成，请放置 200g 砑码' },
      { step: 'weight_200g', stepCode: 204, message: '200g 校准完成' }
    ]

    const runStep = (index: number): void => {
      // 任务已被取消或被新任务替换，终止
      if (device.handlerState.currentCalibTaskId !== taskId) return

      if (index >= steps.length) {
        ctx.publishMqtt(device, eventTopic, {
          deviceId, deviceType, taskId,
          eventType: 'calibrate_done',
          timestamp: ctx.now(),
          bizData: {}
        } as MqttEventPayload)
        ctx.appendLog(deviceId, {
          timestamp: ctx.now(),
          direction: 'up',
          topic: eventTopic,
          message: JSON.stringify({ eventType: 'calibrate_done', taskId })
        })
        device.handlerState.currentCalibTaskId = null
        device.bizData.calibState = 'IDLE'
        if (device.bizData.makeState !== 'BUSY') device.deviceStatus = '0'
        ctx.broadcastDeviceUpdate(deviceId, {
          deviceStatus: device.deviceStatus,
          bizData: { ...device.bizData }
        })
        ctx.publishStatus(device, true)
        return
      }

      const s = steps[index]
      ctx.publishMqtt(device, eventTopic, {
        deviceId, deviceType, taskId,
        eventType: 'calibrate_progress',
        timestamp: ctx.now(),
        bizData: { step: s.step, stepCode: s.stepCode, message: s.message }
      } as MqttEventPayload)
      ctx.appendLog(deviceId, {
        timestamp: ctx.now(),
        direction: 'up',
        topic: eventTopic,
        message: JSON.stringify({ eventType: 'calibrate_progress', taskId, step: s.step, stepCode: s.stepCode })
      })
      setTimeout(() => runStep(index + 1), 1500)
    }

    setTimeout(() => runStep(0), 500)
  }

  /**
   * 换料流程模拟：排空旧料(purge) → 注入新料(fill) → 排空气(vent) → 完成。
   * 每阶段按 0/50/100 三档上报 refill_progress；完成后上报 refill_done，
   * 云端收到 refill_done 直接把该泵余量刷满（协议 2026-08 变更，设备不再补发 sync_remain）。
   */
  private startRefillSimulation(
    device: DeviceRef,
    taskId: string,
    pump: number,
    colorCode: string,
    capacity: number,
    ctx: HandlerCtx
  ): void {
    const { deviceId, deviceType } = device.opts
    const eventTopic = `device/${deviceType}/event/${deviceId}`
    const stages = ['purge', 'fill', 'vent']
    const progresses = [0, 50, 100]

    // 展开成 (stage, progress) 序列
    const seq: Array<{ step: string; progress: number }> = []
    for (const step of stages) for (const progress of progresses) seq.push({ step, progress })

    const runStep = (index: number): void => {
      // 任务已被取消或被新任务替换，终止
      if (device.handlerState.currentRefillTaskId !== taskId) return

      if (index >= seq.length) {
        // 换料完成：更新本机 colorCode/remain，上报 refill_done
        const remains = getRemains(device)
        remains[pump] = capacity
        ctx.publishMqtt(device, eventTopic, {
          deviceId, deviceType, taskId,
          eventType: 'refill_done',
          timestamp: ctx.now(),
          bizData: { pump, colorCode, remain: capacity }
        } as MqttEventPayload)
        ctx.appendLog(deviceId, {
          timestamp: ctx.now(),
          direction: 'up',
          topic: eventTopic,
          message: JSON.stringify({ eventType: 'refill_done', taskId, pump, colorCode, remain: capacity })
        })
        device.handlerState.currentRefillTaskId = null
        device.bizData.refillState = 'IDLE'
        if (device.bizData.makeState !== 'BUSY' && device.bizData.calibState !== 'BUSY') {
          device.deviceStatus = '0'
        }
        ctx.broadcastDeviceUpdate(deviceId, {
          deviceStatus: device.deviceStatus,
          bizData: { ...device.bizData }
        })
        ctx.publishStatus(device, true)
        // 余量刷满由云端收到 refill_done 后完成，设备端不再补发 sync_remain
        return
      }

      const s = seq[index]
      ctx.publishMqtt(device, eventTopic, {
        deviceId, deviceType, taskId,
        eventType: 'refill_progress',
        timestamp: ctx.now(),
        bizData: { pump, step: s.step, progress: s.progress }
      } as MqttEventPayload)
      ctx.appendLog(deviceId, {
        timestamp: ctx.now(),
        direction: 'up',
        topic: eventTopic,
        message: JSON.stringify({ eventType: 'refill_progress', taskId, pump, step: s.step, progress: s.progress })
      })
      setTimeout(() => runStep(index + 1), 800)
    }

    setTimeout(() => runStep(0), 500)
  }
}
