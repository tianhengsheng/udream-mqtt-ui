import { http } from './client';
import { pick } from './common';
import type { Resp } from '../types';

/** App 角色码 → 名称。1手艺人/店长 · 2区域经理 · 3总经理 · 4城市经理。 */
export const CRAFTSMAN_ROLE_LABEL: Record<number, string> = {
  1: '手艺人/店长',
  2: '区域经理',
  3: '总经理',
  4: '城市经理',
};
export const roleLabel = (role?: number) =>
  role == null ? '' : CRAFTSMAN_ROLE_LABEL[role] || `角色${role}`;

/** 查 PC 后台用户角色名（超级管理员/运营/采购…）。POST /uc/role/getRoleByUserId?userId= */
export async function fetchPcRoleName(userId: string): Promise<string | null> {
  const r = await http.post<Resp<{ name?: string; description?: string }>>('/uc/role/getRoleByUserId', null, {
    params: { userId },
  });
  const role = pick<{ name?: string; description?: string }>(r.data);
  return role?.name || role?.description || null;
}

/** 查手艺人 App 角色（1手艺人/店长 · 2区域经理 · 3总经理 · 4城市经理）。 */
export async function fetchCraftsmanRole(craftsmanUid: string) {
  // 网关 user 服务 Path=/uc/**（StripPrefix 后到 /user/...），必须带 /uc 前缀，见 envs.ts serviceOverrides
  const r = await http.post<Resp<{ role?: number }>>('/uc/user/getRoleByCraftsmanUid', null, {
    params: { craftsmanUid },
  });
  return pick(r.data)?.role ?? null;
}
