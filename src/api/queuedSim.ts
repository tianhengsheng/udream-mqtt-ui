/**
 * 排队联调接口（order-service + base-service，全部为已有接口，无新增）。
 *
 * 用于自测 UI 在 dev 打通「顾客取号 → 发型师叫号 → 洗头床预热排水」全链路，
 * 免去依赖真实小程序/App 客户端。
 *
 * 后端出处（只读参考）：
 *  - QueuedController#udreamAdd     POST /apiCustomer/order/queued/udreamAdd（顾客端 token）
 *  - QueuedQueryController#query    POST /queued/query（body QueryQueued）
 *  - QueuedController#updateQueued  POST /queued/updateQueued（body UpdateQueuedStatus）
 *  - QueuedController#call          POST /queued/calling（query string）
 *  - ItemController#listItemDetails GET  /basics/craftsman/listItemDetails（query string）
 *
 * ⚠️ 取号本身必须走**小程序顾客 token**（那正是被测链路的一环）；而项目清单查询只是选参数用的
 * 辅助读接口，走 _useStaffToken 借 App token，绕开网关对小程序 token 的白名单限制（见 client.ts 文件头）。
 */
import { http } from './client';
import { useSession } from '../store/useSession';
import { bigIntSafeParse } from './common';
import type { Resp } from '../types';

/**
 * 洗头床服务项目 id（判断本次取号会不会触发预热的展示依据）。
 * 来源：config_const.shampoo_bed_item_id（dev 实测值，见 docs 归档脚本）。
 * 换环境若与实际不符，只影响页面上的「洗头床」标记，不影响取号本身。
 */
export const SHAMPOO_BED_ITEM_IDS = [
  '1953280798877798401', // 健康烫染护
  '1938524430211891202', // 烫染护套餐
  '1273146135657697281', // 男士洗剪吹
];

/** 项目价格（ItemPriceInfo extends ItemPrice：id 即 priceId） */
export interface ItemPriceInfo {
  /** 价格 id = 取号入参 items[].priceId */
  id?: string;
  itemId?: string;
  priceName?: string;
  price?: number;
  priceOriginal?: number;
}

/** 门店项目详情（ItemDetail，只列页面用到的字段） */
export interface ItemDetail {
  storeId?: string;
  itemId?: string;
  itemName?: string;
  /** 0-剪发类 1-烫染类等，仅展示 */
  itemCategory?: number;
  /** 项目状态，1=可用 */
  itemStatus?: number;
  itemPrices?: ItemPriceInfo[];
  price?: number;
}

/**
 * 门店可取号项目清单。借 App token 调（辅助查询，非被测链路）。
 *
 * **必须传 platform=1**：不传时后端会走「按当前登录顾客算新老客/UVIP 过滤项目」的分支
 * （ItemServiceImpl#listItemDetails），用 AtUtils 里的 uid 去查 CustomerCache——
 * 而我们借的是 App 手艺人 token，查出来必然是 null，后端直接 NPE 返回 5010012。
 * platform=1 表示 App 端，跳过该顾客画像分支，返回门店全量项目，正合自测选参数所需。
 */
export async function listItemDetails(storeId: string, craftsmanId: string): Promise<ItemDetail[]> {
  const res = await http.get<Resp<ItemDetail[]>>('/basics/craftsman/listItemDetails', {
    params: { storeId, craftsmanId, platform: 1 },
    transformResponse: [bigIntSafeParse],
    _useStaffToken: true,
  });
  return (res.data?.result ?? res.data?.data ?? []) as ItemDetail[];
}

/** 取号入参（AddQueued 的最小子集，UVIP/外卖/家庭账户等一概不传） */
export interface AddQueuedReq {
  uid: string;
  storeId: string;
  craftsmanId: string;
  items: { itemId: string; priceId?: string }[];
  /** 0=排队 1=预约，预热只认排队型 */
  queuedType?: number;
  /** 0=优剪 3=绅士制造 */
  app?: number;
  /** 0=H5 1=小程序 */
  source?: number;
}

/** 取号结果（QueuedWaitingStatus，只列页面用到的字段） */
export interface QueuedWaitingStatus {
  queuedId?: string;
  queuedNo?: string;
  waitingCount?: number;
  waitingMinutes?: number;
  storeName?: string;
  craftsmanName?: string;
}

/** 顾客取号。**走小程序顾客 token**（被测链路，不借 staff token）。 */
export async function udreamAdd(req: AddQueuedReq): Promise<QueuedWaitingStatus> {
  const res = await http.post<Resp<QueuedWaitingStatus>>(
    '/apiCustomer/order/queued/udreamAdd',
    { queuedType: 0, app: 0, source: 1, ...req },
    { transformResponse: [bigIntSafeParse] },
  );
  return (res.data?.result ?? res.data?.data ?? {}) as QueuedWaitingStatus;
}

/** 排队明细（QueuedDetail，只列页面用到的字段） */
export interface QueuedDetail {
  id?: string;
  orderId?: string;
  queuedNo?: string;
  /** 0=排队中 1=叫号中 2=服务中 3=待支付 */
  queuedStatus?: number;
  queuedOrder?: number;
  itemNames?: string;
  nickname?: string;
  customerName?: string;
  uid?: string;
  storeId?: string;
  craftsmanId?: string;
  /** 后端灰度标记：是否洗头床项目单 */
  shampooBed?: boolean;
  bookTime?: string;
  createTime?: string;
}

/**
 * 查询排队列表（App 排队页同款接口）。
 *
 * ⚠️ 副作用：pageNum=1 且队列中无「叫号中/服务中」时，后端会**自动触发叫号**
 * （QueuedQueryServiceImplActor#getQueuedList → queuedService.call）。
 * 也就是说刷新列表本身可能就是一次叫号，页面因此不做自动轮询。
 */
export async function queryQueued(params: {
  storeId: string;
  craftsmanId: string;
  queuedStatus?: number[];
  pageNum?: number;
  pageSize?: number;
}): Promise<QueuedDetail[]> {
  const res = await http.post<Resp<QueuedDetail[]>>(
    '/queued/query',
    {
      queuedType: 0,
      app: 0,
      replacePay: 0,
      queuedStatus: [0, 1, 2, 3],
      pageNum: 1,
      pageSize: 20,
      ...params,
    },
    { transformResponse: [bigIntSafeParse] },
  );
  return (res.data?.result ?? res.data?.data ?? []) as QueuedDetail[];
}

/** 排队状态码（QueuedStatus，页面只用到前几个） */
export const QUEUED_STATUS_LABEL: Record<number, string> = {
  0: '排队中',
  1: '叫号中',
  2: '服务中',
  3: '待支付',
  4: '已过号',
  5: '已支付',
};

/**
 * 修改排队状态。newStatus=1 即叫号（命中预热钩子：CAS 排队中→叫号中）；
 * newStatus=4 过号时后端强校验 passedType / passedContent 非空（UpdateQueuedStatus），由 extra 带入。
 */
export async function updateQueuedStatus(
  queuedId: string,
  newStatus: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await http.post<Resp<unknown>>(
    '/queued/updateQueued',
    { queuedId, newStatus, ...extra },
    { transformResponse: [bigIntSafeParse] },
  );
}

/** 触发叫号（真实自动叫号路径：叫队首那条）。入参在 query string。 */
export async function callQueued(storeId: string, craftsmanId: string): Promise<string | null> {
  const res = await http.post<Resp<string>>('/queued/calling', null, {
    params: { storeId, craftsmanId },
    transformResponse: [bigIntSafeParse],
  });
  return (res.data?.result ?? res.data?.data ?? null) as string | null;
}

/**
 * 手艺人工作状态（craftsman_store.active_status）。
 *
 * 取号链路强校验此值：QueuedServiceImpl#checkCraftsmanStore 只放行 1/4/5，
 * 其余一律报「手艺人XXX暂时无法为您服务，请选择其他手艺人取号」。
 * 非工作时段 App 端不给切，自测时用本页的按钮直接调 App 接口切回来。
 */
export const ACTIVE_STATUS_LABEL: Record<number, string> = {
  0: '休息中',
  1: '可接单',
  2: '快下班了',
  3: '隐身',
  4: '接剪发单',
  5: '吃饭中',
  6: '暂不接单',
};

/** 取号放行的工作状态（同后端 checkCraftsmanStore 的白名单） */
export const QUEUED_ALLOW_ACTIVE_STATUS = [1, 4, 5];

/** 工作状态读取结果：值 + 数据来源（db=craftsman_store 表，cache=Redis 门店手艺人缓存） */
export interface ActiveStatusResult {
  activeStatus?: number;
  source: 'db' | 'cache';
}

/**
 * 查手艺人当前工作状态。**查库优先，缓存兜底**：
 *
 * - 首选 StoreCraftsmanController#getStoreCraftsman，直接查 craftsman_store 表，与取号校验
 *   （base CraftsmanMgrServiceImpl#checkAddQueuedNew → getCraftsmanCheck SQL）同源。该接口 api_auth 只放行
 *   小程序顾客 token（pass_token=[2]，App/PC token 调会 50140），故借用小程序身份调（_useMiniToken）。
 * - 未登录小程序、或被拒时退回 getCraftsmanStore（读 Redis 缓存，App token 可调）。缓存与 DB 会不一致：
 *   unified 的「强制下班」整表 update 只改 DB 不刷缓存，缓存显示可接单、取号照样被拒（2026-09-08 踩过），
 *   页面按 source 提示「缓存值，可能与取号校验不一致」。
 */
export async function getActiveStatus(storeId: string, craftsmanId: string): Promise<ActiveStatusResult> {
  if (useSession.getState().miniUser()) {
    try {
      const res = await http.get<Resp<{ activeStatus?: number }>>('/basics/store/craftsman/getStoreCraftsman', {
        params: { storeId, craftsmanId },
        transformResponse: [bigIntSafeParse],
        _useMiniToken: true,
        _silent: true,
      });
      const body = res.data?.result ?? res.data?.data;
      if (body) {
        return { activeStatus: body.activeStatus, source: 'db' };
      }
    } catch {
      /* 落到缓存兜底 */
    }
  }
  const res = await http.get<Resp<{ activeStatus?: number }>>('/basics/store/craftsman/getCraftsmanStore', {
    params: { storeId, craftsmanId },
    transformResponse: [bigIntSafeParse],
    _useStaffToken: true,
  });
  return { activeStatus: (res.data?.result ?? res.data?.data)?.activeStatus, source: 'cache' };
}

/**
 * 切换手艺人工作状态。走 **mgt（区域经理端）** 接口
 * StoreCraftsmanController#updateCraftsmanActiveStatus。
 *
 * ⚠️ 不要用 App 端的 `/order/manage/craftsman/updateActiveStatus`：那条链路里
 * StoreCraftsmanServiceImpl#updateActiveStatus 有一道
 * `activeStatus==0 && 目标!=0 → "您已下班,请打卡上班后再操作"` 的拦截。
 * mgt 这条支持 0/1/2/6 互切，走 updateComm 同时写 DB 和手艺人门店缓存，
 * 并在 record_craftsman_set 留一条操作记录（自测痕迹可查）。
 *
 * ⚠️ 2026-01 起 mgt 这条切「可接单」(1) 也加了校验：当天必须有打卡记录
 * （CraftsmanStoreBindMgrServiceImpl#updateCraftsmanActiveStatus → getAttendanceDetailByCidAndDate），
 * 没有则返回 CRAFTSMAN_NOT_ALLOW_ORDER。长期没打卡的测试手艺人切不回 1，
 * dev 自测直接改库：`UPDATE udream_basics.craftsman_store SET active_status=1 WHERE craftsman_id=? AND store_id=? AND is_default=1`
 * （缓存不一致时也用这条对齐，本页读的是 DB）。
 *
 * 约束：只对**默认门店**（is_default=1）那条绑定关系生效，否则报「手艺人未绑定该门店」。
 */
export async function updateActiveStatus(
  storeId: string,
  craftsmanId: string,
  activeStatus: number,
  operator?: { id?: string; name?: string },
): Promise<void> {
  await http.post<Resp<boolean>>(
    '/basics/store/craftsman/updateCraftsmanActiveStatus',
    {
      storeId,
      craftsmanId,
      activeStatus,
      operationId: operator?.id ?? craftsmanId,
      operationName: operator?.name ?? '自测UI',
    },
    { transformResponse: [bigIntSafeParse], _useStaffToken: true },
  );
}
