import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';
import { installTestHooks } from './test/hooks';

dayjs.locale('zh-cn');

// window.__t 测试钩子（本项目即 dev-only 自测工具，直接挂载）
installTestHooks();

// 每次启动清掉本地域的 cookie。
// 原因：vite proxy 若未剥离 cookie，测试网关下发的 Set-Cookie 会落到 localhost 域，
// 这些过期 cookie 在每次请求时会跟 att 头一起被发到 mgt 网关，触发 50130 鉴权失败。
// vite.config.ts 已剥离上下行 cookie，这里再做一次浏览器侧兜底，杜绝旧 cookie 残留。
(function purgeStaleCookies() {
  document.cookie.split(';').forEach((c) => {
    const eq = c.indexOf('=');
    const name = (eq > -1 ? c.substring(0, eq) : c).trim();
    if (!name) return;
    // 同时按几种可能的 domain/path 覆盖，确保删干净
    const paths = ['/', '/env', ''];
    const domains = ['', 'localhost', '.localhost'];
    paths.forEach((p) =>
      domains.forEach((d) => {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT;${
          p ? ` path=${p};` : ''
        }${d ? ` domain=${d};` : ''}`;
      }),
    );
  });
})();

// 不用 StrictMode：React18 dev 下它会双调用 effect，导致首屏自动请求发两次（联调时干扰）。
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
