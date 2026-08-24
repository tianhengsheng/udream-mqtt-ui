import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ENV, bucketKey, type EnvKey } from '../envs';

/** 客户端类型：PC 后台页 / App 手艺人页 / mini 小程序顾客页（决定发哪个端 token）。 */
export type ClientMode = 'pc' | 'app' | 'mini';

/** clientMode → 激活槽位字段名（统一映射，避免各处 pc/app 二元硬编码） */
export const SLOT_KEY: Record<ClientMode, 'pcUserId' | 'appUserId' | 'miniUserId'> = {
  pc: 'pcUserId',
  app: 'appUserId',
  mini: 'miniUserId',
};

/**
 * 统一账号对象。一条 = 一个完整可操作身份：身份 + 凭据 + 登录态 + 角色 + 门店上下文。
 * 来源：账号密码登录（带 account/password/store/role）或粘贴 token（仅 token，其余可空）。
 * id 用 `${mode}:${uid}` 复合键：同一 uid 在 PC / App 各占一条，互不覆盖。
 */
export interface Account {
  // 身份
  id: string; // = `${mode}:${uid}` 复合键
  uid: string; // 字符串：后端 uid 是 19 位雪花 ID，避免 Number 精度丢失
  name: string;
  type: number; // payload.iss（1 APP / 8 PC ...）
  /** 归属端：决定它出现在 PC 还是 App 列表里 */
  mode: ClientMode;
  // 凭据（账号密码登录时落；粘贴 token 无）。明文，仅本地自测用，便于一键重登/续期。
  account?: string; // PC=账号 / APP=手机号
  password?: string;
  // 登录态
  token: string;
  expiresAt: number | null;
  // 角色：App 端 role 数字（fetchCraftsmanRole：1手艺人/店长·2区域·3总·4城市）；
  //       PC 端 roleName 角色名（fetchPcRoleName：超级管理员/运营/采购…）。
  role?: number;
  roleName?: string;
  // 门店上下文（App 登录的 LoginInfo 默认门店 + 当前选中门店，持久化）
  defaultStoreId?: string;
  defaultStoreName?: string;
  currentStoreId?: string;
  // App 页默认参数所需：门店类别 / 是否M1 / 在默认门店的角色(1店长 0手艺人)
  defaultStoreType?: number;
  isLeadStores?: number;
  storeRoleType?: number;
  savedAt: number;
}

/** 某环境下各端各自激活的账号 id。 */
interface Slots {
  pcUserId: string | null;
  appUserId: string | null;
  miniUserId: string | null;
}
const EMPTY_SLOTS: Slots = { pcUserId: null, appUserId: null, miniUserId: null };

/** 导出/导入的账号快照（按环境分桶 + 激活槽位）。注意含明文密码，属敏感文件。 */
export interface AccountSnapshot {
  accountsByEnv: Record<string, Account[]>;
  activeByEnv: Record<string, Slots>;
}

interface SessionState {
  currentEnv: EnvKey;
  clientMode: ClientMode;

  // —— 源数据：账号按桶键隔离（桶键=env.group ?? env）。同 group 的环境共用一桶（local/dev 同库互通），
  //    test/newdev 无 group 各自隔离，token/uid/门店不同绝不混用 ——
  accountsByEnv: Record<string, Account[]>;
  activeByEnv: Record<string, Slots>;

  // —— 派生镜像：始终 = 当前 env 的视图。消费方（TopBar / client.ts / useCraftsmanStore）读这几个，无需感知分桶 ——
  users: Account[];
  pcUserId: string | null;
  appUserId: string | null;
  miniUserId: string | null;
  token: string;

  setCurrentEnv: (k: EnvKey) => void;
  setClientMode: (m: ClientMode) => void;
  /** 新增/刷新账号（落当前环境桶）；assignTo 指定端槽位（默认当前 clientMode），同时作为归属端 */
  upsertUser: (u: Omit<Account, 'savedAt' | 'mode'>, assignTo?: ClientMode) => void;
  removeUser: (id: string) => void;
  assignSlot: (slot: ClientMode, id: string | null) => void;
  setAccountStore: (id: string, storeId: string) => void;
  setAccountRole: (id: string, role: number) => void;
  setAccountRoleName: (id: string, roleName: string) => void;
  /** 导入账号快照（备份/换机器/分享用）。merge=true 按环境+id 合并(导入覆盖同 id)，false 整体替换。 */
  importSnapshot: (snap: AccountSnapshot, merge: boolean) => void;

  currentUser: () => Account | undefined;
  pcUser: () => Account | undefined;
  appUser: () => Account | undefined;
  miniUser: () => Account | undefined;
}

/** 兼容旧快照：把按 env 分的 local/dev 桶折进 devShared（同 id 去重，槽位 local 优先）。 */
function foldLegacyBuckets(snap: AccountSnapshot): AccountSnapshot {
  const accountsByEnv = { ...(snap.accountsByEnv || {}) };
  const activeByEnv = { ...(snap.activeByEnv || {}) };
  if (!accountsByEnv.local && !accountsByEnv.dev && !activeByEnv.local && !activeByEnv.dev) {
    return { accountsByEnv, activeByEnv };
  }
  const merged = new Map<string, Account>();
  [...(accountsByEnv.devShared || []), ...(accountsByEnv.dev || []), ...(accountsByEnv.local || [])]
    .forEach((u) => merged.set(u.id, u));
  if (merged.size) accountsByEnv.devShared = [...merged.values()];
  const slots = { ...EMPTY_SLOTS, ...(activeByEnv.devShared || {}), ...(activeByEnv.dev || {}), ...(activeByEnv.local || {}) };
  if (activeByEnv.local || activeByEnv.dev || activeByEnv.devShared) activeByEnv.devShared = slots;
  delete accountsByEnv.local;
  delete accountsByEnv.dev;
  delete activeByEnv.local;
  delete activeByEnv.dev;
  return { accountsByEnv, activeByEnv };
}

/** 从分桶源数据派生「当前环境」镜像（users/pcUserId/appUserId/token）。 */
function derive(
  accountsByEnv: Record<string, Account[]>,
  activeByEnv: Record<string, Slots>,
  env: EnvKey,
  clientMode: ClientMode,
) {
  const bk = bucketKey(env);
  const users = accountsByEnv[bk] || [];
  const slots = { ...EMPTY_SLOTS, ...(activeByEnv[bk] || {}) };
  const activeId = slots[SLOT_KEY[clientMode]];
  const token = (activeId && users.find((u) => u.id === activeId)?.token) || '';
  return { users, pcUserId: slots.pcUserId, appUserId: slots.appUserId, miniUserId: slots.miniUserId, token };
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      currentEnv: DEFAULT_ENV,
      clientMode: 'pc',
      accountsByEnv: {},
      activeByEnv: {},
      users: [],
      pcUserId: null,
      appUserId: null,
      miniUserId: null,
      token: '',

      // 切环境 = 换可见账号集 + 换激活槽位（不重登、不冲突）
      setCurrentEnv: (k) =>
        set((s) => ({ currentEnv: k, ...derive(s.accountsByEnv, s.activeByEnv, k, s.clientMode) })),

      setClientMode: (m) =>
        set((s) => ({ clientMode: m, ...derive(s.accountsByEnv, s.activeByEnv, s.currentEnv, m) })),

      upsertUser: (u, assignTo) =>
        set((s) => {
          const bk = bucketKey(s.currentEnv);
          const slot = assignTo || s.clientMode;
          const now = Date.now();
          const bucket = [...(s.accountsByEnv[bk] || [])];
          const idx = bucket.findIndex((x) => x.id === u.id);
          if (idx >= 0) bucket[idx] = { ...bucket[idx], ...u, mode: slot, savedAt: now };
          else bucket.push({ ...u, mode: slot, savedAt: now });
          const accountsByEnv = { ...s.accountsByEnv, [bk]: bucket };
          const slots = { ...EMPTY_SLOTS, ...(s.activeByEnv[bk] || {}) };
          const newSlots: Slots = { ...slots, [SLOT_KEY[slot]]: u.id };
          const activeByEnv = { ...s.activeByEnv, [bk]: newSlots };
          return { accountsByEnv, activeByEnv, ...derive(accountsByEnv, activeByEnv, s.currentEnv, s.clientMode) };
        }),

      removeUser: (id) =>
        set((s) => {
          const bk = bucketKey(s.currentEnv);
          const bucket = (s.accountsByEnv[bk] || []).filter((x) => x.id !== id);
          const accountsByEnv = { ...s.accountsByEnv, [bk]: bucket };
          const slots = { ...EMPTY_SLOTS, ...(s.activeByEnv[bk] || {}) };
          const newSlots: Slots = {
            pcUserId: slots.pcUserId === id ? null : slots.pcUserId,
            appUserId: slots.appUserId === id ? null : slots.appUserId,
            miniUserId: slots.miniUserId === id ? null : slots.miniUserId,
          };
          const activeByEnv = { ...s.activeByEnv, [bk]: newSlots };
          return { accountsByEnv, activeByEnv, ...derive(accountsByEnv, activeByEnv, s.currentEnv, s.clientMode) };
        }),

      assignSlot: (slot, id) =>
        set((s) => {
          const bk = bucketKey(s.currentEnv);
          const slots = { ...EMPTY_SLOTS, ...(s.activeByEnv[bk] || {}) };
          const newSlots: Slots = { ...slots, [SLOT_KEY[slot]]: id };
          const activeByEnv = { ...s.activeByEnv, [bk]: newSlots };
          return { activeByEnv, ...derive(s.accountsByEnv, activeByEnv, s.currentEnv, s.clientMode) };
        }),

      setAccountStore: (id, storeId) =>
        set((s) => {
          const bk = bucketKey(s.currentEnv);
          const bucket = (s.accountsByEnv[bk] || []).map((u) =>
            u.id === id ? { ...u, currentStoreId: storeId } : u,
          );
          const accountsByEnv = { ...s.accountsByEnv, [bk]: bucket };
          return { accountsByEnv, ...derive(accountsByEnv, s.activeByEnv, s.currentEnv, s.clientMode) };
        }),

      setAccountRole: (id, role) =>
        set((s) => {
          const bk = bucketKey(s.currentEnv);
          const bucket = (s.accountsByEnv[bk] || []).map((u) => (u.id === id ? { ...u, role } : u));
          const accountsByEnv = { ...s.accountsByEnv, [bk]: bucket };
          return { accountsByEnv, ...derive(accountsByEnv, s.activeByEnv, s.currentEnv, s.clientMode) };
        }),

      setAccountRoleName: (id, roleName) =>
        set((s) => {
          const bk = bucketKey(s.currentEnv);
          const bucket = (s.accountsByEnv[bk] || []).map((u) => (u.id === id ? { ...u, roleName } : u));
          const accountsByEnv = { ...s.accountsByEnv, [bk]: bucket };
          return { accountsByEnv, ...derive(accountsByEnv, s.activeByEnv, s.currentEnv, s.clientMode) };
        }),

      importSnapshot: (rawSnap, merge) =>
        set((s) => {
          const snap = foldLegacyBuckets(rawSnap); // 兼容旧 local/dev 分桶的导出文件
          let accountsByEnv: Record<string, Account[]>;
          let activeByEnv: Record<string, Slots>;
          if (merge) {
            accountsByEnv = { ...s.accountsByEnv };
            for (const env of Object.keys(snap.accountsByEnv || {})) {
              const map = new Map((accountsByEnv[env] || []).map((u) => [u.id, u] as const));
              (snap.accountsByEnv[env] || []).forEach((u) => map.set(u.id, u)); // 同 id 以导入为准
              accountsByEnv[env] = [...map.values()];
            }
            activeByEnv = { ...s.activeByEnv, ...(snap.activeByEnv || {}) };
          } else {
            accountsByEnv = snap.accountsByEnv || {};
            activeByEnv = snap.activeByEnv || {};
          }
          return { accountsByEnv, activeByEnv, ...derive(accountsByEnv, activeByEnv, s.currentEnv, s.clientMode) };
        }),

      currentUser: () => {
        const s = get();
        const id = s[SLOT_KEY[s.clientMode]];
        return s.users.find((u) => u.id === id);
      },
      pcUser: () => get().users.find((u) => u.id === get().pcUserId),
      appUser: () => get().users.find((u) => u.id === get().appUserId),
      miniUser: () => get().users.find((u) => u.id === get().miniUserId),
    }),
    {
      name: 'udream-mqtt-ui-session',
      version: 2,
      // 只持久化源数据；派生镜像在 merge 时重算（避免存冗余/陈旧）
      partialize: (s) => ({
        currentEnv: s.currentEnv,
        clientMode: s.clientMode,
        accountsByEnv: s.accountsByEnv,
        activeByEnv: s.activeByEnv,
      }),
      // v1→v2：账号桶键由 env 改为 group，把老 local/dev 两桶折进 devShared
      migrate: (persisted, version) => {
        const p = (persisted || {}) as Partial<SessionState>;
        const base = {
          currentEnv: p.currentEnv ?? DEFAULT_ENV,
          clientMode: p.clientMode ?? 'pc',
          accountsByEnv: p.accountsByEnv || {},
          activeByEnv: p.activeByEnv || {},
        };
        if (version >= 2) return base;
        return { ...base, ...foldLegacyBuckets(base) };
      },
      // 合并持久化源数据后，重算当前环境派生镜像
      merge: (persisted, current) => {
        const s = { ...current, ...(persisted as Partial<SessionState>) } as SessionState;
        return { ...s, ...derive(s.accountsByEnv || {}, s.activeByEnv || {}, s.currentEnv, s.clientMode) };
      },
    },
  ),
);
