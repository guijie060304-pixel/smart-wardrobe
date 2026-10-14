// 开发环境回归：node scripts/qa-cutout.cjs <含 miniprogram-automator 与 @napi-rs/canvas 的 node_modules 目录>
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const dependencyRoot = process.argv[2];
if (!dependencyRoot) throw new Error('请传入测试工具的 node_modules 目录。');
const automator = require(path.join(dependencyRoot, 'miniprogram-automator'));
const { createCanvas, loadImage } = require(path.join(dependencyRoot, '@napi-rs/canvas'));
const root = path.resolve(__dirname, '..'), qa = path.join(root, 'docs/qa');
const keys = ['smart-wardrobe.garments.v1', 'smart-wardrobe.outfits.v1', 'smart-wardrobe.calendar.v1', 'smart-wardrobe.body-profile.v1'];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await wait(100); }
  throw new Error(message);
}
async function main() {
  let app;
  for (let attempt = 0; attempt < 10; attempt++) { try { app = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }); break; } catch (error) { if (attempt === 9) throw error; await wait(1000); } }
  const errors = [];
  const routePath = () => app.evaluate(() => getCurrentPages().slice(-1)[0].route);
  const navigate = async (url, method = 'navigateTo') => {
    await app.evaluate((target, name) => { wx[name]({ url: target }); return true; }, url, method);
    await until(async () => (await routePath()) === url.split('?')[0].slice(1), '页面导航未完成'); await wait(250);
  };
  const current = async () => ({ path: await routePath(),
    data: (key) => app.evaluate((name) => { const data = getCurrentPages().slice(-1)[0].data; return name ? data[name] : data; }, key || ''),
    setData: (values) => app.evaluate((patch) => { getCurrentPages().slice(-1)[0].setData(patch); }, values) });
  const canvasSize = async () => {
    await app.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.__qaSize = null;
      p.createSelectorQuery().select('#cutoutCanvas').boundingClientRect((value) => { p.__qaSize = value ? { width: value.width, height: value.height } : null; }).exec(); return true; });
    let size; await until(async () => { size = await app.evaluate(() => getCurrentPages().slice(-1)[0].__qaSize); return !!size; }, '无法读取画布尺寸'); return size;
  };
  app.on('exception', (error) => errors.push(error));
  let before, originalFiles, source;
  const report = {};
  try {
    before = await app.evaluate((names) => Object.fromEntries(names.map((name) => [name, wx.getStorageSync(name)])), keys);
    originalFiles = await app.evaluate(() => wx.getFileSystemManager().readdirSync(wx.env.USER_DATA_PATH));
    console.log('QA: captured original state');
    const canvas = createCanvas(512, 640), context = canvas.getContext('2d');
    context.fillStyle = '#d6c8b5'; context.fillRect(0, 0, 512, 640);
    context.fillStyle = '#b79f86'; context.fillRect(12, 430, 90, 125); context.fillStyle = '#667968'; context.fillRect(400, 70, 80, 70);
    context.fillStyle = '#315f95'; context.beginPath();
    const outline = [[180, 140], [215, 140], [225, 170], [287, 170], [297, 140], [332, 140], [442, 230], [390, 300], [350, 270], [350, 550], [162, 550], [162, 270], [122, 300], [70, 230]];
    outline.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath(); context.fill();
    context.strokeStyle = '#93938b'; context.lineWidth = 5; context.beginPath(); context.moveTo(210, 144); context.lineTo(256, 105); context.lineTo(302, 144); context.stroke();
    source = await app.evaluate((base64) => { const filename = wx.env.USER_DATA_PATH + '/qa_cutout_' + Date.now() + '.png'; wx.getFileSystemManager().writeFileSync(filename, base64, 'base64'); return filename; }, canvas.toBuffer('image/png').toString('base64'));
    if ((await routePath()) !== 'pages/wardrobe/index') await navigate('/pages/wardrobe/index', 'reLaunch');
    await navigate('/pages/garment-form/index'); let form = await current(); console.log('QA: garment form opened');
    await form.setData({ imagePath: source, imageDirty: true, groupIndex: 0, typeIndex: 0, name: '抠图合成验收衣物' });
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].openCutout(); });
    await until(async () => (await routePath()) === 'pages/garment-cutout/index', '未进入抠图页');
    let editor = await current(); await until(async () => await editor.data('ready') || !!(await editor.data('error')), '画布读取超时');
    assert.equal(await editor.data('ready'), true, await editor.data('error'));
    console.log('QA: editor canvas ready');
    const size = await canvasSize(), width = Number(size.width), height = Number(size.height), scale = Math.min(width / 512, height / 640);
    console.log('QA: canvas measured', width, height);
    const at = (x, y, identifier = 1) => ({ x: width / 2 + (x - 256) * scale, y: height / 2 + (y - 320) * scale, identifier });
    const gesture = async (method, touches) => app.evaluate((name, values) => { getCurrentPages().slice(-1)[0][name]({ touches: values }); }, method, touches);
    await gesture('onTouchStart', [at(48, 85)]); await gesture('onTouchMove', [at(465, 580)]); await gesture('onTouchEnd', []);
    assert.equal(await editor.data('hasRect'), true);
    const start = Date.now(); await app.evaluate(() => { getCurrentPages().slice(-1)[0].estimate(); });
    await until(async () => !(await editor.data('busy')), '估算未在期限内结束'); report.nativeEstimateMs = Date.now() - start;
    assert.equal(await editor.data('hasResult'), true, await editor.data('error'));
    console.log('QA: native segmentation finished', report.nativeEstimateMs);
    // 擦掉衣架，再用撤销/补画验证操作，双指介入应回滚待提交笔画。
    await app.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.selectTool({ currentTarget: { dataset: { tool: 'erase' } } }); p.changeBrush({ detail: { value: 12 } }); });
    await gesture('onTouchStart', [at(215, 145)]); await gesture('onTouchMove', [at(256, 104)]); await gesture('onTouchMove', [at(300, 145)]); await gesture('onTouchEnd', []);
    assert.equal(await editor.data('canUndo'), true);
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].undo(); });
    await gesture('onTouchStart', [at(215, 145)]); await gesture('onTouchMove', [at(256, 104)]); await gesture('onTouchMove', [at(300, 145)]); await gesture('onTouchEnd', []);
    await gesture('onTouchStart', [at(250, 400)]); await gesture('onTouchStart', [at(200, 300), at(300, 300, 2)]);
    await gesture('onTouchMove', [at(180, 300), at(320, 300, 2)]); await gesture('onTouchEnd', [at(180, 300)]); await gesture('onTouchEnd', []);
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].resetView(); }); await wait(200);
    await app.screenshot({ path: path.join(qa, 'phase7-cutout-editor.jpg') });
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].toggleBackground(); }); await wait(150);
    await app.screenshot({ path: path.join(qa, 'phase7-cutout-white.jpg') });
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].apply(); });
    await until(async () => (await routePath()) === 'pages/garment-form/index', '结果未返回表单'); form = await current();
    const draft = await form.data(); assert.equal(draft.originalPath, source); assert.equal(draft.imagePath, draft.overlayPath);
    console.log('QA: native PNG returned to form');
    assert.deepEqual(await app.evaluate((names) => Object.fromEntries(names.map((name) => [name, wx.getStorageSync(name)])), keys), before);
    // 读取微信实际导出的 PNG，验证透明背景、RGB 与双指误笔撤回。
    const png = await app.evaluate((filename) => wx.getFileSystemManager().readFileSync(filename, 'base64'), draft.imagePath);
    const decoded = await loadImage(Buffer.from(png, 'base64')), output = createCanvas(decoded.width, decoded.height), out = output.getContext('2d'); out.drawImage(decoded, 0, 0);
    const pixels = out.getImageData(0, 0, output.width, output.height).data;
    report.png = { width: output.width, height: output.height, transparentPixels: 0, visiblePixels: 0 };
    for (let i = 3; i < pixels.length; i += 4) pixels[i] ? report.png.visiblePixels++ : report.png.transparentPixels++;
    assert.ok(report.png.visiblePixels > 10000); assert.ok(report.png.transparentPixels > 1000); assert.equal(pixels[3], 0);
    assert.equal(pixels[(Math.floor(output.height * .65) * output.width + Math.floor(output.width / 2)) * 4 + 3], 255);
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].saveGarment(); });
    await until(async () => (await routePath()) === 'pages/wardrobe/index', '保存未返回衣橱');
    const saved = await app.evaluate(() => wx.getStorageSync('smart-wardrobe.garments.v1').garments.find((g) => g.name === '抠图合成验收衣物'));
    assert.equal(saved.image.displayPath, saved.image.overlayPath); assert.notEqual(saved.image.originalPath, saved.image.displayPath);
    await navigate('/pages/garment-form/index?id=' + encodeURIComponent(saved.id)); form = await current();
    assert.equal(await form.data('originalPath'), saved.image.originalPath);
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].openCutout(); }); await until(async () => (await routePath()) === 'pages/garment-cutout/index', '重新抠图未打开');
    editor = await current(); await until(async () => await editor.data('ready'), '原图重新载入失败');
    // 手动圈选与原图重新加载，随后应用，验证重新处理不丢原照片。
    const secondSize = await canvasSize(), w2 = Number(secondSize.width), h2 = Number(secondSize.height), s2 = Math.min(w2 / 512, h2 / 640);
    const point = (x, y) => ({ x: w2 / 2 + (x - 256) * s2, y: h2 / 2 + (y - 320) * s2, identifier: 1 });
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].selectTool({ currentTarget: { dataset: { tool: 'polygon' } } }); });
    await gesture('onTouchStart', [point(...outline[0])]); for (const xy of [...outline.slice(1), outline[0]]) await gesture('onTouchMove', [point(...xy)]); await gesture('onTouchEnd', []);
    assert.equal(await editor.data('hasResult'), true); await app.evaluate(() => { getCurrentPages().slice(-1)[0].apply(); });
    await until(async () => (await routePath()) === 'pages/garment-form/index', '圈选未返回'); form = await current(); assert.equal(await form.data('originalPath'), saved.image.originalPath);
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].saveGarment(); }); await until(async () => (await routePath()) === 'pages/wardrobe/index', '再次保存未结束');
    if ((await routePath()) !== 'pages/wardrobe/index') await navigate('/pages/wardrobe/index', 'reLaunch');
    await app.evaluate((id) => { const p = getCurrentPages().slice(-1)[0]; p.startOutfitMode(); p.openGarment({ currentTarget: { dataset: { id } } }); p.toggleDraftBoard(); }, saved.id);
    const board = { data: (key) => app.evaluate((name) => getCurrentPages().slice(-1)[0].selectComponent('#wardrobeBoard')?.data[name], key) };
    await until(async () => !(await board.data('loading')), '搭配画布未载入'); assert.equal(await board.data('renderError'), ''); assert.deepEqual(await board.data('warnings'), []);
    await app.screenshot({ path: path.join(qa, 'phase7-cutout-board.jpg') });
    await app.evaluate((id) => { getCurrentPages().slice(-1)[0].removeSelected({ currentTarget: { dataset: { id } } }); }, saved.id);
    await navigate('/pages/garment-form/index?id=' + encodeURIComponent(saved.id));
    const beforeRestore = await app.evaluate(() => wx.getStorageSync('smart-wardrobe.garments.v1').garments.find((g) => g.name === '抠图合成验收衣物'));
    await app.evaluate(() => {
      const app = getApp(); app.__qaModal = wx.showModal;
      wx.showModal = (options) => { if (options.title === '恢复原照片') options.success({ confirm: true, cancel: false }); else app.__qaModal(options); };
      getCurrentPages().slice(-1)[0].restoreOriginal(); wx.showModal = app.__qaModal; delete app.__qaModal;
    });
    assert.equal((await current()).path, 'pages/garment-form/index');
    assert.equal(await (await current()).data('imagePath'), saved.image.originalPath);
    await app.evaluate(() => { getCurrentPages().slice(-1)[0].saveGarment(); }); await until(async () => (await routePath()) === 'pages/wardrobe/index', '恢复原图未保存');
    const restored = await app.evaluate(() => wx.getStorageSync('smart-wardrobe.garments.v1').garments.find((g) => g.name === '抠图合成验收衣物'));
    assert.equal(restored.image.displayPath, saved.image.originalPath); assert.equal(restored.image.overlayPath, undefined);
    assert.equal(await app.evaluate((filename) => { try { wx.getFileSystemManager().accessSync(filename); return true; } catch { return false; } }, beforeRestore.image.displayPath), false);
    report.restoreOriginalSaved = true;
    report.draftOnlyUntilSave = true; report.persistedSharedPng = true; report.originalPreservedOnReprocess = true; report.manualPolygon = true; report.boardLoaded = true;
    assert.deepEqual(errors, []); report.exceptions = errors;
  } finally {
    // 原始存储与专属测试文件必须恢复，禁止遗留合成衣物。
    if (before) await app.evaluate((snapshot) => { for (const [name, value] of Object.entries(snapshot)) { if (value === '' || value === undefined) wx.removeStorageSync(name); else wx.setStorageSync(name, value); } }, before);
    await app.evaluate(() => { const app = getApp(); if (app.__qaModal) { wx.showModal = app.__qaModal; delete app.__qaModal; } });
    if (originalFiles) await app.evaluate((files) => { const fs = wx.getFileSystemManager(), root = wx.env.USER_DATA_PATH + '/'; for (const filename of fs.readdirSync(wx.env.USER_DATA_PATH))
      if (!files.includes(filename) && /^(garment_[a-z0-9_-]+\.[a-z0-9]+|qa_cutout_\d+\.png)$/i.test(filename)) { try { fs.unlinkSync(root + filename); } catch {} } }, originalFiles);
    await app.evaluate(() => { wx.disableAlertBeforeUnload(); });
    if ((await routePath()) !== 'pages/wardrobe/index') await navigate('/pages/wardrobe/index', 'reLaunch');
    await app.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.browseGarments(); p.onShow(); });
    if (before) assert.deepEqual(await app.evaluate((names) => Object.fromEntries(names.map((name) => [name, wx.getStorageSync(name)])), keys), before);
    app.disconnect();
  }
  report.originalDataRestored = true; fs.writeFileSync(path.join(qa, 'phase7-cutout-results.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
