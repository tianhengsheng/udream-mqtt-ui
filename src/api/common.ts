import type { Resp } from '../types';

/** 从 udream Resp 取业务数据：优先 result，兼容旧 data。 */
export function pick<T>(body: Resp<T> | undefined): T | undefined {
  if (!body) return undefined;
  return (body.result !== undefined ? body.result : body.data) as T | undefined;
}

/**
 * 大整数安全解析（axios transformResponse 用）：把 16+ 位整数值加引号转字符串，
 * 避免 19 位雪花 id（storeId/craftsmanId/orderId 等）超出 Number.MAX_SAFE_INTEGER 丢末位精度。
 */
export function bigIntSafeParse(text: string): any {
  try {
    return JSON.parse(text.replace(/:\s*(\d{16,})(?=[,}\]])/g, ':"$1"'));
  } catch {
    return undefined;
  }
}
