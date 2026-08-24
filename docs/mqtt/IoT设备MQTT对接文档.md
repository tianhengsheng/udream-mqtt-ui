# IoT 设备 MQTT 对接文档

> 来源：飞书文档 <https://icnin6j82fax.feishu.cn/docx/WntQdaQq2oAVOGxCag0cYK3wnSc>（作者：盛天珩、冯英玮）
> 本地同步时间：2026-08-04。**飞书为唯一权威原件**，本文件是代码对齐用的本地镜像；
> 修改对接协议时须两边同步：先改飞书 → 同步本文件 → 同步模拟器/后端代码。
>
> 变更记录：2026-08-04 余量管理改增量用量模型（sync_remain.remain=本次用量、get_remain 废弃、refill_done 云端刷满）；
> 同日补充：sync_remain 中 `remain<=0` 的管子云端忽略（设备可全量上报 8 管）。
> 2026-08-24：四代染色仪 OTA 改**拉取式**——设备每天定时发 `get_ota_info`（规范 4.6 req/resp）拉取双芯片（P4/C5）固件信息，不再接收 `ota/notify` 推送；见染色仪「OTA升级」章节。

---

# 通用规范

## 一、概述

所有设备通过 MQTT 与云端 EMQX 建立长连接，实现指令下发与状态上报。

新增设备类型只需新增业务章节，通用规范不变。

## 二、连接与认证

### 2.1 连接

| 环境 | 地址 |
|---|---|
| dev（联调） | device-dev.51yxm.com:8085 |
| test（测试） | device-test.51yxm.com:8085 |
| test2（测试2） | device-test2.51yxm.com:8085 |
| uat（验收） | device-uat.51yxm.com:8085 |
| prod（生产） | 待补充 |
| 协议 | MQTT mTLS（双向 TLS） |
| QoS | 1（至少一次送达） |

#### 2.1.1 认证方式

采用 mTLS 双向证书认证，无需用户名/密码。

EMQX 通过设备证书的 CN 字段识别设备身份，CN 必须与 `{deviceId}` 完全一致。

每台设备需持有三个文件：

- `{deviceId}.crt`（设备证书）
- `{deviceId}.key`（私钥）
- `ca.crt`（平台统一下发）

#### 2.1.2 连接参数（MQTT）

```bash
host     = device-dev.51yxm.com
port     = 8085
clientId = {deviceId}
tls      = 启用双向 mTLS
cert     = device-{deviceId}.crt
key      = device-{deviceId}.key
cafile   = ca.crt
```

### 2.2 设备 ID 规范

格式示例：`{deviceId} = "dm04-000123"`

> **重要**：设备 ID 必须与设备证书 CN 字段完全一致。

格式：`{typeCode}{gen}-{serial}`

- typeCode：2位小写字母，见 typeCode 注册表
- gen：2位数字，硬件代次，无代次差异的设备固定填 01
- serial：6位数字，全平台自增，由平台在签发证书时分配

合法示例：`dm04-000123`
非法示例：`device-001`（缺少 typeCode）/ `04-device-1`（格式混乱）

## 三、统一主题结构

主题格式：`device/{deviceType}/{action}/{deviceId}`

- 状态上报（设备发布）：`device/{deviceType}/status/{deviceId}`
- 指令下发（设备订阅）：`device/{deviceType}/cmd/{deviceId}`
- 指令响应（设备发布）：`device/{deviceType}/cmdresp/{deviceId}`
- 异步事件（设备发布）：`device/{deviceType}/event/{deviceId}`
- OTA 任务下发（设备订阅）：`device/{deviceType}/ota/notify/{deviceId}`
- OTA 进度上报（设备发布）：`device/{deviceType}/ota/progress/{deviceId}`
- 请求主题（设备发布）：`device/{deviceType}/req/{deviceId}`
- 响应主题（设备订阅）：`device/{deviceType}/resp/{deviceId}`

## 四、通用消息格式

### 4.1 指令下发（云端 → 设备）

bizData 为各设备业务扩展字段，见各设备章节。

```json
// 指令：云端 -> 设备
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "start",
  "timestamp": 1762934314537,
  "bizData": {}  // 扩展字段，见设备章节
}
```

### 4.2 指令响应（设备 → 云端）

收到指令后 5 秒内必须响应，超时直接返回 opStatus: 2，不执行指令。

```json
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "ack": "received",
  "opStatus": 0, // 0=成功 1=失败 2=超时(5s未返回) 3=设备忙(正在执行中)
  "message": "可选错误信息"
}
```

注意：

- 幂等性：消息可能重发，需要对消息进行幂等处理 cmdId
- 设备须维护近 N 条（建议 50 条）已处理 cmdId 的缓存，收到重复 cmdId 时直接返回上次的 opStatus，不重复执行。缓存可在重启后清空（云端有超时机制兜底）。

### 4.3 状态上报（设备 → 云端）

连接后立即全量上报；隔固定时间上报一次；

```json
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "timestamp": 1762934314537,
  "status": 0,
  "firmwareVersion": "v1.2.3",
  "osVersion": "Android 11",
  "sn": "SN987654321",
  "wifiName": "SalonWiFi",
  "bizData": {} // 扩展字段，见设备章节
}
```

status（number）：0=空闲 1=运行 2=暂停
设备总体状态。当设备业务字段中任一 `*State`（如 makeState/calibState/refillState）为 BUSY 时，status 必须为 1。

### 4.4 事件上报（设备 → 云端）

用于设备主动推送长时异步操作的过程事件（如下料进度、异常告警等），不受 5 秒限制。eventType 与 bizData 由各设备章节定义。

```json
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "task-20260408-001",
  "eventType": "dispense_progress",
  "timestamp": 1762934314537,
  "bizData": {} // 扩展字段，见设备章节
}
```

### 4.5 OTA 升级（推送式）

> 适用范围：洗头床等旧协议设备。**四代染色仪已改拉取式 OTA**（get_ota_info，见染色仪业务章节），不使用本节推送。

OTA 任务通知（云端 → 设备）：云端主动推送，设备收到后自行下载安装。

```json
{
  "taskId": "ota-20260408-001",
  "targetVersion": "v1.3.0",
  "currentVersion": "v1.2.3",
  "url": "https://cdn.xxx.com/firmware/v1.3.0.bin",
  "md5": "abc123def456",
  "size": 2097152,
  "timestamp": 1762934314537
}
```

OTA 进度上报（设备 → 云端）：每个阶段上报一次。

```json
{
  "taskId": "ota-20260408-001",
  "step": "downloading",
          /*
            notified=收到通知  downloading=下载中
            installing=安装中 rebooting=重启中
            success=成功  failed=失败
          */
  "progress": 75,
  "message": "可选错误描述",
  "timestamp": 1762934314537
}
```

设备端处理逻辑：

- 收到通知后比对 currentVersion，若与本机版本一致则忽略
- 下载完成后校验 md5，不一致则上报 failed
- 每个阶段均需上报进度，任意步骤失败须上报 failed + message

### 4.6 请求响应（设备 → 云端 → 设备）

用于设备主动向云端拉取配置/数据（如启动时拉取业务参数、配方清单、授权信息等）。请求-响应通过 reqId 关联，成对出现。

- 请求主题（设备发布）：`device/{deviceType}/req/{deviceId}`
- 响应主题（设备订阅）：`device/{deviceType}/resp/{deviceId}`

请求（设备 → 云端）：

```json
{
  "reqId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "get_config",
  "timestamp": 1762934314537,
  "bizData": {}
}
```

响应（云端 → 设备）：

```json
{
  "reqId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "opStatus": 0,
  "message": "可选错误信息",
  "timestamp": 1762934314537,
  "bizData": {}
}
```

字段说明：

- reqId：由设备生成（UUID），云端必须原样返回，用于匹配响应。
- action：由各设备章节定义（如 get_config / get_formula 等），bizData 结构随 action 变化。
- opStatus：0=成功 1=失败 2=超时(5s未返回) 3=未授权/无权限。

注意事项：

- 设备端 5s 未收到响应可重试，重试复用同一 reqId；云端对 reqId 做幂等缓存，重复请求返回上次结果。
- 设备收到重复响应仅处理一次（按 reqId 去重）。
- 请求-响应场景不适用于异步长耗时操作，长耗时应改用 event 主题推送过程事件。

### 4.7 主动查询状态（云端 → 设备）

云端可通过 get_status 指令主动触发设备立即上报一次完整状态，常用于：

- 收到异常事件（如 dispense_warn / dispense_fail / calibrate_fail / refill_fail）后，立即拉取设备最新状态确认现场情况
- 网络抖动恢复后强制对账，避免依赖下一次定时上报
- 后台运维/调试场景

指令（云端 → 设备）：

设备订阅：`device/{deviceType}/cmd/{deviceId}`

```json
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "get_status",
  "timestamp": 1762934314537,
  "bizData": {}
}
```

指令响应（设备 → 云端，5s 内必须响应）：

设备发布：`device/{deviceType}/cmdresp/{deviceId}`

```json
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "ack": "received",
  "opStatus": 0,
  "message": ""
}
```

设备处理逻辑：

- 收到指令后，除返回 cmdresp 外，必须立即在 `device/{deviceType}/status/{deviceId}` 主题发布一次完整 status（格式与 §4.3 定时上报完全一致）。
- 该指令不替代周期性上报，定时上报照常进行。
- 该指令为只读查询，不会改变设备业务状态；处于 BUSY 时也应正常响应（不返回 opStatus: 3）。

## 五、注意事项

1. 证书 CN 必须与 deviceId 完全一致，否则 EMQX 拒绝连接。
2. 私钥（.key）严禁外传，仅存于设备本地安全区域。
3. 设备须保持 NTP 时间同步，超时判断依赖 timestamp 字段。
4. cmdId 在响应中必须原样返回，用于云端指令追踪。
5. event 主题仅用于设备主动推送的异步过程事件，不得用于替代 cmdresp。

---

# 设备业务

---

## 四代染色仪（dyemachine）

deviceType：`dyemachine`

主题一览（设备ID = dm04-000123）：

| 用途 | 主题 | 方向 |
|---|---|---|
| 接收指令 | device/dyemachine/cmd/dm04-000123 | 订阅 |
| 响应指令 | device/dyemachine/cmdresp/dm04-000123 | 发布 |
| 状态上报 | device/dyemachine/status/dm04-000123 | 发布 |
| 异步事件 | device/dyemachine/event/dm04-000123 | 发布 |
| 接收OTA任务 | device/dyemachine/ota/notify/dm04-000123 | 订阅 |
| 上报OTA进度 | device/dyemachine/ota/progress/dm04-000123 | 发布 |
| 请求主题 | device/dyemachine/req/dm04-000123 | 发布 |
| 响应主题 | device/dyemachine/resp/dm04-000123 | 订阅 |

---

### 状态上报

设备发布：`device/dyemachine/status/{deviceId}`

设备状态上报，每 n 秒上报云端（设备 -> 云端）

```json
{
  "deviceId": "dm04-000123", // 设备id
  "deviceType": "dyemachine", // 设备类型
  "timestamp": 1762934314537,
  "status": 0, // status：0=空闲 1=运行（任一长耗时操作进行中）
  "firmwareVersion": "v1.2.3",
  "osVersion": "Android 11",
  "sn": "SN987654321",  // 蓝牙编号（重要）
  "wifiName": "SalonWiFi",
  "bizData": {
    "makeState": "IDLE",  // 打料状态：IDLE=空闲 / BUSY=执行中（对应底层 make_state）
    "calibState": "IDLE", // 校准状态：IDLE=空闲 / BUSY=执行中（对应底层 calib_state）
    "refillState": "IDLE",// 换料状态：IDLE=空闲 / BUSY=执行中
    "orderId": 1776160131180, // 业务订单id,number类型
    "pumps": [
        {
           "pump": 1, // 泵编号 1~8
           "colorCode": "33/0",   // 颜色编码，双氧固定为 "H2O2"
           "gram": 67 // 目标克重，下料克重（g，整数）
        },
        {"pump": 2, "colorCode": "0/00",  "gram": 133},
        {"pump": 3, "colorCode": "H2O2",  "gram": 20}
    ]
  }
}
```

### 查询状态

云端可通过 get_status 指令主动触发设备立即上报一次完整状态。

设备订阅：`device/{deviceType}/cmd/{deviceId}`

```json
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "get_status",
  "timestamp": 1762934314537,
  "bizData": {}
}
```

指令响应（设备 → 云端，5s 内必须响应）：

设备发布：`device/{deviceType}/cmdresp/{deviceId}`

```json
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "ack": "received",
  "opStatus": 0,
  "message": ""
}
```

---

### 下料（MAKE）

#### 指令（action）

云端下达下料指令（云端 -> 设备 -> 云端）

设备订阅：`device/dyemachine/cmd/{deviceId}`

```json
// 1、指令：dispense
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "dispense",  // 下料指令
  "timestamp": 1762934314537,
  "bizData": {  //指令参数
    "taskId": "task-20260408-001",
    "orderId": 1776160131180,
    "formulaName": "日系棕7",
    "pumps": [
      {"pump": 1, "colorCode": "33/0",  "gram": 67}, // gram 下料克数（整数）
      {"pump": 2, "colorCode": "0/00",  "gram": 133},
      {"pump": 3, "colorCode": "H2O2",  "gram": 20}
    ]
  }
}

// 2、指令：dispense_cancel
{
  "cmdId": "xxx",
  "action": "dispense_cancel",  // 取消指令
  "timestamp": 1762934314537,
  "bizData": {"taskId": "task-20260408-001"}  //指令参数
}

// 3、指令：dispense_continue
{
  "cmdId": "xxx",
  "action": "dispense_continue", // 继续指令
  "timestamp": 1762934314537,
  "bizData": {"taskId": "task-20260408-001"} //指令参数
}
```

设备发送：`device/dyemachine/cmdresp/{deviceId}`

```json
// 收到指令后 5 秒内必须响应，超时直接返回 opStatus: 2
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "ack": "received",
  "opStatus": 0,
  "message": "可选错误信息"
}
```

#### 事件（event）

设备发布：`device/dyemachine/event/{deviceId}`

下料过程中事件上报（设备 -> 云端）

```json
// 1、事件：dispense_progress | 触发时机：克重每变化 ≥ 1g 上报一次（事件驱动，非定时）
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "task-20260408-001",
  "eventType": "dispense_progress", // 打料过程事件
  "timestamp": 1762934314537,
  "bizData": {
    "orderId": 1776160131180,
    "pump": 1,
    "colorCode": "33/0",
    "currentGram": 33,
    "targetGram": 67
  }
}

// 2、事件：dispense_done
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "task-20260408-001",
  "eventType": "dispense_done",  // 打料完成事件
  "timestamp": 1762934314537,
  "bizData": {
    "orderId": 1776160131180,
    "pumps": [
      // targetGram 目标g， actualGram 实际g（整数）
      {"pump": 1, "colorCode": "33/0",  "targetGram": 67,  "actualGram": 67},
      {"pump": 2, "colorCode": "0/00",  "targetGram": 133, "actualGram": 133},
      {"pump": 3, "colorCode": "H2O2",  "targetGram": 20,  "actualGram": 20}
    ]
  }
}

// 3、事件：dispense_warn
// 触发时机：异常发生时立即上报；若异常持续，设备每 3s 重发一次（云端需按 taskId+warnCode 去重）
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "task-20260408-001",
  "eventType": "dispense_warn", // 打料异常事件
  "timestamp": 1762934314537,
  "bizData": {
    "orderId": 1776160131180,
    "pump": 1,            // 触发异常的泵编号（缺料场景必填）
    "warnCode": 110       // 104=缺料(可换料续接) / 110=料碗被移走(可放回续接) / 111=超重警报
  }
}

// 4、事件：dispense_fail
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "task-20260408-001",
  "eventType": "dispense_fail", // 打料失败
  "timestamp": 1762934314537,
  "bizData": {
    "orderId": 1776160131180,
    "message": "xxx异常，xxx"
  }
}
```

#### 交互流程

```text
云端  → cmd(action: dispense, 含配方)
设备  → cmdresp(opStatus: 0, 确认收到)
设备  → event(dispense_progress × N，每变化 ≥ 1g 一次)
         ↓ 正常完成
设备  → event(dispense_done，含实际克重)
         ↓ 异常：缺料或料碗移走
设备  → event(dispense_warn, warnCode: 104/110)
云端  → cmd(action: dispense_continue 或 dispense_cancel)
设备  → event(dispense_progress 继续... 或 dispense_fail)
```

### 余量管理（REMAIN）

> **协议变更（2026-08）**：由绝对余量模型改为**增量用量模型**——
> `sync_remain` 的 `remain` 字段从"本地扣减后的绝对余量(g)"改为"**本次使用了多少(g)**"；
> 设备**不再拉取余量**（get_remain 废弃）；换料完成由 `refill_done` 事件驱动**云端自动刷满**。

余量由**云端维护**：设备只上报每次的使用克数（增量），云端在库存值上扣减落库。

每罐满载初始容量 initCapacity = 450g，云端据此计算余量占比。

#### 触发时机

| 场景 | 设备动作 | action |
|---|---|---|
| 单泵停转、一次下料任务结束 | 上报相关泵本次使用克数 | sync_remain |
| 换料完成 | 无（云端收到 refill_done 事件后自动刷满该泵） | — |

#### 上报用量 sync_remain（下料结束后）

泵停转、下料任务结束后，设备把各泵本次使用的克数上报云端。bizData.pumps[] 仅含 {pump, remain} 两个字段，**remain = 本次使用量(g)**（字段名沿用 remain，语义已变更）。

设备发布：`device/dyemachine/req/{deviceId}`

```json
// 请求：sync_remain 上报用量
{
  "reqId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "sync_remain",
  "timestamp": 1762934314537,
  "bizData": {
    "pumps": [
      {"pump": 1, "remain": 67},   // remain 本次使用量(g)，增量
      {"pump": 2, "remain": 133},
      {"pump": 3, "remain": 20}
    ]
  }
}
```

设备订阅：`device/dyemachine/resp/{deviceId}`

```json
// 云端返回 opStatus=0 才算同步成功
{
  "reqId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "opStatus": 0,
  "message": "ok",
  "timestamp": 1762934314537,
  "bizData": {}
}
```

#### 一致性规则

1. 增量上报：remain 是本次消耗的克数，云端做 `余量 = max(0, 余量 - remain)` 扣减，不覆盖。
   **本次未消耗的管子可以不报，也可以报 `remain: 0`——云端对 `remain<=0` 一律忽略**（不扣减、
   不更新该管的同步时间）。设备端全量上报 8 个管或只报有消耗的管，两种做法云端结果一致。
2. reqId 幂等：设备 5s 重试复用同一 reqId + QoS1 重复投递都会造成同一报文重复到达；协议要求云端按 reqId 幂等缓存、重复请求返回上次结果。**当前云端暂未实现**（DeviceReqService TODO），重复投递存在重复扣减风险，暂接受。
3. 收到 resp 才算成功：sync_remain 必须收到云端 opStatus=0 的 resp 才算同步成功；5s 未收到可重试，重试复用同一 reqId。
4. 乱序容忍：增量满足交换律，乱序到达照常扣减不丢弃；外层 timestamp 仅用于推进 last_sync_time 展示。

#### 换料刷满（云端驱动）

设备换料完成上报 `event(refill_done)` 后，云端直接把该泵余量刷满（以云端满载容量为基准），设备**不再**补发 sync_remain 满载值。刷满是幂等操作，事件重复投递安全。

#### 生命周期流程

```text
                    ↓ 下料消耗
下料任务结束       → req(sync_remain，上报各泵本次用量)
云端              → resp(opStatus: 0，扣减落库成功)
                    ↓ 余量不足 → 换料
换料完成          → event(refill_done)
云端              → 收到 refill_done 自动把该泵余量刷满（无需设备再上报）
```

#### [已废弃] 拉取余量 get_remain

旧协议中设备上电通过 `get_remain` 拉取绝对余量恢复本地。增量模型下设备不再维护绝对余量，本流程废弃；云端只读查询分支暂保留给旧固件/调试，勿新增依赖。

---

### 校准（CALIBRATE）

用于电子秤砑码校准。完整流程：去皮 → 放置 20g 砑码 → 放置 50g 砑码 → 放置 200g 砑码 → 完成。

校准期间设备 status 与 bizData.calibState 进入 BUSY，期间拒绝下料/换料指令。

#### 指令（action）

云端下达校准指令（云端 -> 设备 -> 云端）

设备订阅：`device/dyemachine/cmd/{deviceId}`

```json
// 1、指令：calibrate_start 启动校准
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "calibrate_start",
  "timestamp": 1762934314537,
  "bizData": {
    "taskId": "calib-20260408-001"
  }
}

// 2、指令：calibrate_cancel 取消校准
{
  "cmdId": "xxx",
  "action": "calibrate_cancel",
  "timestamp": 1762934314537,
  "bizData": {"taskId": "calib-20260408-001"}
}
```

设备发送：`device/dyemachine/cmdresp/{deviceId}`

```json
// 收到指令后 5 秒内必须响应，超时直接返回 opStatus: 2
// 若设备处于打料中(makeState=BUSY)或已在校准中(calibState=BUSY)，应返回 opStatus: 3
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "ack": "received",
  "opStatus": 0,
  "message": "可选错误信息"
}
```

#### 事件（event）

设备发布：`device/dyemachine/event/{deviceId}`

校准过程事件上报（设备 -> 云端）

```json
// 1、事件：calibrate_progress | 触发时机：每个校准阶段完成时上报一次
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "calib-20260408-001",
  "eventType": "calibrate_progress",
  "timestamp": 1762934314537,
  "bizData": {
    "step": "tare",       // tare=去皮(201) / weight_20g=放20g(202) / weight_50g=放50g(203) / weight_200g=放200g(204)
    "stepCode": 201,      // 与底层协议 code 一一对应：201/202/203/204
    "message": "去皮完成，请放置 20g 砑码"
  }
}

// 2、事件：calibrate_done | 校准完成（对应底层 code 205）
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "calib-20260408-001",
  "eventType": "calibrate_done",
  "timestamp": 1762934314537,
  "bizData": {}
}

// 3、事件：calibrate_fail | 校准失败（砑码偏差超限、传感器故障等）
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "calib-20260408-001",
  "eventType": "calibrate_fail",
  "timestamp": 1762934314537,
  "bizData": {
    "step": "weight_50g",
    "message": "砑码读数偏差过大，请重新放置"
  }
}
```

#### 交互流程

```text
云端  → cmd(action: calibrate_start)
设备  → cmdresp(opStatus: 0, 确认收到)
设备  → event(calibrate_progress, step: tare,        stepCode: 201)
设备  → event(calibrate_progress, step: weight_20g,  stepCode: 202)
设备  → event(calibrate_progress, step: weight_50g,  stepCode: 203)
设备  → event(calibrate_progress, step: weight_200g, stepCode: 204)
         ↓ 正常完成
设备  → event(calibrate_done)
         ↓ 任意阶段异常
设备  → event(calibrate_fail)
         ↓ 用户主动取消
云端  → cmd(action: calibrate_cancel)
设备  → cmdresp(opStatus: 0)
```

---

### 换料（REFILL）

用于更换某泵物料。包含三步：排空旧料 → 注入新料 → 排空气。完成后设备更新本机 colorCode 并上报 refill_done；云端收到 refill_done 后自动把该泵余量刷满（设备不再补发 sync_remain）。

#### 指令（action）

云端下达换料指令（云端 -> 设备 -> 云端）

设备订阅：`device/dyemachine/cmd/{deviceId}`

```json
// 1、指令：refill_start 启动换料
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "action": "refill_start",
  "timestamp": 1762934314537,
  "bizData": {
    "taskId": "refill-20260408-001",
    "pump": 1,
    "colorCode": "33/0",
    "capacity": 450
  }
}

// 2、指令：refill_cancel 取消换料（仅在排空气阶段前可取消）
{
  "cmdId": "xxx",
  "action": "refill_cancel",
  "timestamp": 1762934314537,
  "bizData": {"taskId": "refill-20260408-001"}
}
```

设备发送：`device/dyemachine/cmdresp/{deviceId}`

```json
// 收到指令后 5 秒内必须响应，超时直接返回 opStatus: 2
// 若设备处于打料/校准中，应返回 opStatus: 3
{
  "cmdId": "2ef56c26-0b76-434a-bb6b-b13c9db4615b",
  "ack": "received",
  "opStatus": 0,
  "message": "可选错误信息"
}
```

#### 事件（event）

设备发布：`device/dyemachine/event/{deviceId}`

换料过程事件上报（设备 -> 云端）

```json
// 1、事件：refill_progress | 触发时机：每个阶段开始时及阶段内每 5% 进度上报一次
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "refill-20260408-001",
  "eventType": "refill_progress",
  "timestamp": 1762934314537,
  "bizData": {
    "pump": 1,
    "step": "purge",     // purge=排空旧料 / fill=注入新料 / vent=排空气
    "progress": 50
  }
}

// 2、事件：refill_done 换料完成
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "refill-20260408-001",
  "eventType": "refill_done",
  "timestamp": 1762934314537,
  "bizData": {
    "pump": 1,
    "colorCode": "33/0",
    "remain": 450
  }
}

// 3、事件：refill_fail 换料失败
{
  "deviceId": "dm04-000123",
  "deviceType": "dyemachine",
  "taskId": "refill-20260408-001",
  "eventType": "refill_fail",
  "timestamp": 1762934314537,
  "bizData": {
    "pump": 1,
    "step": "fill",
    "message": "新料瓶未检测到，请确认安装"
  }
}
```

#### 交互流程

```text
云端  → cmd(action: refill_start, 含 pump/colorCode/capacity)
设备  → cmdresp(opStatus: 0, 确认收到)
设备  → event(refill_progress, step: purge,  progress: 0..100)
设备  → event(refill_progress, step: fill,   progress: 0..100)
设备  → event(refill_progress, step: vent,   progress: 0..100)
         ↓ 正常完成
设备  → event(refill_done, 含新 colorCode/remain)
云端  → 收到 refill_done 自动刷满该泵余量（设备无需再 sync_remain）
         ↓ 异常
设备  → event(refill_fail)
         ↓ 用户主动取消
云端  → cmd(action: refill_cancel)
```

---

### OTA升级（拉取式）

> **协议变更（2026-08-24）**：四代机 OTA 由推送式（ota/notify）改为**拉取式**——
> 设备每天在合适时间主动发 `get_ota_info` 请求（规范 4.6 req/resp），云端返回当前上架的
> 最新固件信息，设备自行比对版本决定是否下载升级。不再订阅 `ota/notify`。

> 主题（复用规范 4.6）：
> `device/dyemachine/req/{deviceId}`（发布，QoS 1，retain 0）
> `device/dyemachine/resp/{deviceId}`（订阅，QoS 1，retain 0）

#### 拉取固件信息 get_ota_info

`bizData.targets` 指定要拉取的芯片固件，取值 `esp32c5` / `esp32p4` 的任意子集；
缺省（不传或空数组）返回两颗芯片。

> 版本号约定：四代机 P4/C5 **成对发布共用一个版本号**（2026-08-24 定稿），响应里
> `p4.version` 与 `c5.version` 值相同；协议形态保留各自 version 字段，为将来独立迭代留口。

```json
// 请求（设备 → 云端）
{
  "reqId": "550e8400-e29b-41d4-a716-446655440000",
  "action": "get_ota_info",
  "timestamp": 1787508000000,
  "bizData": {
    "targets": ["esp32c5", "esp32p4"]
  }
}
```

```json
// 响应（云端 → 设备）：targets 请求哪颗芯片就回哪颗
{
  "reqId": "550e8400-e29b-41d4-a716-446655440000",
  "opStatus": 0,
  "message": "ok",
  "timestamp": 1787508000500,
  "bizData": {
    "p4": {
      "version": "v0.2.0",
      "url": "https://oss.example.com/dm04-P4/p4.bin",
      "md5": "fedcba9876543210fedcba9876543210",
      "size": 3145728
    },
    "c5": {
      "version": "v0.2.0",
      "url": "https://oss.example.com/dm04-C5/c5.bin",
      "md5": "0123456789abcdef0123456789abcdef",
      "size": 1855952
    }
  }
}
```

#### 设备端处理逻辑

- 每天定时（建议凌晨低峰随机打散）发一次 `get_ota_info`；5s 未收到 resp 可重试（复用同一 reqId）。
- 收到响应后逐芯片比对 version，与本机一致则忽略该芯片。
- 下载完成后校验 md5（有值才校验），不一致则丢弃不刷写。
- **无更新的表达**：云端无上架固件时返回 `opStatus=0` + 空 `bizData`，设备视为无更新。

#### 云端数据源

固件由 PC 端「设备固件升级管理」维护（`dye_firmware_upgrade`，model=4 且已上架的最新一条）：
主字段 = P4（主控）包、`sub_*` 字段 = C5 包，四代机新增时两包必填。
本期拉取式升级不写升级记录（`dye_ota_upgrade_record`），设备如仍上报 `ota/progress`
将因无匹配记录被云端丢弃（warn 日志）。

---

# 其他

### 1、证书申请

向平台提供 `{deviceId}`，平台执行以下命令签发（有效期 10 年）：

```bash
DEVICE_ID="dm04-000123"
# 第一步：生成设备私钥
openssl genpkey -algorithm RSA -out ${DEVICE_ID}.key -pkeyopt rsa_keygen_bits:2048
# 第二步：生成证书申请（CN 必须等于 deviceId）
openssl req -new -key ${DEVICE_ID}.key -out ${DEVICE_ID}.csr -subj "/CN=${DEVICE_ID}"
# 第三步：由 CA 签发设备证书（有效期 10 年）
openssl x509 -req -in ${DEVICE_ID}.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out ${DEVICE_ID}.crt -days 3650 -sha256
```

### 2、根证书文件 ca.crt

```text
-----BEGIN CERTIFICATE-----
MIIFBzCCAu+gAwIBAgIUdfdThZAtBkQ8kQ3RL+SgqcRFmlMwDQYJKoZIhvcNAQEL
BQAwEzERMA8GA1UEAwwITXlJb1QtQ0EwHhcNMjUxMTExMDg1MjQyWhcNMzUxMTA5
MDg1MjQyWjATMREwDwYDVQQDDAhNeUlvVC1DQTCCAiIwDQYJKoZIhvcNAQEBBQAD
ggIPADCCAgoCggIBANBzvfYDsjeOdVPGBnW8suUcL+MBQj+G+MgmHk4ftOdjmcqp
hsAWITx/tVnxVrWHuXZcTNN699Jby7RIaWCYeojCguAtUrrJAmEJJtecZqfgNkW1
Y/8BMEPu0WcCgqq36RgIiBA1Lq6F3W5NnVzTOzSz0Fyar3VbKDQP1Zuf6oez44Kd
KaAGUIYPNG7s1bMRQvMuLSTkcSpPmHS7hb/xmbBiU2gvfguCAxJlC1sL9rcI9C0r
FGR0l/dWQg5IPl+vbjle4wibmD5FGshX1Kqw8rhH7S81MXfVnBv4/u1eGGvzPbE1
4h7nVGtb6/B0VC21Anwa4KDRQbyAdk/fg/nNmebDrPzBfyfUavUDa2Esxhp/8aPu
hVJKD5/KbeFfeiwSwHCehnTLvvxpfhgwc4jMF4dHMt64kNYGePfLqlXy38mAHXqe
ie2ZQDrdrKLnCGS5KkNkuHm8HwD4rchRKyeGUZ8qrN4O00IARRzUFLv5uIFoKAQR
Irgreu5tnPQ2d5dW6CxekqnZbr5UD768OpW8kDBMXfnYOeL2AopL7gSvqQtOwzwb
CtiLuMzTmeai1LNy39cfXRqWW6MDaigFdve9PjefhUypZMK8SQVLJLl6+uiTrnoX
1M0NgUyX1tdjwxxsrNmBJHqMSW9OvuYJjBtp3fJpujz+wIny0dPmnHAM6CDfAgMB
AAGjUzBRMB0GA1UdDgQWBBTPTabo2GtCn5rLcf64JUMbi/EpmDAfBgNVHSMEGDAW
gBTPTabo2GtCn5rLcf64JUMbi/EpmDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3
DQEBCwUAA4ICAQCH9Yuk4Wc8IyAc8a2zHQwGx3ZFDJ0w8qrKF+yk0m9CO0yMWAMu
DAMeQkHgWGi9UEwfjiczTXJLx+SHjfsfIOjXG6/XyUKhhPWa4xp4ic0PVKK8v0El
9VgPRbQFvwsCJrjm6OPs7VRO7y6fZ7dNQQIIhgaG7K9tv4eZwafLcCvvX5u4Hs4Z
HhZqzda9LtVOS3MAtUsZgXue1JcHHPjwrrKTkVR2Qe8K2gGxpdJKgkzxVDm2kAxZ
b3MBIHTNw8xKHoZ00h1LwNAU00b+UqJmeYMjOn7chxiU7GDuHORyxI5c8ZW8VnzB
UeX6YW7a5eM8M317PvORdg9JrUCZNWEn4za5it80n/f8UGp0grBEKv9IHeG/KUT8
Fjd7AcKekzrJdhTEBBFr6p5h0Pl/fG0PdiClIL20ZebVRCD/wW1cKaS2CVj4YX6n
0KuwfBEmr8VKxTtNsyPgr+a5VxB/vt4BaWHf8VbjwxUT+wSXlZ50dJTVA3sKmQQb
lOPTA35VJh3oLFK3NSnTS2jfxAjqKsF5BPrOnCTIE39ELVV4IKuWdArPIlL2IP9F
+/hCFp8Jjl1KbXlsraHhRy4joSlJzFLMvuSoaKv6JRJvdii1P/9RQgt0gd58xhD5
z8XIgbHhi9KwBgt5eU0j95awPAYnv7/uJnwlX3GIz4QqSHlWuRPpZsBtJQ==
-----END CERTIFICATE-----
```
