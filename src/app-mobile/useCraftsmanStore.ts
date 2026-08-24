import { useSession } from '../store/useSession';
import type { CraftsmanStore } from '../types';

/**
 * App 自测公共：操作门店上下文，全部读写自统一 Account 对象。
 * - 门店来自 Account 登录默认门店（LoginInfo），不再调 getCraftsmanToStore（newdev/test 被网关 at 拦截）。
 * - 选中门店 storeId 持久化在 Account.currentStoreId（切换/刷新都不丢）。
 * 当前为单门店（登录默认店）；需要多店时给 Account 补 stores 列表 + getManageStores。
 */
export function useCraftsmanStore() {
  // 响应式订阅当前端激活账号（账号数据变化时重渲染）
  const user = useSession((s) => {
    const id = s.clientMode === 'pc' ? s.pcUserId : s.appUserId;
    return s.users.find((u) => u.id === id);
  });
  const setAccountStore = useSession((s) => s.setAccountStore);

  const craftsmanId = user?.uid;
  const stores: CraftsmanStore[] = user?.defaultStoreId
    ? [{ storeId: user.defaultStoreId, storeName: user.defaultStoreName || '默认门店', type: 1 }]
    : [];
  const storeId = user?.currentStoreId || user?.defaultStoreId || '';
  const setStoreId = (id: string) => {
    if (user) setAccountStore(user.id, id);
  };

  return { user, craftsmanId, stores, storeId, setStoreId };
}
