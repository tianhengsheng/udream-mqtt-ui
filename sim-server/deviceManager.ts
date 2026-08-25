import mqtt, { MqttClient } from 'mqtt'
import { v4 as uuidv4 } from 'uuid'
import type { WebSocket } from 'ws'
import type {
  AddDeviceOptions,
  DeviceStateSnapshot,
  MqttCmd,
  MqttCmdResp,
  LogEntry,
  DeviceStatus
} from './types.js'
import type { DeviceRef, HandlerCtx, ReqResp } from './handlers/types.js'
import { deviceHandlers } from './handlers/index.js'

// 设备内部状态（实现 DeviceRef 接口）
interface ManagedDevice extends DeviceRef {
  client: MqttClient | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  deviceStatus: DeviceStatus
  bizData: Record<string, unknown>
  firmwareVersion: string
  osVersion: string
  sn: string
  wifiName: string
  /** Handler 私有状态（替代原来 currentTaskId / dispensePaused 等字段） */
  handlerState: Record<string, unknown>
  cmdCache: Map<string, MqttCmdResp>  // cmdId -> 已处理响应（幂等）
  statusTimer: ReturnType<typeof setInterval> | null
}

// -------- 工具函数 --------
function now(): number {
  return Date.now()
}

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
}

// -------- DeviceManager --------
class DeviceManager {
  private devices = new Map<string, ManagedDevice>()
  private wsClients = new Set<WebSocket>()
  private logs = new Map<string, LogEntry[]>()

  /** 提供给 handler 调用的上下文（绑定 this） */
  private readonly ctx: HandlerCtx = {
    appendLog: this.appendLog.bind(this),
    publishMqtt: this.publishMqtt.bind(this),
    publishStatus: this.publishStatus.bind(this),
    broadcastDeviceUpdate: this.broadcastDeviceUpdate.bind(this),
    sendReq: this.sendReq.bind(this),
    now
  }

  // 当前已扫描到的证书设备列表（由 index.ts 注入）
  private certDevices: { deviceId: string; deviceType: string }[] = []

  /** 更新证书设备列表并广播给所有客户端 */
  setCertDevices(devices: { deviceId: string; deviceType: string }[]) {
    this.certDevices = devices
    this.broadcast({ type: 'cert_devices_update', devices })
  }

  // ---- WebSocket 客户端管理 ----
  addWsClient(ws: WebSocket) {
    this.wsClients.add(ws)
    this.sendToWs(ws, { type: 'device_list', devices: this.getAllSnapshots() })
    this.sendToWs(ws, { type: 'cert_devices_update', devices: this.certDevices })
    for (const [deviceId, logs] of this.logs) {
      for (const entry of logs.slice(-50)) {
        this.sendToWs(ws, { type: 'log', deviceId, entry })
      }
    }
  }

  removeWsClient(ws: WebSocket) {
    this.wsClients.delete(ws)
  }

  private broadcast(msg: Record<string, unknown>) {
    const str = JSON.stringify(msg)
    const dead: WebSocket[] = []
    for (const ws of this.wsClients) {
      if (ws.readyState === 1 /* OPEN */) {
        try { ws.send(str) } catch { dead.push(ws) }
      } else if (ws.readyState > 1) {
        dead.push(ws)
      }
    }
    for (const ws of dead) this.wsClients.delete(ws)
  }

  private sendToWs(ws: WebSocket, msg: Record<string, unknown>) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg))
  }

  // ---- 日志 ----
  private appendLog(deviceId: string, entry: Omit<LogEntry, 'id'>) {
    const full: LogEntry = { ...entry, id: uuidv4() }
    if (!this.logs.has(deviceId)) this.logs.set(deviceId, [])
    const arr = this.logs.get(deviceId)!
    arr.push(full)
    if (arr.length > 200) arr.shift()
    this.broadcast({ type: 'log', deviceId, entry: full })
  }

  // ---- 状态广播 ----
  private broadcastDeviceUpdate(deviceId: string, data: Partial<DeviceStateSnapshot>) {
    this.broadcast({ type: 'device_update', deviceId, data })
  }

  // ---- 添加设备并连接 ----
  async addDevice(opts: AddDeviceOptions): Promise<void> {
    if (this.devices.has(opts.deviceId)) {
      throw new Error(`设备 ${opts.deviceId} 已存在`)
    }

    const defaultBizData = opts.deviceType === 'washbed'
      ? {
          // 初始为常温附近（无加热源的静置状态），排水/洗头才会升温
          waterTemperature: 18 + Math.round(randFloat(-1, 1)),
          drainStatus: 0,
          washCount: 0,
          waterLevel: 'normal',
          executionProgress: 0,
          washMode: 0,
          screenOn: 1,
          waterPressure: 1
        }
      : {
          makeState: 'IDLE',
          calibState: 'IDLE',
          refillState: 'IDLE',
          orderId: 0,
          pumps: []
        }

    const managed: ManagedDevice = {
      opts,
      client: null,
      connectionStatus: 'connecting',
      deviceStatus: '0',
      bizData: defaultBizData,
      firmwareVersion: 'v1.2.3',
      osVersion: 'Android 11',
      // 自定义 SN 优先；不填则取 deviceId 末段（split 取 serial，避免 5 位序列号把连字符切进来）
      sn: opts.sn && opts.sn.trim() ? opts.sn.trim() : (opts.deviceId.split('-').pop() ?? opts.deviceId),
      wifiName: 'SalonWiFi',
      handlerState: {},
      cmdCache: new Map(),
      statusTimer: null
    }

    this.devices.set(opts.deviceId, managed)
    this.logs.set(opts.deviceId, [])
    this.broadcast({ type: 'device_list', devices: this.getAllSnapshots() })

    this.appendLog(opts.deviceId, {
      timestamp: now(),
      direction: 'info',
      topic: '',
      message: `正在连接 mqtts://${opts.mqttHost}:${opts.mqttPort}...`
    })

    try {
      this.connectMqtt(managed)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      managed.connectionStatus = 'error'
      this.broadcastDeviceUpdate(opts.deviceId, { connectionStatus: 'error' })
      this.appendLog(opts.deviceId, {
        timestamp: now(),
        direction: 'error',
        topic: '',
        message: `证书解析失败: ${msg}`
      })
      console.error(`[MQTT][${opts.deviceId}] connect init error:`, e)
    }
  }

  // ---- 断开并移除设备 ----
  removeDevice(deviceId: string) {
    const managed = this.devices.get(deviceId)
    if (!managed) return

    this.clearStatusTimer(managed)
    deviceHandlers[managed.opts.deviceType]?.onDisconnected?.(managed)
    managed.client?.end(true)
    this.devices.delete(deviceId)
    this.logs.delete(deviceId)
    this.broadcast({ type: 'device_removed', deviceId })
  }

  // ---- MQTT 连接 ----
  private connectMqtt(managed: ManagedDevice) {
    const { deviceId, deviceType, mqttHost, mqttPort, certs } = managed.opts

    const client = mqtt.connect(`mqtts://${mqttHost}:${mqttPort}`, {
      clientId: deviceId,
      ca: Buffer.from(certs.ca),
      cert: Buffer.from(certs.cert),
      key: Buffer.from(certs.key),
      rejectUnauthorized: false,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 15000
    })

    managed.client = client

    client.on('connect', () => {
      try {
        managed.connectionStatus = 'connected'
        this.broadcastDeviceUpdate(deviceId, { connectionStatus: 'connected' })
        this.appendLog(deviceId, {
          timestamp: now(),
          direction: 'info',
          topic: '',
          message: `已连接到 mqtts://${mqttHost}:${mqttPort}`
        })

        // 订阅 cmd 主题
        const cmdTopic = `device/${deviceType}/cmd/${deviceId}`
        client.subscribe(cmdTopic, { qos: 1 }, (err) => {
          if (err) {
            this.appendLog(deviceId, {
              timestamp: now(),
              direction: 'error',
              topic: cmdTopic,
              message: `订阅失败: ${err.message}`
            })
          } else {
            this.appendLog(deviceId, {
              timestamp: now(),
              direction: 'info',
              topic: cmdTopic,
              message: `已订阅指令主题`
            })
          }
        })

        // 订阅 resp 主题（设备 req 的响应，规范 4.6）
        const respTopic = `device/${deviceType}/resp/${deviceId}`
        client.subscribe(respTopic, { qos: 1 }, (err) => {
          if (!err) {
            this.appendLog(deviceId, {
              timestamp: now(),
              direction: 'info',
              topic: respTopic,
              message: '已订阅请求响应主题'
            })
          }
        })

        // 先全量上报一次 status（让云端按 deviceId 缓存到 sn），
        // 再调 onConnected（其中 get_remain 依赖云端已缓存 sn 才能定位 device_code）
        this.publishStatus(managed, true)

        // 调用 handler 的 onConnected（可订阅额外 topic、启动定时器、上电拉取余量等）
        deviceHandlers[deviceType]?.onConnected(managed, this.ctx)

        // 启动 30s 保活定时器
        managed.statusTimer = setInterval(() => {
          try { this.publishStatus(managed, false) } catch { /* ignore */ }
        }, 30000)
      } catch (e) {
        console.error('[DeviceManager] connect handler error:', e)
      }
    })

    client.on('message', (topic, payload) => {
      try {
        const payloadStr = payload.toString()
        this.appendLog(deviceId, {
          timestamp: now(),
          direction: 'down',
          topic,
          message: payloadStr
        })
        this.handleIncomingMessage(managed, topic, payloadStr)
      } catch (e) {
        console.error('[DeviceManager] message handler error:', e)
      }
    })

    client.on('error', (err) => {
      try {
        managed.connectionStatus = 'error'
        this.broadcastDeviceUpdate(deviceId, { connectionStatus: 'error' })
        const errAny = err as unknown as { code?: unknown; message?: string }
        const detail = [errAny.code, errAny.message].filter(Boolean).join(' | ')
        this.appendLog(deviceId, {
          timestamp: now(),
          direction: 'error',
          topic: '',
          message: `连接错误: ${detail || String(err)}`
        })
        console.error(`[MQTT][${deviceId}] error:`, err)
      } catch (e) {
        console.error('[DeviceManager] error handler threw:', e)
      }
    })

    client.on('reconnect', () => {
      try {
        managed.connectionStatus = 'connecting'
        this.broadcastDeviceUpdate(deviceId, { connectionStatus: 'connecting' })
        this.appendLog(deviceId, {
          timestamp: now(),
          direction: 'info',
          topic: '',
          message: '正在重连...'
        })
      } catch { /* ignore */ }
    })

    client.on('close', () => {
      try {
        this.clearStatusTimer(managed)
        if (managed.connectionStatus !== 'error') {
          managed.connectionStatus = 'disconnected'
          this.broadcastDeviceUpdate(deviceId, { connectionStatus: 'disconnected' })
        }
      } catch { /* ignore */ }
    })
  }

  // ---- 处理收到的 MQTT 消息 ----
  private handleIncomingMessage(managed: ManagedDevice, topic: string, payloadStr: string) {
    const { deviceId, deviceType } = managed.opts
    console.log(`[handleIncomingMessage] deviceId=${deviceId} topic=${topic}`)

    // 设备请求的响应（规范 4.6）
    if (topic.includes('/resp/')) {
      this.handleReqResp(managed, payloadStr)
      return
    }

    // 指令
    let cmd: MqttCmd
    try {
      cmd = JSON.parse(payloadStr)
    } catch {
      this.appendLog(deviceId, {
        timestamp: now(),
        direction: 'error',
        topic,
        message: `指令解析失败: ${payloadStr}`
      })
      return
    }

    // 幂等检查
    if (managed.cmdCache.has(cmd.cmdId)) {
      const cached = managed.cmdCache.get(cmd.cmdId)!
      this.appendLog(deviceId, {
        timestamp: now(),
        direction: 'warn',
        topic,
        message: `重复指令 cmdId=${cmd.cmdId}，返回缓存响应`
      })
      this.publishCmdResp(managed, cached)
      return
    }

    const resp: MqttCmdResp = {
      cmdId: cmd.cmdId,
      ack: 'received',
      opStatus: 0,
      message: ''
    }

    // 通过注册表分发给对应 handler
    const handler = deviceHandlers[deviceType]
    if (handler) {
      try {
        handler.executeAction(cmd.action, cmd.bizData ?? {}, managed, resp, this.ctx)
      } catch (err: unknown) {
        resp.opStatus = 1
        resp.message = err instanceof Error ? err.message : String(err)
      }
    } else {
      resp.opStatus = 1
      resp.message = `不支持的设备类型: ${deviceType}`
    }

    // 缓存响应（最多 50 条）
    managed.cmdCache.set(cmd.cmdId, resp)
    if (managed.cmdCache.size > 50) {
      const firstKey = managed.cmdCache.keys().next().value!
      managed.cmdCache.delete(firstKey)
    }

    this.publishCmdResp(managed, resp)
    this.publishStatus(managed, true)
  }

  // ---- 发布状态 ----
  // 始终上报完整字段（对接文档 §4.3 标准 status），保活帧也带全，避免云端字段缺省
  private publishStatus(device: DeviceRef, _full: boolean) {
    const managed = device as ManagedDevice
    const { deviceId, deviceType } = device.opts
    const topic = `device/${deviceType}/status/${deviceId}`
    const payload: Record<string, unknown> = {
      deviceId,
      deviceType,
      timestamp: now(),
      status: device.deviceStatus,
      firmwareVersion: managed.firmwareVersion,
      osVersion: managed.osVersion,
      sn: managed.sn,
      wifiName: managed.wifiName,
      bizData: device.bizData
    }

    this.publishMqtt(device, topic, payload)
    this.appendLog(deviceId, {
      timestamp: now(),
      direction: 'up',
      topic,
      message: JSON.stringify(payload)
    })

    this.broadcastDeviceUpdate(deviceId, {
      deviceStatus: device.deviceStatus,
      bizData: { ...device.bizData }
    })
  }

  // ---- 发布 CmdResp ----
  private publishCmdResp(managed: ManagedDevice, resp: MqttCmdResp) {
    const { deviceId, deviceType } = managed.opts
    const topic = `device/${deviceType}/cmdresp/${deviceId}`
    this.publishMqtt(managed, topic, resp)
    this.appendLog(deviceId, {
      timestamp: now(),
      direction: 'up',
      topic,
      message: JSON.stringify(resp)
    })
  }

  // ---- MQTT 发布辅助 ----
  private publishMqtt(device: DeviceRef, topic: string, payload: unknown) {
    if (!device.client) return
    const connected = device.client.connected
    console.log(`[publishMqtt] topic=${topic} connected=${connected}`)
    if (!connected) {
      // 断线窗口不丢消息：QoS1 消息进 mqtt.js 离线队列，重连后自动补发。
      // 曾因 connected=false 直接丢弃，导致闪断时 cmdresp 静默丢失、服务端等 ack 超时。
      console.warn(`[publishMqtt] 连接未就绪，消息入离线队列等待补发: ${topic}`)
    }
    device.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) console.error(`[publishMqtt] publish error:`, err)
    })
  }

  // ---- 清理保活定时器 ----
  private clearStatusTimer(managed: ManagedDevice) {
    if (managed.statusTimer) {
      clearInterval(managed.statusTimer)
      managed.statusTimer = null
    }
  }

  // ---- 手动触发 action（来自前端 REST API）----
  triggerAction(deviceId: string, action: string, bizData: Record<string, unknown>) {
    const managed = this.devices.get(deviceId)
    if (!managed) throw new Error(`设备 ${deviceId} 不存在`)
    if (managed.connectionStatus !== 'connected') throw new Error('设备未连接')

    const { deviceType } = managed.opts
    const cmdTopic = `device/${deviceType}/cmd/${deviceId}`
    const cmd: MqttCmd = {
      cmdId: uuidv4(),
      action,
      timestamp: now(),
      bizData
    }

    // 发布到 MQTT broker，EMQX (MQTT 3.1.1) 会将消息回传给自身订阅
    // client.on('message') 自然触发 handleIncomingMessage → cmdresp → status
    this.publishMqtt(managed, cmdTopic, cmd)
  }

  // ---- 设备主动发起请求 req（规范 4.6，device → cloud → device）----
  /** 供 handler 通过 ctx.sendReq 调用：发布 req，记录 reqId→action 待 resp 回填。 */
  private sendReq(device: DeviceRef, action: string, bizData: Record<string, unknown>) {
    const { deviceId, deviceType } = device.opts
    const reqId = uuidv4()
    const topic = `device/${deviceType}/req/${deviceId}`
    // bizData 严格按协议（get_remain 为空 / sync_remain 仅含 pumps），不塞 sn；
    // 云端按 deviceId → 状态缓存 sn → device_code 定位（依赖设备已上报过 status）
    const payload = {
      reqId,
      action,
      timestamp: now(),
      bizData: bizData ?? {}
    }

    const pending = (device.handlerState.pendingReqs as Map<string, string>) ??
      (device.handlerState.pendingReqs = new Map<string, string>())
    pending.set(reqId, action)
    // 防止积压：最多保留 50 条待匹配 reqId
    if (pending.size > 50) {
      const firstKey = pending.keys().next().value as string
      pending.delete(firstKey)
    }

    this.publishMqtt(device, topic, payload)
    this.appendLog(deviceId, {
      timestamp: now(),
      direction: 'up',
      topic,
      message: JSON.stringify(payload)
    })
  }

  /** 处理 resp（云端对 req 的响应），按 reqId 找回 action 并回调 handler。 */
  private handleReqResp(managed: ManagedDevice, payloadStr: string) {
    const { deviceId, deviceType } = managed.opts
    let resp: ReqResp
    try {
      resp = JSON.parse(payloadStr)
    } catch {
      return
    }
    const pending = managed.handlerState.pendingReqs as Map<string, string> | undefined
    const action = pending?.get(resp.reqId) ?? ''
    if (pending) pending.delete(resp.reqId)
    deviceHandlers[deviceType]?.onReqResp?.(action, resp, managed, this.ctx)
  }

  // ---- 手动触发设备 req（来自前端 REST API，用于联调拉取/同步余量）----
  triggerReq(deviceId: string, action: string, bizData: Record<string, unknown>) {
    const managed = this.devices.get(deviceId)
    if (!managed) throw new Error(`设备 ${deviceId} 不存在`)
    if (managed.connectionStatus !== 'connected') throw new Error('设备未连接')

    // 手动 sync_remain 未带 pumps 时发空数组做连通性自测。
    // 增量协议下 remain = 本次用量，不能再拿本地绝对余量补全（会被云端当用量扣减）；
    // 真实用量上报只走下料结束的自动 sync_remain。
    let payload = bizData
    if (action === 'sync_remain' && !(bizData && Array.isArray((bizData as { pumps?: unknown }).pumps))) {
      payload = { pumps: [] }
    }
    this.sendReq(managed, action, payload)
  }

  // ---- 触发染色仪告警（测试用）----
  triggerDispenseWarn(deviceId: string, warnCode: number) {
    const managed = this.devices.get(deviceId)
    if (!managed || managed.opts.deviceType !== 'dyemachine') return
    const { deviceType } = managed.opts
    const bd = managed.bizData
    const topic = `device/${deviceType}/event/${deviceId}`

    const payload = {
      deviceId,
      deviceType,
      taskId: (managed.handlerState.currentTaskId as string) ?? 'unknown',
      eventType: 'dispense_warn',
      timestamp: now(),
      bizData: { orderId: bd.orderId, warnCode }
    }
    managed.handlerState.dispensePaused = true
    this.publishMqtt(managed, topic, payload)
    this.appendLog(deviceId, {
      timestamp: now(),
      direction: 'up',
      topic,
      message: JSON.stringify(payload)
    })
  }

  // ---- 快照 ----
  getSnapshot(deviceId: string): DeviceStateSnapshot | null {
    const managed = this.devices.get(deviceId)
    if (!managed) return null
    return this.toSnapshot(deviceId, managed)
  }

  getAllSnapshots(): DeviceStateSnapshot[] {
    return Array.from(this.devices.entries()).map(([id, m]) => this.toSnapshot(id, m))
  }

  private toSnapshot(deviceId: string, managed: ManagedDevice): DeviceStateSnapshot {
    return {
      deviceId,
      deviceType: managed.opts.deviceType,
      displayName: managed.opts.displayName || deviceId,
      connectionStatus: managed.connectionStatus,
      deviceStatus: managed.deviceStatus,
      firmwareVersion: managed.firmwareVersion,
      osVersion: managed.osVersion,
      sn: managed.sn,
      wifiName: managed.wifiName,
      bizData: { ...managed.bizData },
      mqttHost: managed.opts.mqttHost,
      mqttPort: managed.opts.mqttPort
    }
  }
}

export const deviceManager = new DeviceManager()
