import type { CategoryGroup, CategoryGroupId, CategoryPath, CategoryType } from '../models/category';

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'tops', name: '上装', types: [
      ['tshirt', 'T恤'], ['shirt', '衬衫'], ['hoodie', '卫衣'], ['sweater', '毛衣'],
      ['knitwear', '针织衫'], ['vest', '背心'], ['camisole', '吊带'], ['polo', 'Polo衫'],
      ['jacket', '夹克'], ['blazer', '西装'], ['trench', '风衣'], ['coat', '大衣'],
      ['down-jacket', '羽绒服'], ['padded-jacket', '棉服'], ['leather-jacket', '皮衣'], ['waistcoat', '马甲'],
    ].map(([id, name]) => ({ id, name })),
  },
  {
    id: 'bottoms', name: '下装', types: [
      ['jeans', '牛仔裤'], ['casual-pants', '休闲裤'], ['suit-pants', '西裤'], ['sports-pants', '运动裤'],
      ['cargo-pants', '工装裤'], ['wide-leg-pants', '阔腿裤'], ['straight-pants', '直筒裤'],
      ['skinny-pants', '紧身裤'], ['shorts', '短裤'], ['skirt', '半身裙'],
      ['pleated-skirt', '百褶裙'], ['a-line-skirt', 'A字裙'],
    ].map(([id, name]) => ({ id, name })),
  },
  {
    id: 'one-piece', name: '连体装', types: [
      ['dress', '连衣裙'], ['jumpsuit', '连体裤'], ['overalls', '背带裤'], ['pinafore', '背带裙'],
      ['two-piece-set', '两件套'], ['three-piece-set', '三件套'], ['sports-set', '运动套装'], ['formal-set', '正装套装'],
    ].map(([id, name]) => ({ id, name })),
  },
  {
    id: 'shoes', name: '鞋履', types: [
      ['sneakers', '运动鞋'], ['running-shoes', '跑鞋'], ['skate-shoes', '板鞋'], ['canvas-shoes', '帆布鞋'],
      ['casual-shoes', '休闲鞋'], ['leather-shoes', '皮鞋'], ['heels', '高跟鞋'], ['flats', '平底鞋'],
      ['sandals', '凉鞋'], ['slippers', '拖鞋'], ['ankle-boots', '短靴'], ['tall-boots', '长靴'], ['snow-boots', '雪地靴'],
    ].map(([id, name]) => ({ id, name })),
  },
  {
    id: 'accessories', name: '配饰', types: [
      ['backpack', '双肩包'], ['shoulder-bag', '单肩包'], ['crossbody-bag', '斜挎包'], ['handbag', '手提包'],
      ['waist-bag', '腰包'], ['hat', '帽子'], ['scarf', '围巾'], ['gloves', '手套'],
      ['belt', '腰带'], ['glasses', '眼镜'], ['watch', '手表'], ['necklace', '项链'],
      ['ring', '戒指'], ['earrings', '耳饰'],
    ].map(([id, name]) => ({ id, name })),
  },
];

export function getCategoryGroup(id: CategoryGroupId): CategoryGroup | undefined {
  return CATEGORY_GROUPS.find((group) => group.id === id);
}

export function getCategoryType(path: CategoryPath): CategoryType | undefined {
  return getCategoryGroup(path.groupId)?.types.find((type) => type.id === path.typeId);
}

export function getCategoryName(path: CategoryPath): string {
  return getCategoryType(path)?.name || '未识别分类';
}

export function isCategoryPath(value: unknown): value is CategoryPath {
  if (!value || typeof value !== 'object') return false;
  const path = value as CategoryPath;
  return typeof path.groupId === 'string' && typeof path.typeId === 'string' && !!getCategoryType(path);
}
