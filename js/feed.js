
import { state, escapeHtml, requireMemberAccess } from './app-state.js';
import { auth, db } from './firebase-config.js';
import { collection, doc, getDocs, addDoc, setDoc, deleteDoc, updateDoc, query, orderBy, serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';


const POST_WORKER_URL = 'https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev';

async function callPostWorker(path, payload) {
  
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập trước.');
  const idToken = await user.getIdToken();
  const response = await fetch(`${POST_WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Không thực hiện được yêu cầu.');
  }
  return result;
}


const CLOUDINARY_CLOUD = 'cuuhocsinh126';
const CLOUDINARY_IMAGE_PRESET = 'cuuhocsinh126_images';
const CLOUDINARY_VIDEO_PRESET = 'cuuhocsinh126_videos';

function getSelectedMediaFiles() {
  const images = Array.from(document.getElementById('post-image-files')?.files || []);
  const videos = Array.from(document.getElementById('post-video-files')?.files || []);
  return [
    ...images.map(file => ({ file, type: 'image' })),
    ...videos.map(file => ({ file, type: 'video' }))
  ];
}

window.previewPostMedia = function() {
  const preview = document.getElementById('post-media-preview');
  if (!preview) return;

  preview.innerHTML = getSelectedMediaFiles().map(({ file, type }, index) => {
    const url = URL.createObjectURL(file);
    return type === 'image'
      ? `<div class="relative"><img src="${url}" alt="Ảnh xem trước" class="w-full h-36 object-cover rounded-xl"><button type="button" onclick="removePostMedia(${index})" class="absolute top-1 right-1 bg-black/70 text-white rounded-full px-2 py-1">×</button></div>`
      : `<div class="relative"><video src="${url}" controls class="w-full h-36 object-cover rounded-xl"></video><button type="button" onclick="removePostMedia(${index})" class="absolute top-1 right-1 bg-black/70 text-white rounded-full px-2 py-1">×</button></div>`;
  }).join('');
};

window.removePostMedia = function(index) {
  const imageInput = document.getElementById('post-image-files');
  const videoInput = document.getElementById('post-video-files');
  const selected = getSelectedMediaFiles();
  const remaining = selected.filter((_, i) => i !== index);

  const setFiles = (input, type) => {
    const transfer = new DataTransfer();
    remaining.filter(item => item.type === type).forEach(item => transfer.items.add(item.file));
    input.files = transfer.files;
  };

  if (imageInput && videoInput) {
    setFiles(imageInput, 'image');
    setFiles(videoInput, 'video');
    window.previewPostMedia();
  }
};

async function uploadPostMedia(file, type) {
  const resourceType = type === 'video' ? 'video' : 'image';
  const preset = type === 'video' ? CLOUDINARY_VIDEO_PRESET : CLOUDINARY_IMAGE_PRESET;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', preset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/upload`, {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  if (!response.ok || !result.secure_url) {
    throw new Error(result.error?.message || `Không tải được ${type === 'video' ? 'video' : 'ảnh'}.`);
  }

  return {
    type,
    url: result.secure_url,
    publicId: result.public_id || '',
    format: result.format || '',
    resourceType
  };
}


let loadingPosts = false;
let editingPostId = '';
let editingPostMedia = [];
let postRequestId = 0;

function getPostDate(value) {
  if (!value) return '';
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
}

export async function renderPosts() {
  const container = document.getElementById('posts-list');
  if (!container) return;
  const requestId = ++postRequestId;
  container.innerHTML = '<div class="bg-white p-6 rounded-2xl text-center text-stone-500">Đang tải bảng tin...</div>';

  try {
    const snapshot = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc')));
    if (requestId !== postRequestId) return;

    const posts = await Promise.all(snapshot.docs.map(async item => {
      const data = item.data();
      const [likesSnap, commentsSnap] = await Promise.all([
        getDocs(collection(db, 'posts', item.id, 'likes')),
        getDocs(query(collection(db, 'posts', item.id, 'comments'), orderBy('createdAt', 'asc')))
      ]);
      return {
        id: item.id,
        ...data,
        likes: likesSnap.docs.map(d => d.id),
        comments: commentsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      };
    }));

    if (requestId !== postRequestId) return;
    state.posts = posts;
    displayPosts();
  } catch (error) {
    console.error('Không tải được Bảng Tin:', error);
    container.innerHTML = '<div class="bg-white p-6 rounded-2xl text-center text-red-600">Không tải được Bảng Tin. Bạn kiểm tra kết nối nhé.</div>';
  }
}

function displayPosts() {
  const container = document.getElementById('posts-list');
  if (!container) return;

  const searchKeyword = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
  const filtered = state.posts.filter(post =>
    (state.currentCategory === 'ALL' || post.category === state.currentCategory) &&
    ((post.content || '').toLowerCase().includes(searchKeyword) ||
     (post.authorName || '').toLowerCase().includes(searchKeyword))
  );

  if (!filtered.length) {
    container.innerHTML = '<div class="bg-white p-8 rounded-2xl border border-stone-200 text-center text-stone-500 text-sm">Chưa có bài viết nào phù hợp.</div>';
    return;
  }

  container.innerHTML = filtered.map(post => {
    const isOwner = !!state.currentUser && post.ownerId === state.currentUser.uid;
    const isLiked = !!state.currentUser && post.likes.includes(state.currentUser.uid);
    const media = Array.isArray(post.media) ? post.media : [];
    return `
      <article class="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-stone-100">
          <div class="flex items-center gap-3 min-w-0">
            <img src="${escapeHtml(post.authorAvatar || 'store/logo.png')}" alt="Avatar" class="w-10 h-10 rounded-full bg-amber-100 object-cover">
            <div class="min-w-0">
              <h4 class="font-bold text-sm text-stone-800">${escapeHtml(post.authorName || 'Thành viên')}</h4>
              <p class="text-xs text-stone-400">${escapeHtml(getPostDate(post.createdAt))}</p>
            </div>
          </div>
          ${isOwner ? `
            <div class="flex gap-3 shrink-0">
              <button type="button" onclick="editPost('${post.id}')" class="text-sm text-amber-700 hover:underline">Sửa</button>
              <button type="button" onclick="deletePost('${post.id}')" class="text-sm text-red-600 hover:underline">Xóa</button>
            </div>` : ''}
        </div>
        <div class="p-4">
          <p class="text-stone-700 text-sm leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(post.content || '')}</p>
                    ${media.map(item => item.type === 'image'
            ? `<img src="${escapeHtml(item.url)}" alt="Ảnh bài đăng" onclick="openPostMedia('${escapeHtml(item.url)}','image')" class="max-w-full max-h-48 object-contain rounded-xl mt-3 cursor-zoom-in hover:opacity-95" style="display:block;margin-left:auto;margin-right:auto">`
            : item.type === 'video'
? `<video src="${escapeHtml(item.url)}" controls preload="metadata" onclick="if(event.target===this)openPostMedia('${escapeHtml(item.url)}','video')" class="max-w-full max-h-48 rounded-xl mt-3 cursor-zoom-in" style="width:auto;display:block;margin-left:auto;margin-right:auto"></video>`
              : '').join('')}
        </div>
        <div class="px-4 py-3 bg-stone-50/50 border-t border-stone-100 flex items-center justify-between text-xs">
          <button type="button" onclick="toggleLike('${post.id}')" class="flex items-center gap-1.5 font-medium ${isLiked ? 'text-red-500' : 'text-stone-500 hover:text-stone-800'}">
            <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
            <span>${post.likes.length} Thích</span>
          </button>
          <span class="text-stone-500">${post.comments.length} Bình luận</span>
        </div>
        <div class="p-4 bg-stone-50 border-t border-stone-100">
          <div class="space-y-2 mb-3 max-h-48 overflow-y-auto">
            ${post.comments.map(comment => `
              <div class="bg-white p-2.5 rounded-xl border border-stone-200/60 text-xs">
                <span class="font-bold text-stone-800 mr-1">${escapeHtml(comment.authorName || 'Thành viên')}:</span>
                <span class="text-stone-600 whitespace-pre-wrap break-words">${escapeHtml(comment.text || '')}</span>
              </div>
            `).join('')}
          </div>
          <form onsubmit="handleAddComment(event, '${post.id}')" class="flex gap-2">
            <input type="text" id="comment-input-${post.id}" required maxlength="2000" placeholder="Viết bình luận..." class="min-w-0 flex-grow text-xs px-3 py-2 rounded-xl border border-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500">
            <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white text-xs px-3 py-2 rounded-xl font-medium">Gửi</button>
          </form>
        </div>
      </article>`;
  }).join('');
}


function renderExistingPostMedia() {
  const container = document.getElementById('post-existing-media');
  if (!container) return;
  container.innerHTML = editingPostMedia.map((media, index) => `
    <div class="relative">
      ${media.type === 'video'
        ? `<video src="${escapeHtml(media.url)}" controls class="w-full h-36 object-cover rounded-xl"></video>`
        : `<img src="${escapeHtml(media.url)}" alt="Ảnh bài viết" class="w-full h-36 object-cover rounded-xl">`}
      <button type="button" onclick="removeExistingPostMedia(${index})" class="absolute top-1 right-1 bg-black/70 text-white rounded-full px-2 py-1" title="Xóa phương tiện">×</button>
    </div>
  `).join('');
}


window.removeExistingPostMedia = async function(index) {
  const media = editingPostMedia[index];
  if (!media || !editingPostId) return;

  if (!media.publicId) {
    alert('Media này thiếu publicId nên chưa thể xóa an toàn trên Cloudinary.');
    return;
  }

  const buttons = document.querySelectorAll('#post-existing-media button');
  buttons.forEach(button => button.disabled = true);

  try {
    await callPostWorker('/posts/media/delete', {
      postId: editingPostId,
      publicId: media.publicId,
      resourceType: media.resourceType || media.type
    });

    editingPostMedia = editingPostMedia.filter((_, i) => i !== index);

    const post = state.posts.find(item => item.id === editingPostId);
    if (post) post.media = [...editingPostMedia];

    renderExistingPostMedia();
    alert('Đã xóa ảnh/video khỏi bài viết và Cloudinary.');
  } catch (error) {
    console.error('Lỗi xóa media:', error);
    alert(error.message || 'Không thể xóa ảnh/video.');
    renderExistingPostMedia();
  }
};


async function handleCreatePost(event) {
  event.preventDefault();
  if (!requireMemberAccess()) return;

  const form = document.getElementById('create-post-form');
  const contentInput = document.getElementById('post-content');
  const submitBtn = document.getElementById('post-submit-btn');
  const content = contentInput.value.trim();
  const files = getSelectedMediaFiles();

  if (!content && !files.length && !editingPostMedia.length) {
    alert('Bạn hãy nhập nội dung hoặc chọn ảnh/video.');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = editingPostId ? 'Đang cập nhật...' : 'Đang đăng...';
  }

  try {
    const uploadedMedia = [];
    for (const item of files) {
      uploadedMedia.push(await uploadPostMedia(item.file, item.type));
    }

    if (editingPostId) {
      const postRef = doc(db, 'posts', editingPostId);
      await updateDoc(postRef, {
        content,
        media: [...editingPostMedia, ...uploadedMedia],
        updatedAt: serverTimestamp()
      });
      alert('Cập nhật bài viết thành công!');
    } else {
      const media = [...editingPostMedia, ...uploadedMedia];
      await addDoc(collection(db, 'posts'), {
        ownerId: state.currentUser.uid,
        authorName: state.currentUser.displayName || 'Cựu Học Sinh 126',
        authorAvatar: state.currentUser.photoURL || '',
        content,
        media,
        createdAt: serverTimestamp()
      });
      alert('Đăng bài thành công!');
    }

    form.reset();
    editingPostId = '';
    editingPostMedia = [];
    document.getElementById('editing-post-id').value = '';
    document.getElementById('post-media-preview').innerHTML = '';
    document.getElementById('post-existing-media').innerHTML = '';
    document.getElementById('post-submit-btn').textContent = 'Đăng';
    document.getElementById('post-cancel-edit-btn').classList.add('hidden');
    document.getElementById('feed-composer').classList.remove('hidden');
    await renderPosts();
    document.getElementById('feed-composer').classList.add('hidden');
  } catch (error) {
    console.error('Lỗi đăng/cập nhật bài viết:', error);
    alert(error.message || 'Không thể lưu bài viết. Bạn thử lại nhé.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitBtn && !editingPostId) submitBtn.textContent = 'Đăng';
  }
}




window.editPost = function(postId) {
  const post = state.posts.find(item => item.id === postId);
  if (!post) {
    alert('Không tìm thấy bài viết.');
    return;
  }
  if (post.ownerId !== state.currentUser?.uid) {
    alert('Bạn chỉ có thể sửa bài viết của mình.');
    return;
  }

  editingPostId = postId;
  editingPostMedia = Array.isArray(post.media) ? post.media.map(media => ({ ...media })) : [];

  document.getElementById('editing-post-id').value = postId;
  document.getElementById('post-content').value = post.content || '';
  document.getElementById('post-image-files').value = '';
  document.getElementById('post-video-files').value = '';
  document.getElementById('post-media-preview').innerHTML = '';
  document.getElementById('post-submit-btn').textContent = 'Cập nhật';
  document.getElementById('post-cancel-edit-btn').classList.remove('hidden');

  renderExistingPostMedia();
  document.getElementById('feed-composer').classList.remove('hidden');
  document.getElementById('feed-composer').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.cancelEditPost = function() {
  editingPostId = '';
  editingPostMedia = [];

  const form = document.getElementById('create-post-form');
  form.reset();
  document.getElementById('editing-post-id').value = '';
  document.getElementById('post-media-preview').innerHTML = '';
  document.getElementById('post-existing-media').innerHTML = '';
  document.getElementById('post-submit-btn').textContent = 'Đăng';
  document.getElementById('post-cancel-edit-btn').classList.add('hidden');
};



window.deletePost = async function(postId) {
  const post = state.posts.find(item => item.id === postId);
  if (!post) {
    alert('Không tìm thấy bài viết.');
    return;
  }

  if (post.ownerId !== state.currentUser?.uid) {
    alert('Bạn chỉ có thể xóa bài viết của mình.');
    return;
  }

  if (!confirm('Xóa toàn bộ bài viết này cùng ảnh, video, lượt thích và bình luận?')) return;

  try {
    await callPostWorker('/posts/delete', { postId });
    state.posts = state.posts.filter(item => item.id !== postId);

    if (editingPostId === postId) window.cancelEditPost();

    displayPosts();
    alert('Đã xóa bài viết cùng media và dữ liệu liên quan.');
  } catch (error) {
    console.error('Lỗi xóa bài viết:', error);
    alert(error.message || 'Không thể xóa bài viết. Dữ liệu vẫn được giữ lại nếu Worker chưa hoàn tất.');
  }
};


export async function toggleLike(postId) {
  if (!requireMemberAccess('thích bài viết')) return;
  const post = state.posts.find(item => item.id === postId);
  if (!post) return;

  const uid = state.currentUser.uid;
  const likeRef = doc(db, 'posts', postId, 'likes', uid);
  const alreadyLiked = post.likes.includes(uid);

  try {
    if (alreadyLiked) {
      await deleteDoc(likeRef);
    } else {
      await setDoc(likeRef, { uid, createdAt: serverTimestamp() });
    }
    await renderPosts();
  } catch (error) {
    console.error('Lỗi Like:', error);
    alert('Chưa cập nhật được lượt thích. Vui lòng thử lại.');
  }
}

export async function handleAddComment(event, postId) {
  event.preventDefault();
  if (!requireMemberAccess('bình luận')) return;

  const input = document.getElementById(`comment-input-${postId}`);
  const text = input?.value.trim();
  if (!text) return;

  const button = event.submitter;
  if (button) button.disabled = true;

  try {
    await addDoc(collection(db, 'posts', postId, 'comments'), {
      authorId: state.currentUser.uid,
      authorName: state.currentUser.displayName || 'Thành viên',
      authorAvatar: state.currentUser.photoURL || 'store/logo.png',
      text,
      createdAt: serverTimestamp()
    });
    await renderPosts();
  } catch (error) {
    console.error('Lỗi bình luận:', error);
    alert('Chưa gửi được bình luận. Vui lòng thử lại.');
  } finally {
    if (button) button.disabled = false;
  }
}

export function setPresetImage() {
  alert('Chức năng tải ảnh sẽ được nối Cloudinary ở bước tiếp theo.');
}

export function filterCategory(category) {
  state.currentCategory = category;
  document.querySelectorAll('.cat-filter').forEach(button => {
    button.classList.toggle('active', button.innerText.includes(category) || (category === 'ALL' && button.innerText === 'Tất Cả'));
  });
  displayPosts();
}

export function handleSearch() {
  displayPosts();
}

window.openPostMedia = function(url, type) {
  let viewer = document.getElementById('post-media-viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'post-media-viewer';
    viewer.className = 'fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4';
    viewer.innerHTML = '<button type="button" onclick="closePostMedia()" class="absolute top-4 right-5 text-white text-3xl z-10" aria-label="Đóng">&times;</button><div id="post-media-viewer-content" class="w-full h-full flex items-center justify-center"></div>';
    viewer.onclick = function(event) {
      if (event.target === viewer) window.closePostMedia();
    };
    document.body.appendChild(viewer);
  }
  const content = document.getElementById('post-media-viewer-content');
  content.innerHTML = type === 'image'
    ? `<img src="${escapeHtml(url)}" alt="Ảnh phóng to" class="max-w-full max-h-full object-contain">`
    : `<video src="${escapeHtml(url)}" controls autoplay class="max-w-full max-h-full"></video>`;
  viewer.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

window.closePostMedia = function() {
  const viewer = document.getElementById('post-media-viewer');
  if (!viewer) return;
  const video = viewer.querySelector('video');
  if (video) video.pause();
  viewer.classList.add('hidden');
  document.body.style.overflow = '';
};


window.closePostComposer = function() {
  const composer = document.getElementById('feed-composer');
  if (composer) composer.classList.add('hidden');
};


window.handleCreatePost = handleCreatePost;
window.setPresetImage = setPresetImage;
window.toggleLike = toggleLike;
window.handleAddComment = handleAddComment;
window.editPost = editPost;
window.deletePost = deletePost;
window.filterCategory = filterCategory;
window.handleSearch = handleSearch;
