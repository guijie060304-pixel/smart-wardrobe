// switchTab 不支持查询参数；入口意图只在本次导航中消费，不写入本地数据。
let sequence = 0;
let matchingRequest = 0;

export function openWardrobeMatching(): void {
  const request = ++sequence;
  matchingRequest = request;
  wx.switchTab({
    url: '/pages/wardrobe/index',
    fail: () => {
      if (matchingRequest === request) matchingRequest = 0;
      wx.showToast({ title: '暂时无法打开自由搭配，请重试', icon: 'none' });
    },
  });
}

export function consumeWardrobeMatchingRequest(): boolean {
  const requested = matchingRequest !== 0;
  matchingRequest = 0;
  return requested;
}
