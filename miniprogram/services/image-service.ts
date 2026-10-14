import type { GarmentImage } from '../models/garment';
export class ImageSelectionCancelled extends Error {}

function mapImageError(error: { errMsg?: string }): Error {
  if (error.errMsg?.toLowerCase().includes('cancel')) return new ImageSelectionCancelled('已取消图片操作。');
  return new Error(error.errMsg || '图片操作失败，请重试。');
}

export function chooseImage(source: 'camera' | 'album'): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      success: (result) => {
        const path = result.tempFiles[0]?.tempFilePath;
        if (!path) { reject(new Error('未获取到图片文件。')); return; }
        wx.getImageInfo({
          src: path,
          success: () => resolve(path),
          fail: () => reject(new Error('图片无法读取，请重新选择。')),
        });
      },
      fail: (error) => reject(mapImageError(error)),
    });
  });
}

/** 调用微信原生图片编辑器，提供基础裁剪与方向调整。 */
export function editImage(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.editImage({
      src: path,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) => reject(mapImageError(error)),
    });
  });
}

export function saveImage(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success: (info) => {
        if (info.type === 'unknown') {
          reject(new Error('暂不支持该图片格式，请选择 JPG 或 PNG 图片。'));
          return;
        }
        const extension = info.type === 'jpeg' ? 'jpg' : info.type;
        const destination = `${wx.env.USER_DATA_PATH}/garment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}.${extension}`;
        wx.getFileSystemManager().copyFile({
          srcPath: path,
          destPath: destination,
          success: () => resolve(destination),
          fail: (error) => reject(new Error(error.errMsg || '图片保存失败，请检查本地空间。')),
        });
      },
      fail: () => reject(new Error('图片无法读取，请重新选择。')),
    });
  });
}

export function removeImage(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const prefix = `${wx.env.USER_DATA_PATH}/`;
    if (!path.startsWith(prefix) || !/^garment_[a-z0-9_-]+\.[a-z0-9]+$/i.test(path.slice(prefix.length))) {
      resolve();
      return;
    }
    wx.getFileSystemManager().unlink({
      filePath: path,
      success: () => resolve(),
      fail: (error) => reject(new Error(error.errMsg || '图片清理失败。')),
    });
  });
}

export function garmentImagePaths(image: GarmentImage): string[] {
  return [...new Set([image.displayPath, image.overlayPath, image.originalPath].filter((path): path is string => !!path))];
}

/** 同一临时 PNG 的展示/试衣引用只复制一次；准备失败仅回滚本次副本。 */
export async function saveGarmentImages(image: GarmentImage, dirtyPaths: Set<string>): Promise<{ image: GarmentImage; created: string[] }> {
  const copies = new Map<string, string>(), created: string[] = [];
  try {
    for (const path of garmentImagePaths(image)) {
      if (!dirtyPaths.has(path)) continue;
      const saved = await saveImage(path); copies.set(path, saved); created.push(saved);
    }
    return { image: { displayPath: copies.get(image.displayPath) || image.displayPath,
      overlayPath: image.overlayPath ? copies.get(image.overlayPath) || image.overlayPath : undefined,
      originalPath: image.originalPath ? copies.get(image.originalPath) || image.originalPath : undefined }, created };
  } catch (error) { await Promise.allSettled(created.map(removeImage)); throw error; }
}
