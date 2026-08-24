import type { DeviceType } from '../../src/simulator/types.js'
import type { DeviceHandler } from './types.js'
import { WashbedHandler } from './washbed.js'
import { DyemachineHandler } from './dyemachine.js'

/**
 * 设备类型 → Handler 注册表
 * 新增设备类型：新建 handler 文件，在此注册一行即可，无需改 deviceManager.ts
 */
export const deviceHandlers: Record<DeviceType, DeviceHandler> = {
  washbed: new WashbedHandler(),
  dyemachine: new DyemachineHandler()
}
