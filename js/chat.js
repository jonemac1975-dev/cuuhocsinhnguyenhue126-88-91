
import { state, escapeHtml, requireMemberAccess } from './app-state.js';
import { db, auth } from './firebase-config.js';
import { collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp, doc, updateDoc, arrayUnion, arrayRemove, deleteField, getDoc, setDoc, where, deleteDoc} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';



let chatUnsubscribe = null;
let chatListenerUid = null;
let chatStarting = false;
let replyingTo = null;
let selectedChatMedia = null;
let chatMediaStatusTimer = null;
let privateChatUnsubscribe = null;
let privateChatId = null;
let privateChatTarget = null;
let privateChatSending = false;
let selectedPrivateChatMedia = null;
// Trạng thái gọi thoại riêng 1–1
let privateCallUnsubscribe = null;
let privateCallDocId = null;
let privateCallPeerConnection = null;
let privateCallLocalStream = null;
let privateCallRemoteAudio = null;
let privateCallIceUnsubscribe = [];
let privateCallBusy = false;

function setPrivateChatMediaStatus(message, type = '') {
  const status = document.getElementById('private-chat-media-status');
  if (!status) return;

  status.textContent = message;
  status.classList.toggle('hidden', !message);
  status.classList.toggle('text-red-600', type === 'error');
  status.classList.toggle('text-green-600', type === 'success');
  status.classList.toggle('text-stone-500', !type);
}


function setChatMode(mode) {
  const isPrivate = mode === 'private';

  document.getElementById('group-chat-panel')
    ?.classList.toggle('hidden', isPrivate);

  document.getElementById('private-chat-panel')
    ?.classList.toggle('hidden', !isPrivate);

  document.getElementById('private-chat-notice')
    ?.classList.toggle('hidden', !isPrivate);

  const groupButton = document.getElementById('chat-mode-group');
  const privateButton = document.getElementById('chat-mode-private');

  groupButton?.classList.toggle('bg-amber-600', !isPrivate);
  groupButton?.classList.toggle('text-white', !isPrivate);
  groupButton?.classList.toggle('bg-stone-100', isPrivate);
  groupButton?.classList.toggle('text-stone-700', isPrivate);

  privateButton?.classList.toggle('bg-amber-600', isPrivate);
  privateButton?.classList.toggle('text-white', isPrivate);
  privateButton?.classList.toggle('bg-stone-100', !isPrivate);
  privateButton?.classList.toggle('text-stone-700', !isPrivate);
}

document.getElementById('chat-mode-group')
  ?.addEventListener('click', () => setChatMode('group'));

document.getElementById('chat-mode-private')
  ?.addEventListener('click', () => setChatMode('private'));

function populatePrivateChatMembers() {
  const select = document.getElementById('private-chat-member');
  const user = auth.currentUser;

  if (!select || !user) return;

  const currentValue = select.value;

  const members = (Array.isArray(state.directory) ? state.directory : [])
    .filter(member =>
      member.uid &&
      member.uid !== user.uid &&
      member.status === 'approved'
    )
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

  select.innerHTML = '<option value="">-- Danh sách --</option>';

  members.forEach(member => {
    const option = document.createElement('option');
    option.value = member.uid;
    option.textContent = member.name || 'Thành viên';
    select.appendChild(option);
  });

  if (members.some(member => member.uid === currentValue)) {
    select.value = currentValue;
  }
}

document.getElementById('chat-mode-private')
  ?.addEventListener('click', populatePrivateChatMembers);


function setChatMediaStatus(message, type = 'loading') {
  let status = document.getElementById('chat-media-status');

  if (!status) {
    status = document.createElement('div');
    status.id = 'chat-media-status';
    status.className = 'mx-1 mb-2 rounded-lg px-3 py-2 text-sm';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const form = document.getElementById('chat-form');
    const messages = document.getElementById('chat-messages');

    if (form) {
      form.insertAdjacentElement('beforebegin', status);
    } else if (messages) {
      messages.insertAdjacentElement('afterend', status);
    } else {
      return;
    }
  }

  clearTimeout(chatMediaStatusTimer);
  status.classList.remove('hidden', 'bg-amber-50', 'text-amber-800', 'bg-green-50', 'text-green-800', 'bg-red-50', 'text-red-700');

  if (!message) {
    status.classList.add('hidden');
    status.textContent = '';
    return;
  }

  const icons = {
    loading: '⏳ ',
    success: '✅ ',
    error: '⚠️ '
  };

  status.classList.add(
    type === 'success' ? 'bg-green-50' : type === 'error' ? 'bg-red-50' : 'bg-amber-50',
    type === 'success' ? 'text-green-800' : type === 'error' ? 'text-red-700' : 'text-amber-800'
  );

  status.textContent = (icons[type] || '') + message;
  status.classList.remove('hidden');

  if (type === 'success') {
    chatMediaStatusTimer = setTimeout(() => setChatMediaStatus(''), 4000);
  }
}



function formatChatTime(value) {
  if (!value) return 'Đang gửi...';
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}


function updateReplyPreview() {
  const preview = document.getElementById('chat-reply-preview');
  if (!preview) return;

  if (!replyingTo) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
    return;
  }

  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0 border-l-4 border-amber-500 pl-2">
        <p class="font-semibold text-amber-800">Đang trả lời ${escapeHtml(replyingTo.senderName)}</p>
        <p class="truncate text-stone-600">${escapeHtml(replyingTo.text)}</p>
      </div>
      <button type="button" id="chat-cancel-reply" class="shrink-0 px-2 text-stone-500 hover:text-red-600" aria-label="Hủy trả lời">✕</button>
    </div>
  `;

  document.getElementById('chat-cancel-reply').onclick = () => {
    replyingTo = null;
    updateReplyPreview();
  };
}

function setReplyTo(messageId) {
  const message = state.messages.find(item => item.id === messageId);
  if (!message) return;

  replyingTo = {
    messageId: message.id,
    senderName: message.senderName || 'Bạn học',
    text: message.text || ''
  };

  updateReplyPreview();
  document.getElementById('chat-input')?.focus();
}


async function toggleChatLike(messageId) {
  if (!requireMemberAccess('thả tim tin nhắn')) return;

  const user = auth.currentUser;
  if (!user) return;

  const message = state.messages.find(item => item.id === messageId);
  if (!message) return;

  const likedBy = Array.isArray(message.likedBy) ? message.likedBy : [];
  const alreadyLiked = likedBy.includes(user.uid);

  try {
    await updateDoc(doc(db, 'chatMessages', messageId), {
      likedBy: alreadyLiked ? arrayRemove(user.uid) : arrayUnion(user.uid)
    });

  } catch (error) {
    console.error('Lỗi thả tim:', error.code, error.message, error);
    alert(`Lỗi thả tim: ${error.code || 'unknown'}\n${error.message || 'Không rõ nguyên nhân'}`);
  }

}

const CHAT_MEDIA_DELETE_URL = 'https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/chat/media/delete';

async function deleteChatMedia(messageId) {
  if (!requireMemberAccess('xóa media tin nhắn')) return;

  const user = auth.currentUser;
  const message = state.messages.find(item => item.id === messageId);
  if (!user || !message || !['image', 'video'].includes(message.mediaType)) return;

  const isAdmin = state.isAdmin === true;
  if (message.senderId !== user.uid && !isAdmin) {
    alert('Bạn không có quyền xóa media này.');
    return;
  }

  if (!confirm('Bạn chắc muốn xóa tin nhắn cùng tệp media này không?')) return;


  setChatMediaStatus(
    message.mediaType === 'video' ? 'Đang xóa video và tin nhắn…' : 'Đang xóa ảnh và tin nhắn…'
  );

  try {
    const token = await user.getIdToken();
    const response = await fetch(CHAT_MEDIA_DELETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ messageId })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Xóa media thất bại.');

    setChatMediaStatus('Đã xóa media và tin nhắn thành công.', 'success');
  } catch (error) {
    console.error('Lỗi xóa media chat:', error);
    setChatMediaStatus(error.message || 'Chưa xóa được media. Bạn thử lại nhé.', 'error');
  }

}


async function recallChatMessage(messageId) {
  if (!requireMemberAccess('thu hồi tin nhắn')) return;

  const user = auth.currentUser;
  const message = state.messages.find(item => item.id === messageId);

  if (!user || !message || message.recalled === true) return;

  const isAdmin = state.isAdmin === true;

  if (message.senderId !== user.uid && !isAdmin) {
    alert('Bạn không có quyền thu hồi tin nhắn này.');
    return;
  }

  // Tạm thời xử lý tin nhắn văn bản và sticker.
  // Ảnh/video cần quy trình riêng để xóa tệp Cloudinary an toàn.
  if (['image', 'video'].includes(message.mediaType) && message.mediaUrl) {
    alert('Tin nhắn có ảnh/video cần xử lý media riêng. Hãy dùng nút “Xóa media” hiện có.');
    return;
  }

  if (!confirm('Bạn chắc muốn thu hồi tin nhắn này không?')) return;

  try {
    await updateDoc(doc(db, 'chatMessages', messageId), {
      text: 'Tin nhắn đã được thu hồi',
      recalled: true,
      recalledAt: serverTimestamp(),
      stickerId: deleteField(),
      mediaType: deleteField(),
      mediaUrl: deleteField(),
      mediaPublicId: deleteField(),
      mediaFormat: deleteField()
    });
  } catch (error) {
    console.error('Lỗi thu hồi tin nhắn:', error);
    alert('Chưa thu hồi được tin nhắn. Bạn thử lại nhé.');
  }
}


function renderChatTextWithLinks(text) {
  const escapeHtmlText = value => escapeHtml(value);

  return escapeHtmlText(text).replace(
    /https?:\/\/[^\s<>"']+/gi,
    url => {
      // Tách dấu câu cuối câu khỏi URL
      const match = url.match(/^(.*?)([.,!?;:)\]}]+)?$/);
      const cleanUrl = match ? match[1] : url;
      const trailing = match && match[2] ? match[2] : '';

      try {
        const parsed = new URL(cleanUrl);

        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return url;
        }

        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 break-all font-medium ${'text-amber-200'} hover:opacity-80">${cleanUrl}</a>${trailing}`;
      } catch {
        return url;
      }
    }
  );
}


export function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (!state.messages.length) {
    container.innerHTML = '<p class="text-center text-stone-400 text-sm py-6">Chưa có tin nhắn. Hãy gửi lời chào đầu tiên!</p>';
    return;
  }

  container.innerHTML = state.messages.map(m => {
    const isMe = state.currentUser && m.senderId === state.currentUser.uid;
    const canDeleteMedia = isMe || state.isAdmin === true;
    const canRecall = isMe || state.isAdmin === true;
    const isRecalled = m.recalled === true;
const member = state.directory.find(
  item => item.uid === m.senderId || item.id === m.senderId
);

const avatar = escapeHtml(
  member?.avatar ||
  m.avatar ||
  'https://api.dicebear.com/7.x/bottts/svg?seed=Member'
);
    const stickerIds = ['1f602', '1f60d', '1f970', '1f44d', '2764-fe0f', '1f389', '1f64f', '1f923', '1f973', '1f917'];
    const stickerHtml = stickerIds.includes(m.stickerId)
      ? `<img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${m.stickerId === '2764-fe0f' ? '2764' : m.stickerId}.png" alt="Sticker" class="w-28 h-28 object-contain">`
      : '';
    const reply = m.replyTo?.senderName !== undefined ? m.replyTo : null;
    const replyHtml = reply
      ? `<div class="mb-2 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-2 text-xs text-stone-600"><p class="font-semibold">↩ ${escapeHtml(reply.senderName || 'Bạn học')}</p><p class="whitespace-pre-wrap break-words">${escapeHtml(reply.text || '')}</p></div>`
      : '';

    let mediaHtml = '';
    if (m.mediaType === 'image' && m.mediaUrl) {
      mediaHtml = `<a href="${escapeHtml(m.mediaUrl)}" target="_blank" rel="noopener noreferrer" class="block overflow-hidden rounded-xl"><img src="${escapeHtml(m.mediaUrl)}" alt="Ảnh trong tin nhắn" loading="lazy" class="block max-w-full max-h-80 rounded-xl object-contain"></a>`;
    } else if (m.mediaType === 'video' && m.mediaUrl) {
      mediaHtml = `<video controls preload="metadata" class="block w-full max-h-80 rounded-xl bg-black"><source src="${escapeHtml(m.mediaUrl)}" type="video/${escapeHtml(m.mediaFormat || 'mp4')}">Trình duyệt không hỗ trợ phát video.</video>`;
    }


const textHtml = m.text
  ? `<div class="p-2 sm:p-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap break-words ${isMe ? 'bg-amber-600 text-white rounded-tr-none' : 'bg-white text-stone-800 border border-stone-200 rounded-tl-none'} shadow-sm">${renderChatTextWithLinks(m.text)}</div>`
  : '';


 const messageHtml = isRecalled
  ? `<div class="p-2 sm:p-3 rounded-2xl text-xs italic text-stone-500 bg-stone-100 border border-stone-200">Tin nhắn đã được thu hồi</div>`
  : m.stickerId
    ? stickerHtml
    : mediaHtml
      ? `<div class="space-y-2">${mediaHtml}${textHtml}</div>`
      : textHtml;

    return `
      <div class="flex items-start gap-2 ${isMe ? 'flex-row-reverse' : ''}">
  <img src="${avatar}" alt="" class="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-full bg-amber-100 object-cover mt-0.5">
  <div class="max-w-[85%] sm:max-w-[75%] min-w-0">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1 ${isMe ? 'justify-end' : ''}">
  <span class="text-[11px] sm:text-xs font-bold text-stone-700">${escapeHtml(m.senderName || 'Bạn học')}</span>
  <span class="text-[9px] sm:text-[10px] text-stone-400">${escapeHtml(m.timestamp || '')}</span>
</div>
          ${replyHtml}
          ${messageHtml}
<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" data-like-id="${escapeHtml(m.id)}" class="text-xs hover:scale-105 transition">
              ${(Array.isArray(m.likedBy) && state.currentUser && m.likedBy.includes(state.currentUser.uid)) ? '❤️' : '🤍'} ${Array.isArray(m.likedBy) ? m.likedBy.length : 0}
            </button>
            ${!isRecalled ? `
  <button type="button" data-like-id="${escapeHtml(m.id)}" class="text-xs hover:scale-105 transition">
    ${(Array.isArray(m.likedBy) && state.currentUser && m.likedBy.includes(state.currentUser.uid)) ? '❤️' : '🤍'} ${Array.isArray(m.likedBy) ? m.likedBy.length : 0}
  </button>
  <button type="button" data-reply-id="${escapeHtml(m.id)}" class="text-[11px] sm:text-xs text-amber-700 hover:underline">↩ Trả lời</button>

  ${canRecall
    ? `<button type="button" data-recall-id="${escapeHtml(m.id)}" class="text-xs text-red-700 hover:underline">↩ Thu hồi</button>`
    : ''}
  ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.onclick = event => {
    const likeButton = event.target.closest('[data-like-id]');
    if (likeButton) {
      toggleChatLike(likeButton.dataset.likeId);
      return;
    }

    const deleteMediaButton = event.target.closest('[data-delete-media-id]');
    if (deleteMediaButton) {
      deleteChatMedia(deleteMediaButton.dataset.deleteMediaId);
      return;
    }


	const recallButton = event.target.closest('[data-recall-id]');
	if (recallButton) {
	  recallChatMessage(recallButton.dataset.recallId);
	  return;
	}

    const replyButton = event.target.closest('[data-reply-id]');
    if (replyButton) setReplyTo(replyButton.dataset.replyId);
  };

  container.scrollTop = container.scrollHeight;
}

export function startChatListener() {
  const user = auth.currentUser;

  if (!user || (state.authStatus !== 'approved' && state.isAdmin !== true)) {
    stopChatListener();
    return;
  }

  if (chatListenerUid === user.uid && chatUnsubscribe) return;
  if (chatStarting) return;

  stopChatListener();
  chatStarting = true;
  chatListenerUid = user.uid;

  const messagesQuery = query(
    collection(db, 'chatMessages'),
    orderBy('createdAt', 'desc'),
    limit(100)
  );


  chatUnsubscribe = onSnapshot(messagesQuery, snapshot => {
    state.messages = snapshot.docs.map(d => {
      const data = d.data({ serverTimestamps: 'estimate' });
      return {
        id: d.id,
        senderId: data.senderId || '',
        senderName: data.senderName || 'Thành viên',
        avatar: data.avatar || data.senderAvatar || '',
        text: data.text || '',
        replyTo: data.replyTo || null,
        likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
        stickerId: data.stickerId || null,
        mediaType: data.mediaType || null,
        mediaUrl: data.mediaUrl || '',
        mediaPublicId: data.mediaPublicId || '',
        mediaFormat: data.mediaFormat || '',
	recalled: data.recalled === true,
	recalledAt: data.recalledAt || null,
	createdAt: data.createdAt || null,
	timestamp: formatChatTime(data.createdAt)

      };
    }).reverse();

    renderChatMessages();
  }, error => {
    console.error('Lỗi tải tin nhắn chat:', error);
    const container = document.getElementById('chat-messages');
    if (container) {
      container.innerHTML = '<p class="text-sm text-red-600 text-center p-4">Không tải được tin nhắn. Bạn kiểm tra kết nối mạng.</p>';
    }
    stopChatListener();
  });

  chatStarting = false;
}

export function stopChatListener() {
  if (chatUnsubscribe) chatUnsubscribe();
  chatUnsubscribe = null;
  chatListenerUid = null;
  chatStarting = false;
}



export async function handleSendMessage(e) {
  e.preventDefault();

  if (!requireMemberAccess('gửi tin nhắn')) return;

  const user = auth.currentUser;
  const profile = state.currentUser;
  const input = document.getElementById('chat-input');
  const text = input?.value.trim() || '';
  const media = selectedChatMedia;

  if (!user || !profile || user.uid !== profile.uid || (!text && !media)) return;

  if (text.length > 5000) {
    alert('Tin nhắn không được vượt quá 5.000 ký tự.');
    return;
  }

  const submitButton = document.querySelector('#chat-form button[type="submit"]');
  const mediaButton = document.getElementById('chat-media-button');
  if (submitButton) submitButton.disabled = true;
  if (mediaButton) mediaButton.disabled = true;

  try {
    let mediaData = {};

    if (media) {
      const isVideo = media.type.startsWith('video/');
      const resourceType = isVideo ? 'video' : 'image';
      const uploadPreset = isVideo
        ? 'cuuhocsinh126_videos'
        : 'cuuhocsinh126_images';

      const formData = new FormData();
      formData.append('file', media);
      formData.append('upload_preset', uploadPreset);

      setChatMediaStatus(
        isVideo ? 'Đang tải video , vui lòng chờ…' : 'Đang tải ảnh, vui lòng chờ…'
      );

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/cuuhocsinh126/${resourceType}/upload`,
        {
          method: 'POST',
          body: formData
        }
      );

      const result = await response.json();

      if (!response.ok || !result.secure_url || !result.public_id) {
        throw new Error(result.error?.message || 'Upload Cloudinary thất bại.');
      }

      mediaData = {
        mediaType: isVideo ? 'video' : 'image',
        mediaUrl: result.secure_url,
        mediaPublicId: result.public_id,
        mediaFormat: result.format || ''
      };
    }

    await addDoc(collection(db, 'chatMessages'), {
      senderId: user.uid,
      senderName: profile.displayName || 'Thành viên',
      avatar: profile.photoURL || '',
      text,
      createdAt: serverTimestamp(),
      replyTo: replyingTo ? { ...replyingTo } : null,
      ...mediaData
    });

    if (media) {
      setChatMediaStatus(
        media.type.startsWith('video/') ? 'Đã gửi video thành công.' : 'Đã gửi ảnh thành công.',
        'success'
      );
    }

    input.value = '';
    replyingTo = null;
    updateReplyPreview();

    selectedChatMedia = null;
    if (mediaButton) {
      mediaButton.textContent = '📎';
      mediaButton.title = 'Gửi ảnh hoặc clip';
    }
  } catch (error) {
    console.error('Lỗi gửi tin nhắn/media:', error);
    setChatMediaStatus(error.message || 'Gửi media thất bại. Bạn thử lại.', 'error');
    alert(`Gửi tin nhắn thất bại: ${error.message || 'Bạn thử lại nhé.'}`);
  } finally {
    if (submitButton) submitButton.disabled = false;
    if (mediaButton) mediaButton.disabled = false;
  }
}

const stickerToggle = document.getElementById('chat-sticker-toggle');
const stickerPanel = document.getElementById('chat-sticker-panel');

if (stickerToggle && stickerPanel && !stickerToggle.dataset.bound) {
  stickerToggle.dataset.bound = 'true';

  stickerToggle.addEventListener('click', () => {
    stickerPanel.classList.toggle('hidden');
  });

  stickerPanel.addEventListener('click', async event => {
    const button = event.target.closest('[data-sticker-id]');
    if (!button) return;

    if (!requireMemberAccess('gửi sticker')) return;

    const user = auth.currentUser;
    const profile = state.currentUser;
    const stickerId = button.dataset.stickerId;

    if (!user || !profile || user.uid !== profile.uid) return;

    button.disabled = true;

    try {
      await addDoc(collection(db, 'chatMessages'), {
        senderId: user.uid,
        senderName: profile.displayName || 'Thành viên',
        avatar: profile.photoURL || '',
        text: '',
        stickerId,
        createdAt: serverTimestamp(),
        replyTo: null
      });

      stickerPanel.classList.add('hidden');
    } catch (error) {
      console.error('Lỗi gửi sticker:', error.code, error.message, error);
      alert(`Gửi sticker thất bại: ${error.code || 'unknown'}\n${error.message || 'Không rõ nguyên nhân'}`);
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('click', event => {
    if (!stickerPanel.contains(event.target) && !stickerToggle.contains(event.target)) {
      stickerPanel.classList.add('hidden');
    }
  });
}



async function compressChatImage(file) {
  if (file.type === 'image/gif') return file;

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  try {
    image.src = objectUrl;
    await image.decode();

    const maxDimension = 1200;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không tạo được vùng xử lý ảnh.');

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const outputType = file.type === 'image/png' && file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';


    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, outputType, 0.5);
    });


    if (!blob) throw new Error('Không nén được ảnh.');

    const extension = outputType === 'image/png' ? 'png'
      : outputType === 'image/webp' ? 'webp' : 'jpg';

    const baseName = file.name.replace(/\.[^.]+$/, '');

    return new File([blob], `${baseName}.${extension}`, {
      type: outputType,
      lastModified: Date.now()
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const chatMediaInput = document.getElementById('chat-media-input');
const chatMediaButton = document.getElementById('chat-media-button');

if (chatMediaInput && chatMediaButton && !chatMediaInput.dataset.bound) {
  chatMediaInput.dataset.bound = 'true';

  chatMediaButton.addEventListener('click', () => {
    chatMediaInput.click();
  });

  chatMediaInput.addEventListener('change', async () => {
    const file = chatMediaInput.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      alert('Bạn chỉ chọn ảnh hoặc video nhé.');
      chatMediaInput.value = '';
      return;
    }


    chatMediaButton.disabled = true;
    chatMediaButton.textContent = '…';
    setChatMediaStatus(isImage ? 'Đang nén ảnh, vui lòng chờ…' : 'Đang chuẩn bị video…');


    try {
      selectedChatMedia = isImage
        ? await compressChatImage(file)
        : file;

      setChatMediaStatus(isImage ? 'Đã nén ảnh, sẵn sàng gửi.' : 'Video đã sẵn sàng gửi.', 'success');
      const originalMB = (file.size / 1024 / 1024).toFixed(2);
      const finalMB = (selectedChatMedia.size / 1024 / 1024).toFixed(2);

      chatMediaButton.title = `${file.name} — ${originalMB} MB → ${finalMB} MB`;
      chatMediaButton.textContent = '✓';

    } catch (error) {
      console.error('Lỗi xử lý media chat:', error);
      setChatMediaStatus('Không xử lý được file. Bạn thử chọn file khác nhé.', 'error');
      selectedChatMedia = null;
      chatMediaButton.textContent = '📎';
      alert('Không xử lý được file. Bạn thử chọn file khác nhé.');
    } finally {
      chatMediaButton.disabled = false;
      chatMediaInput.value = '';
    }
  });
}

function stopPrivateChatListener() {
  if (privateChatUnsubscribe) privateChatUnsubscribe();
  privateChatUnsubscribe = null;
  privateChatId = null;
}

function showPrivateChatStatus(message, isError = false) {
  const status = document.getElementById('private-chat-status');
  if (!status) return;

  status.textContent = message;
  status.classList.toggle('text-red-600', isError);
  status.classList.toggle('text-stone-500', !isError);
}


function renderPrivateChatMessages(messages) {
  const container = document.getElementById('private-chat-messages');
  const user = auth.currentUser;
  if (!container || !user) return;

  if (!messages.length) {
    container.innerHTML = `
      <p class="py-6 text-center text-sm text-stone-400">
        Chưa có tin nhắn. Hãy gửi lời chào đầu tiên!
      </p>`;
    return;
  }

  container.innerHTML = messages.map(message => {
    const mine = message.senderId === user.uid;
    const isAdmin = state.isAdmin === true;
    const canRecall = mine || isAdmin;
    const canDeleteMedia = mine || isAdmin;
    const recalled = message.recalled === true;
    const likedBy = Array.isArray(message.likedBy) ? message.likedBy : [];
    const liked = likedBy.includes(user.uid);

    const reply = message.replyTo;
    const replyHtml = reply
      ? `<div class="mb-2 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-2 text-xs text-stone-600">
           <p class="font-semibold">↩ ${escapeHtml(reply.senderName || 'Bạn học')}</p>
           <p class="whitespace-pre-wrap break-words">${escapeHtml(reply.text || '')}</p>
         </div>`
      : '';

    let mediaHtml = '';

    if (!recalled && message.mediaType === 'image' && message.mediaUrl) {
      mediaHtml = `
        <a href="${escapeHtml(message.mediaUrl)}"
           target="_blank" rel="noopener noreferrer"
           class="block overflow-hidden rounded-xl">
          <img src="${escapeHtml(message.mediaUrl)}"
               alt="Ảnh trong tin nhắn"
               loading="lazy"
               class="block max-w-full max-h-80 rounded-xl object-contain">
        </a>`;
    } else if (!recalled && message.mediaType === 'video' && message.mediaUrl) {
      mediaHtml = `
        <video controls preload="metadata"
               class="block w-full max-h-80 rounded-xl bg-black">
          <source src="${escapeHtml(message.mediaUrl)}"
                  type="video/${escapeHtml(message.mediaFormat || 'mp4')}">
          Trình duyệt không hỗ trợ phát video.
        </video>`;
    }

    const stickerIds = [
      '1f602', '1f60d', '1f970', '1f44d', '2764-fe0f',
      '1f389', '1f64f', '1f923', '1f973', '1f917'
    ];

    const stickerHtml = !recalled && stickerIds.includes(message.stickerId)
      ? `<img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${message.stickerId === '2764-fe0f' ? '2764' : message.stickerId}.png"
              alt="Sticker" class="w-28 h-28 object-contain">`
      : '';

    const textHtml = !recalled && message.text
      ? `<p class="whitespace-pre-wrap break-words">${escapeHtml(message.text)}</p>`
      : '';

    const contentHtml = recalled
      ? `<p class="italic text-stone-500">Tin nhắn đã được thu hồi</p>`
      : `${mediaHtml}${stickerHtml}${textHtml}`;

    return `
      <div class="flex ${mine ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[85%] min-w-0">
          <div class="rounded-2xl px-3 py-2 ${
            mine
              ? 'bg-amber-600 text-white'
              : 'border border-stone-200 bg-white text-stone-800'
          }">
            <p class="mb-1 text-xs ${
              mine ? 'text-amber-100' : 'text-stone-500'
            }">${escapeHtml(message.senderName || 'Thành viên')}</p>

            ${replyHtml}

            <div class="space-y-2">${contentHtml}</div>

            <p class="mt-1 text-right text-[10px] ${
              mine ? 'text-amber-100' : 'text-stone-400'
            }">${escapeHtml(message.time || '')}</p>
          </div>

          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 ${
            mine ? 'justify-end' : 'justify-start'
          }">
            <button type="button"
                    data-private-like-id="${escapeHtml(message.id)}"
                    class="text-xs hover:scale-105 transition">
              ${liked ? '❤️' : '🤍'} ${likedBy.length}
            </button>

            ${!recalled ? `
              <button type="button"
                      data-private-reply-id="${escapeHtml(message.id)}"
                      class="text-xs text-amber-700 hover:underline">
                ↩ Trả lời
              </button>



              ${canRecall
                ? `<button type="button"
                           data-private-recall-id="${escapeHtml(message.id)}"
                           class="text-xs text-red-700 hover:underline">
                     ↩ Thu hồi
                   </button>`
                : ''}
            ` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  container.onclick = event => {
    const likeButton = event.target.closest('[data-private-like-id]');
    if (likeButton) {
      togglePrivateChatLike(likeButton.dataset.privateLikeId);
      return;
    }

    const replyButton = event.target.closest('[data-private-reply-id]');
    if (replyButton) {
      setPrivateReplyTo(replyButton.dataset.privateReplyId);
      return;
    }

    const recallButton = event.target.closest('[data-private-recall-id]');
    if (recallButton) {
      recallPrivateChatMessage(recallButton.dataset.privateRecallId);
      return;
    }

    const deleteButton = event.target.closest('[data-private-delete-media-id]');
    if (deleteButton) {
      deletePrivateChatMedia(deleteButton.dataset.privateDeleteMediaId);
    }
  };

  container.scrollTop = container.scrollHeight;
}


async function togglePrivateChatLike(messageId) {
  const user = auth.currentUser;

  if (!user || !privateChatId || !messageId) return;

  try {
    const messageRef = doc(
      db,
      'privateChats',
      privateChatId,
      'messages',
      messageId
    );

    const messageSnap = await getDoc(messageRef);

    if (!messageSnap.exists()) return;

    const data = messageSnap.data();
    const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];

    if (likedBy.includes(user.uid)) {
      await updateDoc(messageRef, {
        likedBy: arrayRemove(user.uid)
      });
    } else {
      await updateDoc(messageRef, {
        likedBy: arrayUnion(user.uid)
      });
    }
  } catch (error) {
    console.error('Lỗi thích tin nhắn riêng:', error);
    showPrivateChatStatus('Không thể cập nhật lượt thích.', true);
  }
}



async function recallPrivateChatMessage(messageId) {
  const user = auth.currentUser;

  if (!user || !privateChatId || !messageId) return;

  try {
    const messageRef = doc(
      db,
      'privateChats',
      privateChatId,
      'messages',
      messageId
    );

    const messageSnap = await getDoc(messageRef);

    if (!messageSnap.exists()) return;

    const data = messageSnap.data();

    if (data.senderId !== user.uid && state.isAdmin !== true) {
      showPrivateChatStatus(
        'Bạn chỉ có thể thu hồi tin nhắn của mình.',
        true
      );
      return;
    }

    if (data.recalled === true) return;

    if (!confirm('Bạn muốn thu hồi tin nhắn này?')) {
      return;
    }

    showPrivateChatStatus('Đang thu hồi tin nhắn…');

    const token = await user.getIdToken();

    const response = await fetch(
      'https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/private-chat/recall',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          chatId: privateChatId,
          messageId
        })
      }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Thu hồi tin nhắn thất bại.');
    }

    showPrivateChatStatus('Tin nhắn đã thu hồi.', false);

  } catch (error) {
    console.error('Lỗi thu hồi tin nhắn riêng:', error);

    showPrivateChatStatus(
      error.message || 'Thu hồi tin nhắn thất bại.',
      true
    );
  }
}


function updatePrivateCallUI(message, buttons = {}) {
  const status = document.getElementById('private-call-status');
  const answer = document.getElementById('private-call-answer');
  const reject = document.getElementById('private-call-reject');
  const end = document.getElementById('private-call-end');

  if (status) status.textContent = message;
  if (answer) answer.classList.toggle('hidden', !buttons.answer);
  if (reject) reject.classList.toggle('hidden', !buttons.reject);
  if (end) end.classList.toggle('hidden', !buttons.end);
}


function getPrivateCallChatParticipants() {
  const uid = auth.currentUser?.uid;
  const peerUid = typeof privateChatTarget === 'string'
    ? privateChatTarget
    : privateChatTarget?.uid;

  if (!uid || !peerUid || uid === peerUid) {
    throw new Error('Vui lòng chọn một thành viên để gọi.');
  }

  return [uid, peerUid].sort();
}


function createPrivateCallPeerConnection(callId, remoteDescriptionReady = false) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  });

  privateCallPeerConnection = pc;

  privateCallRemoteAudio = document.getElementById('private-call-remote-audio');

  if (!privateCallRemoteAudio) {
    privateCallRemoteAudio = document.createElement('audio');
    privateCallRemoteAudio.id = 'private-call-remote-audio';
    privateCallRemoteAudio.autoplay = true;
    privateCallRemoteAudio.playsInline = true;
    document.body.appendChild(privateCallRemoteAudio);
  }

  pc.ontrack = async (event) => {
  const stream = event.streams?.[0];
  if (!stream) return;

  const remoteAudio = document.getElementById('private-call-remote-audio');
  const remoteVideo = document.getElementById('private-call-remote-video');

  if (remoteAudio) {
    remoteAudio.srcObject = stream;

    try {
      await remoteAudio.play();
    } catch (error) {
      console.warn('Chưa phát được âm thanh từ cuộc gọi:', error);
    }
  }

  if (remoteVideo && stream.getVideoTracks().length > 0) {
    remoteVideo.srcObject = stream;

    try {
      await remoteVideo.play();
    } catch (error) {
      console.warn('Chưa phát được video từ cuộc gọi:', error);
    }

    const videoPanel = document.getElementById('private-call-video-panel');
    if (videoPanel) videoPanel.hidden = false;
  }
};

  pc.onicecandidate = async (event) => {
    if (!event.candidate || !privateCallDocId) return;

    const currentUid = auth.currentUser?.uid;
    const callSnapshot = await getDoc(
      doc(db, 'privateCalls', privateCallDocId)
    );

    if (!callSnapshot.exists()) return;

    const callData = callSnapshot.data();
    const candidateCollection =
      currentUid === callData.callerId
        ? 'offerCandidates'
        : 'answerCandidates';

    try {
      await addDoc(
        collection(
          db,
          'privateCalls',
          privateCallDocId,
          candidateCollection
        ),
        {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid ?? null,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
          createdAt: serverTimestamp()
        }
      );
    } catch (error) {
      console.error('Không gửi được ICE candidate:', error);
    }
  };

  return pc;
}


async function addPrivateCallLocalAudio(pc, withVideo = false) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Trình duyệt không hỗ trợ microphone/camera hoặc cần HTTPS.');
  }

  privateCallLocalStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: withVideo ? { facingMode: 'user' } : false
  });

  privateCallLocalStream.getTracks().forEach((track) => {
    pc.addTrack(track, privateCallLocalStream);
  });

  if (withVideo) {
    const localVideo = document.getElementById('private-call-local-video');
    const videoPanel = document.getElementById('private-call-video-panel');

    if (localVideo) {
      localVideo.srcObject = privateCallLocalStream;

      try {
        await localVideo.play();
      } catch (error) {
        console.warn('Không phát được video camera của bạn:', error);
      }
    }

    if (videoPanel) videoPanel.hidden = false;
  }
}



function listenPrivateCallCandidates(collectionName) {
  if (!privateCallDocId || !privateCallPeerConnection) return;

  const callId = privateCallDocId;
  const pc = privateCallPeerConnection;
  let remoteReady = Boolean(pc.remoteDescription);
  let flushing = false;
  const pendingCandidates = [];
  let lastCandidateError = null;

  const flushCandidates = async () => {
    if (flushing || !remoteReady || pc.signalingState === 'closed') return;

    flushing = true;

    try {
      while (pendingCandidates.length && remoteReady) {
        const candidateData = pendingCandidates.shift();

        try {
          await pc.addIceCandidate(
            new RTCIceCandidate({
              candidate: candidateData.candidate,
              sdpMid: candidateData.sdpMid ?? null,
              sdpMLineIndex: candidateData.sdpMLineIndex ?? null
            })
          );
          lastCandidateError = null;
        } catch (error) {
          lastCandidateError = error;
          console.warn('Không thêm được ICE candidate:', error);
        }
      }
    } finally {
      flushing = false;
    }
  };

  const unsubscribe = onSnapshot(
    collection(db, 'privateCalls', callId, collectionName),
    (snapshot) => {
      if (
        privateCallDocId !== callId ||
        privateCallPeerConnection !== pc
      ) {
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;

        const data = change.doc.data();

        // Chỉ bỏ qua khi không có trường candidate.
        // Candidate rỗng có thể biểu thị kết thúc thu thập ICE.
        if (typeof data.candidate !== 'string') return;

        pendingCandidates.push(data);
      });

      void flushCandidates();
    },
    (error) => console.error('Lỗi nghe ICE candidates:', error)
  );

  privateCallIceUnsubscribe.push(unsubscribe);

  return {
    markRemoteReady: () => {
      remoteReady = true;
      void flushCandidates();
    }
  };
}



async function cleanupPrivateCall() {
  // Ngừng nhận các cập nhật cuộc gọi và ICE.
  privateCallUnsubscribe?.();
  privateCallUnsubscribe = null;

  privateCallIceUnsubscribe.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn('Lỗi dừng ICE listener:', error);
    }
  });
  privateCallIceUnsubscribe = [];

  // Đóng kết nối WebRTC.
  const pc = privateCallPeerConnection;
  privateCallPeerConnection = null;

  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;

    try {
      pc.close();
    } catch (error) {
      console.warn('Lỗi đóng kết nối WebRTC:', error);
    }
  }

  // Tắt microphone và giải phóng thiết bị.
  const stream = privateCallLocalStream;
  privateCallLocalStream = null;

  if (stream) {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        console.warn('Lỗi dừng microphone:', error);
      }
    });
  }

  // Ngắt âm thanh từ phía bên kia.
  if (privateCallRemoteAudio) {
    privateCallRemoteAudio.pause();
    privateCallRemoteAudio.srcObject = null;
  }

const localVideo = document.getElementById('private-call-local-video');
const remoteVideo = document.getElementById('private-call-remote-video');
const videoPanel = document.getElementById('private-call-video-panel');

if (localVideo) localVideo.srcObject = null;
if (remoteVideo) remoteVideo.srcObject = null;
if (videoPanel) videoPanel.hidden = true;

  privateCallDocId = null;
  privateCallBusy = false;
}

async function startPrivateVoiceCall(withVideo = false) {
  if (privateCallBusy || privateCallDocId) return;

  privateCallBusy = true;

  try {
    const user = auth.currentUser;

    if (!user || !privateChatId || !privateChatTarget) {
      throw new Error('Vui lòng chọn người chat riêng trước.');
    }

    updatePrivateCallUI('Đang chuẩn bị cuộc gọi...');

console.log(
  '[VOICE CALL DEBUG] privateChatTarget:',
  JSON.stringify(privateChatTarget)
);
    const participants = getPrivateCallChatParticipants();
    const callRef = doc(collection(db, 'privateCalls'));

    // Tạo tài liệu cuộc gọi trước để Rules cho phép ghi ICE candidates.
    console.log('[VOICE CALL] Bắt đầu tạo cuộc gọi', {
  chatId: privateChatId,
  callerId: user.uid,
  calleeId: typeof privateChatTarget === 'string'
  ? privateChatTarget
  : privateChatTarget?.uid,
  participants
});

console.log('[VOICE CALL DEBUG 2]', {
  authUid: auth.currentUser?.uid,
  authStatus: state.authStatus,
  isAdmin: state.isAdmin,
  chatId: privateChatId,
  callerId: user.uid,
  calleeId: typeof privateChatTarget === 'string'
    ? privateChatTarget
    : privateChatTarget?.uid,
  participants: getPrivateCallChatParticipants()
});

try {
  const callData = {
  chatId: privateChatId,
  participants,
  callerId: user.uid,
  calleeId: typeof privateChatTarget === 'string'
    ? privateChatTarget
    : privateChatTarget?.uid,
  callType: withVideo ? 'video' : 'audio',
  status: 'calling',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
};

  console.log('[VOICE CALL ACTUAL DATA]', {
    ...callData,
    createdAt: 'serverTimestamp()',
    updatedAt: 'serverTimestamp()',
    participantsAreStrings: callData.participants.every(
      id => typeof id === 'string'
    ),
    callerIncluded: callData.participants.includes(callData.callerId),
    calleeIncluded: callData.participants.includes(callData.calleeId),
    distinctParticipants: new Set(callData.participants).size === 2
  });

  await setDoc(callRef, callData);

  console.log('[VOICE CALL] Tạo tài liệu thành công:', callRef.id);
} catch (error) {
  console.error('[VOICE CALL] Lỗi tạo tài liệu:', {
    code: error.code,
    message: error.message
  });
  throw error;
}

privateCallDocId = callRef.id;

const pc = createPrivateCallPeerConnection(callRef.id);
await addPrivateCallLocalAudio(pc, withVideo);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await updateDoc(callRef, {
      offer: {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp
      },
      updatedAt: serverTimestamp()
    });

    privateCallBusy = false;

    updatePrivateCallUI(
  withVideo
    ? '📹 Đang gọi video... Chờ người nhận trả lời.'
    : '📞 Đang gọi thoại... Chờ người nhận trả lời.',
  { end: true }
);

    privateCallUnsubscribe = onSnapshot(
      callRef,
      async (snapshot) => {
        if (!snapshot.exists()) return;

        const data = snapshot.data();

        if (
          data.status === 'accepted' &&
          data.answer &&
          !pc.remoteDescription
        ) {
          try {
            await pc.setRemoteDescription(
	new RTCSessionDescription(data.answer)
	);

	const answerIce = listenPrivateCallCandidates('answerCandidates');
	answerIce?.markRemoteReady();
            updatePrivateCallUI('Đã kết nối. Hai bên có thể nói chuyện.', {
              end: true
            });
          } catch (error) {
            console.error('Lỗi nhận câu trả lời cuộc gọi:', error);
          }
        }

        if (data.status === 'rejected') {
          await cleanupPrivateCall();
          updatePrivateCallUI('Người nhận đã từ chối cuộc gọi.');
        } else if (data.status === 'ended') {
          await cleanupPrivateCall();
          updatePrivateCallUI('Cuộc gọi đã kết thúc.');
        }
      },
      (error) => {
        console.error('Lỗi theo dõi cuộc gọi:', error);
      }
    );

    listenPrivateCallCandidates('answerCandidates');
  } catch (error) {
    console.error('Không thể bắt đầu cuộc gọi:', error);

    const message = error.message || 'Không thể bắt đầu cuộc gọi.';

    await cleanupPrivateCall();
    updatePrivateCallUI(message);
  } finally {
    privateCallBusy = false;
  }
}


async function answerPrivateVoiceCall() {
  if (privateCallBusy || !privateCallDocId) return;

  try {
    privateCallBusy = true;

    const callRef = doc(db, 'privateCalls', privateCallDocId);
    const callSnapshot = await getDoc(callRef);

    if (!callSnapshot.exists()) {
      throw new Error('Cuộc gọi không còn tồn tại.');
    }

    const data = callSnapshot.data();

    if (
      data.status !== 'calling' ||
      data.calleeId !== auth.currentUser?.uid
    ) {
      throw new Error('Cuộc gọi không còn khả dụng.');
    }

    const withVideo = data.callType === 'video';

updatePrivateCallUI(
  withVideo
    ? 'Đang kết nối microphone và camera...'
    : 'Đang kết nối microphone...'
);

const pc = createPrivateCallPeerConnection(privateCallDocId);
await addPrivateCallLocalAudio(pc, withVideo);
    if (!data.offer?.type || !data.offer?.sdp) {
  throw new Error('Cuộc gọi chưa có tín hiệu offer. Vui lòng thử lại.');
}

await pc.setRemoteDescription(
  new RTCSessionDescription(data.offer)
);

const offerIce = listenPrivateCallCandidates('offerCandidates');
offerIce?.markRemoteReady();
const answer = await pc.createAnswer();

    await pc.setLocalDescription(answer);

    await updateDoc(callRef, {
      answer: {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp
      },
      status: 'accepted',
      updatedAt: serverTimestamp()
    });

    privateCallBusy = false;
    updatePrivateCallUI('Đã kết nối cuộc gọi.', { end: true });

    privateCallUnsubscribe = onSnapshot(callRef, async (snapshot) => {
      if (!snapshot.exists()) return;

      const status = snapshot.data().status;

      if (status === 'ended' || status === 'rejected') {
        updatePrivateCallUI('Cuộc gọi đã kết thúc.');
        await cleanupPrivateCall();
      }
    });
  } catch (error) {
    console.error('Không thể nhận cuộc gọi:', error);
    updatePrivateCallUI(error.message || 'Không thể nhận cuộc gọi.');
    await cleanupPrivateCall();
  }
}

async function rejectPrivateVoiceCall() {
  if (!privateCallDocId) return;

  try {
    const callRef = doc(db, 'privateCalls', privateCallDocId);
    const snapshot = await getDoc(callRef);

    if (
      snapshot.exists() &&
      snapshot.data().calleeId === auth.currentUser?.uid &&
      snapshot.data().status === 'calling'
    ) {
      await updateDoc(callRef, {
        status: 'rejected',
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.error('Không thể từ chối cuộc gọi:', error);
  } finally {
    await cleanupPrivateCall();
    updatePrivateCallUI('Đã từ chối cuộc gọi.');
  }
}


async function endPrivateVoiceCall() {
  const callId = privateCallDocId;
  const uid = auth.currentUser?.uid;

  try {
    if (callId && uid) {
      const callRef = doc(db, 'privateCalls', callId);
      const snapshot = await getDoc(callRef);

      if (
        snapshot.exists() &&
        snapshot.data().participants?.includes(uid) &&
        ['calling', 'accepted'].includes(snapshot.data().status)
      ) {
        await updateDoc(callRef, {
          status: 'ended',
          updatedAt: serverTimestamp()
        });
      }
    }
  } catch (error) {
    console.error('Lỗi cập nhật trạng thái kết thúc cuộc gọi:', error);
  } finally {
    // Luôn tắt microphone và đóng kết nối, kể cả khi Firestore lỗi.
    await cleanupPrivateCall();
    updatePrivateCallUI('Cuộc gọi đã kết thúc.');
  }
}



function stopPrivateIncomingCallListener() {
  privateCallIncomingUnsubscribe?.();
  privateCallIncomingUnsubscribe = null;
}

let privateCallIncomingUnsubscribe = null;

function startPrivateIncomingCallListener() {
  stopPrivateIncomingCallListener();

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const callsQuery = query(
    collection(db, 'privateCalls'),
    where('participants', 'array-contains', uid)
  );

  privateCallIncomingUnsubscribe = onSnapshot(
    callsQuery,
    (snapshot) => {
      const incoming = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((call) =>
          call.calleeId === uid &&
          call.status === 'calling' &&
          call.chatId === privateChatId
        )
        .sort((a, b) => {
          const timeA = a.createdAt?.toMillis?.() || 0;
          const timeB = b.createdAt?.toMillis?.() || 0;
          return timeB - timeA;
        })[0];


if (incoming) {
  if (privateCallDocId || privateCallPeerConnection) return;

  privateCallDocId = incoming.id;

  const isVideoCall = incoming.callType === 'video';

  updatePrivateCallUI(
    isVideoCall
      ? '📹 Có cuộc gọi video đến. Bạn có muốn nhận không?'
      : '📞 Có cuộc gọi thoại đến. Bạn có muốn nhận không?',
    { answer: true, reject: true }
  );

  return;
}

// Cuộc gọi không còn ở trạng thái chờ nhận.
if (privateCallDocId && !privateCallPeerConnection) {
  const oldCallId = privateCallDocId;

  getDoc(doc(db, 'privateCalls', oldCallId))
    .then(async (callSnapshot) => {
      if (privateCallDocId !== oldCallId) return;

      if (
        !callSnapshot.exists() ||
        callSnapshot.data().status !== 'calling'
      ) {
        await cleanupPrivateCall();
        updatePrivateCallUI('Cuộc gọi đã kết thúc hoặc bị hủy.');
      }
    })
    .catch((error) => {
      console.error('Lỗi kiểm tra trạng thái cuộc gọi:', error);
    });
}

    },
    (error) => {
      console.error('Lỗi nghe cuộc gọi đến:', error);
    }
  );
}


function bindPrivateCallButtons() {
  const start = document.getElementById('private-call-start');
  const videoStart = document.getElementById('private-video-call-start');
  const answer = document.getElementById('private-call-answer');
  const reject = document.getElementById('private-call-reject');
  const end = document.getElementById('private-call-end');

  if (start && !start.dataset.callBound) {
    start.dataset.callBound = 'true';
    start.addEventListener('click', () => {
      startPrivateVoiceCall(false);
    });
  }

  if (videoStart && !videoStart.dataset.callBound) {
    videoStart.dataset.callBound = 'true';
    videoStart.addEventListener('click', () => {
      startPrivateVoiceCall(true);
    });
  }

  if (answer && !answer.dataset.callBound) {
    answer.dataset.callBound = 'true';
    answer.addEventListener('click', answerPrivateVoiceCall);
  }

  if (reject && !reject.dataset.callBound) {
    reject.dataset.callBound = 'true';
    reject.addEventListener('click', rejectPrivateVoiceCall);
  }

  if (end && !end.dataset.callBound) {
    end.dataset.callBound = 'true';
    end.addEventListener('click', endPrivateVoiceCall);
  }
}

bindPrivateCallButtons();


async function openPrivateChat(targetUid) {
  stopPrivateChatListener();

  const user = auth.currentUser;
  const profile = state.currentUser;
  const container = document.getElementById('private-chat-messages');
  const input = document.getElementById('private-chat-input');

  privateChatTarget = null;

  if (container) {
    container.innerHTML = `
      <p class="py-6 text-center text-sm text-stone-400">
        Đang tải cuộc trò chuyện...
      </p>`;
  }

  if (!user || !profile ||
      user.uid !== profile.uid ||
      (state.authStatus !== 'approved' && state.isAdmin !== true)) {
    showPrivateChatStatus('Bạn cần đăng nhập bằng tài khoản thành viên đã được duyệt.', true);
    if (input) input.disabled = true;
    return;
  }

  if (!targetUid || targetUid === user.uid) {
    showPrivateChatStatus('Chọn một thành viên để bắt đầu trò chuyện.');
    if (input) input.disabled = true;
    if (container) {
      container.innerHTML = `
        <p class="py-6 text-center text-sm text-stone-400">
          Tin nhắn riêng sẽ hiển thị tại đây.
        </p>`;
    }
    return;
  }

  const target = (state.directory || []).find(member =>
    member.uid === targetUid && member.status === 'approved'
  );

  if (!target) {
    showPrivateChatStatus('Không tìm thấy thành viên hợp lệ. Hãy tải lại danh sách.', true);
    if (input) input.disabled = true;
    return;
  }

  const participants = [user.uid, targetUid].sort();
  const chatId = participants.join('_');
  const chatRef = doc(db, 'privateChats', chatId);

  try {
    const chatSnapshot = await getDoc(chatRef);

    if (!chatSnapshot.exists()) {
      try {
        await setDoc(chatRef, {
          participants,
          participantA: participants[0],
          participantB: participants[1],
          createdAt: serverTimestamp()
        });
      } catch (createError) {
        // Có thể thành viên còn lại vừa tạo cùng cuộc trò chuyện.
        const retrySnapshot = await getDoc(chatRef);
        if (!retrySnapshot.exists()) throw createError;
      }
    } else {
      const existing = chatSnapshot.data();
      if (
        !Array.isArray(existing.participants) ||
        existing.participants.length !== 2 ||
        !existing.participants.includes(user.uid) ||
        !existing.participants.includes(targetUid)
      ) {
        throw new Error('Thông tin thành viên của cuộc trò chuyện không hợp lệ.');
      }
    }

    privateChatTarget = target;
    privateChatId = chatId;
    startPrivateIncomingCallListener();

    const name = target.name || 'Thành viên';
    showPrivateChatStatus(`Đang trò chuyện riêng với ${name}.`);

    const heading = document.getElementById('private-chat-notice');
    if (heading) heading.classList.add('hidden');
    if (input) {
      input.disabled = false;
      input.focus();
    }

    const messagesQuery = query(
      collection(db, 'privateChats', chatId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200)
    );

    const listeningChatId = chatId;

    privateChatUnsubscribe = onSnapshot(messagesQuery, snapshot => {
      if (privateChatId !== listeningChatId) return;


const messages = snapshot.docs.map(item => {
  const data = item.data({ serverTimestamps: 'estimate' });

  return {
    id: item.id,
    senderId: data.senderId || '',
    senderName: data.senderName || 'Thành viên',
    avatar: data.avatar || '',
    text: data.text || '',
    time: formatChatTime(data.createdAt),
    createdAt: data.createdAt || null,
    mediaType: data.mediaType || '',
    mediaUrl: data.mediaUrl || '',
    mediaPublicId: data.mediaPublicId || '',
    mediaFormat: data.mediaFormat || '',
    likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
    replyTo: data.replyTo || null,
    recalled: data.recalled === true,
    stickerId: data.stickerId || ''
  };
});


      renderPrivateChatMessages(messages);
    }, error => {
      console.error('Lỗi tải chat riêng:', error);
      showPrivateChatStatus(
        'Không tải được tin nhắn riêng. Có thể Firestore Rules chưa được cập nhật.',
        true
      );
    });
  } catch (error) {
    console.error('Lỗi mở chat riêng:', error);
    showPrivateChatStatus(
      'Không mở được cuộc trò chuyện. Kiểm tra Firestore Rules và kết nối mạng.',
      true
    );
    if (input) input.disabled = true;
  }
}

const privateMemberSelect = document.getElementById('private-chat-member');

if (privateMemberSelect && !privateMemberSelect.dataset.privateBound) {
  privateMemberSelect.dataset.privateBound = 'true';

  privateMemberSelect.addEventListener('change', () => {
    openPrivateChat(privateMemberSelect.value);
  });
}

const privateChatForm = document.getElementById('private-chat-form');

const privateMediaInput = document.getElementById('private-chat-media-input');
const privateMediaButton = document.getElementById('private-chat-media-button');

if (privateMediaButton && privateMediaInput &&
    !privateMediaButton.dataset.privateBound) {
  privateMediaButton.dataset.privateBound = 'true';

  privateMediaButton.addEventListener('click', () => {
    if (!privateChatId || !privateChatTarget) {
      showPrivateChatStatus('Hãy chọn thành viên trước khi gửi ảnh hoặc clip.', true);
      return;
    }

    privateMediaInput.click();
  });

  privateMediaInput.addEventListener('change', () => {
    const file = privateMediaInput.files?.[0] || null;
    selectedPrivateChatMedia = file;

    if (!file) {
      setPrivateChatMediaStatus('');
      privateMediaButton.textContent = '📎';
      return;
    }

    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      selectedPrivateChatMedia = null;
      privateMediaInput.value = '';
      setPrivateChatMediaStatus('Chỉ hỗ trợ tệp ảnh hoặc video.', 'error');
      return;
    }

    privateMediaButton.textContent = '✖';
    privateMediaButton.title = 'Bỏ tệp đã chọn';
    setPrivateChatMediaStatus(`Đã chọn: ${file.name}`);
  });

  privateMediaButton.addEventListener('contextmenu', event => {
    event.preventDefault();
    selectedPrivateChatMedia = null;
    privateMediaInput.value = '';
    privateMediaButton.textContent = '📎';
    privateMediaButton.title = 'Gửi ảnh hoặc clip';
    setPrivateChatMediaStatus('');
  });
}


if (privateChatForm && !privateChatForm.dataset.privateBound) {
  privateChatForm.dataset.privateBound = 'true';

  privateChatForm.addEventListener('submit', async event => {
    event.preventDefault();

    if (privateChatSending) return;

    const user = auth.currentUser;
    const profile = state.currentUser;
    const input = document.getElementById('private-chat-input');
    const text = input?.value.trim() || '';
    const media = selectedPrivateChatMedia;

    if (!text && !media) return;

    if (!user || !profile ||
        user.uid !== profile.uid ||
        !privateChatId ||
        !privateChatTarget ||
        (state.authStatus !== 'approved' && state.isAdmin !== true)) {
      showPrivateChatStatus('Hãy chọn thành viên hợp lệ trước khi gửi tin.', true);
      return;
    }

    if (text.length > 5000) {
      showPrivateChatStatus('Tin nhắn không được vượt quá 5.000 ký tự.', true);
      return;
    }

    const sendingChatId = privateChatId;
    privateChatSending = true;

    const button = privateChatForm.querySelector('button[type="submit"]');
    if (button) button.disabled = true;


try {
  let mediaData = {};

  if (media) {
    const isVideo = media.type.startsWith('video/');
    const resourceType = isVideo ? 'video' : 'image';
    const uploadPreset = isVideo
      ? 'cuuhocsinh126_videos'
      : 'cuuhocsinh126_images';

    setPrivateChatMediaStatus(
      isVideo ? 'Đang tải video lên…' : 'Đang tải ảnh lên…'
    );

    const formData = new FormData();
    formData.append('file', media);
    formData.append('upload_preset', uploadPreset);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/cuuhocsinh126/${resourceType}/upload`,
      {
        method: 'POST',
        body: formData
      }
    );

    const result = await response.json();

    if (!response.ok || !result.secure_url || !result.public_id) {
      throw new Error(result.error?.message || 'Upload Cloudinary thất bại.');
    }

    mediaData = {
      mediaType: isVideo ? 'video' : 'image',
      mediaUrl: result.secure_url,
      mediaPublicId: result.public_id,
      mediaFormat: result.format || ''
    };
  }

  await addDoc(
    collection(db, 'privateChats', sendingChatId, 'messages'),
    {
      senderId: user.uid,
      senderName: profile.displayName || 'Thành viên',
      avatar: profile.photoURL || '',
      text,
      createdAt: serverTimestamp(),
      replyTo: null,
      ...mediaData
    }
  );

  if (privateChatId === sendingChatId) {
    if (input) {
      input.value = '';
      input.focus();
    }

    selectedPrivateChatMedia = null;

    const mediaInput = document.getElementById('private-chat-media-input');
    const mediaButton = document.getElementById('private-chat-media-button');

    if (mediaInput) mediaInput.value = '';

    if (mediaButton) {
      mediaButton.textContent = '📎';
      mediaButton.title = 'Gửi ảnh hoặc clip';
    }

    setPrivateChatMediaStatus(
      media ? 'Đã gửi tin nhắn thành công.' : '',
      media ? 'success' : ''
    );
  }
} catch (error) {
  console.error('Lỗi gửi tin nhắn riêng/media:', error);

  setPrivateChatMediaStatus(
    error.message || 'Gửi tin nhắn riêng thất bại.',
    'error'
  );

  showPrivateChatStatus(
    'Gửi thất bại. Kiểm tra kết nối và Firestore Rules.',
    true
  );
} finally {
  privateChatSending = false;
  if (button) button.disabled = false;
}
  });
}

window.addEventListener('beforeunload', stopPrivateChatListener);
window.addEventListener('beforeunload', stopPrivateIncomingCallListener);

window.handleSendMessage = handleSendMessage;

