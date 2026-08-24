# 部署（Mac 本机 homebrew nginx，8091）

照搬扫码购 UI 的部署模式（`scanbuy-ui.conf`，8080/8081 错位同款）。
Docker/Win10 方案已废弃删除（卡 Docker Desktop 凭据助手，且 nginx 方式更简单），不要再走回去。

## 配置文件（在 nginx 目录，不在本仓库）

- `/opt/homebrew/etc/nginx/servers/mqtt-ui.conf` —— 端口 **8091**（8080 是 vite dev，网关白名单要求），
  托管本项目 `dist/` + rewrite 复刻 vite 代理（/env×4 含 local、/simapi、/simws WebSocket）
- `/opt/homebrew/etc/nginx/mqtt-proxy-common.conf` —— 代理公共片段：剥 Cookie/Origin/Referer
  （**Origin 白名单不剥会 403**）、Set-Cookie 里 att → x-app-token 响应头
- homebrew 主配置 nginx.conf 的默认欢迎页 server 已从 8090 迁到 8082

## 日常发布

```bash
npm run build    # 改前端 = 这一条就完事；nginx 直读 dist，index.html 已 no-cache，刷新即新版
```

例外情况：

| 改动内容 | 额外动作 |
|---|---|
| sim-server 代码 | dev server 开着则 tsx watch 自动重启；没开则 `npm run dev:sim` 单独常驻 3001 |
| envs.ts 加新环境 | 需在 mqtt-ui.conf 手工加对应 location 块（nginx 路由不会自动跟）+ `nginx -s reload` |
| nginx 配置本身 | `nginx -t && nginx -s reload` |

## 运行前提

- nginx 在跑：`pgrep nginx || nginx`
- sim-server 占着 3001：已注册 **LaunchAgent 常驻**（`~/Library/LaunchAgents/com.udream.mqtt-sim.plist`，
  开机自启 + 崩溃自动拉起，日志 `~/Library/Logs/mqtt-sim.log`），不依赖任何终端会话。
  - 改了 sim-server 代码要生效：`launchctl kickstart -k gui/$(id -u)/com.udream.mqtt-sim`
    （LaunchAgent 跑的是 tsx 无 watch，不会自动跟代码）
  - 本地开 `npm run dev` 时 dev:sim 会因 3001 被占报 EADDRINUSE——无妨，vite 会直接代理到
    LaunchAgent 的 sim-server；想用 tsx watch 调 sim-server 就先
    `launchctl unload ~/Library/LaunchAgents/com.udream.mqtt-sim.plist`，调完再 load 回来

## 访问

本机 http://localhost:8091 ｜ 局域网 http://\<Mac内网IP\>:8091 ｜ Tailscale http://100.89.24.15:8091

8080（vite dev 热更）与 8091（nginx 静态部署版）可同时开、互不影响。
