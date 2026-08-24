import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ENV_PRESETS } from './src/envs';

// 为每个环境预设注册 proxy：
//   1. 先注册 serviceOverrides 里的细粒度规则 → /env/{key}{prefix} → 对应服务 target
//   2. catch-all：/env/{key} → 环境顶层 target（local 兜底走 unified）
//
// http-proxy 按 key 长度从长到短匹配，所以 /env/local/franchise 会优先命中细粒度规则，
// 不会被 /env/local 通配掉。
export default defineConfig(() => {
  const proxy: Record<string, any> = {};

  const buildProxy = (target: string, pathPrefix: string, envKey: string) => ({
    target,
    changeOrigin: true,
    secure: false,
    rewrite: (path: string) => {
      const stripped = path.replace(new RegExp(`^/env/${envKey}`), '');
      return pathPrefix ? `${pathPrefix}${stripped}` : stripped;
    },
    // 剥 Cookie：避免浏览器 localhost 域下沉积的 session cookie 污染网关鉴权(50130 假阳)
    configure: (proxy: any) => {
      proxy.on('proxyReq', (proxyReq: any) => {
        proxyReq.removeHeader('cookie');
      });
      proxy.on('proxyRes', (proxyRes: any) => {
        // 后端登录态 token 是通过 Set-Cookie(att=<token>) 下发的（见 common-at AtUtils.set）。
        // 我们仍然删除 set-cookie 避免污染本地域，但先把 att 的值抽到一个可读的自定义响应头，
        // 供「账号密码登录」捕获——APP 登录接口 body 里不含 token，只有这个 cookie。
        const sc = proxyRes.headers['set-cookie'];
        if (sc) {
          const arr = Array.isArray(sc) ? sc : [sc];
          for (const c of arr) {
            const m = /^\s*att=([^;]+)/i.exec(c);
            if (m && m[1]) {
              // 原值含 / + 等字符，按原样透传，不做 decode 以免破坏 token
              proxyRes.headers['x-app-token'] = m[1];
              break;
            }
          }
          delete proxyRes.headers['set-cookie'];
        }
      });
    },
  });

  ENV_PRESETS.forEach((e) => {
    // 先注册细粒度 override（更长的 key 优先匹配）
    (e.serviceOverrides || []).forEach((o) => {
      proxy[`/env/${e.key}${o.prefix}`] = buildProxy(o.target, o.pathPrefix, e.key);
    });
    // 兜底：catch-all
    proxy[`/env/${e.key}`] = buildProxy(e.target, e.pathPrefix, e.key);
  });

  // 设备模拟器本地服务（sim-server，端口 3001）：
  //  - /simapi/**  → http://localhost:3001/api/**（前缀重写，服务端路由保持 /api 不动）
  //  - /simws      → ws://localhost:3001/ws（WebSocket 实时推送设备状态/日志）
  // 前端一律用相对路径（src/simulator/** 里的 fetch('/simapi/...') 与 useWebSocket 的 '/simws'），
  // 不直连 localhost:3001，避免跨域和端口硬编码。
  proxy['/simapi'] = {
    target: 'http://localhost:3001',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/simapi/, '/api'),
  };
  proxy['/simws'] = {
    target: 'ws://localhost:3001',
    ws: true,
    rewrite: (path: string) => path.replace(/^\/simws/, '/ws'),
  };

  // 启动期打印路由表，排查 404 快
  // eslint-disable-next-line no-console
  console.log('[vite] proxy routes:');
  Object.keys(proxy).forEach((k) => {
    const t = proxy[k];
    // eslint-disable-next-line no-console
    console.log(`  ${k.padEnd(40)} →  ${t.target}`);
  });

  return {
    plugins: [react()],
    server: {
      host: true, // 监听 0.0.0.0，允许局域网其它设备访问
      // 用 8080：test/newdev 等环境的网关跨域白名单只登记了 localhost:8080（扫码购同款），
      // vite 代理不剥 Origin，换端口会被网关拦。代价是与扫码购 UI dev 不能同时开
      // （scanbuy 配了 autoPort 会自动让位）；支持 PORT 环境变量覆盖
      port: Number(process.env.PORT) || 8080,
      proxy,
    },
  };
});
