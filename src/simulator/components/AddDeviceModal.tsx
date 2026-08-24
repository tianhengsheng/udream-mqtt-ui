import React, { useState, useRef, useEffect } from 'react'
import {
  Modal, Form, Input, Button, Space, Alert, Tag,
  Typography, Divider, Spin, message, Tooltip
} from 'antd'
import {
  CheckCircleFilled, CloseCircleFilled, UploadOutlined,
  ReloadOutlined, WifiOutlined
} from '@ant-design/icons'
import { DEVICE_TYPE_CONFIGS } from '../config/deviceTypes'
import { useDeviceStore } from '../store/useDeviceStore'
import type { CertDeviceInfo } from '../types'
import {
  ACCENT, BG_CARD, BG_PAGE, BG_SUBTLE, BORDER, BORDER_WEAK,
  SUCCESS, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY
} from '../theme'

const DEFAULT_HOST = 'device-dev.51yxm.com'
const DEFAULT_PORT = 8085
const DEVICE_ID_RE = /^[a-z]{2}\d{2}-.+$/

const TYPE_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.values(DEVICE_TYPE_CONFIGS).map((c) => [c.deviceType, c.displayName])
)

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export const AddDeviceModal: React.FC<Props> = ({ open, onClose, onSuccess }) => {
  const [form] = Form.useForm()
  const { certDevices, devices } = useDeviceStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadCert, setUploadCert] = useState<string | null>(null)
  const [uploadKey, setUploadKey] = useState<string | null>(null)
  const [uploadCertName, setUploadCertName] = useState<string | null>(null)
  const [uploadKeyName, setUploadKeyName] = useState<string | null>(null)
  // CA 证书：新机器部署后 certs/ 为空，mTLS 连接必需 ca.crt，这里支持单独上传
  const [uploadCa, setUploadCa] = useState<string | null>(null)
  const [uploadCaName, setUploadCaName] = useState<string | null>(null)
  const [caReady, setCaReady] = useState<boolean | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const certInputRef = useRef<HTMLInputElement>(null)
  const keyInputRef = useRef<HTMLInputElement>(null)
  const caInputRef = useRef<HTMLInputElement>(null)

  // 打开弹窗时探测服务端 certs/ca.crt 是否就绪（决定是否提示上传 CA）
  useEffect(() => {
    if (!open) return
    fetch('/simapi/certs/ca')
      .then((r) => r.json())
      .then((d) => setCaReady(!!d.success))
      .catch(() => setCaReady(null))
  }, [open])

  const connectedIds = new Set(devices.map((d) => d.deviceId))

  // 设备 SN 按 deviceId 记忆：选中设备时自动带出上次填的 sn，省去每次重敲（sn 对应余量表 device_code）
  const snKey = (deviceId: string) => `mqtt-sim-sn-${deviceId}`
  function selectDevice(deviceId: string) {
    setSelectedId(deviceId)
    form.setFieldValue('sn', localStorage.getItem(snKey(deviceId)) || undefined)
  }

  function handleClose() {
    form.resetFields()
    setSelectedId(null)
    setShowUpload(false)
    setUploadCert(null)
    setUploadKey(null)
    setUploadCertName(null)
    setUploadKeyName(null)
    setUploadCa(null)
    setUploadCaName(null)
    onClose()
  }

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  async function handleCertFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const content = await readFile(file)
    setUploadCert(content)
    setUploadCertName(file.name)
    // 从文件名提取设备 ID，自动选中（如果 key 也已选）
    const deviceId = file.name.replace(/\.(crt|pem)$/i, '')
    if (DEVICE_ID_RE.test(deviceId) && uploadKey) {
      // 将在上传后自动出现在列表
    }
  }

  async function handleKeyFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const content = await readFile(file)
    setUploadKey(content)
    setUploadKeyName(file.name)
  }

  async function handleCaFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const content = await readFile(file)
    setUploadCa(content)
    setUploadCaName(file.name)
  }

  async function handleUpload() {
    const hasPair = !!(uploadCert && uploadKey && uploadCertName)
    if (!hasPair && !uploadCa) {
      message.warning('请选择 CA 证书，或设备的证书 + 私钥文件')
      return
    }
    if ((uploadCert && !uploadKey) || (!uploadCert && uploadKey)) {
      message.warning('设备证书需同时选择 .crt 和 .key')
      return
    }
    let deviceId: string | null = null
    if (hasPair) {
      deviceId = uploadCertName!.replace(/\.(crt|pem)$/i, '')
      if (!DEVICE_ID_RE.test(deviceId)) {
        message.error('证书文件名格式错误，应为 {deviceId}.crt，如 wb01-000123.crt')
        return
      }
    }
    setUploading(true)
    try {
      const formData = new FormData()
      if (uploadCa) {
        formData.append('ca', new Blob([uploadCa], { type: 'text/plain' }), uploadCaName ?? 'ca.crt')
      }
      if (hasPair && deviceId) {
        formData.append('cert', new Blob([uploadCert!], { type: 'text/plain' }), uploadCertName!)
        formData.append('key', new Blob([uploadKey!], { type: 'text/plain' }), uploadKeyName ?? `${deviceId}.key`)
      }
      const res = await fetch('/simapi/certs/upload-to-dir', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        const parts = []
        if (uploadCa) parts.push('CA 证书已就绪')
        if (deviceId) parts.push(`设备 ${deviceId} 已加入列表`)
        message.success(parts.join('，'))
        if (uploadCa) setCaReady(true)
        if (deviceId) {
          selectDevice(deviceId)
          setShowUpload(false)
        }
        setUploadCert(null)
        setUploadKey(null)
        setUploadCertName(null)
        setUploadKeyName(null)
        setUploadCa(null)
        setUploadCaName(null)
      } else {
        message.error(data.message)
      }
    } catch {
      message.error('上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    if (!selectedId) {
      message.warning('请选择一个设备')
      return
    }
    let values: { mqttHost: string; mqttPort: number; sn?: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    // 记忆本次填的 sn（清空则忘掉），下次选同一设备自动带出
    const sn = values.sn?.trim()
    if (sn) localStorage.setItem(snKey(selectedId), sn)
    else localStorage.removeItem(snKey(selectedId))
    try {
      const res = await fetch('/simapi/devices/from-cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedId,
          mqttHost: values.mqttHost,
          mqttPort: Number(values.mqttPort),
          sn: values.sn?.trim() || undefined
        })
      })
      const data = await res.json()
      if (data.success) {
        message.success('设备连接中...')
        handleClose()
        onSuccess()
      } else {
        message.error(data.message)
      }
    } catch {
      message.error('请求失败')
    } finally {
      setSubmitting(false)
    }
  }

  const { Text } = Typography

  return (
    <Modal
      title="添加设备"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="连接设备"
      okButtonProps={{ disabled: !selectedId || connectedIds.has(selectedId ?? '') }}
      cancelText="取消"
      width={520}
      destroyOnHidden
    >
      {/* 设备列表 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13, color: TEXT_PRIMARY }}>选择设备</Text>
          <Space size={6}>
            <Tooltip title="刷新列表">
              <Button
                size="small" type="text" icon={<ReloadOutlined />}
                onClick={async () => {
                  const res = await fetch('/simapi/cert-devices')
                  const data = await res.json()
                  if (data.success) {
                    useDeviceStore.setState({ certDevices: data.data })
                  }
                }}
              />
            </Tooltip>
            <Button
              size="small"
              icon={<UploadOutlined />}
              onClick={() => setShowUpload((v) => !v)}
              type={showUpload ? 'primary' : 'default'}
              ghost={showUpload}
            >
              上传新证书
            </Button>
          </Space>
        </div>

        {certDevices.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message="证书目录为空"
            description={
              <span>
                请将设备证书（<code>.crt</code> + <code>.key</code>）放入项目 <code>certs/</code> 目录，
                或点击右上角「上传新证书」
              </span>
            }
          />
        ) : (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            {certDevices.map((d: CertDeviceInfo, idx) => {
              const isConnected = connectedIds.has(d.deviceId)
              const isSelected = selectedId === d.deviceId
              return (
                <div
                  key={d.deviceId}
                  onClick={() => !isConnected && selectDevice(d.deviceId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    borderBottom: idx < certDevices.length - 1 ? `1px solid ${BORDER_WEAK}` : undefined,
                    // 选中行用主色低透明度高亮；已连接行压暗表示不可选；普通行比弹窗底亮一档
                    background: isSelected ? 'rgba(83,155,245,0.20)' : isConnected ? BG_PAGE : BG_SUBTLE,
                    cursor: isConnected ? 'not-allowed' : 'pointer',
                    opacity: isConnected ? 0.55 : 1,
                    transition: 'background 0.15s'
                  }}
                >
                  {/* 选中圆圈 */}
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${isSelected ? ACCENT : BORDER}`,
                    background: isSelected ? ACCENT : BG_CARD,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {isSelected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: BG_PAGE }} />}
                  </div>

                  {/* 设备 ID */}
                  <Text style={{ fontFamily: 'monospace', fontSize: 13, flex: 1, color: isConnected ? TEXT_MUTED : TEXT_PRIMARY }}>
                    {d.deviceId}
                  </Text>

                  {/* 类型 tag */}
                  <Tag color="blue" style={{ margin: 0, flexShrink: 0 }}>
                    {TYPE_DISPLAY[d.deviceType] ?? d.deviceType}
                  </Tag>

                  {/* 状态 */}
                  {isConnected ? (
                    <Tag icon={<WifiOutlined />} color="success" style={{ margin: 0, flexShrink: 0 }}>
                      已连接
                    </Tag>
                  ) : (
                    <Tag style={{ margin: 0, flexShrink: 0, color: SUCCESS, borderColor: 'rgba(63,185,80,0.45)', background: 'rgba(63,185,80,0.18)' }}>
                      可用
                    </Tag>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 上传新证书（可折叠） */}
      {showUpload && (
        <div style={{ background: BG_SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
          <Text strong style={{ fontSize: 12, color: TEXT_SECONDARY }}>上传证书到 certs/ 目录</Text>
          <div style={{ marginTop: 10 }}>
            <input ref={certInputRef} type="file" style={{ display: 'none' }} accept=".crt,.pem" onChange={handleCertFileChange} />
            <input ref={keyInputRef} type="file" style={{ display: 'none' }} accept=".key,.pem" onChange={handleKeyFileChange} />
            <input ref={caInputRef} type="file" style={{ display: 'none' }} accept=".crt,.pem" onChange={handleCaFileChange} />

            {/* CA 证书：新机器部署后 certs/ 为空时必须先补上，否则设备连不上 mTLS */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Button size="small" icon={<UploadOutlined />} onClick={() => caInputRef.current?.click()}>
                选择 ca.crt
              </Button>
              {uploadCaName ? (
                <span style={{ fontSize: 12, color: SUCCESS, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircleFilled /> {uploadCaName}
                </span>
              ) : caReady ? (
                <span style={{ fontSize: 12, color: SUCCESS, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircleFilled /> 服务端已有 CA，无需重复上传
                </span>
              ) : (
                <span style={{ fontSize: 12, color: '#faad14', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CloseCircleFilled /> 服务端缺少 ca.crt，请上传（否则设备无法连接）
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Button size="small" icon={<UploadOutlined />} onClick={() => certInputRef.current?.click()}>
                选择 .crt
              </Button>
              {uploadCertName ? (
                <span style={{ fontSize: 12, color: SUCCESS, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircleFilled /> {uploadCertName}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: TEXT_MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CloseCircleFilled /> 未选择
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Button size="small" icon={<UploadOutlined />} onClick={() => keyInputRef.current?.click()}>
                选择 .key
              </Button>
              {uploadKeyName ? (
                <span style={{ fontSize: 12, color: SUCCESS, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircleFilled /> {uploadKeyName}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: TEXT_MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CloseCircleFilled /> 未选择
                </span>
              )}
            </div>

            <Spin spinning={uploading}>
              <Button
                type="primary" size="small" ghost
                disabled={!uploadCa && !(uploadCert && uploadKey)}
                onClick={handleUpload}
              >
                上传到证书目录
              </Button>
            </Spin>
          </div>
        </div>
      )}

      <Divider style={{ margin: '0 0 16px' }} />

      {/* MQTT 配置 */}
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="MQTT 连接地址" style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="mqttHost" noStyle initialValue={DEFAULT_HOST} rules={[{ required: true }]}>
              <Input style={{ width: '75%' }} placeholder="MQTT Host" />
            </Form.Item>
            <Form.Item name="mqttPort" noStyle initialValue={DEFAULT_PORT} rules={[{ required: true }]}>
              <Input style={{ width: '25%' }} placeholder="Port" type="number" />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item
          name="sn"
          label="设备 SN（选填）"
          style={{ marginBottom: 0 }}
          extra="设备状态上报的 sn 字段，对应余量表 device_code；不填默认取设备 ID 末段。填过的值按设备记忆，下次自动带出"
        >
          <Input
            placeholder={selectedId ? `不填默认：${selectedId.split('-').pop()}` : '不填默认取设备 ID 末段'}
            allowClear
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
