
import { state } from './app-state.js';
import { renderPosts } from './feed.js';
import { renderChatMessages, startChatListener, stopChatListener } from './chat.js';
import { renderEvents, loadEvents } from './events.js';
import { updateDirectoryList } from './directory.js';
import { updateUserUI } from './auth.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { initAnnouncements, refreshAnnouncementPermissions } from './announcements.js';
import { initTikTok } from './tiktok.js';
import { initEditorialBoard } from './editorial-board.js';
import { initLive } from './live.js';
import { getMessaging, getToken, onMessage, deleteToken} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { app, auth, db } from "./firebase-config.js";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const VAPID_KEY = "BBo94a2c_TnPUGbZ8vn8vRMg7IVAa2IpUrbVWPQPgOq3myyQ5YIR7Kr1zauRhkH_kTTPqGh21TLPkK827GNYcYA";
const messaging = getMessaging(app);


async function enableCallNotifications() {
  const user = auth.currentUser;

  if (!user) {
    alert("Bạn cần đăng nhập trước khi cài đặt thông báo.");
    return;
  }

  if (!("Notification" in window)) {
    alert("Trình duyệt này không hỗ trợ thông báo.");
    return;
  }

  const memberRef = doc(db, "members", user.uid);

  try {
    // Đọc trạng thái token hiện tại trên tài khoản.
    const memberSnap = await getDoc(memberRef);
    const currentToken = memberSnap.exists()
      ? memberSnap.data().fcmToken || ""
      : "";

    // Nếu đang bật trên tài khoản này thì click để tắt.
    if (currentToken) {
      await updateDoc(memberRef, {
        fcmToken: "",
        fcmTokenUpdatedAt: serverTimestamp()
      });

      console.log("[FCM] Đã tắt thông báo cuộc gọi cho tài khoản này.");
      updateCallNotificationButton(false);
      alert("Bạn muốn tắt thông báo");
      return;
    }

    // Nếu chưa bật thì tiến hành đăng ký.
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      alert("Bạn chưa cấp quyền thông báo.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      throw new Error("Firebase chưa cấp FCM token.");
    }

    await setDoc(
      memberRef,
      {
        fcmToken: token,
        fcmTokenUpdatedAt: serverTimestamp()
      },
      { merge: true }
    );

    console.log("[FCM] Đã bật thông báo cuộc gọi.");
    updateCallNotificationButton(true);
    alert("Bạn muốn bật thông báo");
  } catch (error) {
    console.error("[FCM] Không đổi được trạng thái:", error);
    alert("Chưa đổi được trạng thái thông báo: " +
      (error.message || error));
  }
}

window.enableCallNotifications = enableCallNotifications;



const callNotificationButton = document.getElementById(
  'call-notification-toggle'
);

if (
  callNotificationButton &&
  !callNotificationButton.dataset.bound
) {
  callNotificationButton.dataset.bound = 'true';

  callNotificationButton.addEventListener('click', () => {
    window.enableCallNotifications();
  });
}

const mobileCallNotificationButton = document.getElementById(
  'mobile-call-notification-toggle'
);

if (
  mobileCallNotificationButton &&
  !mobileCallNotificationButton.dataset.bound
) {
  mobileCallNotificationButton.dataset.bound = 'true';

  mobileCallNotificationButton.addEventListener('click', () => {
    window.enableCallNotifications();
  });
}




function updateCallNotificationButton(isEnabled) {
  const buttons = [
    document.getElementById('call-notification-toggle'),
    document.getElementById('mobile-call-notification-toggle')
  ].filter(Boolean);

  buttons.forEach((button) => {
    button.classList.toggle('is-enabled', isEnabled);
    button.setAttribute('aria-pressed', String(isEnabled));

    if (button.id === 'mobile-call-notification-toggle') {
      button.innerHTML = isEnabled
        ? '<i class="fa-solid fa-bell text-base"></i><span class="text-[10px] font-semibold mt-0.5">Đang bật</span>'
        : '<i class="fa-solid fa-bell-slash text-base"></i><span class="text-[10px] font-semibold mt-0.5">Thông báo</span>';
    } else {
      button.innerHTML = isEnabled ? '🔔 Tắt' : '🔕 Bật';
    }
  });
}




onMessage(messaging, async (payload) => {
  console.log('[FCM] Nhận thông báo khi trang đang mở:', payload);

  const data = payload.data || {};

  if (!('Notification' in window) ||
      Notification.permission !== 'granted') {
    return;
  }

  // Cuộc gọi đến khi tab đang chạy nền hoặc bị ẩn.
  if (data.type === 'private_call') {
    if (document.visibilityState === 'visible') return;

    try {
      const registration = await navigator.serviceWorker.ready;

      await registration.showNotification(
        data.title || '📞 Cuộc gọi đến',
        {
          body: data.body || 'Bạn có một cuộc gọi mới.',
          icon: '/favicon.ico',
          tag: `private-call-${data.callId || 'incoming'}`,
          renotify: true,
          requireInteraction: true,
          data: {
            url: data.url || (
              data.callId
                ? `/?incomingCallId=${encodeURIComponent(data.callId)}`
                : '/'
            ),
            type: 'private_call',
            callId: data.callId || '',
            senderId: data.senderId || ''
          }
        }
      );
    } catch (error) {
      console.warn('[FCM] Không hiển thị được thông báo cuộc gọi:', error);
    }

    return;
  }

  // Giữ nguyên xử lý thông báo chat.
  if (
    data.type !== 'private_chat' &&
    data.type !== 'group_chat'
  ) return;

  try {
    const registration = await navigator.serviceWorker.ready;

    await registration.showNotification(
      data.title || '💬 Tin nhắn mới',
      {
        body: data.body || 'Bạn có tin nhắn mới.',
        icon: '/favicon.ico',
        tag: data.type === 'group_chat'
          ? `group-chat-${data.messageId || 'message'}`
          : `private-chat-${data.chatId || 'message'}`,
        renotify: true,
        data: {
          url: data.url || '/',
          type: data.type,
          chatId: data.chatId || '',
          senderId: data.senderId || '',
          messageId: data.messageId || ''
        }
      }
    );
  } catch (error) {
    console.warn('[FCM] Không hiển thị được thông báo chat:', error);
  }
});



async function registerMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Trình duyệt không hỗ trợ Service Worker.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js'
    );

    await navigator.serviceWorker.ready;
    } catch (error) {
    console.error('Không đăng ký được Messaging Service Worker:', error);
  }
}


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

  // Cập nhật màu nút đang chọn trên thanh điều hướng mobile
  document.querySelectorAll('[id^="m-nav-"]').forEach((button) => {
    button.classList.remove('text-amber-600');
    button.classList.add('text-stone-400');
  });

  const activeMobileBtn = document.getElementById(`m-nav-${tabName}`);
  if (activeMobileBtn) {
    activeMobileBtn.classList.remove('text-stone-400');
    activeMobileBtn.classList.add('text-amber-600');
  }


  document.getElementById('feed-composer')?.classList.toggle('hidden', tabName !== 'feed');
  document.getElementById('chat-mode-switcher')?.classList.toggle('hidden', tabName !== 'chat');

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


async function syncCallNotificationButton(user = auth.currentUser) {
  if (!user) {
    updateCallNotificationButton(false);
    return;
  }

  try {
    const memberSnap = await getDoc(doc(db, 'members', user.uid));

    // Bỏ kết quả nếu tài khoản đã thay đổi trong lúc đang đọc.
    if (auth.currentUser?.uid !== user.uid) return;

    const token = memberSnap.exists()
      ? memberSnap.data().fcmToken || ''
      : '';

    updateCallNotificationButton(Boolean(token));
  } catch (error) {
    console.warn('[FCM] Không đọc được trạng thái thông báo:', error);
  }
}


window.switchTab = switchTab;


document.addEventListener('DOMContentLoaded', () => {
   onAuthStateChanged(auth, (user) => {
  syncCallNotificationButton(user);
});
  updateUserUI();
  registerMessagingServiceWorker();
  loadEvents();
  renderPosts();
  updateDirectoryList();
  initAnnouncements();
  initTikTok();
  initEditorialBoard();
  initLive();
});
