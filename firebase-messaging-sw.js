
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

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  const title =
    payload.notification?.title ||
    data.title ||
    'Cuộc gọi đến';

  const options = {
    body:
      payload.notification?.body ||
      data.body ||
      'Bạn có một cuộc gọi mới.',
    icon: '/favicon.ico',

    // Tách thông báo chat khỏi thông báo cuộc gọi.
    tag:
  data.type === 'private_chat'
    ? `private-chat-${data.messageId || data.chatId || 'message'}`
    : data.type === 'group_chat'
      ? `group-chat-${data.messageId || 'message'}`
      : `private-call-${data.callId || 'incoming'}`,

    renotify: true,

    data: {
  url: data.url || '/',
  callId: data.callId || '',
  type: data.type || '',
  chatId: data.chatId || '',
  senderId: data.senderId || '',
  messageId: data.messageId || ''
}
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || '/',
    self.location.origin
  ).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          await client.navigate(targetUrl);
        }
        return;
      }
    }

    await self.clients.openWindow(targetUrl);
  })());
});
