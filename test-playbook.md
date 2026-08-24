# MQTT/IoT 联调自测 UI 测试手册（test-playbook）

> AI/人工做 UI 测试的唯一入口。**新增/修改页面交互必须同步本文件**（规则见 CLAUDE.md）。
> 最后同步：2026-08-24（四代机拉取式 OTA：模拟器去推送式 OTA 加「拉取OTA」、新增固件升级管理(PC)页）｜
> 覆盖页面：设备模拟器 / 控制面板 / 设备列表(PC) / 调色记录(PC) / 换料记录(PC) / 洗头记录(PC) / 固件升级管理(PC) / 智染设备(App) / 下料(App)（+ 框架自检 hidden）

## 0. 四步工作法（每次测试照此执行，控制 token）

1. 读本文件相关小节（一次）。
2. 用 `window.__t` 钩子组合原子操作（javascript_tool 一次调用串多步），**文本断言**
   （`__t.state()` / `__t.toasts()` / `__t.read()`），不逐步截图。
3. mysql-dev 按 §4 SQL 模板核验数据（19 位 id 必须 `CAST(id AS CHAR)`）。
4. 仅流程终态截 1 张图存证；失败时才加截图排查。

## 1. 全局

### 1.1 `window.__t` 钩子（src/test/hooks.ts）

| 方法 | 说明 |
|---|---|
| `__t.nav(label)` | 按侧栏菜单文案跳页：'设备模拟器' / '控制面板'；'框架自检' 无菜单（hidden），走 `navigateByLabel` 兜底（返回 `via:'hidden-page'`） |
| `__t.click(sel)` | data-testid 或可见文本点击（自动归一 antd 中文按钮空格、自动上溯可点祖先） |
| `__t.type(sel, v)` | 普通输入框赋值（testid 或 placeholder 定位；React 受控兼容） |
| `await __t.otp(code)` | 逐格输入 maxlength=1 输入组 |
| `await __t.select(box, opt)` | antd Select：按框内文案定位→打开→(搜索)→选项 |
| `__t.state()` | {env, clientMode, user, page, modalText, tableRows} |
| `__t.read(kw, n)` | 抓含 kw 的最小可见文本块（短文案定位） |
| `__t.block(kw, minLen)` | 含 kw 且长度≥minLen 的块（防"只抓到标题"） |
| `__t.table(maxRows)` | PC 列表结构化 `[{列名:值}]` |
| `__t.rowClick(行关键词, 按钮)` | 表格行内点击（避免同名按钮命中错行） |
| `__t.desc()` | antd Descriptions 结构化 {label:value} |
| `__t.screen(n)` | 手机壳（PhoneFrame）整屏文本快照 + 浮层 |
| `__t.toasts(n)` | 最近 n 条 antd message 历史（toast 一闪即逝，靠它留档） |
| `await __t.sleep(ms)` | 步间等待 |

注入脚本模板（一次调用串多步）：
```js
(async () => {
  __t.nav('设备模拟器'); await __t.sleep(600);
  const r1 = __t.click('添加设备'); await __t.sleep(400);
  return JSON.stringify({ r1, state: __t.state(), toasts: __t.toasts() });
})()
```

### 1.2 环境与账号

- 环境切换：顶栏左侧按钮 → radio（'本地'=local / '开发-newdevi'=dev / '测试' / '测试-newdev'）。
  **local 与 dev 同库同 Redis、token 互通、账号共享一个桶（devShared）**；test/newdev 隔离。
- token 取法：
  ```js
  JSON.parse(localStorage.getItem('udream-mqtt-ui-session')).state.accountsByEnv.devShared
  ```
- 身份切换：跳页自动切端（PAGES 的 client 字段）；顶栏右侧可换账号。
  `client: 'device'`（设备模拟器 / 控制面板）是设备端页，**不切端、不发 token**，clientMode 保持上一个业务端。
- 注意：**设备模拟器页不需要登录态**（只跟本地 sim-server 说话），账号体系是给后续后端联调页用的。

### 1.3 已踩坑（操作前必读）

- 改 `src/envs.ts` 或 `vite.config.ts` 的 proxy 后必须重启 vite，热更新不生效。
- 模拟器页所有请求走 `/simapi`，**若返回 404/连接失败先确认 sim-server(3001) 起没起**
  （顶部「服务正常/连接中...」徽标就是 WebSocket 状态）。
- 控制面板是 **iframe 直连** dye-service 部署地址（不走 vite proxy、不走本 UI 的 token）；
  白屏先确认 dye-service 起没起：`curl -I localhost:20016/tools/control-panel.html`。
  面板内部的接口调用是它自己同源发的，与本 UI 的环境切换无关。
- **日志重复 = WS 连接泄漏**：模拟器搬进多页框架后，切页卸载时 `ws.onclose` 仍会排重连定时器，
  每切一次泄漏一条连接、服务端每条广播被重复入库 N 次。已用 `disposedRef` 修（useWebSocket.ts）；
  若日志又出现同秒重复条目，先 `lsof -nP -iTCP:3001 -sTCP:ESTABLISHED` 数连接数（正常 1 条）。
- 默认 SN 取 deviceId **末段**（`split('-').pop()`），不是后六位——5 位序列号会把连字符切进来
  （`dm04-test-00000` → 曾错成 `-00000`），这种 SN 永远匹配不上 `dye_device_cream.device_code`。
- **`__t.select` 打不开 antd 5.2x 下拉的两个原因**（已在 hooks.ts 修，但同类合成事件都得注意）：
  ① 内部 `input` 必须先 `focus()`，否则 selector 上的 mousedown 只拿焦点不开下拉；
  ② 事件必须含 `pointerdown`（只发 mousedown 无效）。另外**不可搜索的 Select 里那个 readOnly
  搜索框一旦写值，下拉会直接空掉** → 表现为 `option not found`，所以只有 `.ant-select-show-search` 才走搜索。
- **PC 页首屏可能要等 5s**：token 过期时 client.ts 会先静默续登再重发，`sleep(2500)` 会拍到空表
  （不是 bug）。PC 列表页断言统一 `await __t.sleep(5000)`。

## 2. 页面索引（原子操作）

### 2.1 设备模拟器（device，菜单'设备模拟器'）

> 待补：连接设备 / 触发指令 / 告警 / OTA / 余量同步 的原子操作串与断言点。

- 页面就绪判定：`__t.read('IoT 设备模拟器')` 有值，且顶部徽标为「服务正常」。
- 添加设备：`__t.click('添加设备')` → 弹窗内点设备 ID 行选中 → 可填「设备 SN」（按 deviceId 记忆）
  → `__t.click('连接设备')`。
- 日志面板：**在模拟器页内容区底部**（不是 fixed 满屏），点标题栏展开/收起。
  **设备会自动选中**，不用手动去下拉里选：新增设备→选中它并自动展开面板；
  进页/刷新→兜底选第一个（不展开）；移除当前选中设备→顺延到剩余第一个。
  断言用 `__t.read()` 抓行文本；一次 `查询状态` 应恰好产生 `指令 ↓ / 响应 ↑ / 状态 ↑` 各一条，
  出现同秒重复即 WS 泄漏（见 §1.3）。
- **模拟器页整体深色**（外层脚手架/控制面板页仍是浅色）：色板集中在 `src/simulator/theme.ts`，
  改色只改这一处，组件里禁止再硬编码。三级明度分层 `BG_PAGE #22272e` < `BG_CARD #2d333b` < `BG_SUBTLE #373e47`，
  层次靠明度差、边框只收边。深色算法由 SimulatorPage 那层 ConfigProvider 的 `theme.darkAlgorithm` 提供，
  并覆盖了 `colorBgBase/colorBgElevated` 等 token（否则 Modal/Select 下拉会是另一套偏黑的灰）。
- 设备卡片按**设备类型配色**（深色版）：四代染色仪=紫 `#b083f0`、洗头床=青 `#6cd8d0`
  （顶部色条/类型标签/状态区底色/卡片描边/指令按钮描边同色，离线退回中性灰）；
  查询类按钮保持中性，与下发指令的按钮区分。状态值为「执行中」时标 ACCENT 加粗 + 脉冲点。
- 设备卡片：**SN 是独立徽章**（等宽字体，点击复制），它就是 `dye_device_cream.device_code`；
  设备在跑时（`deviceStatus=1` 或任一 `*State` 非 IDLE）徽章加流光+脉冲、卡片透蓝光、右上角标签变「运行中」。
  断言运行态用 class：`document.querySelector('.sim-sn').className` 含 `sim-sn--running`。
- **SN 填错不会报错，只在下料完成时炸**：`sync_remain` 返回 `opStatus=1 sync remain failed`
  即 SN 在 `dye_device_cream` 里查无此 `device_code`（dev 可用的是 `0400000` / `0400001`，7 位）。
- **余量=增量用量模型（协议 2026-08 变更）**：`sync_remain` 的 `remain` 字段 = 本次使用克数，
  云端扣减落库（`weight -= remain`）；设备连接时**不再发 get_remain**（日志里出现即旧代码）；
  换料 `refill_done` 后**云端自动刷满**该泵（weight=total_weight、used=0），设备不补发 sync_remain。
  DB 断言：下料前后 `weight` 差 = dispense_done 各泵 actualGram 取整；换料后该泵 `weight=450, used_weight=0`。
  **remain<=0 的管子云端忽略**（不扣减、不推 last_sync_time）：设备可全量上报 8 管，没下料的报 0；
  全部为 0 时不写库但仍回 opStatus=0。DB 断言时别指望没下料的管有 update_time 变化。
  注意：服务端 reqId 幂等缓存**暂未实现**（DeviceReqService TODO），重发同一 reqId 会二次扣减——测试时别手动重发 sync_remain。
- **19 位 orderId 禁止 `Number()` 转型**（handlers/dyemachine.ts 已修）：dispense 指令 bizData 里的虚拟
  订单 id 是 19 位，转 Number 丢精度 → dispense_done 事件带错 orderId → 后端按 orderId 更新调色记录落空，
  整单状态永远停「等待中」。orderId 一律原样透传。
- **sim-server 是 tsx watch，改 handler 热重启会清空内存设备列表**：重启后要重新添加/连接设备
  （POST /simapi/devices，certs 在 certs/ 目录），否则「执行下料」反查不到在线设备。
- **推送式 OTA 已从模拟器移除（2026-08-24）**：卡片不再有「OTA 升级」按钮/进度条，sim-server 不订阅
  `ota/notify`、不上报 `ota/progress`。四代机 OTA 走拉取式：染色仪卡片新增「拉取OTA」按钮
  （`data-testid="sim.get-ota-info-{deviceId}"`），发 `req(get_ota_info, targets=[esp32c5,esp32p4])`，
  云端固件信息在日志面板「请求响应」类目里看 resp（bizData.p4/c5 各含 version/url/md5/size；
  无上架固件时 bizData 为空对象）。断言：`__t.read()` 抓日志行含 `get_ota_info`。
- 设备卡片其余操作（校准/换料）断言方式：待补。

### 2.2 控制面板（device，菜单'控制面板'）

> 面板本体是 dye-service 部署的静态页（后端仓库 `dye/dye-service/src/main/resources/mqtt/control-panel.html`，
> 运行时 `:20016/tools/control-panel.html`），**源码在后端仓库维护，本项目只做 iframe 统一入口**。
> 面板要对外直接给别人访问测试，所以不做 React 化。

- 就绪判定：`__t.read('面板由 dye-service 部署')` 有值（顶部说明 Alert，可关闭）。
- 地址栏：`__t.type('panel.url', 'http://localhost:20016/tools/control-panel.html')` →
  `__t.click('panel.load')` 加载并按环境记住（localStorage `mqtt-panel-url-{envKey}`）；
  `panel.open` 新窗口打开。local 默认已填本机地址，其他环境默认空。
- 地址为空 → 显示 Empty 引导；有地址 → iframe `panel.frame` 撑满内容区。
- **iframe 内的元素 `__t` 钩子够不到**（跨 document），面板内操作需切到面板自己的页面/新窗口里做。

### 2.3 设备列表（pc，菜单'设备列表'）

> 四代机管理端页。接口全在 `src/api/dye.ts`（后端 dye-service，前缀 `/mgtDye`）。
> **要 PC token**（切页自动切端）；dev 环境已有 `pc:1 管理员` 账号可直接用。

就绪判定：`__t.state().page === 'PC设备列表'` 且 `__t.table().rows.length > 0`。

> **默认筛选 = 设备类型「四代机(04)」**（`DEFAULT_FILTER`，本自测 UI 只关心四代机）：进页与「重置」
> 都停在它上面，dev 固定「共 4 条」；要看全量得手动清空设备类型再查询。
> **左侧固定列 = 序号/设备名称/MAC码**（`fixed:'left'`，共 316px）：横向滚动时 MAC码 常驻可见。
> antd 的 fixed:'left' 必须**从最左连续**，只固定 MAC码 会告警+错位，所以前两列被连带钉住。
> 断言固定生效：滚动后该单元格 className 含 `ant-table-cell-fix-left`。

| 原子操作 | 写法 | 断言点 |
|---|---|---|
| 进页 | `__t.nav('设备列表'); await __t.sleep(5000)` | 设备类型下拉显示「四代机(04)」，分页栏「共 4 条」（默认筛选生效） |
| 文本筛选 | `__t.type('deviceList.macCode','0400001')` → `__t.click('deviceList.query')` | 「共 1 条」，行 MAC 命中 |
| 下拉筛选 | 设备类型已默认四代机；换其它值 `await __t.select('四代机(04)','三代机(03)')` → 查询 | 条数随之变化 |
| 重置 | `__t.click('deviceList.reset')` | 其余条件清空，**设备类型回到「四代机(04)」**、条数回「共 4 条」（不是全量） |
| 翻页 | 点分页 `2` | 首行序号 = 21（序号 = (页-1)×页长 + 行号） |
| 更多筛选 | `__t.click('deviceList.filter-toggle')` | 多出「绑定状态/销售人/绑定时间」三项 |
| 导出 | `__t.click('deviceList.export')` | toast「导出文件已下载」（**真下载 xlsx**，见下） |
| 模板下载 | `deviceList.template` 的 href = `/设备导入模板.xls` | `fetch` 该地址返回 18944 字节 |
| 远程弹窗 | `__t.click('deviceList.remote-{macCode}')` | 标题「请谨慎使用远程控制」+ 5 个按钮 |
| 远程下发 | 弹窗内 `deviceList.remote-calibrate` | 请求体 `{code,type:1,operatorId,operatorName}`，toast「开始校准 指令已下发」 |
| 解绑确认框 | `__t.click('deviceList.unbind-{macCode}')` | 标题「回收设备」/ 文案「回收后设备状态变为未划拨，可二次划拨」/ 按钮「取消 确定」/ 图标 `anticon-question-circle` 且 `color === 'rgb(250, 173, 20)'` |
| 解绑执行 | `__t.click('unbindConfirm.ok')` → `sleep(6000)` | toast「设备 {mac} 已回收」；该行「划拨状态」变**未划拨**、店铺列空、操作列 testid 由 `unbind-` 变 `transfer-` |
| 打开划拨弹窗 | `__t.click('deviceList.transfer-{macCode}')` | 标题「划拨」；`transferModal.storeId/storeName/storeAddress` 三格均为 `-`；`transferModal.save` `disabled === true` |
| 门店搜索 | 见下方「划拨弹窗门店搜索」专用脚本 | 下拉出现「门店名称(门店ID)」选项 |
| 选中门店 | 点下拉里的选项 | 三格回填真实值、`save` 解除 disabled；**`storeId` 文本须与 DB 逐字相等**（19 位末位不能被 JS number 吃掉） |
| 划拨执行 | `__t.click('transferModal.save')` → `sleep(7000)` | toast「已划拨到「{门店名}」」、弹窗关闭、该行变**已划拨**且操作列回到 `unbind-` |

**划拨弹窗门店搜索**不能直接用 `__t.select`：它会把整个 optionText 一次性写进搜索框、且只等 400ms，
和本页 400ms 防抖 + 远程请求撞在一起必然 `option not found`。用局部关键词手动驱动：

```js
const setV = (i, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,v);
  i.dispatchEvent(new Event('input',{bubbles:true})); };
const box = document.querySelector('[data-testid="transferModal.search"]').closest('.ant-select');
box.querySelector('input').focus();
['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
  box.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,button:0,detail:1})));
await __t.sleep(300);
setV(box.querySelector('.ant-select-selection-search-input'), '光明');
await __t.sleep(2500);  // 400ms 防抖 + 网络，别压到 1s 以内
[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].map(o=>o.innerText);
```

- 门店搜索走 **base 服务** `/basics/store/getStoreListByFuzzyName`（`src/api/store.ts`），不是 `/mgtDye`；
  envs.ts 的 catch-all 根路由本来就能转发，**不用**为它加 serviceOverride。
- 后端是 `like(store_name, kw) OR eq(id, kw)`，**同一个 storeName 参数兼管名称模糊和 ID 精确**，
  所以搜 19 位门店 ID 也原样传 storeName 即可，别去找「按 ID 查」的接口（没有）。
- **下拉选项数 < 接口返回条数是正常的**：antd Select 用 rc-virtual-list 虚拟滚动，DOM 里只有可见的
  那 10~11 条（实测「光明」接口回 12、DOM 11）。断言条数要以接口为准，别按 DOM 计数判定丢数据。

- **`mark=true` 整行标红**（后端口径：同门店同型号 ≥2 台）。断言用计算样式而非截图：
  `getComputedStyle(tr).color === 'rgb(255, 77, 79)'`。
- **染膏容量列只有四代机有值**，其余显示 `-`；列内是「N口 + 最低 x%（按最差状态着色）」，
  明细（每口色号/克数/百分比 + 更新时间）在 hover Popover 里。合成事件要发
  `pointerover/mouseover/mouseenter` 才弹。
- **破坏性远程按钮（恢复出厂设置/关机/重启设备）带 Popconfirm 二次确认**（原型没有，是防误触加的）。
  测试时**不要真点确认**——验到 Popconfirm 文案「该操作会直接影响真实设备」就取消。
  安全操作只用「开始校准」，且挑测试门店的设备（dev 上 `0400000/0400001/0400015`
  属「光明大第工作室(测试)」）。
- **操作列按划拨状态二选一**：`transferStatus===1`→「解绑」(红 `#ff4d4f`) + 远程；
  `transferStatus===0`→「划拨」(蓝) + 远程；状态缺失时两个都不渲染，只留远程。
  断言优先用 testid 存在性（`deviceList.unbind-{mac}` vs `deviceList.transfer-{mac}`），比读文本稳。
- **解绑/划拨会真改 dev 数据，必须成对做完整回路**：先用列表 + DB 记下设备原属门店
  （`storeName` + `storeId`），解绑测完立刻用划拨绑回原店，不留脏状态。
  **`0400000` / `0400001` 是 MQTT 模拟器联调在用的，绝对不要动**（绑「光明大第工作室(测试)」
  `1474262550837915649`）；要测拿 `0469419`。
- **划拨不是「原地改绑」，后端每次都新插一条 `dye_device_store` 行**（DyeServiceImpl#transferDevice）：
  老行留成 `state=2`，新行 `device_name` 按「门店内第 N 台」重新生成（实测 `新美智染61号`→`62号`）。
  所以回路做完 **DB 会多一条历史行、设备名会 +1**，这是后端既有行为不是 bug；
  核验「已还原」只看**当前生效行（state=1）的 store_id 是否与原值逐字相等**。
- **染膏余量不会被解绑/划拨清掉**：四代机走 `createOrRebindDeviceCreamForFour`「余量跟随设备」原地改绑。
- **导入不要真传文件**（会污染 dev 数据）：只验 `.ant-upload input[type=file]` 的
  `accept === '.xls,.xlsx'`，FormData 字段名固定 `file`。

### 2.4 调色记录（pc，菜单'调色记录'）

> 下料流水管理端页（原型「调色记录」）。接口在 `src/api/dyeColorRecord.ts`
> （后端 dye-service `DyeOrderController`，前缀 `/mgtDye`）：
> 列表 `order/dye/getDyeRecord`、导出 `order/dye/exportDyeRecord`。
> **要 PC token**（切页自动切端）；dev 环境已有 `pc:1 管理员` 账号可直接用。
>
> 与「设备列表」的分工：那页是**设备维度**（一台设备一行），本页是**下料流水维度**
> （一次下料一行，dev 上 23 万+ 行），两者 VO 完全不同，别互相套用字段。

就绪判定：`__t.state().page === 'PC调色记录'` 且 `__t.table().rows.length > 0`。

表格 17 列（横向滚动 `scroll.x=1900`）：
序号 / 设备名称 / MAC码 / 设备类型 / 所属店铺 / 服务类型 / 所在城市 / 手艺人 / 下料类型 /
下料颜色 / 下料重量 / 物料1名称 / 物料2名称 / 物料3名称 / 下料时间 / 执行状态 / 提示

| 原子操作 | 写法 | 断言点 |
|---|---|---|
| 进页 | `__t.nav('调色记录'); await __t.sleep(5000)` | 分页栏「共 N 条」（dev 全量 **236427**，与 §4 SQL 逐字相等） |
| MAC 筛选 | `__t.type('dyeRecord.deviceCode','0400001')` → `__t.click('dyeRecord.query')` | 「共 33 条」，各行 MAC 命中（后端是 **like 模糊**，不是精确） |
| 店铺筛选 | `__t.type('dyeRecord.storeName','光明')` → 查询 | 「共 770 条」 |
| 执行状态 | `await __t.select('请选择执行状态','已完成')` → 查询 | 「共 164162 条」，状态列全是绿 Tag「已完成」 |
| 设备类型 | `await __t.select('请选择设备类型','四代机(04)')` → 查询 | 「共 42 条」 |
| 更多筛选 | `__t.click('dyeRecord.filter-toggle')` | 多出「下料时间」区间选择器（一级筛选没放，见下） |
| 下料时间 | 展开后选 2026-07-01 ~ 2026-07-31 → 查询 | 「共 3 条」，行时间全落在区间内 |
| 重置 | `__t.click('dyeRecord.reset')` | 条数回到 236427，输入框/下拉清空 |
| 翻页 | 点分页 `2` | 首行序号 = 21（序号 = (页-1)×页长 + 行号），与第 1 页 id 无重叠 |
| 导出 | `__t.click('dyeRecord.export')` | 窄筛选下 toast「导出文件已下载」（**真下载 xlsx**）；不加筛选 toast「导出数据需小于3万」 |

默认每页 20 条（`pageSizeOptions [10,20,50,100]`，带跳至）。

#### 必读坑

- **`counted` 不传 = 总数恒 0**。`DyeRecordReq extends PageReq`，而 `PageReq.counted` 默认 `false`，
  不统计总数时 `page.total` 直接回 0，「共 N 条」会显示成「共 0 条」。
  `fetchDyeRecordPage` 已强制 `{ counted: true, ...query }` 兜底，**改接口层时别把这行删了**。

- **执行状态只有 4 个可选，不是 6 个**。后端 `DyeConstant.DyeChangeStatus` 定义了 6 个
  （0 失败 / 11 等待中 / 12 执行中 / 13 待取走 / 20 已取消 / 21 已完成），但
  `DyeOrderServiceImpl#buildLambdaQuery` 里写死了 `.in(status, 0, 11, 20, 21)`——
  **12/13 被硬过滤，永远查不出来**（dev 上被挡掉 7106 行）。所以：
  - 筛选下拉 `STATUS_OPTIONS` 只给这 4 个（给 12/13 的话用户选了必然空列表，是假 bug）；
  - 渲染映射 `STATUS_LABEL` 仍保留 6 个，防将来后端放开过滤时列表显示成裸数字。

- **`connectionType` 实测有 `-1`，枚举里没有**。`dye_formula_color_record.connection_type` 的
  **建表默认值就是 -1**（= 未记录连接方式，老数据/回调没带该字段），dev 上约占 1/3。
  后端 `ConnectionType.getDesc(-1)` 返回 `Optional.empty()`，前端同口径渲染成 `-`。
  断言「下料类型」列时**别默认每行都是 WIFI**：0=WIFI、1=蓝牙、2=推送、其余(-1/null)=`-`。

- **时间筛选是开区间**：后端用 `gt(startTime)` / `lt(endTime)`，不是 ge/le；字段是 `LocalDateTime`，
  格式必须 `yyyy-MM-dd HH:mm:ss`（只传 `yyyy-MM-dd` 会被当 00:00:00）。
  页面 `toQuery` 已自动把结束日期补到 `23:59:59`，否则会整整漏掉结束当天的数据。

- **导出超 3 万条会被后端拒绝**。`exportDyeRecord` 把 `isPage` 置 false 全量查，
  `selectCount > 30000` 直接返回业务失败「导出数据需小于3万」。
  接口契约写的是 `Resp<Boolean>`，**实现却是把 xlsx 写进 response 流**，所以前端用 blob 收：
  命中二进制就下载，回 JSON（超限/报错）就把 `retMsg` 透出来。两种形态都要测。
  注意错误字段是 **`retMsg`** 不是 `retInfo`（与列表接口不同），取值链已兼容。

- **导出入参走 query string**（`@GetMapping` 且形参无 `@RequestBody`），与列表的 JSON body 不同；
  `exportDyeRecord` 里已把 `pageNum/pageSize/counted` 剔掉再拼参数。

- **19 位雪花 id 必须当字符串**：`id/storeId/employeeId` 走 `bigIntSafeParse` 兜底，
  `rowKey` 直接用 `r.id`。断言时用字符串比较，落 JS number 会丢末位。

- **dye-service 会抖**：实测中途整个服务 503 了约 10 秒（重启），列表和导出同时报
  `finishConnect(..) failed: Connection refused` / `Connection prematurely closed`（gateway code 999999）。
  **这不是页面 bug**，遇到先按 ≤3s 一轮轮询探活重试，别急着改代码。

#### SQL 核验（mysql-dev，库 `udream_dye`）

19 位 id 必须 `CAST(id AS CHAR)`，否则 MCP 返回时丢精度。

```sql
-- 列表全量总数（必须 == 页面「共 N 条」= 236427）
-- 口径：未删除 + 后端硬过滤的 status IN (0,11,20,21)
SELECT COUNT(*) FROM udream_dye.dye_formula_color_record
WHERE is_del = 0 AND status IN (0,11,20,21);

-- 被后端硬过滤掉的 12/13（dev 7106 行，页面上永远查不到，用来证明「不是漏数据」）
SELECT status, COUNT(*) FROM udream_dye.dye_formula_color_record
WHERE is_del = 0 AND status IN (12,13) GROUP BY status;

-- 单条行数据核对（按页面首行的 MAC + 下料时间取）
SELECT CAST(id AS CHAR) id, CAST(store_id AS CHAR) store_id, device_code, color_name,
       weight, execute_time, status, connection_type, model, execute_result
FROM udream_dye.dye_formula_color_record
WHERE is_del = 0 AND device_code = '0400001'
ORDER BY execute_time DESC LIMIT 5;

-- 下料类型分布（验证 -1 占比，别把 -1 当异常）
SELECT connection_type, COUNT(*) FROM udream_dye.dye_formula_color_record
WHERE is_del = 0 AND status IN (0,11,20,21) GROUP BY connection_type;
```

> 列表按 `execute_time DESC` 排序（后端 `orderByDesc(ExecuteTime)`），
> 断言首行时用同样的 ORDER BY，否则对不上。

### 2.5 换料记录（pc，菜单'换料记录'）

> 换料流水管理端页。接口在 `src/api/dyeChangeRecord.ts`（后端 dye-service `DyeOrderController`，
> 前缀 `/mgtDye`）：列表 `order/dye/dyeChangeRecordsStaff`、导出 `order/dye/exportDyeChangeRecordsStaff`。
> 与「调色记录」是姐妹页（同一个 Controller），VO 精简很多，只有 9 个字段。

就绪判定：`__t.state().page === 'PC换料记录'` 且分页栏「共 N 条」有值。

表格 9 列：序号 / 所属店铺 / 店铺类型 / MAC码 / 设备名称 / 设备类型 / 所在城市 / 换料状态 / 换料时间

| 原子操作 | 写法 | 断言点 |
|---|---|---|
| 进页 | `__t.nav('换料记录'); await __t.sleep(3000)` | 「共 N 条」（dev 实测 **69764**） |
| MAC 筛选 | `__t.type('dyeChange.macCode','0400001')` → `__t.click('dyeChange.search')` | 「共 2 条」（**后端 eq 精确匹配**，与调色记录的模糊匹配不同，别按同一口径断言） |
| 换料状态 | `await __t.select('请选择','等待中')` → 查询 | 「共 27907 条」 |
| 重置 | `__t.click('dyeChange.reset')` | 条数回到 69764 |
| 导出 | `__t.click('dyeChange.export')` | 有筛选直接导出；**无任何筛选会先弹二次确认**（`dyeChange.export-confirm`），因为后端会拉全量 |

注意本页按钮文案是**「搜索」**不是「查询」（和调色记录/设备列表不一致，是原型本身如此，勿改）；
本页**没有**漏斗「更多筛选」按钮，一级筛选（店铺/MAC/换料状态/换料时间/设备类型）已经是全部字段。

#### 必读坑

- **换料状态 6 个全能选，不像调色记录那样被硬过滤**。`DyeConstant.DyeChangeStatus`
  （dye-api `contants/DyeConstant.java:648`）定义 0-失败/11-等待中/12-执行中/13-待取走/20-已取消/21-已完成，
  `dyeChangeRecordsStaff` 的查询没有额外 `.in(status,...)` 硬编码过滤，6 个值都查得出数据。
- **门店三列（所属店铺/店铺类型/所在城市）默认全是 `-`**：这是**后端既有行为**，不是漏字段——
  实现里门店信息只在**传了 storeName 或 cityId 筛选**时才会反查填充，不传门店筛选时这三列必空。
  断言全量列表时不要因为这三列是 `-` 就当 bug 报。
- MAC 是 **eq 精确匹配**（不是 like），传半个 MAC 码查不出东西，和调色记录的模糊匹配口径不同。
- 换料时间筛选（`dyeChangeStartDate`/`dyeChangeEndDate`）比对的是 **create_time 的日期部分**，
  不是 `changeDate`（=`update_time`）——筛"换料时间"实际按创建时间过滤，是后端既有口径。
- 导出走 `GET` + query string、返回真 xlsx blob（非异步任务），与调色记录/设备列表页同一套路。

### 2.6 洗头记录（pc，菜单'洗头记录'）

> AI 洗头床记录管理端页。接口在 `src/api/dyeBedRecord.ts`（后端 dye-service `DyeBedRecordController`，
> **前缀 `/dye/apiUnified`，不是 `/mgtDye`**）：列表 `dyeBedRecord/pageDyeBedRecord`、
> 导出 `dyeBedRecord/excelDyeBedRecord`。
>
> **`/dye/apiUnified` 前缀未登记在后端 `.claude/conventions/api-route-naming.md`，但 dev 网关实测放行**
> （2026-08-04 验证：`共 63 条`能正常拉到），如果哪天这页突然 404/50xxx，先怀疑网关路由被收紧，
> 不是页面这边的问题。

就绪判定：`__t.state().page === 'PC洗头记录'` 且分页栏「共 N 条」有值。

表格 16 列：关联订单 / 设备名称 / MAC码 / 设备类型 / 所属店铺 / 店铺类型 / 所在城市 / 发型师 /
操作类型 / 操作项目 / 实际洗头时间 / 服务项目 / 过程水温 / 性别 / 操作时间 / 执行状态

| 原子操作 | 写法 | 断言点 |
|---|---|---|
| 进页 | `__t.nav('洗头记录'); await __t.sleep(3000)` | 「共 63 条」（dev 数据量不大） |
| MAC 筛选 | `__t.type('bedRecord.deviceCode','XTC00003')` → `__t.click('bedRecord.query')` | 「共 6 条」 |
| 更多筛选 | `__t.click('bedRecord.filter-toggle')` | 展开顾客名称 / 执行状态 / 设备类型三个二级筛选 |
| 导出 | `__t.click('bedRecord.export')` | 有数据下载 xlsx；无匹配数据时后端 `BizAssert`「暂无数据」，全局拦截器已提示 |

MAC码输入框 placeholder 是「请输入MAC码」——**原型截图上写的是「请输入门店名称」，那是原型自己的文案错误**，
本页按语义纠正了，不是实现漏看。

#### 必读坑

- **枚举来自 `dye-api/contants/DyeConstant.java`**：`Gender`(0未知/1男/2女)、
  `RinseType`(0男士速洗/1女士速洗/2洗护模式/3养护模式/4消毒模式，与设备模拟器的 washModeMap 同源)、
  `WaterPressure`(1~4档)、`BedStatus`(15已开始/30已完成/35手动终止/40异常结束)、
  `ConnectionType`(0wifi/1蓝牙/2推送)——五个枚举全部在源码里逐条核对过，不是猜的。
- **`bedStatus=10` 是脏数据**：dev 上 63 条里有 34 条 `bedStatus=10`（均 2026-04-29），
  这个值**不在任何分支的 BedStatus 枚举里**（现枚举「已开始」是 15，推断是枚举改值前的历史数据）。
  后端 `getDesc(10)` 返回空，前端按约定**原样显示数字 `10`**，断言时别把它当异常揪出来重映射。
- **dev 部署版本比这个分支新**：dev 的 VO/Req 实测多一个 `orderNo` 字段，「关联订单」列优先取
  `orderNo`，没有才回退 `orderId`（两个版本都兼容）。如果后续这个分支同步了后端新代码，
  留意 `orderNo` 是否已经进了这个分支的 VO，届时可以把 fallback 逻辑简化掉。
- 「设备名称」列 VO 里其实没有对应字段（不像调色/换料记录那样有 `deviceName`），
  借用 `modelName` 顶上（洗头记录里恒为「AI洗头床(XTC)」），与旁边「设备类型」列显示内容相同，
  是刻意的取舍不是 bug——原型截图这列显示的是字面「洗头床」三个字，无法从任何字段精确还原。
- 19 位 `orderId` 全程按字符串处理（`bigIntSafeParse` 兜底），断言别用 JS number 比较。

### 2.7 智染设备（app，菜单'智染设备'）

> 还原真实 App「智能烫染洗护 → 四代调色仪」：选门店 → 选设备 → 看染膏容量 → 去下料。
> 接口在 `src/api/dyeAppDevice.ts`（dye-service）。**要 App token**（切页自动切端），
> 门店取登录返回的默认门店（`useCraftsmanStore`，不调 getCraftsmanToStore）。
> 页面**浅色**，手机壳 = `PhoneFrame`，右侧控件栏 = `StoreResolveBar` + 调试信息卡。

就绪判定：`__t.state().page === '智染设备'` 且 `__t.read('选择设备')` 有值。

| 原子操作 | 写法 | 断言点 |
|---|---|---|
| 进页 | `__t.nav('智染设备'); await __t.sleep(3000)` | `__t.screen()` 含「四代调色仪 / 选择设备 / 染膏容量监控 / 去下料」 |
| 选门店 | `await __t.select('选择门店', '<门店名>')` | 调试卡「门店 storeId」变为该门店 id（19 位，逐字与 DB 相等） |
| 选设备 | `__t.click('appDevice.pick-0400001')` | 该卡片描边变蓝；容量区重新拉数、「更新于」刷新 |
| 记忆上次选择 | 选完刷新页面 | `localStorage['mqtt-app-dye-device-{storeId}'] === '0400001'`，进页自动选回它 |
| 刷新容量 | `__t.click('appDevice.refresh-capacity')` | 发出一次 creamCapacity 请求；「更新于」= 各槽位最大 last_sync_time |
| 整页刷新 | `__t.click('appDevice.refresh')` | 设备列表 + 容量各发一次请求 |
| 调试重查 | `appDevice.reload-devices` / `appDevice.reload-capacity` | 同上，用于不动 UI 单独重发某一个请求 |
| 去下料 | `__t.click('去下料')` | `localStorage['mqtt-app-selected-device']` = `{deviceCode,deviceName,storeId,dyeDeviceStoreId}`；跳「下料(App)」，未接入时 toast「已记录设备，「下料(App)」页尚未接入」 |
| 胶囊柱读数 | `__t.read('appDevice.pump-1')` 或 `document.querySelector('[data-testid="appDevice.pump-3"]').innerText` | 形如 `0%\n0/88\n3号\n阻断 0g` |

**接口契约（后端源码核实，两个接口入参都在 query string，不是 body）**

| 用途 | 方法 + 路径 | 入参 | 返回 |
|---|---|---|---|
| 设备列表 | `GET /apiDye/base/dye/queryDyeByModel` | `storeIds`（单数 Long，名字带 s 是历史遗留）、`model`（选填，四代机=4） | `Resp<List<DyeDeviceStore>>`，后端已过滤 state=已绑定、按 updateTime 倒序 |
| 容量监控 | `POST /dye/apiCraftsman/dyemachine/creamCapacity` | `macCode`（= MAC 码 = `dye_device_cream.device_code`）、`storeId` | `Resp<DyeCreamCapacityVO>`：`deviceCode / lastSyncTime / pumps[]` |

`pumps[]` 字段：`devicePort / name（染膏色号或双氧浓度）/ type(0染膏 1双氧) / weight / usedWeight /
totalWeight / proportion(0~1) / percent(0~100) / status(0正常 1预警≤45g 2阻断≤5g)`。
**没有 colorCode 字段**，色号就在 `name` 里。

### 已踩坑（本页）

- `queryDyeByModel` 的参数名是 **`storeIds`**，写成 `storeId` 后端收不到直接 400。
- `creamCapacity` 是 POST 但走 `@RequestParam`，**body 发过去后端读不到**，必须拼 query。
- `macCode` 是 MAC 码 / SN（如 `0400001`），**不是 MQTT 的 `deviceId`（dm04-xxxx）**，填错不报错、只回空 pumps。
- 后端查不到 `device_code + store_id` 的绑定行时**不报错**，返回 `pumps: [], lastSyncTime: null` ——
  UI 当「暂无余量数据」展示，别当异常排查。
- 8 个胶囊柱按 `devicePort` 1~8 归位；后端只回配置过的槽位，缺口补空位（显示 `-`）。
- dev 可用样本：门店 `1474262550837915649` 下有 4 台四代机（`0400001 / 0469419 / 0400000 / 0400015`），
  每台 8 个槽位（6 染膏 + 2 双氧 3%/12%）。

### 2.8 下料(App)（app，**无侧栏菜单**，从「智染设备」页点「去下料」进入）

> 四代机「直接组配方下料」页，**不做色板/颜色建议**：选管子颜色 + 克数 →（自动）几号管 → 保存 → 确认下料。
> 接口全在 `src/api/dyeAppColor.ts`（余量复用 `dyeAppDevice.ts#fetchCreamCapacity`）。
> 设备上下文来自「智染设备」页写的 localStorage `mqtt-app-selected-device`
> （`{deviceCode, deviceName, storeId, dyeDeviceStoreId?}`），没有时右侧控件栏可手输。
> 交互简化（2026-08-04）：几号管**自动预览**（配方变更 600ms 防抖，无预览按钮）；底部**单按钮
> 「确认下料」= 保存调色记录 + MQTT dispense 两步串行**（与真机 App 一致，一个按钮两个操作）；
> 先探模拟器有无同 SN 在线设备，探不到不落库（避免堆"等待中"死记录）；
> 下发后自动 3s 轮询到终态；右栏只留设备上下文兜底输入。

就绪判定：`__t.read('配方（管子颜色 + 克数）')` 有值（hidden 页 `__t.state().page` 为空，别拿它断言）。

| 原子操作 | 写法 | 断言点 |
|---|---|---|
| 进页 | 智染设备页选中设备后 `__t.click('去下料')`；或 `__t.nav('下料(App)')`（hidden 页 label 兜底） | 顶部卡片「SN xxx · 门店 xxx」 |
| 补设备上下文 | `__t.type('appDye.device-code','0400001')`、`__t.type('appDye.store-id','1474262550837915649')` | 「缺设备上下文」告警消失 |
| 选颜色 | `await __t.select('选择管子颜色','1号口')` | 行下方「1号口余量 xxg」；**~600ms 后「几号管下料」自动出现**「1号管33/0 30g」 |
| 改克数/加双氧 | `appDye.weight-0` / `appDye.hydrogen-toggle` + `select('双氧浓度','6%')` | 几号管区自动刷新（双氧 7/8 号管本地推算） |
| 确认下料（保存+驱动设备） | `__t.click('appDye.dispense')` → Popconfirm「确认下料」 | **一键两步**：先 savaOrUpdateColorRecordsV2 落库（手机内出「已保存 N 条 · 订单 xxx」），再按保存返回的 dyeColorRecordPort 组 pumps 下发 dispense，toast「已保存并向 dm04-xxx 下发 dispense」；deviceId 按 SN 自动反查模拟器在线设备（反查不到**直接不落库**并提示）；随后自动轮询，手机内 Alert 到「下料状态：已完成」自动停；设备页容量按管扣减 |
| 改配方使保存作废 | 下发后改任一行/克数/双氧 | 「已保存」行与状态消失（记录作废，重新确认下料会新存一单） |
| 跳模拟器 | `__t.click('appDye.goto-sim')`（右栏） | 进入设备模拟器页 |

data-testid 一览：`appDye.refresh` / `appDye.device-code` / `appDye.store-id` / `appDye.device-name` /
`appDye.goto-sim` / `appDye.color-{行号}` / `appDye.weight-{行号}` / `appDye.del-{行号}` / `appDye.add-row` /
`appDye.tag` / `appDye.hydrogen-toggle` / `appDye.hydrogen-name` / `appDye.hydrogen-weight` /
`appDye.dispense`（确认下料=保存+下发）。
（已移除：`appDye.preview`（自动预览）、`appDye.save`（并入确认下料）、`appDye.mqtt-device-id`（自动反查）、
`appDye.reload-consts` / `appDye.reload-capacity`（并入顶部刷新）、`appDye.poll-once` / `appDye.poll-auto`
（下发后自动轮询）、`appDye.execute-{记录id}`（并入底部「确认下料」）。）

### 已踩坑（本页专属，并入时抄进 §1.3）

- **「几号管」用的是 `getDyeColorRecordPortResult`，不是 `getDyeColorRecordPortName`**：后者入参
  `colorId`(色板 id) `@NotNull`、返回的 `DyeColorRecordPortNameVO` **压根没有 devicePort 字段**，
  拿不到管号；前者入参就是保存用的同一份 `List<DyeColorRecordsDTO>`。
- **预览只发染膏行**：后端 `getDyeColorRecordPortResult` 里染膏分支只 new 对象（只读），
  **双氧分支 `createHydrogenDyeColorRecord` 会真的 insert 一条 `dye_formula_color_record`**。
  所以页面把双氧的 7/8 号管按 `device_dioxygen_four` 配比在本地算（`previewHydrogenPorts`），
  预览零写库（实测预览 2 次后 `dye_formula_color_record` 增量为 0）。
- **执行下料=MQTT dispense 等价替代蓝牙（既定方案）**：真机 App 靠蓝牙把配方发给设备；自测 UI 的
  「执行下料」直接走 `POST /dye/apiCraftsman/dyemachine/op?deviceId=&action=dispense`。
  `executeColorRecord` 的老 zmg 通道实现整段被注释、必失败，页面已不用（api 函数保留备查）。
  执行目标 deviceId 按 SN 从 `/simapi/devices` 自动反查——**模拟器里没有同 SN 在线设备时会提示先去连一台**。
- **colorId 必须是 `dye_color_config.id`（19 位）**：后端 `getDyeConfigConstVO(model=4)` 用管子名
  （33/0 等）反查 `dye_color_config`（type=6 畅想模式、model_color_type=4）拿 id，**查不到时会退化成
  配置里的 1~8 小 id**；那种行保存时会被 `saveOrCreamDyeColorRecord` 静默丢弃（不报错，返回列表少一条）。
  页面已把 `colorId.length<=6` 的选项置灰，保存后也会比对条数弹「只落库 N 行」。
- **`getNewDyeColorRecordsStatus` 的 orderId 是 `@NotNull`**：自测没有真实订单，靠**保存返回里的
  orderId**（后端 `getVirtuallyOrderIdVO`：先按 storeId+employeeId 找进行中染发服务单，找不到就造虚拟
  订单 id）。所以「未保存 → 无法查状态」是设计如此，不是 bug。
- **dev 的 dye-service 会整段掉线**：网关直接回 `999999 / 503 Unable to find instance for dye-service`
  （2026-08-04 实测断续复现）。此时所有 `/apiDye/**` 都失败，先确认服务在不在，别当页面 bug 查。

### 2.9 框架自检（pc，**无侧栏菜单**，`__t.nav('框架自检')` 进）

- 「带鉴权接口」按钮：验证环境 proxy + att 注入 + Resp 解包 + 静默续登。
- 「模拟器服务」按钮：验证 `/simapi` → sim-server(3001) 通不通。

### 2.10 固件升级管理（pc，菜单'固件升级管理'）

- 对接 dye-service `/dye/apiUnified/firmwareUpgrade/*`：列表 listDyeFirmwareUpgrade /
  保存 saveOrUpdateDyeFirmwareUpgrade / 上下架 updateDyeFirmwareUpgradeStatus。
- 就绪判定：`__t.read('设备固件升级管理')` 有值且表格加载完成。
- 筛选：状态下拉 `firmware.filter-status` + 配置时间范围 → `__t.click('查询')`。
- 新增：`__t.click('添加')` → 弹窗选设备类型（`firmware.model-select`）→
  **选「四代机(04)」出两个上传框、一个版本号**：P4/C5 成对发布共用版本号（提交时 subVersion=version 同值），
  上传框 `firmware.upload-main`（P4 主控）/ `firmware.upload-sub`（C5），两包都必填（前端拦 + 后端校验兜底）；
  其他型号只有主包一组。
- 上传走 base 服务 `getUploadSign` OSS 直传（PostObject），md5 前端 spark-md5 算、size 取 File.size，
  上传成功后 url/md5/size 显示在上传按钮下方。**Upload 组件文件对话框 __t 驱不动**，
  测试时用 DataTransfer 造 File 触发 input[type=file]，或只测已回填态的保存链路。
- 上下架：行内「上架/下架」带 Popconfirm；上架后该记录即为设备 `get_ota_info` 拉取到的版本（model=4 最新上架一条）。
- 主/副包语义：列表两列分别是「主固件包（四代机=P4 主控）」「C5 固件包（仅四代机）」，
  对应 DB `dye_firmware_upgrade` 主字段 与 `sub_*` 字段。
- DB 核验（四代机 sub_version 应与 version 同值）：`SELECT CAST(id AS CHAR) id, model, version, sub_version,
  status, md5, sub_md5, size, sub_size FROM udream_dye.dye_firmware_upgrade WHERE is_delete=0
  ORDER BY create_time DESC LIMIT 5;`

## 3. 测试数据

> 待补：联调用固定测试设备（certs/ 下 `wb00-test-*`、`dm04-test-*`）与对应门店/设备档案数据。

- dev 四代机共 4 台，**现均绑「光明大第工作室(测试)」`1474262550837915649`**：
  `0400000` / `0400001`（**MQTT 模拟器专用，禁止解绑/划拨**）、`0400015`、
  `0469419`（无余量、无连接状态，解绑/划拨回路就拿它测）。远程控制只拿前三台试。

```sql
-- 解绑/划拨前后核验绑定关系（state=1 才是当前生效行）
SELECT dd.code, dd.state transferStatus, CAST(dds.id AS CHAR) dds_id,
       CAST(dds.store_id AS CHAR) storeId, dds.state bindingState, dds.device_name, dds.create_time
FROM udream_dye.dye_device dd LEFT JOIN udream_dye.dye_device_store dds ON dd.code = dds.device_code
WHERE dd.code = '0469419' ORDER BY dds.create_time;
```

## 4. DB 核验 SQL 模板

> 待补：设备状态/事件落库表的核验 SQL。19 位 id 一律 `CAST(id AS CHAR)`。

设备列表页（`listStaffDevice` 的取数：`dye_device dd` LEFT JOIN `dye_device_store dds`
ON `dd.code = dds.device_code AND dds.state = 1`）：

```sql
-- 列表行核对（macCode 换成页面上那一行）
SELECT CAST(dds.id AS CHAR) id, dd.name deviceName, dd.code macCode, dd.model,
       CAST(dds.store_id AS CHAR) storeId, dd.state transferStatus, dds.state bindingStatus,
       dds.status deviceStatus, dds.type, dds.type_name, dds.run_state, dds.run_desc,
       dds.address, dds.usage_time, dds.create_time
FROM dye_device dd LEFT JOIN dye_device_store dds
  ON dd.code = dds.device_code AND dds.state = 1
WHERE dd.code = '0400001';

-- 染膏容量列（仅四代机；device_code 就是 MAC 码）
SELECT device_port, name, type, weight, total_weight, last_sync_time
FROM dye_device_cream WHERE device_code = '0400001' AND is_del = 0 ORDER BY device_port;
```

换料记录页（表 `dye_change_record`，`dyeChangeRecordsStaffVO.storeId` 塞的其实是这张表的 `id`）：

```sql
-- 列表行核对（macCode 换成页面上那一行）
SELECT CAST(id AS CHAR) id, device_code macCode, device_name deviceName, model,
       status, update_time changeDate, create_time
FROM dye_change_record WHERE device_code = '0400001' ORDER BY update_time DESC;

-- 换料状态分布（用来核对每个状态筛选出来的「共 N 条」）
SELECT status, COUNT(*) FROM dye_change_record GROUP BY status;
```

洗头记录页（表 `dye_bed_record`，MyBatis-Plus 默认命名，无自定义 mapper XML）：

```sql
-- 列表行核对（deviceCode 换成页面上那一行）
SELECT CAST(id AS CHAR) id, CAST(order_id AS CHAR) orderId, device_code, model, modelName,
       CAST(store_id AS CHAR) storeId, store_name, craftsman_name, gender, rinse_type,
       water_pressure, bed_status, connection_type, create_time
FROM dye_bed_record WHERE device_code = 'XTC00003' ORDER BY create_time DESC;

-- bedStatus=10 脏数据核实（dev 应为 34 条，均 2026-04-29）
SELECT bed_status, COUNT(*), MIN(create_time), MAX(create_time)
FROM dye_bed_record GROUP BY bed_status;
```


```sql
-- 智染设备页（App）
-- 门店下的四代机（对应 queryDyeByModel 结果）
SELECT CAST(id AS CHAR) id, CAST(store_id AS CHAR) store_id, device_code, device_name, state, status
FROM udream_dye.dye_device_store WHERE store_id = {storeId} AND model = 4 AND state = 1;

-- 某台设备的槽位余量（对应 creamCapacity.pumps；percent = round(weight/total_weight*100)）
SELECT c.device_port, c.name, c.type, c.weight, c.used_weight, c.total_weight, c.proportion, c.last_sync_time
FROM udream_dye.dye_device_cream c
JOIN udream_dye.dye_device_store s ON s.id = c.dye_device_store_id
WHERE s.device_code = '0400001' AND s.store_id = {storeId}
ORDER BY c.device_port;
```

```sql
-- 下料页（App）
-- 保存后的调色记录（19 位 id 必须 CAST）
SELECT CAST(id AS CHAR) id, CAST(order_id AS CHAR) order_id, is_virtually_order_id, device_code,
       color_name, hydrogen_name, out_type, weight, is_execute, status, execute_result, create_time
FROM udream_dye.dye_formula_color_record
WHERE device_code = '0400001' AND create_time > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
ORDER BY create_time DESC;

-- 每条记录拆到几号管（保存时才落库，预览不落）
SELECT CAST(p.dye_color_record_id AS CHAR) rec_id, p.device_port, p.name, p.weight
FROM udream_dye.dye_color_record_port p
WHERE p.dye_color_record_id IN (/* 上面查出的 id */);

-- 可选颜色的真值（页面下拉就是它 join 出来的）
SELECT CAST(id AS CHAR) id, name, combination, ratio_json
FROM udream_dye.dye_color_config
WHERE type = 6 AND model_color_type = 4 AND status = 1;
```

## 5. 流程组合速查

> 待补。
