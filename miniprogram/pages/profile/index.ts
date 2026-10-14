import { BODY_TEMPLATES } from '../../config/body';
import type { BodyProfile } from '../../models/body-profile';
import { bodyProfileService } from '../../services/instances';

Page({
  data: { profile: null as BodyProfile | null, templateName: '', loadError: '' },
  onShow() { this.loadProfile(); },
  loadProfile() {
    try {
      const profile = bodyProfileService.get();
      this.setData({ profile, templateName: BODY_TEMPLATES.find((item) => item.id === profile?.template)?.name || '', loadError: '' });
    } catch (error) {
      this.setData({ loadError: error instanceof Error ? error.message : '身材读取失败。', profile: null });
    }
  },
  editBody() { wx.navigateTo({ url: '/pages/body-settings/index' }); },
  viewBody() { wx.switchTab({ url: '/pages/try-on/index' }); },
});
