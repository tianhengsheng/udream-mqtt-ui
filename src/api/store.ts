/**
 * base-service 门店（/basics）接口。
 *
 * 单独放这里而不是塞进 dye.ts：dye.ts 的定位是「dye-service 管理端 /mgtDye」，
 * 门店模糊搜索属于 base 服务的公共能力（设备划拨只是它的调用方之一），混进 dye.ts 会误导后来人。
 *
 * 后端出处（只读参考，勿改后端仓库）：
 *  - base/base-service/.../controller/store/StoreController.java#getStoreListByFuzzyName
 *  - base/base-api/.../vo/store/Store.java
 *
 * 路由：`/basics` 是网关根路由，envs.ts 里 catch-all 的 pathPrefix '' 就能转发，无需加 serviceOverride。
 */
import { http } from './client';
import { bigIntSafeParse, pick } from './common';
import type { Resp } from '../types';

/** 门店搜索结果（base 的 Store VO，本页只用得上这三个字段） */
export interface StoreBrief {
  /** 门店id（19 位雪花，后端全局 Long→String，这里恒当字符串用） */
  id?: string;
  storeName?: string;
  storeAddress?: string;
}

/**
 * 门店模糊搜索。
 *
 * 后端实现是 `like(store_name, kw) OR eq(id, kw)`（StoreServiceImpl#getStoreListByFuzzyName），
 * **同一个 storeName 参数既走名称模糊、又走 ID 精确**，所以用户输入 19 位门店 ID 也照样原样传
 * storeName 即可，不需要另找「按 ID 查询」的接口。
 *
 * 注意：该接口无分页、无 limit，关键词太宽会一次拉回大量门店，调用方自己截断展示。
 */
export async function searchStoreByFuzzyName(keyword: string, cityId?: number): Promise<StoreBrief[]> {
  const res = await http.get<Resp<StoreBrief[]>>('/basics/store/getStoreListByFuzzyName', {
    params: { storeName: keyword, cityId },
    transformResponse: [bigIntSafeParse],
  });
  return pick(res.data) ?? [];
}
