import type { DeviceType, WashbedBizData, DyemachineBizData } from '../types'

export interface ActionParamField {
  name: string
  label: string
  type: 'select' | 'number' | 'text' | 'pumps'
  options?: { label: string; value: number | string }[]
  defaultValue?: number | string
  required?: boolean
}

export interface ActionConfig {
  action: string
  label: string
  danger?: boolean
  /** 依赖 bizData 字段显示/隐藏 */
  showWhen?: (bizData: Record<string, unknown>) => boolean
  params?: ActionParamField[]
}

export interface StatusFieldConfig {
  key: string
  label: string
  unit?: string
  format?: (v: unknown) => string
}

export interface DeviceTypeConfig {
  deviceType: DeviceType
  displayName: string
  typeCode: string
  actions: ActionConfig[]
  statusFields: StatusFieldConfig[]
  defaultBizData: WashbedBizData | DyemachineBizData
}

const washModeMap: Record<number, string> = {
  0: '男士速洗',
  1: '女士速洗',
  2: '洗护模式',
  3: '养护模式',
  4: '消毒模式'
}
const screenMap: Record<number, string> = { 0: '锁屏', 1: '解屏' }
const pressureMap: Record<number, string> = { 1: '1档', 2: '2档', 3: '3档', 4: '4档' }

export const DEVICE_TYPE_CONFIGS: Record<DeviceType, DeviceTypeConfig> = {
  washbed: {
    deviceType: 'washbed',
    displayName: '洗头床',
    typeCode: 'wb',
    actions: [
      {
        action: 'start',
        label: '启动',
        params: [
          {
            name: 'model',
            label: '洗头模式',
            type: 'select',
            options: [
              { label: '男士速洗', value: 0 },
              { label: '女士速洗', value: 1 },
              { label: '洗护模式', value: 2 },
              { label: '养护模式', value: 3 },
              { label: '消毒模式', value: 4 }
            ],
            defaultValue: 0
          },
          {
            name: 'waterPressure',
            label: '水压强度',
            type: 'select',
            options: [
              { label: '1档', value: 1 },
              { label: '2档', value: 2 },
              { label: '3档', value: 3 },
              { label: '4档', value: 4 }
            ],
            defaultValue: 1
          },
          {
            name: 'waterTemperature',
            label: '设置水温(°C)',
            type: 'number',
            defaultValue: 38
          }
        ]
      },
      { action: 'stop', label: '停止', danger: true },
      {
        action: 'screen_on',
        label: '亮屏',
        showWhen: (b) => b.screenOn === 0
      },
      {
        action: 'screen_off',
        label: '息屏',
        showWhen: (b) => b.screenOn === 1
      },
      { action: 'get_status', label: '查询状态' }
    ],
    statusFields: [
      { key: 'waterTemperature', label: '水温', unit: '°C' },
      { key: 'washCount', label: '洗头次数', unit: '次' },
      { key: 'waterLevel', label: '水位' },
      { key: 'executionProgress', label: '执行步骤' },
      { key: 'washMode', label: '模式', format: (v) => washModeMap[v as number] ?? String(v) },
      { key: 'screenOn', label: '屏幕', format: (v) => screenMap[v as number] ?? String(v) },
      { key: 'waterPressure', label: '水压', format: (v) => pressureMap[v as number] ?? String(v) }
    ],
    defaultBizData: {
      waterTemperature: 38,
      washCount: 0,
      waterLevel: 'normal',
      executionProgress: 0,
      washMode: 0,
      screenOn: 1,
      waterPressure: 1
    } as WashbedBizData
  },

  dyemachine: {
    deviceType: 'dyemachine',
    displayName: '四代染色仪',
    typeCode: 'dm',
    actions: [
      {
        action: 'dispense',
        label: '下料',
        showWhen: (b) => b.makeState === 'IDLE',
        params: [
          { name: 'taskId', label: '任务ID', type: 'text', required: true },
          { name: 'orderId', label: '订单号', type: 'text', required: true },
          { name: 'formulaName', label: '配方名称', type: 'text' },
          { name: 'pumps', label: '配方', type: 'pumps', required: true }
        ]
      },
      {
        action: 'dispense_continue',
        label: '继续下料',
        showWhen: (b) => b.makeState === 'BUSY'
      },
      {
        action: 'dispense_cancel',
        label: '取消下料',
        danger: true,
        showWhen: (b) => b.makeState === 'BUSY'
      },
      {
        action: 'calibrate_start',
        label: '开始校准',
        showWhen: (b) => b.makeState === 'IDLE' && b.calibState === 'IDLE',
        params: [
          { name: 'taskId', label: '任务ID', type: 'text', required: true }
        ]
      },
      {
        action: 'calibrate_cancel',
        label: '取消校准',
        danger: true,
        showWhen: (b) => b.calibState === 'BUSY'
      },
      {
        action: 'refill_start',
        label: '开始换料',
        showWhen: (b) => b.makeState === 'IDLE' && b.calibState === 'IDLE' && b.refillState === 'IDLE',
        params: [
          { name: 'taskId', label: '任务ID', type: 'text', required: true },
          { name: 'pump', label: '泵号', type: 'number', required: true },
          { name: 'colorCode', label: '新颜色编码', type: 'text', required: true },
          { name: 'capacity', label: '满载容量(g)', type: 'number' }
        ]
      },
      {
        action: 'refill_cancel',
        label: '取消换料',
        danger: true,
        showWhen: (b) => b.refillState === 'BUSY'
      },
      { action: 'get_status', label: '查询状态' }
    ],
    statusFields: [
      {
        key: 'makeState',
        label: '打料状态',
        format: (v) => (v === 'BUSY' ? '执行中' : '空闲')
      },
      {
        key: 'calibState',
        label: '校准状态',
        format: (v) => (v === 'BUSY' ? '执行中' : '空闲')
      },
      {
        key: 'refillState',
        label: '换料状态',
        format: (v) => (v === 'BUSY' ? '执行中' : '空闲')
      },
      { key: 'orderId', label: '当前订单' }
    ],
    defaultBizData: {
      makeState: 'IDLE',
      calibState: 'IDLE',
      refillState: 'IDLE',
      orderId: 0,
      pumps: []
    } as DyemachineBizData
  }
}

export function getDeviceTypeConfig(deviceType: DeviceType): DeviceTypeConfig {
  return DEVICE_TYPE_CONFIGS[deviceType]
}

export const DEVICE_TYPE_OPTIONS = Object.values(DEVICE_TYPE_CONFIGS).map((c) => ({
  label: c.displayName,
  value: c.deviceType
}))
