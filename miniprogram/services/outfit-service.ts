import { getTryOnLayer } from '../config/try-on';
import type { Garment } from '../models/garment';
import type { Outfit, OutfitItem, OutfitBoardItem } from '../models/outfit';
import type { OutfitRepository } from '../repositories/outfit-repository';
import { assertOutfitItems, cloneOutfit, cloneOutfitItems, normalizeOutfitName, outfitItemsSignature } from '../utils/outfit-validation';
import { assertBoard, cloneBoard, completeBoard } from '../utils/outfit-board';

export interface OutfitDraft { name: string; items: OutfitItem[]; kind?: 'free' | 'try-on'; board?: OutfitBoardItem[] }
export class OutfitService {
  constructor(private readonly repository: OutfitRepository, private readonly garments: { list(): Garment[] }) {}
  list(mode: 'active' | 'deleted' | 'all' = 'active'): Outfit[] {
    return this.repository.list().filter((item) => mode === 'all' || (mode === 'deleted' ? !!item.deletedAt : !item.deletedAt))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(cloneOutfit);
  }
  get(id: string, includeDeleted = false): Outfit | undefined {
    const outfit = this.repository.list().find((item) => item.id === id);
    return outfit && (includeDeleted || !outfit.deletedAt) ? cloneOutfit(outfit) : undefined;
  }
  private checked(id: string, revision: number, includeDeleted = false): Outfit {
    const outfit = this.get(id, includeDeleted);
    if (!outfit) throw new Error('穿搭不存在或已移入回收站，请重新打开列表。');
    if (outfit.revision !== revision) throw new Error('这套穿搭已在其他页面更改，请重新打开后再编辑。');
    return outfit;
  }
  private validateDraft(draft: OutfitDraft, previousItems: OutfitItem[] = []): OutfitDraft {
    const name = normalizeOutfitName(draft.name);
    assertOutfitItems(draft.items);
    const garments = this.garments.list();
    for (const item of draft.items) {
      const garment = garments.find((entry) => entry.id === item.garmentId);
      if (!garment || getTryOnLayer(garment) !== item.layer) {
        const previous = previousItems.find((entry) => entry.garmentId === item.garmentId);
        // 原有失效引用原样保留；不允许凭空新增或修改失效位置。
        if (!previous || outfitItemsSignature([previous]) !== outfitItemsSignature([item])) {
          throw new Error('部分衣物已删除或分类改变，请先替换或移除。');
        }
      }
    }
    return { name, items: cloneOutfitItems(draft.items) };
  }
  create(draft: OutfitDraft): Outfit {
    const normalized = this.validateDraft(draft);
    if (draft.board !== undefined) assertBoard(draft.board, normalized.items);
    if (draft.kind !== undefined && draft.kind !== 'free' && draft.kind !== 'try-on') throw new Error('穿搭类型无效。');
    const now = new Date().toISOString();
    const outfit: Outfit = { ...normalized, id: `outfit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`,
      revision: 1, createdAt: now, updatedAt: now, ...(draft.kind ? { kind: draft.kind } : {}), ...(draft.board ? { board: cloneBoard(draft.board) } : {}) };
    this.repository.put(outfit);
    return cloneOutfit(outfit);
  }
  createFree(items: OutfitItem[], board?: OutfitBoardItem[], optionalName = ''): Outfit {
    if (board !== undefined) assertBoard(board, items);
    if (optionalName.trim()) return this.create({ name: optionalName, items, kind: 'free', board: completeBoard(items, board) });
    const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
    const base = `自由搭配 · ${now.getMonth() + 1}月${now.getDate()}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const names = new Set(this.list('all').map((item) => item.name));
    let name = base, number = 2;
    while (names.has(name)) name = `${base}（${number++}）`;
    return this.create({ name, items, kind: 'free', board: completeBoard(items, board) });
  }
  saveBoard(id: string, revision: number, board: OutfitBoardItem[]): Outfit {
    const previous = this.checked(id, revision);
    assertBoard(board, previous.items);
    const outfit = { ...previous, board: cloneBoard(board), revision: previous.revision + 1, updatedAt: new Date().toISOString() };
    this.repository.put(outfit); return cloneOutfit(outfit);
  }
  update(id: string, revision: number, draft: OutfitDraft): Outfit {
    const previous = this.checked(id, revision);
    const normalized = this.validateDraft(draft, previous.items);
    const outfit: Outfit = { ...previous, ...normalized, ...(previous.board ? { board: completeBoard(normalized.items, previous.board) } : {}), revision: previous.revision + 1, updatedAt: new Date().toISOString() };
    this.repository.put(outfit);
    return cloneOutfit(outfit);
  }
  rename(id: string, revision: number, name: string): Outfit {
    const previous = this.checked(id, revision);
    const outfit = { ...previous, name: normalizeOutfitName(name), revision: previous.revision + 1, updatedAt: new Date().toISOString() };
    this.repository.put(outfit);
    return cloneOutfit(outfit);
  }
  delete(id: string, revision: number): void {
    const previous = this.checked(id, revision);
    const now = new Date().toISOString();
    this.repository.put({ ...previous, deletedAt: now, updatedAt: now, revision: previous.revision + 1 });
  }
  restore(id: string, revision: number): Outfit {
    const previous = this.checked(id, revision, true);
    if (!previous.deletedAt) throw new Error('这套穿搭已恢复，请重新读取列表。');
    const { deletedAt: _deletedAt, ...active } = previous;
    const outfit = { ...active, updatedAt: new Date().toISOString(), revision: previous.revision + 1 };
    this.repository.put(outfit);
    return cloneOutfit(outfit);
  }
  references(garmentId: string): Outfit[] {
    return this.list('all').filter((outfit) => outfit.items.some((item) => item.garmentId === garmentId));
  }
}
