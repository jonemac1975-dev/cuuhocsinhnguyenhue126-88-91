
import { state, canUseMemberFeatures } from './app-state.js';
import { auth, db } from './firebase-config.js';
import { addDoc, collection, onSnapshot, query, orderBy, limit, serverTimestamp, deleteDoc, doc} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const CLIPS_COLLECTION = 'tiktokClips';

let clipsUnsubscribe = null;
let isSubmitting = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'https:') return null;

    // Không nhận URL chứa thông tin đăng nhập hoặc cổng tùy chỉnh.
    if (url.username || url.password || url.port) return null;

    return url;
  } catch {
    return null;
  }
}

function getHost(url) {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function getVideoInfo(value) {
  const url = normalizeUrl(value);
  if (!url) return null;

  const host = getHost(url);
  const path = url.pathname;

  // TikTok video chính thức
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const match = path.match(/\/@[^/]+\/video\/(\d+)/);

    if (match) {
      return {
        platform: 'TikTok',
        icon: 'fa-brands fa-tiktok',
        embed: `https://www.tiktok.com/player/v1/${match[1]}?controls=1&description=1`
      };
    }

    // Link TikTok rút gọn chưa có video ID để nhúng trực tiếp.
    return {
      platform: 'TikTok',
      icon: 'fa-brands fa-tiktok',
      embed: null
    };
  }

  // Facebook video / Reel
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
    const isVideo =
      /^\/reel\/[^/]+/.test(path) ||
      /^\/watch/.test(path) ||
      /\/videos\/[^/]+/.test(path);

    return {
      platform: 'Facebook',
      icon: 'fa-brands fa-facebook',
      embed: isVideo
        ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url.href)}&show_text=false&width=280`
        : null
    };
  }

  // YouTube video và Shorts
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id =
      url.searchParams.get('v') ||
      path.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]+)/)?.[1];

    return {
      platform: 'YouTube',
      icon: 'fa-brands fa-youtube',
      embed: id && /^[A-Za-z0-9_-]+$/.test(id)
        ? `https://www.youtube.com/embed/${id}`
        : null
    };
  }

  if (host === 'youtu.be') {
    const id = path.split('/').filter(Boolean)[0];

    return {
      platform: 'YouTube',
      icon: 'fa-brands fa-youtube',
      embed: id && /^[A-Za-z0-9_-]+$/.test(id)
        ? `https://www.youtube.com/embed/${id}`
        : null
    };
  }

  // Instagram Reel / bài đăng
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const match = path.match(/^\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);

    return {
      platform: 'Instagram',
      icon: 'fa-brands fa-instagram',
      embed: match
        ? `https://www.instagram.com/${path.split('/').filter(Boolean).slice(0, 2).join('/')}/embed/`
        : null
    };
  }

  // Website khác: lưu link và cho mở trang gốc.
  return {
    platform: 'Video ngoài',
    icon: 'fa-solid fa-play',
    embed: null
  };
}

function setStatus(message, isError = false) {
  const status = document.getElementById('tiktok-form-status');
  if (!status) return;

  status.textContent = message;
  status.className = `text-sm ${isError ? 'text-red-600' : 'text-green-700'}`;
}

function closeTikTokForm() {
  document.getElementById('tiktok-form-panel')?.classList.add('hidden');
  document.getElementById('tiktok-form')?.reset();
  setStatus('');
}

function openTikTokForm() {
  document.getElementById('tiktok-form-panel')?.classList.remove('hidden');

  if (!canUseMemberFeatures() || !auth.currentUser) {
    setStatus(
      'Bạn cần đăng nhập bằng tài khoản thành viên đã được duyệt để đăng clip.',
      true
    );
    return;
  }

  setStatus('');
  document.getElementById('tiktok-url')?.focus();
}

function renderTikTokClips(snapshot) {
  const container = document.getElementById('tiktok-list');
  if (!container) return;

  if (snapshot.empty) {
    container.innerHTML = `
      <p class="w-full py-6 text-center text-sm text-stone-500">
        Chưa có clip nào. Cả lớp mình đăng clip đầu tiên nhé!
      </p>
    `;
    return;
  }

  container.innerHTML = snapshot.docs.map(docSnap => {
    const clip = docSnap.data();
    const info = getVideoInfo(clip.url || '');

    if (!info) return '';

    const authorName = escapeHtml(clip.authorName || 'Thành viên');
    const caption = escapeHtml(clip.caption || '');
    const safeUrl = escapeHtml(clip.url || '');
const canDeleteClip =
  auth.currentUser &&
  (
    auth.currentUser.uid === clip.authorId ||
    state.isAdmin === true
  );

const deleteButton = canDeleteClip
  ? `
    <button
      type="button"
      class="tiktok-delete-btn mt-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
      data-clip-id="${escapeHtml(docSnap.id)}">
      <i class="fa-solid fa-trash mr-1"></i>Xóa clip
    </button>
  `
  : '';

    const player = info.embed
      ? `
        <iframe
          src="${escapeHtml(info.embed)}"
          title="${authorName} - ${escapeHtml(info.platform)}"
          class="absolute inset-0 h-full w-full border-0"
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen; web-share"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin">
        </iframe>
      `
      : `
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <i class="${escapeHtml(info.icon)} text-4xl text-stone-500"></i>
          <p class="text-sm font-semibold text-stone-700">
            ${escapeHtml(info.platform)}
          </p>
          <a
            href="${safeUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white">
            Mở video
          </a>
        </div>
      `;

    return `
      <article class="w-[220px] min-w-[220px] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div class="relative aspect-[9/16] w-full overflow-hidden bg-stone-100">
          ${player}
        </div>

        <div class="space-y-2 p-3">
          <p class="truncate text-sm font-bold text-stone-800">
            ${authorName}
          </p>

          <p class="text-xs text-stone-500">
            <i class="${escapeHtml(info.icon)} mr-1"></i>${escapeHtml(info.platform)}
          </p>

          ${caption ? `
            <p class="whitespace-pre-wrap break-words text-sm text-stone-600">${caption}</p>
          ` : ''}

          <a
            href="${safeUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 hover:text-amber-800">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
            Mở video gốc
          </a>
		${deleteButton}
        </div>
      </article>
    `;
  }).join('');

  if (!container.innerHTML.trim()) {
    container.innerHTML = `
      <p class="w-full py-6 text-center text-sm text-stone-500">
        Chưa có link video hợp lệ để hiển thị.
      </p>
    `;
  }
}

function startTikTokListener() {
  const container = document.getElementById('tiktok-list');
  if (!container || clipsUnsubscribe) return;

  container.innerHTML = `
    <p class="text-sm text-stone-500">Đang tải clip...</p>
  `;

  const clipsQuery = query(
    collection(db, CLIPS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(30)
  );

  clipsUnsubscribe = onSnapshot(
    clipsQuery,
    renderTikTokClips,
    error => {
      console.error('Lỗi tải clip:', error);
      container.innerHTML = `
        <p class="py-4 text-sm text-red-600">
          Không tải được danh sách clip. Vui lòng kiểm tra kết nối và Firestore Rules.
        </p>
      `;
    }
  );
}

async function handleTikTokSubmit(event) {
  event.preventDefault();

  if (isSubmitting) return;

  if (!canUseMemberFeatures() || !auth.currentUser) {
    setStatus('Bạn cần đăng nhập bằng tài khoản thành viên đã được duyệt.', true);
    return;
  }

  const urlInput = document.getElementById('tiktok-url');
  const captionInput = document.getElementById('tiktok-caption');
  const submitButton = document.getElementById('tiktok-submit-btn');

  const url = urlInput?.value.trim() || '';
  const caption = captionInput?.value.trim() || '';
  const info = getVideoInfo(url);

  if (!info) {
    setStatus('Link chưa hợp lệ. Hãy nhập link bắt đầu bằng https://', true);
    return;
  }

  if (caption.length > 500) {
    setStatus('Lời giới thiệu tối đa 500 ký tự.', true);
    return;
  }

  isSubmitting = true;

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Đang đăng...';
  }

  try {
    const user = auth.currentUser;

    const authorName =
      state.currentUser?.displayName ||
      user.displayName ||
      user.email ||
      'Thành viên';

    const authorAvatar =
      state.currentUser?.photoURL ||
      user.photoURL ||
      '';

    await addDoc(collection(db, CLIPS_COLLECTION), {
      url: normalizeUrl(url).href,
      caption,
      authorId: user.uid,
      authorName,
      authorAvatar,
      createdAt: serverTimestamp()
    });

    document.getElementById('tiktok-form')?.reset();
    setStatus('Đăng clip thành công!');

    setTimeout(closeTikTokForm, 800);
  } catch (error) {
    console.error('Lỗi đăng clip:', error);
    setStatus(
      'Đăng clip chưa thành công. Kiểm tra kết nối và Firestore Rules nhé.',
      true
    );
  } finally {
    isSubmitting = false;

    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Đăng clip';
    }
  }
}

async function handleDeleteTikTokClip(event) {
  const button = event.target.closest('.tiktok-delete-btn');
  if (!button) return;

  const clipId = button.dataset.clipId;
  if (!clipId) return;

  if (!canUseMemberFeatures() || !auth.currentUser) {
    alert('Bạn cần đăng nhập bằng tài khoản thành viên đã được duyệt.');
    return;
  }

  const confirmed = confirm(
    'Bạn có chắc muốn xóa clip này không? Thao tác này không thể hoàn tác.'
  );

  if (!confirmed) return;

  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Đang xóa...';

  try {
    await deleteDoc(doc(db, CLIPS_COLLECTION, clipId));
    // Danh sách tự cập nhật qua onSnapshot().
  } catch (error) {
    console.error('Lỗi xóa clip TikTok:', error);

    alert(
      'Không xóa được clip. Chỉ người đăng hoặc admin mới có quyền xóa.'
    );

    button.disabled = false;
    button.innerHTML = '<i class="fa-solid fa-trash mr-1"></i>Xóa clip';
  }
}

export function initTikTok() {
  const createButton = document.getElementById('tiktok-create-btn');
  const cancelButton = document.getElementById('tiktok-cancel-btn');
  const form = document.getElementById('tiktok-form');

  if (!createButton || !cancelButton || !form) {
    console.warn('Clip: Không tìm thấy đủ phần tử HTML.');
    return;
  }

  createButton.addEventListener('click', openTikTokForm);
cancelButton.addEventListener('click', closeTikTokForm);
form.addEventListener('submit', handleTikTokSubmit);

document
  .getElementById('tiktok-list')
  ?.addEventListener('click', handleDeleteTikTokClip);

startTikTokListener();
}
