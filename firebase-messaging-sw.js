
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

messaging.onBackgroundMessage(async (payload) => {
  console.log('[FCM SW] Nhận background message:', payload);

  const data = payload.data || {};
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
