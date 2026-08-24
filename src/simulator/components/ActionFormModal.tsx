import React, { useState, useEffect } from 'react'
import { Modal, Form, Select, Input, InputNumber, Button, Space, Divider, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ActionConfig } from '../config/deviceTypes'

interface Pump {
  pump: number
  colorCode: string
  gram: number
}

interface Props {
  open: boolean
  action: ActionConfig | null
  deviceId: string
  onClose: () => void
}

export const ActionFormModal: React.FC<Props> = ({ open, action, deviceId, onClose }) => {
  const [form] = Form.useForm()
  const [pumps, setPumps] = useState<Pump[]>([
    { pump: 1, colorCode: '33/0', gram: 66.7 },
    { pump: 2, colorCode: '0/00', gram: 133.3 },
    { pump: 3, colorCode: 'H2O2', gram: 20.0 }
  ])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open && action) {
      // 设置默认值
      const defaults: Record<string, unknown> = {}
      for (const param of action.params ?? []) {
        if (param.defaultValue !== undefined) {
          defaults[param.name] = param.defaultValue
        }
      }
      // 下料任务自动生成 taskId 和 orderId
      if (action.action === 'dispense') {
        defaults.taskId = `task-${Date.now()}`
        defaults.orderId = Date.now()
        defaults.formulaName = '测试配方'
      }
      // 校准任务自动生成 taskId
      if (action.action === 'calibrate_start') {
        defaults.taskId = `calib-${Date.now()}`
      }
      // 换料任务自动生成 taskId，容量默认 450
      if (action.action === 'refill_start') {
        defaults.taskId = `refill-${Date.now()}`
        defaults.capacity = 450
      }
      form.setFieldsValue(defaults)
    }
  }, [open, action, form])

  async function handleSubmit() {
    if (!action) return
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const bizData: Record<string, unknown> = { ...values }

    // 如果有泵配置，加入 bizData
    if (action.params?.some((p) => p.type === 'pumps')) {
      bizData.pumps = pumps
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/simapi/devices/${deviceId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.action, bizData })
      })
      const data = await res.json()
      if (data.success) {
        message.success(`指令「${action.label}」已发送`)
        onClose()
        form.resetFields()
      } else {
        message.error(data.message)
      }
    } catch {
      message.error('请求失败')
    } finally {
      setSubmitting(false)
    }
  }

  function addPump() {
    setPumps((prev) => [
      ...prev,
      { pump: prev.length + 1, colorCode: '', gram: 0 }
    ])
  }

  function removePump(index: number) {
    setPumps((prev) => prev.filter((_, i) => i !== index).map((p, i) => ({ ...p, pump: i + 1 })))
  }

  function updatePump(index: number, field: keyof Pump, value: string | number) {
    setPumps((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    )
  }

  if (!action) return null

  const hasPumps = action.params?.some((p) => p.type === 'pumps')

  return (
    <Modal
      title={`${action.label}`}
      open={open}
      onCancel={() => { onClose(); form.resetFields() }}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="发送指令"
      cancelText="取消"
      width={540}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        {action.params
          ?.filter((p) => p.type !== 'pumps')
          .map((param) => (
            <Form.Item
              key={param.name}
              name={param.name}
              label={param.label}
              rules={param.required ? [{ required: true, message: `请填写${param.label}` }] : []}
            >
              {param.type === 'select' ? (
                <Select options={param.options} />
              ) : param.type === 'number' ? (
                <InputNumber style={{ width: '100%' }} />
              ) : (
                <Input />
              )}
            </Form.Item>
          ))}

        {hasPumps && (
          <>
            <Divider>泵配置</Divider>
            {pumps.map((pump, index) => (
              <Space key={`pump-${index}`} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                <InputNumber
                  size="small"
                  value={pump.pump}
                  min={1}
                  max={8}
                  addonBefore="泵"
                  style={{ width: 80 }}
                  onChange={(v) => updatePump(index, 'pump', v ?? 1)}
                />
                <Input
                  size="small"
                  value={pump.colorCode}
                  placeholder="颜色编码"
                  style={{ width: 120 }}
                  onChange={(e) => updatePump(index, 'colorCode', e.target.value)}
                />
                <InputNumber
                  size="small"
                  value={pump.gram}
                  min={0}
                  step={0.1}
                  addonAfter="g"
                  style={{ width: 110 }}
                  onChange={(v) => updatePump(index, 'gram', v ?? 0)}
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  size="small"
                  onClick={() => removePump(index)}
                />
              </Space>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={addPump}
              size="small"
              block
            >
              添加泵
            </Button>
          </>
        )}
      </Form>
    </Modal>
  )
}
