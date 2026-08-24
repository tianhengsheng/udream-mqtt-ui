import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CERTS_DIR = path.resolve(__dirname, '..', 'certs')

// typeCode → deviceType（与 src/config/deviceTypes.ts 保持一致）
const TYPE_CODE_MAP: Record<string, string> = {
  wb: 'washbed',
  dm: 'dyemachine'
}

const DEVICE_ID_RE = /^[a-z]{2}\d{2}-.+$/

export interface ScannedCertDevice {
  deviceId: string
  deviceType: string
}

/** 扫描 certs/ 目录，返回有完整证书对（.crt + .key）的设备列表 */
export function scanCertsDir(): ScannedCertDevice[] {
  try {
    if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true })
    const files = fs.readdirSync(CERTS_DIR)
    const results: ScannedCertDevice[] = []

    for (const file of files) {
      if (!file.endsWith('.crt') || file === 'ca.crt') continue
      const deviceId = file.slice(0, -4) // strip .crt
      if (!DEVICE_ID_RE.test(deviceId)) continue
      if (!files.includes(`${deviceId}.key`)) continue
      const typeCode = deviceId.slice(0, 2)
      const deviceType = TYPE_CODE_MAP[typeCode]
      if (!deviceType) continue
      results.push({ deviceId, deviceType })
    }

    return results.sort((a, b) => a.deviceId.localeCompare(b.deviceId))
  } catch {
    return []
  }
}

/** 读取指定设备的 cert + key 内容 */
export function readDeviceCerts(deviceId: string): { cert: string; key: string } {
  return {
    cert: fs.readFileSync(path.join(CERTS_DIR, `${deviceId}.crt`), 'utf8'),
    key: fs.readFileSync(path.join(CERTS_DIR, `${deviceId}.key`), 'utf8')
  }
}

/** 将证书文件写入 certs/ 目录 */
export function saveCertFiles(deviceId: string, certContent: string, keyContent: string): void {
  if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true })
  fs.writeFileSync(path.join(CERTS_DIR, `${deviceId}.crt`), certContent, 'utf8')
  fs.writeFileSync(path.join(CERTS_DIR, `${deviceId}.key`), keyContent, 'utf8')
}

/** 保存 CA 证书到 certs/ca.crt（新机器部署后 certs/ 为空，经 UI 上传一次即可） */
export function saveCaCert(content: string): void {
  if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true })
  fs.writeFileSync(path.join(CERTS_DIR, 'ca.crt'), content, 'utf8')
}

/** 监听 certs/ 目录变化，防抖 600ms 后回调 */
export function watchCertsDir(onChange: () => void): fs.FSWatcher | null {
  try {
    if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true })
    let timer: ReturnType<typeof setTimeout> | null = null
    const watcher = fs.watch(CERTS_DIR, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 600)
    })
    console.log(`[certScanner] 监听证书目录: ${CERTS_DIR}`)
    return watcher
  } catch (e) {
    console.error('[certScanner] 监听失败:', e)
    return null
  }
}
