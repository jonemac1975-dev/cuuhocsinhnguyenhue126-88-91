
// js/live.js

import { auth } from './firebase-config.js';

const LIVE_API =
  'https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/live';

const LIVEKIT_MODULE =
  'https://esm.sh/livekit-client@2.15.6';

let livekitModulePromise = null;
let liveRoom = null;
let liveRole = null;
let liveBusy = false;
let liveInitialized = false;
let liveStatsTimer = null;
let liveStatsBusy = false;
let liveCommandTimer = null;
let liveCommandSendBusy = false;
let liveCommandRefreshBusy = false;
let liveCommandRequestVersion = 0;
let knownLiveCommandIds = new Set();
let liveCommandInitialized = false;

function getLiveElement(id) {
  return document.getElementById(id);
}

function setLiveStatus(message) {
  const element = getLiveElement('live-status');
  if (element) element.textContent = message;
}

function setLiveParticipantCount(count) {
  const element = getLiveElement('live-participant-count');
  if (element) {
    element.textContent = Number(count) || 0;
  }
}

async function refreshLiveStats() {
  const room = liveRoom;

  if (!room || liveStatsBusy) return;

  liveStatsBusy = true;

  try {
    const data = await callLiveApi('stats');

    // Chỉ cập nhật nếu vẫn là phòng Live ban đầu.
    if (liveRoom !== room) return;

    if (data.isLive) {
      setLiveParticipantCount(data.participantCount);
    }
  } catch (error) {
    console.warn('Không cập nhật được số người Live:', error.message);
  } finally {
    liveStatsBusy = false;
  }
}

function startLiveStatsPolling() {
  stopLiveStatsPolling();

  refreshLiveStats();

  liveStatsTimer = setInterval(() => {
    refreshLiveStats();
  }, 3000);
}

function stopLiveStatsPolling() {
  if (liveStatsTimer) {
    clearInterval(liveStatsTimer);
    liveStatsTimer = null;
  }
}

let liveLikeTimer = null;
let liveLikeBusy = false;
let liveLikeRefreshBusy = false;
let liveLikeInitialized = false;
let knownLiveLikeIds = new Set();

function showLiveHeart() {
  const overlay = getLiveElement('live-heart-overlay');
  if (!overlay) return;

  const heart = document.createElement('i');
  heart.className = 'fa-solid fa-heart absolute text-rose-500';
  heart.style.left = `${15 + Math.random() * 70}%`;
  heart.style.bottom = '0';
  heart.style.fontSize = `${20 + Math.random() * 18}px`;
  heart.style.opacity = '1';
  heart.style.transition =
    'transform 2.2s ease-out, opacity 2.2s ease-out';

  overlay.appendChild(heart);

  requestAnimationFrame(() => {
    heart.style.transform =
      `translate(${Math.random() * 50 - 25}px, -${180 + Math.random() * 100}px) scale(1.5)`;
    heart.style.opacity = '0';
  });

  setTimeout(() => heart.remove(), 2300);
}

function setLiveLikeCount(count) {
  const element = getLiveElement('live-like-count');
  if (element) element.textContent = Number(count) || 0;
}

async function sendLiveLike() {
  if (!liveRoom || liveLikeBusy) return;

  liveLikeBusy = true;

  try {
    const data = await callLiveApi('like');

    // Đánh dấu lượt Like vừa gửi để polling không phát hiệu ứng lần hai.
    if (data.like?.id) {
      knownLiveLikeIds.add(data.like.id);
    }

    showLiveHeart();
    await refreshLiveLikes();
  } catch (error) {
    console.error('Live Like error:', error);
    alert(error.message || 'Chưa gửi được lượt thích.');
  } finally {
    liveLikeBusy = false;
  }
}


async function refreshLiveLikes() {
  const room = liveRoom;

  if (!room || liveLikeRefreshBusy) return;

  liveLikeRefreshBusy = true;

  try {
    const data = await callLiveApi('likes');

    // Bỏ kết quả nếu phòng Live đã thay đổi hoặc bị ngắt.
    if (liveRoom !== room) return;

    if (!Array.isArray(data.likes)) return;

    setLiveLikeCount(Number(data.total) || 0);

    for (const like of data.likes) {
      if (!like.id || knownLiveLikeIds.has(like.id)) continue;

      knownLiveLikeIds.add(like.id);

      if (liveLikeInitialized) {
        showLiveHeart();
      }
    }

    liveLikeInitialized = true;

    if (knownLiveLikeIds.size > 100) {
      knownLiveLikeIds = new Set(
        data.likes.map(like => like.id).filter(Boolean)
      );
    }
  } catch (error) {
    console.warn('Không cập nhật được Live Likes:', error);
  } finally {
    liveLikeRefreshBusy = false;
  }
}


function startLiveLikePolling() {
  stopLiveLikePolling();
  knownLiveLikeIds = new Set();
  liveLikeInitialized = false;
  refreshLiveLikes();
  liveLikeTimer = setInterval(refreshLiveLikes, 2000);
}

function setLiveCommandVisible(visible) {
  const panel = document.getElementById('live-command-panel');
  if (panel) {
    panel.classList.toggle('hidden', !visible);
  }

  if (!visible) {
    const list = document.getElementById('live-command-list');
    if (list) {
      list.innerHTML = `
        <p id="live-command-empty" class="py-3 text-center text-xs text-stone-400">
          Chưa có command nào. Hãy gửi lệnh đầu tiên!
        </p>
      `;
    }

    knownLiveCommandIds.clear();
    liveCommandInitialized = false;
  }
}

function renderLiveCommands(commands = []) {
  const list = document.getElementById('live-command-list');
  if (!list) return;

  list.replaceChildren();

  if (!commands.length) {
    const empty = document.createElement('p');
    empty.className = 'py-3 text-center text-xs text-stone-400';
    empty.textContent = 'Chưa có command nào. Hãy gửi lệnh đầu tiên!';
    list.appendChild(empty);
    return;
  }

  commands.forEach(command => {
    const item = document.createElement('div');
    item.className = 'rounded-lg bg-stone-50 px-3 py-2';

    const header = document.createElement('div');
    header.className = 'mb-1 flex items-center justify-between gap-2';

    const name = document.createElement('span');
    name.className = 'truncate text-xs font-bold text-red-700';
    name.textContent = command.displayName || 'Thành viên';

    const time = document.createElement('span');
    time.className = 'shrink-0 text-[10px] text-stone-400';

    if (command.createdAt) {
      const date = new Date(command.createdAt);
      time.textContent = date.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    const text = document.createElement('p');
    text.className = 'whitespace-pre-wrap break-words text-sm text-stone-700';
    text.textContent = command.text || '';

    header.append(name, time);
    item.append(header, text);
    list.appendChild(item);
  });

  list.scrollTop = list.scrollHeight;
}

async function refreshLiveCommands() {
  if (!liveRoom || liveCommandRefreshBusy) return;

  liveCommandRefreshBusy = true;
  const requestVersion = liveCommandRequestVersion;

  try {
    const data = await callLiveApi('commands');

    // Bỏ kết quả cũ nếu Live đã ngắt hoặc chuyển phiên.
    if (!liveRoom || requestVersion !== liveCommandRequestVersion) {
      return;
    }

    const commands = Array.isArray(data.commands)
      ? data.commands
      : [];

    knownLiveCommandIds = new Set(
      commands.map(command => command.id).filter(Boolean)
    );

    renderLiveCommands(commands);
    liveCommandInitialized = true;
  } catch (error) {
    if (requestVersion === liveCommandRequestVersion) {
      console.error('Refresh Live Commands error:', error);
    }
  } finally {
    liveCommandRefreshBusy = false;
  }
}

function startLiveCommandPolling() {
  stopLiveCommandPolling();

  setLiveCommandVisible(true);
  knownLiveCommandIds.clear();
  liveCommandInitialized = false;

  refreshLiveCommands();

  liveCommandTimer = setInterval(() => {
    refreshLiveCommands();
  }, 3000);
}

function stopLiveCommandPolling() {
  if (liveCommandTimer) {
    clearInterval(liveCommandTimer);
    liveCommandTimer = null;
  }

  // Vô hiệu hóa kết quả của những yêu cầu đang chạy.
  liveCommandRequestVersion++;

  setLiveCommandVisible(false);
}

async function sendLiveCommand() {
  const input = getLiveElement('live-command-input');
  const button = getLiveElement('live-command-send');

  if (!input || !liveRoom || liveCommandSendBusy) return;

  const text = input.value.trim();
  if (!text) return;

  if (text.length > 500) {
    alert('Command không được vượt quá 500 ký tự.');
    return;
  }

  liveCommandSendBusy = true;
  if (button) button.disabled = true;

  try {
    await callLiveApi('command', { text });

    if (!liveRoom) return;

    input.value = '';

    // Tải lại ngay sau khi gửi thành công.
    await refreshLiveCommands();
  } catch (error) {
    console.error('Send Live Command error:', error);
    alert(error.message || 'Không gửi được command.');
  } finally {
    liveCommandSendBusy = false;

    if (button) {
      button.disabled = !liveRoom;
    }
  }
}

function stopLiveLikePolling() {
  if (liveLikeTimer) {
    clearInterval(liveLikeTimer);
    liveLikeTimer = null;
  }

  knownLiveLikeIds.clear();
  liveLikeInitialized = false;
}

function setLiveButton(id, visible, disabled = false) {
  const button = getLiveElement(id);
  if (!button) return;

  button.classList.toggle('hidden', !visible);
  button.disabled = disabled;
  button.classList.toggle('opacity-50', disabled);
  button.classList.toggle('cursor-not-allowed', disabled);
}

function setLiveButtons(role = null) {
  setLiveButton('live-start-btn', !role, liveBusy);
  setLiveButton('live-join-btn', !role, liveBusy);
  setLiveButton('live-end-btn', role === 'host', liveBusy);
}

function showLiveVideoContainer(show) {
  getLiveElement('live-video-container')
    ?.classList.toggle('hidden', !show);
}

function getVideoGrid() {
  return getLiveElement('live-video-grid');
}

function clearLiveVideoGrid() {
  const grid = getVideoGrid();
  if (grid) grid.replaceChildren();
}

async function getLiveKit() {
  if (!livekitModulePromise) {
    livekitModulePromise = import(LIVEKIT_MODULE);
  }

  return livekitModulePromise;
}

async function callLiveApi(action, extra = {}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error('Vui lòng đăng nhập trước khi sử dụng Live.');
  }

  const idToken = await user.getIdToken();

  const response = await fetch(LIVE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({ action, ...extra })
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('Worker trả về dữ liệu không hợp lệ.');
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Phiên đăng nhập hết hạn. Anh hãy đăng nhập lại.');
    }

    if (response.status === 403) {
      throw new Error(data.error || 'Tài khoản chưa có quyền sử dụng Live.');
    }

    if (response.status === 404 && action === 'join') {
      throw new Error('Hiện chưa có buổi Live nào đang diễn ra.');
    }

    if (response.status === 409) {
      throw new Error('Đã có buổi Live khác đang hoạt động.');
    }

    throw new Error(data.error || `Lỗi Live API (${response.status}).`);
  }

  const actionsWithoutLiveKitToken = [
    'end',
    'stats',
    'like',
    'likes',
    'command',
    'commands'
  ];

  if (
    !actionsWithoutLiveKitToken.includes(action) &&
    (!data.token || !data.serverUrl || !data.roomName)
  ) {
    console.error('LiveKit response check:', {
      action,
      status: response.status,
      fields: Object.keys(data),
      hasToken: Boolean(data.token),
      hasServerUrl: Boolean(data.serverUrl),
      hasRoomName: Boolean(data.roomName),
      response: {
        error: data.error,
        message: data.message
      }
    });

    throw new Error('Worker chưa trả về đủ thông tin kết nối LiveKit.');
  }

  return data;
}


function createTrackContainer(track, participant, isLocal = false) {
  const grid = getVideoGrid();
  if (!grid) throw new Error('Không tìm thấy vùng hiển thị video Live.');

  const trackId = track.sid || `${participant.identity}-${track.kind}`;

  const existing = grid.querySelector(
    `[data-live-track="${CSS.escape(trackId)}"]`
  );

  if (existing) return existing;

  const wrapper = document.createElement('div');
  wrapper.className =
    'relative overflow-hidden rounded-xl bg-black min-h-20';
  wrapper.dataset.liveTrack = trackId;

  const media = track.attach();

  media.autoplay = true;
  media.playsInline = true;
  media.classList.add('block', 'w-full');

  if (track.kind === 'video') {
    media.style.width = '100%';
    media.style.maxHeight = '70vh';
    media.style.objectFit = 'contain';
    media.muted = isLocal;
  } else {
    media.controls = false;
  }

  wrapper.appendChild(media);

  if (track.kind === 'video') {
    const label = document.createElement('div');
    label.className =
      'absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white';

    label.textContent =
      `${participant.name || participant.identity || 'Thành viên'}${isLocal ? ' (Bạn)' : ''}`;

    wrapper.appendChild(label);
  } else {
    wrapper.classList.add('hidden');
  }

  grid.appendChild(wrapper);

  if (track.kind === 'video') {
    showLiveVideoContainer(true);
  }

  return wrapper;
}

function removeTrackContainer(track) {
  const grid = getVideoGrid();
  if (!grid) return;

  const trackId = track.sid;
  if (!trackId) return;

  grid.querySelectorAll('[data-live-track]').forEach(element => {
    if (element.dataset.liveTrack === trackId) {
      element.remove();
    }
  });

  if (!grid.querySelector('video')) {
    showLiveVideoContainer(false);
  }
}

function bindRoomEvents(room) {
  const { RoomEvent } = window.__unusedLiveKitEvents || {};

  // Sự kiện được đăng ký từ module LiveKit ở connectToLive().
}

async function connectToLive(data, role) {
  const { Room, RoomEvent, Track } = await getLiveKit();

  const room = new Room({
    adaptiveStream: true,
    dynacast: true
  });

  liveRoom = room;
  liveRole = role;

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    try {
      createTrackContainer(track, participant, false);
    } catch (error) {
      console.error('Không thể hiển thị track Live:', error);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, track => {
    track.detach().forEach(element => element.remove());
    removeTrackContainer(track);
  });

  room.on(RoomEvent.ParticipantDisconnected, participant => {
    console.info('Thành viên rời Live:', participant.identity);
  });

  room.on(RoomEvent.Disconnected, () => {
    if (liveRoom !== room) return;

    liveRoom = null;
    liveRole = null;
    liveBusy = false;

    clearLiveVideoGrid();
    showLiveVideoContainer(false);
    setLiveButtons();
    setLiveStatus('Đã ngắt kết nối Live.');
    stopLiveStatsPolling();
    stopLiveLikePolling();
    stopLiveCommandPolling();
    setLiveParticipantCount(0);
  });

  await room.connect(data.serverUrl, data.token);

  if (role === 'host') {
    try {
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (error) {
      try {
        await callLiveApi('end');
      } catch (cleanupError) {
        console.error('Không thể dọn buổi Live sau lỗi camera:', cleanupError);
      }

      await room.disconnect();
      throw new Error(
        'Không mở được camera hoặc micro. Bạn kiểm tra quyền truy cập thiết bị rồi thử lại.'
      );
    }
  }

  // Hiển thị camera của người phát sau khi camera được bật.
  for (const publication of room.localParticipant.trackPublications.values()) {
    if (publication.track) {
      createTrackContainer(publication.track, room.localParticipant, true);
    }
  }

  setLiveButtons(role);
  showLiveVideoContainer(true);
  startLiveStatsPolling();
  startLiveLikePolling();
  startLiveCommandPolling();
  setLiveStatus(
    role === 'host'
      ? 'Đang phát trực tiếp. Camera và micro đã kết nối.'
      : 'Đang xem trực tiếp.'
  );
}

export function initLive() {
  if (liveInitialized) return;
  liveInitialized = true;

  window.openLivePanel = openLivePanel;
  window.closeLivePanel = closeLivePanel;
  window.startLive = startLive;
  window.joinLive = joinLive;
  window.endLive = endLive;

  getLiveElement('live-like-btn')?.addEventListener(
    'click',
    sendLiveLike
  );

  const commandForm = getLiveElement('live-command-form');

  if (commandForm && !commandForm.dataset.bound) {
    commandForm.dataset.bound = 'true';

    commandForm.addEventListener('submit', event => {
      event.preventDefault();
      sendLiveCommand();
    });
  }

  setLiveButtons();
}

export function openLivePanel() {
  const section = getLiveElement('live-section');

  if (!section) {
    alert('Không tìm thấy khung Live trong index.html.');
    return;
  }

  section.classList.remove('hidden');

  if (!liveRoom) {
    setLiveStatus('Chọn Bắt đầu Live để phát hoặc Tham gia xem nếu đã có buổi Live.');
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function startLive() {
  if (liveBusy || liveRoom) return;

  liveBusy = true;
  setLiveButtons();
  setLiveStatus('Đang tạo buổi Live và kết nối camera...');

  let sessionCreated = false;

  try {
    const data = await callLiveApi('start');
    sessionCreated = true;

    await connectToLive(data, 'host');
  } catch (error) {
    console.error('Start Live error:', error);

    if (sessionCreated && !liveRoom) {
      try {
        await callLiveApi('end');
      } catch (cleanupError) {
        console.error('Không thể kết thúc phiên Live lỗi:', cleanupError);
      }
    }

    setLiveStatus(error.message || 'Không thể bắt đầu Live.');
    alert(error.message || 'Không thể bắt đầu Live.');
  } finally {
    liveBusy = false;
    setLiveButtons(liveRole);
  }
}

export async function joinLive() {
  if (liveBusy || liveRoom) return;

  liveBusy = true;
  setLiveButtons();
  setLiveStatus('Đang kết nối với buổi Live...');

  try {
    const data = await callLiveApi('join');
    await connectToLive(data, 'viewer');
  } catch (error) {
    console.error('Join Live error:', error);

    setLiveStatus(error.message || 'Không thể tham gia Live.');
    alert(error.message || 'Không thể tham gia Live.');
  } finally {
    liveBusy = false;
    setLiveButtons(liveRole);
  }
}


export async function endLive() {
  if (liveBusy || !liveRoom || liveRole !== 'host') return;

  if (!confirm('Anh có chắc muốn kết thúc buổi Live cho tất cả mọi người?')) {
    return;
  }

  liveBusy = true;
  setLiveButtons(liveRole);
  setLiveStatus('Đang kết thúc buổi Live...');

  try {
    // Kết thúc buổi Live trên Worker trước.
    const result = await callLiveApi('end');

    if (!result.success) {
      throw new Error(result.message || 'Worker chưa xác nhận kết thúc Live.');
    }

    const room = liveRoom;
    liveRoom = null;
    liveRole = null;
    stopLiveStatsPolling();
    stopLiveLikePolling();
    stopLiveCommandPolling();
    setLiveParticipantCount(0);

    if (room) {
      await room.disconnect();
    }

    clearLiveVideoGrid();
    showLiveVideoContainer(false);

    // Khôi phục trạng thái các nút Live.
    setLiveButtons(null);
    setLiveStatus('Buổi Live đã kết thúc.');

    getLiveElement('live-section')?.classList.add('hidden');
    window.closePostComposer?.();

  } catch (error) {
    console.error('End Live error:', error);
    setLiveStatus(error.message || 'Không thể kết thúc Live.');
    alert(error.message || 'Không thể kết thúc Live.');
  } finally {
    liveBusy = false;
    setLiveButtons(liveRole);
  }
}


export async function closeLivePanel() {
  if (liveBusy) return;

  if (liveRole === 'host' && liveRoom) {
    const shouldEnd = confirm(
      'Bạn đang phát Live. Chọn OK để kết thúc buổi Live, hoặc Cancel để giữ buổi phát.'
    );

    if (shouldEnd) {
      await endLive();
      if (liveRoom) return;
    } else {
      // Giữ buổi phát, chỉ thu gọn khung giao diện.
      getLiveElement('live-section')?.classList.add('hidden');
      return;
    }
  } else if (liveRole === 'viewer' && liveRoom) {
    await liveRoom.disconnect();
  }

  getLiveElement('live-section')?.classList.add('hidden');
}

window.addEventListener('beforeunload', () => {
  // Ngắt thiết bị ở phía trình duyệt khi rời trang.
  // Nếu host đóng tab đột ngột, phiên trên Worker có thể cần được dọn riêng.
  if (liveRoom) {
    liveRoom.disconnect();
  }
});
