/**
 * 解析后端 AT JWT 的 payload —— 与 common-at `AtUtils.getAtUserDatails` 对应：
 *   - sub        → uid (字符串数字)
 *   - iss        → type (0=后台 / 10=APP 等)
 *   - obj.name   → 用户名
 *   - exp        → 过期时间（秒级 epoch）
 *
 * 注意：只 decode 不验签，本工具仅用于本地自测 UI 取展示字段，不能做权限决策。
 */

export interface DecodedAtToken {
  /**
   * 用户 ID。保留字符串：后端 uid 是 19 位雪花 ID（如 1069897682382950402），
   * 超出 JS Number.MAX_SAFE_INTEGER (~9e15)，转 Number 会丢末位精度。
   */
  uid: string;
  type: number;
  name: string;
  /** 过期时间 (ms epoch)，无 exp 时为 null */
  expiresAt: number | null;
  /** 原始 payload（调试用） */
  raw: Record<string, unknown>;
}

function base64UrlDecode(str: string): string {
  // base64url → base64
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const decoded = atob(b64 + pad);
  // 处理中文（payload 里 name 是中文，atob 是按 byte 来的）
  try {
    return decodeURIComponent(
      decoded
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
  } catch {
    return decoded;
  }
}

export function decodeAtToken(token: string): DecodedAtToken {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('token 为空');
  }
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error('token 不是合法 JWT（应为 xxx.yyy.zzz 三段）');
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch (e) {
    throw new Error('payload 解码失败：' + (e as Error).message);
  }

  const sub = payload.sub;
  const iss = payload.iss;
  const obj = payload.obj as Record<string, unknown> | undefined;
  const exp = payload.exp;

  if (sub == null || sub === '') throw new Error('token payload 缺 sub（uid）');
  const uid = String(sub); // 保留字符串避免 19 位雪花 ID 精度丢失

  return {
    uid,
    type: iss == null ? -1 : Number(iss),
    name: (obj && typeof obj.name === 'string' ? obj.name : '') || '未识别',
    expiresAt: typeof exp === 'number' ? exp * 1000 : null,
    raw: payload,
  };
}

/** 是否已过期。无 exp 视为不会过期。 */
export function isAtTokenExpired(token: string): boolean {
  try {
    const d = decodeAtToken(token);
    return d.expiresAt != null && d.expiresAt < Date.now();
  } catch {
    return false;
  }
}
