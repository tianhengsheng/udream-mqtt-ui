# CLAUDE.md

MQTT/IoT 设备联调自测工具（dev-only，配合后端 monorepo udream-micro-service 的 dye/washbed 等设备域联调）。
脚手架（环境切换 / 双端 token / 测试钩子）复刻自 udream-scanbuy-ui，设备模拟器来自
`dye/dye-service/src/main/resources/mqtt/device-web-react`。

## 测试工作法

做任何 UI 测试前先读 [test-playbook.md](test-playbook.md)，按其「四步工作法」执行：
钩子 `window.__t` 组合原子操作 + 文本断言 + DB 核验，只在终态/失败时截图。

## 同步规则（强制）

新增/修改页面交互时，必须同步：
1. 无文案交互元素加 `data-testid`（命名 `页.动作`，如 `sim.connect-{deviceId}`）；有文案元素靠 `__t.click(文本)` 定位，不必加。
2. test-playbook.md 对应页面小节（§2 原子操作、§1.3 新坑、顶部「最后同步」日期）。
3. 涉及新表/新状态时补 §4 DB 核验 SQL 模板。

## 项目约定

- **两个进程**：前端 vite 端口 **8080**（test/newdev 网关跨域白名单只登记了 localhost:8080，勿改端口；与扫码购 UI dev 不能同开，scanbuy 有 autoPort 会让位），设备模拟器后端 sim-server 端口 **3001**；`npm run dev` 用
  concurrently 一起起（`npm run dev:web` / `npm run dev:sim` 可单起）。sim-server 用 tsx watch 热重载。
  注意 dye-service 里的老模拟器 device-web-react 也占 3001，二者不能同时跑；必要时用
  `SIM_PORT=3002 npm run dev:sim` 换端口（同时要改 vite.config.ts 的 proxy target）。
- **前端到 sim-server 一律走 vite proxy**，不直连 3001：`/simapi/**` → `http://localhost:3001/api/**`、
  `/simws` → `ws://localhost:3001/ws`。新增模拟器接口继续用 `/simapi/xxx` 相对路径。
- **加页面 = App.tsx `PAGES` 数组加一行**（key/client/label/Comp[/hidden]），client 决定发哪端 token；
  切页时 `setClientMode` 必须先于 `setPage`（同步切端，否则新页首个请求带上一个端的 token）。
  `client: 'device'` = 设备端/无端页（设备模拟器、控制面板），菜单打灰色「设备」Tag，
  切进去**不调 setClientMode**（不挂 token，保持上一个业务端）。
- **控制面板不在本项目实现**：它是 dye-service 部署的静态页
  （后端 `dye/dye-service/src/main/resources/mqtt/control-panel.html` → 运行时 `:20016/tools/control-panel.html`），
  要对外直接暴露给别人访问测试。本项目只有 `src/pages/ControlPanelPage.tsx` 做 iframe 嵌入 +
  按环境记住面板地址（localStorage `mqtt-panel-url-{envKey}`）。**不要再把它 React 化搬进来。**
- **环境预设 src/envs.ts**：所有环境 catch-all 根路径，仅老 franchise 控制器 override '/mgt'；
  新增接口默认即根路由，勿反向加 /mgt。改 envs.ts 后须重启 vite（proxy 是启动期注册的）。
- **账号分桶 src/store/useSession.ts**：桶键 = `env.group ?? env`，local+dev 共享 devShared 桶；
  账号按端（pc/app/mini）各占一个激活槽位，id = `${mode}:${uid}`。
- 19 位雪花 id 一律字符串传递（`bigIntSafeParse`），DB 查询 `CAST(id AS CHAR)`。
- **类型文件别混**：`src/types.ts` = 后端接口公共类型（Resp/PageResp…）；
  `src/simulator/types.ts` = 模拟器前后端共享类型（DeviceInstance/WsMessage…，sim-server 也 import 它）。

## 设备模拟器（src/simulator + sim-server）

- **协议以对接文档为准**：[docs/mqtt/IoT设备MQTT对接文档.md](docs/mqtt/IoT设备MQTT对接文档.md)
  （飞书原件 docx/WntQdaQq2oAVOGxCag0cYK3wnSc 的本地镜像）。模拟器/面板代码按它对齐编写；
  **改文档必须同步改代码**（先改飞书 → 同步本地 md → 同步代码），反之协议行为变更也要回写文档。
- 浏览器建不了 TCP TLS，MQTT mTLS 连接由 sim-server（Node）建；前端只通过 REST + WebSocket 驱动它。
- 默认 broker `device-dev.51yxm.com:8085`（mqtts，QoS 1，mTLS 双向证书，CN = deviceId）。
- Topic：`device/{deviceType}/{cmd|cmdresp|status|event|ota/notify|ota/progress}/{deviceId}`。
- 设备 ID 格式 `{typeCode}{gen}-{serial}`：洗头床 `wb`=washbed，四代染色仪 `dm`=dyemachine。
- **证书放 `certs/`**（`{deviceId}.crt` + `{deviceId}.key`，ca.crt 已内置）。sim-server 启动时扫描该目录并
  fs.watch 热更新；也可在「添加设备」弹窗里上传。CA 私钥 `ca.key` 放项目根目录才能自动签发，**不提交**。
- 添加设备的「设备 SN」按 deviceId 记忆在 localStorage（`mqtt-sim-sn-{deviceId}`），sn 对应余量表 `device_code`。
- 新增设备类型：`src/simulator/config/deviceTypes.ts` 加 `DEVICE_TYPE_CONFIGS` 条目
  （actions / statusFields / defaultBizData），再在 `sim-server/deviceManager.ts` 的 executeAction 与
  状态模拟里加对应处理。

## 校验命令

```bash
npx tsc -b                                # 前端类型
npx tsc -p tsconfig.server.json --noEmit  # sim-server 类型
```
