import { Card, Select, Space, Tag } from 'antd';
import type { CraftsmanStore } from '../types';
import { roleLabel } from '../api/role';

/**
 * App 自测控件：门店下拉（+ 角色标签）。
 * 手艺人身份（名字/uid）见顶部账号栏，此处省略；放在右侧控件栏。
 */
export function StoreResolveBar({
  role,
  stores,
  storeId,
  onStoreChange,
}: {
  role?: number;
  stores: CraftsmanStore[];
  storeId: string;
  onStoreChange: (id: string) => void;
}) {
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Space wrap>
        <span>门店：</span>
        <Select
          value={storeId || undefined}
          onChange={onStoreChange}
          placeholder={stores.length ? '选择门店' : '无绑定门店'}
          style={{ width: 220 }}
          disabled={!stores.length}
          options={stores.map((s) => ({
            value: s.storeId,
            label: `${s.storeName || s.storeId}${s.type === 1 ? '（店长）' : ''}`,
          }))}
        />
        {role != null && <Tag color="purple">{roleLabel(role)}</Tag>}
      </Space>
    </Card>
  );
}
