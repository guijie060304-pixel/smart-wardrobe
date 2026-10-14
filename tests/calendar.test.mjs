import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { LocalOutfitCalendarRepository, CALENDAR_STORAGE_KEY } from '../miniprogram/repositories/outfit-calendar-repository.ts';
import { OutfitCalendarService } from '../miniprogram/services/outfit-calendar-service.ts';
import { archiveCalendarImage, removeCalendarImage } from '../miniprogram/services/calendar-images.ts';
import { calendarCells, calendarDateLabel, isCalendarDate, localDateKey, shiftCalendarMonth } from '../miniprogram/utils/calendar-date.ts';
import { DEFAULT_TRANSFORM } from '../miniprogram/config/try-on.ts';
import { DAY_LOOK_LIMIT } from '../miniprogram/utils/outfit-calendar.ts';

const require = createRequire(import.meta.url), stamp = '2026-10-13T08:00:00Z', date = '2026-10-13';
const garment = (id, category = { groupId: 'tops', typeId: 'tshirt' }) => ({ id, name: `衣物${id}`, category,
  image: { displayPath: `/user/garment_${id}.png` }, createdAt: stamp, updatedAt: stamp });
const top = garment('top'), bottom = garment('bottom', { groupId: 'bottoms', typeId: 'jeans' });
const outfit = (id, garmentId = top.id, layer = 'top') => ({ id, name: `穿搭${id}`, items: [{ garmentId, layer, transform: { ...DEFAULT_TRANSFORM } }],
  revision: 1, createdAt: stamp, updatedAt: stamp });
const a = outfit('a'), b = outfit('b', bottom.id, 'bottom');

test('抠图后新日期归档复制透明展示图，保留原图和历史日期副本互不影响', async () => {
  const clothing = garment('cutout'), look = outfit('cutout-look', clothing.id), env = setup([look], [clothing]), copied = [];
  env.images.save = async (source) => { copied.push(source); return `/user/calendar_cutout_${copied.length}.png`; };
  const oldDay = await env.service.addOutfits('2026-10-13', 0, [look.id]);
  const original = clothing.image.displayPath;
  clothing.image = { displayPath: '/user/garment_transparent.png', overlayPath: '/user/garment_transparent.png', originalPath: original };
  const newDay = await env.service.addOutfits('2026-10-14', 0, [look.id]);
  assert.deepEqual(copied, [original, '/user/garment_transparent.png']);
  assert.equal(newDay.looks[0].items[0].imagePath, '/user/calendar_cutout_2.png');
  assert.deepEqual(env.service.get('2026-10-13'), oldDay);
  clothing.image = { displayPath: original }; assert.deepEqual(env.service.get('2026-10-14'), newDay);
});

function setup(source = [a, b], garments = [top, bottom]) {
  const stored = new Map(), sources = new Map(source.map((item) => [item.id, structuredClone(item)]));
  let writes = 0, failWrite = false, failRead = false, copies = 0, failCopyAt = 0;
  const removed = [];
  globalThis.wx = {
    getStorageSync: (key) => { if (failRead) throw Error('读取失败'); return structuredClone(stored.get(key) || ''); },
    setStorageSync: (key, value) => { if (failWrite) throw Error('空间不足'); writes++; stored.set(key, structuredClone(value)); },
  };
  const images = { save: async () => { copies++; if (copies === failCopyAt) throw Error('照片复制失败'); return `/user/calendar_${copies}.png`; }, remove: async (path) => { removed.push(path); } };
  const repository = new LocalOutfitCalendarRepository();
  const service = new OutfitCalendarService(repository, { get: (id) => structuredClone(sources.get(id)) }, { list: () => structuredClone(garments) }, images);
  return { stored, sources, service, repository, removed, images, get writes() { return writes; }, get copies() { return copies; },
    failWrite: (value) => { failWrite = value; }, failRead: (value) => { failRead = value; }, failCopyAt: (value) => { failCopyAt = value; } };
}

test('日历按本地日期取今天，月历以周一开头并保留跨月日期、闰年和世纪边界', () => {
  assert.equal(localDateKey(new Date(2026, 9, 13, 0, 1)), date);
  for (const valid of [date, '2024-02-29', '2000-02-29', '1900-01-01', '2199-12-31']) assert.equal(isCalendarDate(valid), true);
  for (const invalid of ['2026-02-29', '2100-02-29', '2026-04-31', '2026-1-01', '2026-10-13T00:00Z', '1899-12-31', null]) assert.equal(isCalendarDate(invalid), false);
  assert.equal(shiftCalendarMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftCalendarMonth('2100-01-31', 1), '2100-02-28');
  assert.equal(shiftCalendarMonth('2026-01-31', -1), '2025-12-31');
  assert.throws(() => shiftCalendarMonth('2199-12-31', 1), /边界/);
  const cells = calendarCells(date, date, { [date]: { count: 2, hasNote: true } });
  assert.equal(cells.length, 42); assert.equal(cells[0].date, '2026-09-28');
  assert.equal(cells.filter((item) => item.inMonth).length, 31);
  assert.deepEqual(cells.find((item) => item.date === date), { date, day: 13, inMonth: true, selected: true, today: true, disabled: false, count: 2, hasNote: true });
  assert.equal(calendarDateLabel(date), '10月13日 · 星期二');
});

test('每日多套穿搭和注意事项独立持久保存，历史名称/照片/变换不随来源改动或删除', async () => {
  const env = setup();
  assert.deepEqual(env.service.list(), []);
  let day = await env.service.addOutfits(date, 0, [a.id, b.id]);
  assert.equal(day.looks.length, 2); assert.equal(env.copies, 2); assert.equal(env.writes, 1);
  day = env.service.saveNote(date, day.revision, '  下午开会带外套\n白鞋先清洁  ');
  assert.equal(day.note, '下午开会带外套\n白鞋先清洁'); assert.equal(day.looks.length, 2);
  const snapshot = structuredClone(day);
  env.sources.get(a.id).name = '新的名字'; env.sources.get(a.id).items[0].transform.scale = 2;
  env.sources.delete(b.id); top.image.displayPath = '/user/garment_changed.png';
  assert.deepEqual(env.service.get(date), snapshot); top.image.displayPath = '/user/garment_top.png';
  day.looks[0].items[0].transform.scale = 9; day.looks[0].name = '外部修改';
  assert.deepEqual(env.service.get(date), snapshot);
  assert.deepEqual([...env.stored.keys()], [CALENDAR_STORAGE_KEY]);
  assert.ok(!JSON.stringify(env.stored.get(CALENDAR_STORAGE_KEY)).includes('heightCm'));
});

test('注意事项可单独保存/清空，移除穿搭保留备注与其他日期，只清理对应存档副本', async () => {
  const env = setup();
  let day = env.service.saveNote(date, 0, '只记备注');
  day = await env.service.addOutfits(date, day.revision, [a.id, b.id]);
  const other = await env.service.addOutfits('2026-10-14', 0, [a.id]);
  const path = day.looks[0].items[0].imagePath;
  day = await env.service.removeLook(date, day.revision, day.looks[0].id);
  assert.equal(day.note, '只记备注'); assert.equal(day.looks.length, 1); assert.deepEqual(env.removed, [path]);
  assert.deepEqual(env.service.get(other.date), other); assert.equal(env.sources.size, 2);
  day = await env.service.removeLook(date, day.revision, day.looks[0].id);
  day = env.service.saveNote(date, day.revision, '   ');
  assert.equal(day.note, ''); assert.equal(day.looks.length, 0);
  assert.throws(() => env.service.saveNote(date, 0, '旧页面'), /已更改/);
});

test('照片复制中途失败或记录写入失败回滚新副本，不留下半套记录或改动原记录', async () => {
  const env = setup(); const original = env.service.saveNote(date, 0, '保留的注意事项');
  env.failCopyAt(2);
  await assert.rejects(env.service.addOutfits(date, original.revision, [a.id, b.id]), /复制失败/);
  assert.deepEqual(env.service.get(date), original); assert.deepEqual(env.removed, ['/user/calendar_1.png']);
  env.failCopyAt(0); env.failWrite(true);
  await assert.rejects(env.service.addOutfits(date, original.revision, [a.id]), /空间不足/);
  env.failWrite(false); assert.deepEqual(env.service.get(date), original);
  assert.ok(env.removed.includes('/user/calendar_3.png'));
});

test('照片准备期间其他页面保存会拒绝过期写入，保留新记录并清理此次副本', async () => {
  const env = setup();
  env.images.save = async () => { env.service.saveNote(date, 0, '另一个页面的新备注'); return '/user/calendar_conflict.png'; };
  await assert.rejects(env.service.addOutfits(date, 0, [a.id]), /已更改/);
  assert.equal(env.service.get(date).note, '另一个页面的新备注'); assert.equal(env.service.get(date).looks.length, 0);
  assert.deepEqual(env.removed, ['/user/calendar_conflict.png']);
});

test('重复/回收站/空选择和每日数量上限拒绝写入，缺失衣物保留文字位置', async () => {
  const many = Array.from({ length: DAY_LOOK_LIMIT + 1 }, (_, i) => outfit(`look${i}`));
  const env = setup(many);
  await assert.rejects(env.service.addOutfits(date, 0, []), /勾选/);
  await assert.rejects(env.service.addOutfits(date, 0, [many[0].id, many[0].id]), /勾选/);
  env.sources.get(many[0].id).deletedAt = stamp;
  await assert.rejects(env.service.addOutfits(date, 0, [many[0].id]), /回收站/); delete env.sources.get(many[0].id).deletedAt;
  const day = await env.service.addOutfits(date, 0, many.slice(0, DAY_LOOK_LIMIT).map((item) => item.id));
  const writes = env.writes, copies = env.copies;
  await assert.rejects(env.service.addOutfits(date, day.revision, [many.at(-1).id]), /最多/);
  assert.equal(env.writes, writes); assert.equal(env.copies, copies);
  const missing = setup([a], []); const missingDay = await missing.service.addOutfits(date, 0, [a.id]);
  assert.equal(missingDay.looks[0].items[0].imagePath, ''); assert.equal(missingDay.looks[0].items[0].name, '已删除的衣物');
  await assert.rejects(missing.service.addOutfits(date, missingDay.revision, [a.id]), /已经加入/);
});

test('坏快照、重复日期、无效照片路径及读写失败均不覆盖日历数据', async () => {
  const env = setup(); const day = await env.service.addOutfits(date, 0, [a.id]);
  const badLook = structuredClone(day); badLook.looks[0].items[0].imagePath = 'https://example.com/calendar_photo.png';
  for (const value of [{ version: 9, days: [] }, { version: 1, days: [day, day] }, { version: 1, days: [{ ...day, date: '2026-02-31' }] },
    { version: 1, days: [badLook] }, { version: 1, days: [{ ...day, note: 'x'.repeat(1001) }] }]) {
    env.stored.set(CALENDAR_STORAGE_KEY, value); const writes = env.writes;
    assert.throws(() => env.service.saveNote(date, 1, '不应覆盖'), /格式异常/); assert.equal(env.writes, writes);
  }
  env.stored.set(CALENDAR_STORAGE_KEY, { version: 1, days: [day] });
  assert.throws(() => env.service.saveNote(date, 1, 'x'.repeat(1001)), /1000/);
  env.failWrite(true); assert.throws(() => env.service.saveNote(date, 1, '新备注'), /空间不足/);
  env.failWrite(false); assert.deepEqual(env.service.get(date), day);
  env.failRead(true); assert.throws(() => env.service.get(date), /读取失败/);
});

test('日历照片只复制本地文件，清理严格限定专用文件名，不触碰原衣物/其他路径', async () => {
  const copied = [], removed = [];
  globalThis.wx = { env: { USER_DATA_PATH: '/user' }, getImageInfo: (options) => options.success({ type: 'png' }),
    getFileSystemManager: () => ({ copyFile: (options) => { copied.push(options); options.success(); }, unlink: (options) => { removed.push(options.filePath); options.success(); } }) };
  const archived = await archiveCalendarImage('/user/garment_source.png');
  assert.match(archived, /^\/user\/calendar_[a-z0-9_]+\.png$/); assert.equal(copied[0].srcPath, '/user/garment_source.png');
  await assert.rejects(archiveCalendarImage('https://example.com/image.png'), /本机/);
  for (const value of ['/user/garment_source.png', '/other/calendar_a.png', '/user/../calendar_a.png', '/user/nested/calendar_a.png']) await removeCalendarImage(value);
  assert.deepEqual(removed, []); await removeCalendarImage(archived); assert.deepEqual(removed, [archived]);
});

test('微信模拟器 http://usr 本地目录可复制/持久化/清理，外部网络地址仍被拒绝', async () => {
  const env = setup(); const removed = [];
  Object.assign(wx, { env: { USER_DATA_PATH: 'http://usr' }, getImageInfo: (options) => options.success({ type: 'png' }),
    getFileSystemManager: () => ({ copyFile: (options) => options.success(), unlink: (options) => { removed.push(options.filePath); options.success(); } }) });
  const path = await archiveCalendarImage('http://usr/garment_source.png');
  assert.match(path, /^http:\/\/usr\/calendar_/);
  env.images.save = async () => path;
  const day = await env.service.addOutfits(date, 0, [a.id]); assert.deepEqual(env.service.get(date), day);
  await assert.rejects(archiveCalendarImage('http://usr.example.com/garment_source.png'), /本机/);
  await removeCalendarImage(path); assert.deepEqual(removed, [path]);
});

function pageEnvironment() {
  const stored = new Map([
    ['smart-wardrobe.garments.v1', { version: 1, garments: structuredClone([top, bottom]) }],
    ['smart-wardrobe.outfits.v1', { version: 1, outfits: structuredClone([a, b]) }],
  ]);
  const files = new Set(), toasts = [], scrolls = [], modals = [];
  let failWrite = false, failCopy = false, pendingCopy = false;
  const copies = [];
  globalThis.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageSync: (key) => { assert.ok(!key.includes('body-profile')); return structuredClone(stored.get(key) || ''); },
    setStorageSync: (key, value) => { if (failWrite) throw Error('空间不足'); stored.set(key, structuredClone(value)); },
    getImageInfo: (options) => options.success({ type: 'png' }),
    getFileSystemManager: () => ({ copyFile: (options) => { if (failCopy) options.fail({}); else if (pendingCopy) copies.push(options); else { files.add(options.destPath); options.success(); } },
      unlink: (options) => { files.delete(options.filePath); options.success(); } }),
    nextTick: (callback) => callback(), pageScrollTo: (options) => scrolls.push(options), showToast: (options) => toasts.push(options.title),
    showModal: (options) => modals.push(options), enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
  };
  let definition; globalThis.Page = (value) => { definition = value; };
  const modulePath = require.resolve('../miniprogram/pages/outfit-calendar/index.ts'); delete require.cache[modulePath]; require(modulePath); delete require.cache[modulePath];
  const page = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  for (const [key, method] of Object.entries(definition)) if (typeof method === 'function') page[key] = method.bind(page);
  page.onLoad({ date }); page.onShow();
  return { page, stored, files, toasts, scrolls, modals, copies, failWrite: (value) => { failWrite = value; }, failCopy: (value) => { failCopy = value; }, pendingCopy: (value) => { pendingCopy = value; } };
}
const byId = (id) => ({ currentTarget: { dataset: { id } } });

test('日历页面跨搜索多选穿搭，添加时保留未保存备注，保存后切日重开仍有多套存档与标记', async () => {
  const env = pageEnvironment(), p = env.page;
  p.editNote(); p.onNoteInput({ detail: { value: '下午开会，带外套' } }); p.openOutfitPicker();
  p.toggleOutfit(byId(a.id)); p.onOutfitQuery({ detail: { value: b.name } }); p.toggleOutfit(byId(b.id));
  assert.equal(p.data.selectedOutfitIds.length, 2); await p.addSelectedOutfits();
  assert.equal(p.data.looks.length, 2); assert.equal(p.data.noteDirty, true); assert.equal(p.data.noteDraft, '下午开会，带外套');
  p.onSaveNote(); assert.equal(p.data.noteDirty, false); assert.equal(p.data.noteSaved, '下午开会，带外套');
  assert.equal(p.data.cells.find((cell) => cell.date === date).count, 2); assert.equal(p.data.cells.find((cell) => cell.date === date).hasNote, true);
  p.requestDate('2026-10-14'); assert.equal(p.data.looks.length, 0); assert.equal(p.data.noteSaved, '');
  p.requestDate(date); assert.equal(p.data.looks.length, 2); assert.equal(p.data.noteSaved, '下午开会，带外套');
  p.openOutfitPicker(); assert.ok(p.data.choices.every((choice) => choice.added));
  assert.equal(env.files.size, 2); p.onUnload();
});

test('备注切日确认与写入失败不会丢输入，成功才切换；外部冲突保留草稿并要求重读', () => {
  const env = pageEnvironment(), p = env.page;
  p.editNote(); p.onNoteInput({ detail: { value: '待保存' } }); p.requestDate('2026-10-14'); env.modals.at(-1).success({ confirm: false });
  assert.equal(p.data.selectedDate, date); assert.equal(p.data.noteDraft, '待保存');
  env.failWrite(true); p.requestDate('2026-10-14'); env.modals.at(-1).success({ confirm: true });
  assert.equal(p.data.selectedDate, date); assert.equal(p.data.noteDirty, true); assert.match(p.data.error, /空间不足/);
  env.failWrite(false); p.requestDate('2026-10-14'); env.modals.at(-1).success({ confirm: true });
  assert.equal(p.data.selectedDate, '2026-10-14'); p.requestDate(date); assert.equal(p.data.noteSaved, '待保存');
  p.editNote(); p.onNoteInput({ detail: { value: '本页草稿' } });
  const raw = env.stored.get(CALENDAR_STORAGE_KEY); raw.days[0].note = '另页更改'; raw.days[0].revision++; p.onShow();
  assert.equal(p.data.noteDraft, '本页草稿'); assert.match(p.data.error, /其他页面/);
  assert.equal(p.saveNote(), false); assert.equal(env.stored.get(CALENDAR_STORAGE_KEY).days[0].note, '另页更改');
  p.cancelNote(); assert.equal(p.data.noteSaved, '另页更改'); p.onUnload();
});

test('照片复制失败保留选择和日期；保存过程中禁止切日，离页后异步结果不更新已卸载页面', async () => {
  const env = pageEnvironment(), p = env.page;
  p.openOutfitPicker(); p.toggleOutfit(byId(a.id)); env.failCopy(true); await p.addSelectedOutfits();
  assert.equal(p.data.looks.length, 0); assert.deepEqual(p.data.selectedOutfitIds, [a.id]); assert.equal(p.data.saving, false); assert.equal(p.data.pickerOpen, true);
  env.failCopy(false); env.pendingCopy(true); const pending = p.addSelectedOutfits();
  assert.equal(p.data.saving, true); p.requestDate('2026-10-14'); assert.equal(p.data.selectedDate, date);
  p.onUnload(); p.setData = () => { throw Error('卸载后不应更新'); }; env.copies[0].success(); await pending;
  assert.equal(env.stored.get(CALENDAR_STORAGE_KEY).days[0].looks.length, 1);
});

test('日历删除取消保留记录，确认只移除本日存档；归档坏图有文字回退', async () => {
  const env = pageEnvironment(), p = env.page;
  p.openOutfitPicker(); p.toggleOutfit(byId(a.id)); p.toggleOutfit(byId(b.id)); await p.addSelectedOutfits();
  const removed = p.data.looks[0];
  p.onArchiveImageError({ currentTarget: { dataset: { path: removed.items[0].imagePath } } }); assert.equal(p.data.looks[0].pieces[0].failed, true);
  p.removeLook(byId(removed.id)); await env.modals.at(-1).success({ confirm: false }); assert.equal(p.data.looks.length, 2);
  p.removeLook(byId(removed.id)); await env.modals.at(-1).success({ confirm: true }); assert.equal(p.data.looks.length, 1); assert.equal(env.files.size, 1);
  assert.equal(env.stored.get('smart-wardrobe.outfits.v1').outfits.length, 2); assert.equal(env.stored.get('smart-wardrobe.garments.v1').garments.length, 2);
  p.onUnload();
});
