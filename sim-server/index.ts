import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { deviceManager } from './deviceManager.js'
import { generateCert, readCaCert, canGenerateCert } from './certUtils.js'
import {
  scanCertsDir,
  readDeviceCerts,
  saveCertFiles,
  saveCaCert,
  watchCertsDir
} from './certScanner.js'
import type { AddDeviceOptions } from './types.js'

const DEVICE_ID_RE = /^[a-z]{2}\d{2}-.+$/
const TYPE_CODE_MAP: Record<string, string> = { wb: 'washbed', dm: 'dyemachine' }

// 防止未捕获异常导致进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason)
})

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())

// -------- REST API --------

/** 获取设备列表 */
app.get('/api/devices', (_req, res) => {
  res.json({ success: true, data: deviceManager.getAllSnapshots() })
})

/** 添加设备（JSON body，certs 为 PEM 字符串） */
app.post('/api/devices', async (req, res) => {
  const body = req.body as {
    deviceId: string
    deviceType: string
    displayName?: string
    mqttHost: string
    mqttPort: number
    sn?: string
    certs: { ca: string; cert: string; key: string }
  }

  if (!body.deviceId || !body.deviceType || !body.certs?.ca || !body.certs?.cert || !body.certs?.key) {
    res.status(400).json({ success: false, message: '缺少必要参数（deviceId/deviceType/certs）' })
    return
  }

  const opts: AddDeviceOptions = {
    deviceId: body.deviceId,
    deviceType: body.deviceType as 'washbed' | 'dyemachine',
    displayName: body.displayName || body.deviceId,
    mqttHost: body.mqttHost || 'device-dev.51yxm.com',
    mqttPort: body.mqttPort || 8085,
    sn: body.sn,
    certs: body.certs
  }

  try {
    await deviceManager.addDevice(opts)
    res.json({ success: true, message: '设备连接中' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ success: false, message: msg })
  }
})

/** 移除设备 */
app.delete('/api/devices/:deviceId', (req, res) => {
  deviceManager.removeDevice(req.params.deviceId)
  res.json({ success: true })
})

/** 触发指令 */
app.post('/api/devices/:deviceId/action', (req, res) => {
  const { action, bizData } = req.body as { action: string; bizData?: Record<string, unknown> }
  if (!action) {
    res.status(400).json({ success: false, message: '缺少 action 参数' })
    return
  }
  try {
    deviceManager.triggerAction(req.params.deviceId, action, bizData ?? {})
    res.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ success: false, message: msg })
  }
})

/** 触发设备主动请求 req（规范 4.6，如 get_remain / sync_remain，用于联调） */
app.post('/api/devices/:deviceId/req', (req, res) => {
  const { action, bizData } = req.body as { action: string; bizData?: Record<string, unknown> }
  if (!action) {
    res.status(400).json({ success: false, message: '缺少 action 参数' })
    return
  }
  try {
    deviceManager.triggerReq(req.params.deviceId, action, bizData ?? {})
    res.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ success: false, message: msg })
  }
})

/** 触发染色仪告警（测试用） */
app.post('/api/devices/:deviceId/warn', (req, res) => {
  const { warnCode } = req.body as { warnCode: number }
  deviceManager.triggerDispenseWarn(req.params.deviceId, warnCode ?? 104)
  res.json({ success: true })
})

/** 上传证书（multipart form: ca, cert, key 三个文件字段） */
app.post(
  '/api/certs/upload',
  upload.fields([
    { name: 'ca', maxCount: 1 },
    { name: 'cert', maxCount: 1 },
    { name: 'key', maxCount: 1 }
  ]),
  (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]>
    const ca = files?.ca?.[0]?.buffer?.toString('utf8')
    const cert = files?.cert?.[0]?.buffer?.toString('utf8')
    const key = files?.key?.[0]?.buffer?.toString('utf8')

    if (!ca || !cert || !key) {
      res.status(400).json({ success: false, message: '请上传 ca、cert、key 三个证书文件' })
      return
    }
    res.json({ success: true, data: { ca, cert, key } })
  }
)

/** 生成证书（需要 ca.key 在项目根目录） */
app.post('/api/certs/generate', (req, res) => {
  const { deviceId } = req.body as { deviceId: string }
  if (!deviceId) {
    res.status(400).json({ success: false, message: '缺少 deviceId' })
    return
  }
  if (!canGenerateCert()) {
    res.status(400).json({
      success: false,
      message: '项目根目录缺少 ca.key，无法自动生成证书。请手动上传证书文件，或将 ca.key 放置到项目根目录。'
    })
    return
  }
  try {
    const certs = generateCert(deviceId)
    res.json({ success: true, data: certs })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ success: false, message: msg })
  }
})

/** 获取项目内置 ca.crt */
app.get('/api/certs/ca', (_req, res) => {
  try {
    const ca = readCaCert()
    res.json({ success: true, data: ca })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(404).json({ success: false, message: msg })
  }
})

/** 检查是否可以自动生成证书 */
app.get('/api/certs/can-generate', (_req, res) => {
  res.json({ success: true, data: canGenerateCert() })
})

/** 获取 certs/ 目录中可用的设备列表 */
app.get('/api/cert-devices', (_req, res) => {
  res.json({ success: true, data: scanCertsDir() })
})

/** 通过 certs/ 目录中的证书添加设备（无需手动上传证书） */
app.post('/api/devices/from-cert', async (req, res) => {
  const { deviceId, displayName, mqttHost, mqttPort, sn } = req.body as {
    deviceId: string
    displayName?: string
    mqttHost: string
    mqttPort: number
    sn?: string
  }
  if (!deviceId) {
    res.status(400).json({ success: false, message: '缺少 deviceId' })
    return
  }
  const typeCode = deviceId.slice(0, 2)
  const deviceType = TYPE_CODE_MAP[typeCode]
  if (!deviceType) {
    res.status(400).json({ success: false, message: `未识别的设备类型码: ${typeCode}` })
    return
  }
  try {
    const ca = readCaCert()
    const { cert, key } = readDeviceCerts(deviceId)
    const opts: AddDeviceOptions = {
      deviceId,
      deviceType: deviceType as 'washbed' | 'dyemachine',
      displayName: displayName || deviceId,
      mqttHost: mqttHost || 'device-dev.51yxm.com',
      mqttPort: Number(mqttPort) || 8085,
      sn,
      certs: { ca, cert, key }
    }
    await deviceManager.addDevice(opts)
    res.json({ success: true, message: '设备连接中' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ success: false, message: msg })
  }
})

/** 上传证书到 certs/ 目录：设备证书（cert + key 成对）与 CA 证书（ca，可单独传）均支持 */
app.post(
  '/api/certs/upload-to-dir',
  upload.fields([
    { name: 'cert', maxCount: 1 },
    { name: 'key', maxCount: 1 },
    { name: 'ca', maxCount: 1 }
  ]),
  (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]>
    const certFile = files?.cert?.[0]
    const keyFile = files?.key?.[0]
    const caFile = files?.ca?.[0]
    if (!caFile && !certFile && !keyFile) {
      res.status(400).json({ success: false, message: '请上传 ca.crt，或设备的 .crt + .key 文件' })
      return
    }
    if ((certFile && !keyFile) || (!certFile && keyFile)) {
      res.status(400).json({ success: false, message: '设备证书需同时上传 .crt 和 .key 文件' })
      return
    }
    let deviceId: string | undefined
    if (certFile) {
      deviceId = certFile.originalname.replace(/\.(crt|pem)$/i, '')
      if (!DEVICE_ID_RE.test(deviceId)) {
        res.status(400).json({ success: false, message: `文件名格式错误，应为 {deviceId}.crt，如 wb01-000123.crt` })
        return
      }
    }
    try {
      if (caFile) {
        saveCaCert(caFile.buffer.toString('utf8'))
      }
      if (certFile && keyFile && deviceId) {
        saveCertFiles(deviceId, certFile.buffer.toString('utf8'), keyFile.buffer.toString('utf8'))
      }
      // fs.watch 会自动触发刷新，这里立即广播一次保证实时性
      deviceManager.setCertDevices(scanCertsDir())
      res.json({ success: true, data: { deviceId, caSaved: !!caFile } })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ success: false, message: msg })
    }
  }
)

// -------- HTTP + WebSocket Server --------
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  deviceManager.addWsClient(ws)
  ws.on('close', () => {
    deviceManager.removeWsClient(ws)
  })
})

// 默认 3001（vite proxy /simapi、/simws 指向它）。
// 若 3001 已被别的模拟器实例（如 dye-service 里的 device-web-react）占用，可用 SIM_PORT 换端口，
// 此时要同步改 vite.config.ts 的 proxy target。
const PORT = Number(process.env.SIM_PORT) || 3001
server.listen(PORT, () => {
  console.log(`[server] 已启动: http://localhost:${PORT}`)
  console.log(`[server] WebSocket:  ws://localhost:${PORT}/ws`)

  // 初始化证书设备列表
  deviceManager.setCertDevices(scanCertsDir())

  // 监听 certs/ 目录变化，自动推送更新
  watchCertsDir(() => {
    const devices = scanCertsDir()
    console.log(`[certScanner] 目录变化，当前设备: ${devices.map(d => d.deviceId).join(', ') || '无'}`)
    deviceManager.setCertDevices(devices)
  })
})
