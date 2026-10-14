import { getCategoryName, isCategoryPath } from '../config/categories';
import type { CategoryGroupId, CategoryPath } from '../models/category';
import type { Garment, GarmentImage, Season } from '../models/garment';
import type { GarmentRepository } from '../repositories/garment-repository';
import type { GarmentFitting } from '../models/garment-fitting';
import { cloneFitting, fittingError, fittingMatches } from '../utils/garment-fitting';

export interface GarmentDraft {
  name?: string;
  category: CategoryPath;
  image: GarmentImage;
  color?: string;
  seasons?: Season[];
  style?: string;
  fit?: string;
  material?: string;
  brand?: string;
  purchasePrice?: number;
  purchaseDate?: string;
  note?: string;
  tags?: string[];
}

export interface GarmentFilter {
  query?: string;
  groupId?: CategoryGroupId;
  typeId?: string;
  color?: string;
  season?: Season;
  style?: string;
}

function normalizeDraft(draft: GarmentDraft): GarmentDraft {
  if (!isCategoryPath(draft.category)) throw new Error('请选择有效的衣物分类。');
  if (!draft.image || typeof draft.image.displayPath !== 'string' || !draft.image.displayPath) throw new Error('请选择衣物图片。');
  if (draft.image.overlayPath !== undefined && typeof draft.image.overlayPath !== 'string') throw new Error('试衣贴图路径无效。');
  if (draft.image.originalPath !== undefined && (typeof draft.image.originalPath !== 'string' || !draft.image.originalPath)) throw new Error('原照片路径无效。');
  if (draft.seasons !== undefined && (!Array.isArray(draft.seasons)
    || draft.seasons.some((season) => !['spring', 'summer', 'autumn', 'winter'].includes(season)))) {
    throw new Error('季节选择无效。');
  }
  if (draft.tags !== undefined && (!Array.isArray(draft.tags) || draft.tags.some((tag) => typeof tag !== 'string'))) {
    throw new Error('标签内容无效。');
  }
  if (draft.purchasePrice !== undefined && (!Number.isFinite(draft.purchasePrice) || draft.purchasePrice < 0)) {
    throw new Error('购买价格不能为负数。');
  }
  const purchaseDay = draft.purchaseDate ? new Date(`${draft.purchaseDate}T00:00:00.000Z`) : null;
  if (draft.purchaseDate && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.purchaseDate)
    || !purchaseDay || !Number.isFinite(purchaseDay.getTime())
    || purchaseDay.toISOString().slice(0, 10) !== draft.purchaseDate)) {
    throw new Error('购买日期请填写为 YYYY-MM-DD。');
  }
  return {
    ...draft,
    name: draft.name?.trim() || getCategoryName(draft.category),
    color: draft.color?.trim(),
    style: draft.style?.trim(),
    fit: draft.fit?.trim(),
    material: draft.material?.trim(),
    brand: draft.brand?.trim(),
    note: draft.note?.trim(),
    tags: draft.tags?.map((tag) => tag.trim()).filter(Boolean) || [],
  };
}

function createId(): string {
  return `garment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function filterGarments(garments: Garment[], filter: GarmentFilter): Garment[] {
  const query = filter.query?.trim().toLocaleLowerCase() || '';
  return garments.filter((item) =>
    (!query || item.name.toLocaleLowerCase().includes(query) || getCategoryName(item.category).toLocaleLowerCase().includes(query))
    && (!filter.groupId || item.category.groupId === filter.groupId)
    && (!filter.typeId || item.category.typeId === filter.typeId)
    && (!filter.color || item.color === filter.color)
    && (!filter.season || item.seasons?.includes(filter.season))
    && (!filter.style || item.style === filter.style));
}

export class GarmentService {
  constructor(private readonly repository: GarmentRepository) {}

  list(): Garment[] {
    return this.repository.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Garment | undefined {
    return this.repository.list().find((item) => item.id === id);
  }

  create(draft: GarmentDraft): Garment {
    const normalized = normalizeDraft(draft);
    const now = new Date().toISOString();
    const garment: Garment = { ...normalized, name: normalized.name || '', id: createId(), createdAt: now, updatedAt: now };
    this.repository.put(garment);
    return garment;
  }

  update(id: string, draft: GarmentDraft, expectedUpdatedAt?: string): Garment {
    const previous = this.get(id);
    if (!previous) throw new Error('衣物不存在，可能已被删除。');
    if (expectedUpdatedAt !== undefined && previous.updatedAt !== expectedUpdatedAt) throw new Error('衣物已修改，请返回重新打开编辑。');
    const normalized = normalizeDraft(draft);
    const garment: Garment = {
      ...normalized,
      fitting: fittingMatches(previous.fitting, normalized) ? cloneFitting(previous.fitting) : undefined,
      name: normalized.name || '',
      id,
      createdAt: previous.createdAt,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString(),
    };
    this.repository.put(garment);
    return garment;
  }

  saveFitting(id: string, fitting: GarmentFitting, expectedUpdatedAt: string): Garment {
    const previous = this.get(id);
    if (!previous) throw new Error('衣物不存在，可能已被删除。');
    if (previous.updatedAt !== expectedUpdatedAt) throw new Error('衣物已修改，请返回重新打开校准。');
    const error = fittingError(fitting);
    if (error) throw new Error(error);
    if (!fittingMatches(fitting, previous)) throw new Error('图片或品类已变更，请重新打开校准。');
    const garment = { ...previous, fitting: cloneFitting(fitting), updatedAt: new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString() };
    this.repository.put(garment);
    return garment;
  }

  delete(id: string): Garment {
    const garment = this.get(id);
    if (!garment) throw new Error('衣物不存在，可能已被删除。');
    this.repository.remove(id);
    return garment;
  }
}
