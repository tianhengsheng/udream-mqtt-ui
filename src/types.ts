// MQTT/IoT 自测 UI 的后端交互公共类型（脚手架层）。
// 注意：设备模拟器（sim-server）自己的类型在 src/simulator/types.ts，两者互不相干，别混用。
// 业务 VO 按需求在此追加，字段名严格对齐后端 VO/Req，避免装配错。

// udream Resp 真实字段：{ success, retCode, subCode, retInfo, result }；兼容旧 { code, msg, data }
export interface Resp<T> {
  success?: boolean;
  retCode?: string;
  subCode?: string;
  retInfo?: string;
  result?: T;
  // 旧字段兼容
  code?: string | number;
  msg?: string;
  data?: T;
}

// 分页返回：result 为数组，分页信息在 page（PageInfo）。兼容旧 pageInfo/records/total。
export interface PageInfo {
  pageNum?: number;
  pageSize?: number;
  current?: number;
  pages?: number;
  total?: number;
}
export interface PageResp<T> extends Resp<T[]> {
  page?: PageInfo;
  pageInfo?: PageInfo;
  total?: number;
  records?: T[];
}

/** App 端手艺人可操作门店（useCraftsmanStore / StoreResolveBar 用）。 */
export interface CraftsmanStore {
  storeId: string;
  storeName?: string;
  city?: string;
  area?: string;
  type?: number; // 0员工/1店长 等
}
