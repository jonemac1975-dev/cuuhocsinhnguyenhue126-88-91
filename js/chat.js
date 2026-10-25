
import { state, escapeHtml, requireMemberAccess } from './app-state.js';
import { db, auth } from './firebase-config.js';
import { collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp, doc, updateDoc, arrayUnion, arrayRemove, deleteField } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';



let chatUnsubscribe = null;
let chatListenerUid = null;
let chatStarting = false;
let replyingTo = null;
let selectedChatMedia = null;

let chatMediaStatusTimer = null;

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
  ${['image', 'video'].includes(m.mediaType) && m.mediaUrl && canDeleteMedia
    ? `<button type="button" data-delete-media-id="${escapeHtml(m.id)}" class="text-xs text-red-600 hover:underline">🗑️ Xóa media</button>`
    : ''}
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



window.handleSendMessage = handleSendMessage;

