
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDloJ2Ra8xN1IvUD0yj7aU_BjF_-2Fq7fE",
  authDomain: "cuuhocsinh126.firebaseapp.com",
  databaseURL: "https://cuuhocsinh126-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cuuhocsinh126",
  storageBucket: "cuuhocsinh126.firebasestorage.app",
  messagingSenderId: "214410037671",
  appId: "1:214410037671:web:c9555a1b530ebebb78ce82"
});

const messaging = firebase.messaging();

const BADGE_DB_NAME = 'cuuhocsinh126-badges';
const BADGE_DB_VERSION = 1;
const BADGE_STORE = 'conversations';

function openBadgeDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      BADGE_DB_NAME,
      BADGE_DB_VERSION
    );

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(BADGE_STORE)) {
        db.createObjectStore(BADGE_STORE, {
          keyPath: 'key'
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateBadgeRecord(key, updater) {
  const db = await openBadgeDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BADGE_STORE, 'readwrite');
    const store = tx.objectStore(BADGE_STORE);
    const request = store.get(key);

    request.onsuccess = () => {
      const current = request.result || {
        key,
        count: 0,
        eventIds: []
      };

      const updated = updater(current);

      if (updated) {
        store.put(updated);
      }
    };

    tx.oncomplete = () => {
      db.close();
      resolve();
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function updateAppBadge() {
  try {
    const badgeApi = self.navigator;

    if (!badgeApi || typeof badgeApi.setAppBadge !== 'function') {
      console.log('[FCM SW] Thiết bị chưa hỗ trợ App Badge.');
      return;
    }

    const db = await openBadgeDB();

    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(BADGE_STORE, 'readonly');
      const request = tx.objectStore(BADGE_STORE).getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);

      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    });

    const total = records.reduce(
      (sum, item) => sum + Math.max(0, Number(item.count) || 0),
      0
    );

    if (total === 0) {
      if (typeof badgeApi.clearAppBadge === 'function') {
        await badgeApi.clearAppBadge();
      } else {
        await badgeApi.setAppBadge(0);
      }
    } else {
      await badgeApi.setAppBadge(total);
    }

    console.log('[FCM SW] Tổng badge:', total);

  } catch (error) {
    console.warn(
      '[FCM SW] Lỗi cập nhật badge:',
      error?.message || error
    );
  }
}

async function incrementUnreadBadge(data) {
  try {
    const key = String(data.badgeKey || '');
    const eventId = String(data.badgeEventId || '');

    if (
      !/^(group|private:.+)$/.test(key) ||
      !eventId
    ) {
      return;
    }

    await updateBadgeRecord(key, current => {
      const eventIds = Array.isArray(current.eventIds)
        ? current.eventIds
        : [];

      // Không cộng lại nếu FCM gửi trùng một tin nhắn.
      if (eventIds.includes(eventId)) {
        return null;
      }

      return {
        key,
        count: Math.max(0, Number(current.count) || 0) + 1,
        eventIds: [...eventIds, eventId].slice(-300)
      };
    });

    await updateAppBadge();

  } catch (error) {
    console.error(
      '[FCM SW] Lỗi tăng badge:',
      error?.message || error
    );
  }
}

async function clearUnreadBadge(key) {
  try {
    if (!key) return;

    await updateBadgeRecord(key, current => ({
      ...current,
      count: 0
    }));

    await updateAppBadge();

    console.log('[FCM SW] Đã xóa badge:', key);

  } catch (error) {
    console.error(
      '[FCM SW] Lỗi xóa badge:',
      error?.message || error
    );
  }
}

messaging.onBackgroundMessage(async (payload) => {
  console.log('[FCM SW] Nhận background message:', payload);

	const data = payload.data || {};
	await incrementUnreadBadge(data);
	const title = data.title || 'Cuộc gọi đến';

  const options = {
    body: data.body || 'Bạn có một cuộc gọi mới.',
    tag: data.type === 'private_chat'
      ? `private-chat-${data.messageId || data.chatId || 'message'}`
      : data.type === 'group_chat'
        ? `group-chat-${data.messageId || 'message'}`
        : `private-call-${data.callId || 'incoming'}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || '/',
      callId: data.callId || '',
      type: data.type || '',
      chatId: data.chatId || '',
      senderId: data.senderId || '',
      messageId: data.messageId || ''
    }
  };

  try {
    console.log('[FCM SW] Permission:', Notification.permission);
    console.log('[FCM SW] Đang gọi showNotification:', {
      title,
      type: data.type,
      callId: data.callId
    });

    await self.registration.showNotification(title, options);

    console.log('[FCM SW] SHOW_NOTIFICATION_SUCCESS:', data.callId || '');
  } catch (error) {
    console.error('[FCM SW] SHOW_NOTIFICATION_FAILED:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    });
  }
});

self.addEventListener('message', (event) => {
  const message = event.data || {};

  if (message.type === 'CHAT_BADGE_INCREMENT') {
    event.waitUntil(
      incrementUnreadBadge(message)
    );
  }

  if (message.type === 'CHAT_BADGE_CLEAR') {
    event.waitUntil(
      clearUnreadBadge(message.badgeKey)
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await updateAppBadge();
  })());
});

self.addEventListener('notificationclick', (event) => {
  const notificationData = event.notification.data || {};
  event.notification.close();

  let targetUrl = notificationData.url || '/';

  if (
    notificationData.type === 'private_call' &&
    notificationData.callId
  ) {
    targetUrl = `/?incomingCallId=${encodeURIComponent(notificationData.callId)}`;
  }

  const url = new URL(targetUrl, self.location.origin);

  if (url.origin !== self.location.origin) {
    url.href = self.location.origin + '/';
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // Ưu tiên tab đang mở: chỉ focus, tuyệt đối không navigate/reload.
    for (const client of windows) {
      if (
        client.url.startsWith(self.location.origin) &&
        'focus' in client
      ) {
        await client.focus();

        if (notificationData.type === 'private_call') {
          client.postMessage({
            type: 'PRIVATE_CALL_NOTIFICATION_CLICK',
            callId: notificationData.callId || ''
          });
        }

        return;
      }
    }

    // Chỉ mở trang mới nếu hiện không có tab nào của website.
    await self.clients.openWindow(url.href);
  })());
});
