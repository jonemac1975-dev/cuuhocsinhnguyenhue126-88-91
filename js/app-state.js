
export const state = {
  currentUser: null,
  authStatus: 'guest',
  isAdmin: false,
  activeTab: 'feed',
  currentCategory: 'ALL',
  posts: [],
  messages: [],
  events: [],
  directory: []
};

export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}


export function canUseMemberFeatures() {
  return state.authStatus === 'approved' || state.isAdmin === true;
}

export function requireMemberAccess(action = 'thực hiện chức năng này') {
  if (canUseMemberFeatures()) return true;

  const message = state.authStatus === 'pending'
    ? 'Tài khoản đang chờ Admin duyệt. Anh chỉ có thể cập nhật hồ sơ cá nhân.'
    : state.authStatus === 'rejected'
      ? 'Tài khoản đã bị từ chối. Vui lòng liên hệ Admin.'
      : 'Anh cần đăng nhập bằng tài khoản đã được duyệt để ' + action + '.';

  alert(message);
  return false;
}
