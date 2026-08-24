import { create } from 'zustand'
import type { CertDeviceInfo, DeviceInstance, LogEntry, WsMessage } from '../types'

interface DeviceStore {
  devices: DeviceInstance[]
  certDevices: CertDeviceInfo[]
  selectedDeviceId: string | null
  logPanelOpen: boolean
  wsConnected: boolean
  /** 是否收到过首帧设备列表：用于区分「页面初始加载」与「真的新增了设备」（见 setDevices 的自动选中） */
  listInitialized: boolean

  // actions
  setDevices: (devices: Omit<DeviceInstance, 'logs'>[]) => void
  updateDevice: (deviceId: string, data: Partial<Omit<DeviceInstance, 'logs'>>) => void
  appendLog: (deviceId: string, entry: LogEntry) => void
  removeDevice: (deviceId: string) => void
  selectDevice: (deviceId: string | null) => void
  toggleLogPanel: () => void
  setWsConnected: (v: boolean) => void
  handleWsMessage: (msg: WsMessage) => void
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: [],
  certDevices: [],
  selectedDeviceId: null,
  logPanelOpen: false,
  wsConnected: false,
  listInitialized: false,

  setDevices(snapshots) {
    set((state) => {
      // 保留已有设备的 logs，合并新快照
      const logMap = new Map(state.devices.map((d) => [d.deviceId, d.logs]))
      const devices: DeviceInstance[] = snapshots.map((s) => ({
        ...s,
        logs: logMap.get(s.deviceId) ?? []
      }))

      // 日志面板自动选中，省掉「加完设备还得再去下拉里选一次」：
      //   新增设备 → 选中它并展开面板；首帧列表 / 选中项已不在 → 兜底选第一个（不强制展开面板）
      const prevIds = new Set(state.devices.map((d) => d.deviceId))
      const added = state.listInitialized ? devices.find((d) => !prevIds.has(d.deviceId)) : undefined
      const selectedStillThere = devices.some((d) => d.deviceId === state.selectedDeviceId)

      let selectedDeviceId = state.selectedDeviceId
      let logPanelOpen = state.logPanelOpen
      if (added) {
        selectedDeviceId = added.deviceId
        logPanelOpen = true
      } else if (!selectedStillThere) {
        selectedDeviceId = devices[0]?.deviceId ?? null
      }

      return { devices, selectedDeviceId, logPanelOpen, listInitialized: true }
    })
  },

  updateDevice(deviceId, data) {
    set((state) => ({
      devices: state.devices.map((d) =>
        d.deviceId === deviceId ? { ...d, ...data } : d
      )
    }))
  },

  appendLog(deviceId, entry) {
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.deviceId !== deviceId) return d
        const logs = [...d.logs, entry]
        if (logs.length > 200) logs.shift()
        return { ...d, logs }
      })
    }))
  },

  removeDevice(deviceId) {
    set((state) => {
      const devices = state.devices.filter((d) => d.deviceId !== deviceId)
      // 移除的正是当前选中项 → 顺延到剩余第一个（而不是退回「请选择设备」再让人手动选）
      const selectedDeviceId =
        state.selectedDeviceId === deviceId
          ? devices[0]?.deviceId ?? null
          : state.selectedDeviceId
      return { devices, selectedDeviceId }
    })
  },

  selectDevice(deviceId) {
    set({ selectedDeviceId: deviceId })
    if (deviceId) {
      set({ logPanelOpen: true })
    }
  },

  toggleLogPanel() {
    set((s) => ({ logPanelOpen: !s.logPanelOpen }))
  },

  setWsConnected(v) {
    set({ wsConnected: v })
  },

  handleWsMessage(msg) {
    const { setDevices, updateDevice, appendLog, removeDevice } = get()
    switch (msg.type) {
      case 'device_list':
        setDevices(msg.devices)
        break
      case 'device_update':
        updateDevice(msg.deviceId, msg.data)
        break
      case 'log':
        appendLog(msg.deviceId, msg.entry)
        break
      case 'device_removed':
        removeDevice(msg.deviceId)
        break
      case 'cert_devices_update':
        set({ certDevices: msg.devices })
        break
    }
  }
}))
