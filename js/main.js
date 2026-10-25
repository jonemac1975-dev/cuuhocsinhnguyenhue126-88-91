
import { state } from './app-state.js';
import { renderPosts } from './feed.js';
import { renderChatMessages, startChatListener, stopChatListener } from './chat.js';
import { renderEvents, loadEvents } from './events.js';
import { updateDirectoryList } from './directory.js';
import { updateUserUI } from './auth.js';
import { initAnnouncements, refreshAnnouncementPermissions } from './announcements.js';
import { initTikTok } from './tiktok.js';
import { initEditorialBoard } from './editorial-board.js';
import { initLive } from './live.js';



function scrollToForm(target) {
  const element = typeof target === 'string'
    ? document.querySelector(target)
    : target;
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}



export function switchTab(tabName) {
  state.activeTab = tabName;
  if (tabName !== 'chat') stopChatListener();
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const activeContent = document.getElementById(`tab-${tabName}`);
  if (activeContent) activeContent.classList.remove('hidden');

  const activeBtn = document.getElementById(`nav-${tabName}`);
  if (activeBtn) activeBtn.classList.add('active');

  document.getElementById('feed-composer')?.classList.toggle('hidden', tabName !== 'feed');

  const postsList = document.getElementById('posts-list');
  if (postsList) postsList.classList.toggle('hidden', tabName !== 'feed');

  if (tabName === 'feed') renderPosts();
  if (tabName === 'chat') { startChatListener(); renderChatMessages(); }
  if (tabName === 'events') loadEvents();
  if (tabName === 'directory') updateDirectoryList();
requestAnimationFrame(() => {
  if (tabName === 'feed') {
    const composer = document.getElementById('feed-composer');
    if (composer && !composer.classList.contains('hidden')) {
      composer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }

  const target = document.getElementById(`tab-${tabName}`);
  if (target && !target.classList.contains('hidden')) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
}

window.switchTab = switchTab;


document.addEventListener('DOMContentLoaded', () => {
  updateUserUI();
  loadEvents();
  renderPosts();
  updateDirectoryList();
  initAnnouncements();
  initTikTok();
  initEditorialBoard();
  initLive();
});
