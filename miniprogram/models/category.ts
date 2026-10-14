export type CategoryGroupId = 'tops' | 'bottoms' | 'one-piece' | 'shoes' | 'accessories';

/** 当前只使用“大类 → 具体品类”两级，稳定 ID 不依赖展示名称。 */
export interface CategoryGroup {
  id: CategoryGroupId;
  name: string;
  types: CategoryType[];
}

export interface CategoryType {
  id: string;
  name: string;
}

export interface CategoryPath {
  groupId: CategoryGroupId;
  typeId: string;
}
