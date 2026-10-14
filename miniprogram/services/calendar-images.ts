/** 独立副本用于日期回顾，衣橱换图/删图不会清理这些照片。 */
export function archiveCalendarImage(source: string): Promise<string> {
  // 开发者工具的 USER_DATA_PATH 为 http://usr，仍属于本机文件目录。
  if (/^https?:/i.test(source) && !source.startsWith(`${wx.env.USER_DATA_PATH}/`)) return Promise.reject(new Error('日历只保存本机衣物照片。'));
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src: source, success: (info) => {
      if (!/^(jpeg|jpg|png|webp|gif|bmp)$/i.test(info.type)) { reject(new Error('图片格式暂不支持存入日历。')); return; }
      const extension = info.type === 'jpeg' ? 'jpg' : info.type;
      const destPath = `${wx.env.USER_DATA_PATH}/calendar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}.${extension}`;
      wx.getFileSystemManager().copyFile({ srcPath: source, destPath, success: () => resolve(destPath),
        fail: () => reject(new Error('日历照片保存失败，请检查本机存储空间后重试。')) });
    }, fail: () => reject(new Error('部分衣物照片无法读取，请先在衣橱修复后重试。')) });
  });
}
export function removeCalendarImage(filePath: string): Promise<void> {
  if (!filePath.startsWith(`${wx.env.USER_DATA_PATH}/`) || !/^calendar_[a-z0-9_-]+\.[a-z0-9]+$/i.test(filePath.slice(wx.env.USER_DATA_PATH.length + 1))) return Promise.resolve();
  return new Promise((resolve, reject) => wx.getFileSystemManager().unlink({ filePath, success: () => resolve(), fail: reject }));
}
