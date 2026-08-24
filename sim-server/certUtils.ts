import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { CERTS_DIR } from './certScanner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

/**
 * 使用 openssl 为指定 deviceId 生成证书（需要 certs/ca.crt + ca.key 在项目根目录）
 */
export function generateCert(deviceId: string): { cert: string; key: string; ca: string } {
  const caPath = path.join(CERTS_DIR, 'ca.crt')
  const caKeyPath = path.join(PROJECT_ROOT, 'ca.key')

  if (!existsSync(caPath)) {
    throw new Error('certs/ca.crt 不存在，无法生成证书')
  }
  if (!existsSync(caKeyPath)) {
    throw new Error('ca.key 不存在，无法签发证书。请将 CA 私钥放置到项目根目录')
  }

  const tmpDir = '/tmp'
  const keyFile = path.join(tmpDir, `${deviceId}.key`)
  const csrFile = path.join(tmpDir, `${deviceId}.csr`)
  const certFile = path.join(tmpDir, `${deviceId}.crt`)

  try {
    // 生成私钥
    execSync(`openssl genpkey -algorithm RSA -out "${keyFile}" -pkeyopt rsa_keygen_bits:2048`, {
      stdio: 'pipe'
    })

    // 生成 CSR（CN = deviceId）
    execSync(
      `openssl req -new -key "${keyFile}" -out "${csrFile}" -subj "/CN=${deviceId}"`,
      { stdio: 'pipe' }
    )

    // 签发证书（有效期 10 年）
    execSync(
      `openssl x509 -req -in "${csrFile}" -CA "${caPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${certFile}" -days 3650 -sha256`,
      { stdio: 'pipe' }
    )

    const cert = readFileSync(certFile, 'utf8')
    const key = readFileSync(keyFile, 'utf8')
    const ca = readFileSync(caPath, 'utf8')

    return { cert, key, ca }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`证书生成失败: ${msg}`)
  }
}

/**
 * 读取 certs/ca.crt 内容
 */
export function readCaCert(): string {
  const caPath = path.join(CERTS_DIR, 'ca.crt')
  if (!existsSync(caPath)) {
    throw new Error('certs/ca.crt 不存在')
  }
  return readFileSync(caPath, 'utf8')
}

/**
 * 检查 ca.key 是否存在（用于判断是否可以自动生成证书）
 */
export function canGenerateCert(): boolean {
  return (
    existsSync(path.join(CERTS_DIR, 'ca.crt')) &&
    existsSync(path.join(PROJECT_ROOT, 'ca.key'))
  )
}
