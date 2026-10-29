
import { state, escapeHtml } from './app-state.js';
import { db, auth } from './firebase-config.js';
import { collection, getDocs, doc, updateDoc, query, where} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { uploadToCloudinary } from './cloudinary.js';


let memberProfiles = [];

export async function updateDirectoryList() {
  const grid = document.getElementById('directory-grid');
  if (!grid) return;

  try {
    let members = [];

    if (state.isAdmin) {
      const snapshot = await getDocs(collection(db, 'members'));
      members = snapshot.docs.map(d => ({ ...d.data(), uid: d.id }));
    } else if (state.authStatus === 'approved') {
      const q = query(collection(db, 'members'), where('status', '==', 'approved'));
      const snapshot = await getDocs(q);
      members = snapshot.docs.map(d => ({ ...d.data(), uid: d.id }));
    } else {
      members = state.directory.map(m => ({ ...m }));
    }

    memberProfiles = members;
    state.directory = members.map(m => ({
      id: m.uid || m.id,
      uid: m.uid || '',
      name: m.displayName || m.name || 'Chưa có tên',
      avatar: m.photoURL || m.avatar || '',
      job: m.job || '',
      location: m.location || '',
      phone: m.phone || '',
      facebook: m.facebook || '',
      status: m.status || ''
    }));

    grid.innerHTML = state.directory.map(m => {
      const pending = state.isAdmin && m.status === 'pending';
      const profile = memberProfiles.find(p => (p.uid || p.id) === (m.uid || m.id));

      return `
        <div class="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm flex items-start space-x-3">
          <img src="${escapeHtml(m.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=Member')}" class="w-12 h-12 rounded-full bg-amber-100 object-cover flex-shrink-0">
          <div class="flex-grow min-w-0">
            <h4 class="font-bold text-sm text-stone-800 truncate">${escapeHtml(m.name)}</h4>
            <p class="text-xs text-amber-700 font-medium truncate mb-1">${escapeHtml(m.job || 'Chưa cập nhật công việc')}</p>
            <p class="text-[11px] text-stone-500 truncate mb-2"><i class="fa-solid fa-location-dot mr-1"></i>${escapeHtml(m.location || 'Chưa rõ')}</p>
            <div class="flex items-center flex-wrap gap-2 text-xs">
              ${m.phone ? `<a href="tel:${escapeHtml(m.phone)}" class="text-green-600 bg-green-50 hover:bg-green-100 px-2 py-0.5 rounded-md font-medium"><i class="fa-solid fa-phone mr-1"></i>${escapeHtml(m.phone)}</a>` : ''}
              ${m.facebook ? `<a href="${escapeHtml(m.facebook)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md font-medium"><i class="fa-brands fa-facebook"></i></a>` : ''}
              ${pending ? `<button onclick="togglePendingProfile('${m.uid}')" class="text-amber-800 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-md font-semibold">Đang chờ duyệt</button>` : ''}
            </div>
            ${pending ? `
              <div id="pending-profile-${m.uid}" class="hidden mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs space-y-2">
                <p><b>Email:</b> ${escapeHtml(profile?.email || '')}</p>
                <p><b>Họ tên:</b> ${escapeHtml(profile?.displayName || '')}</p>
                <p><b>Công việc:</b> ${escapeHtml(profile?.job || 'Chưa cập nhật')}</p>
                <p><b>Nơi ở:</b> ${escapeHtml(profile?.location || 'Chưa cập nhật')}</p>
                <p><b>Điện thoại:</b> ${escapeHtml(profile?.phone || 'Chưa cập nhật')}</p>
                <p><b>Facebook:</b> ${escapeHtml(profile?.facebook || 'Chưa cập nhật')}</p>
                <button onclick="approveMember('${m.uid}')" class="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg font-semibold"><i class="fa-solid fa-check mr-1"></i>Duyệt thành viên</button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('') || `<div class="col-span-full text-center text-sm text-stone-500 p-6">Chưa có thành viên để hiển thị.</div>`;
  } catch (error) {
    console.error('Không thể tải danh sách thành viên:', error);
    grid.innerHTML = `<div class="col-span-full text-center text-sm text-red-600 p-6">Không tải được danh sách thành viên. Vui lòng kiểm tra quyền truy cập và kết nối.</div>`;
  }
}

export function togglePendingProfile(uid) {
  if (!state.isAdmin) {
    alert('Chỉ Admin mới có quyền xem hồ sơ chờ duyệt.');
    return;
  }

  const panel = document.getElementById(`pending-profile-${uid}`);
  if (panel) panel.classList.toggle('hidden');
}

export async function approveMember(uid) {
  if (!state.isAdmin) {
    alert('Chỉ Admin mới có quyền duyệt thành viên.');
    return;
  }

  const member = memberProfiles.find(m => m.uid === uid);
  if (!member || member.status !== 'pending') {
    alert('Hồ sơ không còn ở trạng thái chờ duyệt.');
    return;
  }

  if (!confirm(`Duyệt thành viên ${member.displayName || member.email || uid}?`)) return;

  try {
    await updateDoc(doc(db, 'members', uid), { status: 'approved' });
    alert('Đã duyệt thành viên thành công.');
    await updateDirectoryList();
  } catch (error) {
    console.error('Lỗi duyệt thành viên:', error);
    alert('Không thể duyệt thành viên, chỉ có Admin.');
  }
}


let selectedAvatarFile = null;
let avatarPreviewUrl = '';

export function previewProfileAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Bạn vui lòng chọn một tệp hình ảnh.');
    event.target.value = '';
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    alert('Ảnh gốc không được vượt quá 10 MB.');
    event.target.value = '';
    return;
  }

  selectedAvatarFile = file;

  if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
  avatarPreviewUrl = URL.createObjectURL(file);

  const preview = document.getElementById('prof-avatar-preview');
  const status = document.getElementById('prof-avatar-status');

  if (preview) preview.src = avatarPreviewUrl;
  if (status) status.textContent = `Đã chọn: ${file.name}`;
}

window.previewProfileAvatar = previewProfileAvatar;



export function openProfileEditModal() {
  if (!state.currentUser) {
    alert('Bạn vui lòng đăng nhập để cập nhật hồ sơ cá nhân.');
    return;
  }

  const profile = state.currentUser;
  selectedAvatarFile = null;

  const fileInput = document.getElementById('prof-avatar');
  const preview = document.getElementById('prof-avatar-preview');
  const status = document.getElementById('prof-avatar-status');

  if (fileInput) fileInput.value = '';
  if (preview) preview.src = profile.photoURL || 'https://api.dicebear.com/7.x/bottts/svg?seed=Member';
  if (status) status.textContent = 'Chọn ảnh JPG, PNG hoặc WebP.';

  document.getElementById('prof-job').value = profile.job || '';
  document.getElementById('prof-location').value = profile.location || '';
  document.getElementById('prof-phone').value = profile.phone || '';
  document.getElementById('prof-fb').value = profile.facebook || '';
  document.getElementById('profile-modal').classList.remove('hidden');
}


export function closeProfileModal() {
  document.getElementById('profile-modal').classList.add('hidden');
}



export async function handleSaveProfile(e) {
  e.preventDefault();

  if (!state.currentUser || !auth.currentUser) {
    alert('Bạn vui lòng đăng nhập lại để cập nhật hồ sơ.');
    return;
  }

  const saveBtn = document.getElementById('prof-save-btn');
  const avatarStatus = document.getElementById('prof-avatar-status');
  const job = document.getElementById('prof-job').value.trim();
  const location = document.getElementById('prof-location').value.trim();
  const phone = document.getElementById('prof-phone').value.trim();
  const facebook = document.getElementById('prof-fb').value.trim();

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu...';
  }

  try {
    await updateDoc(doc(db, 'members', state.currentUser.uid), {
      job, location, phone, facebook
    });

    Object.assign(state.currentUser, { job, location, phone, facebook });

    if (selectedAvatarFile) {
      if (avatarStatus) avatarStatus.textContent = 'Đang nén và tải avatar mới lên Cloudinary...';

      const uploaded = await uploadToCloudinary(selectedAvatarFile, 'avatar');
      const idToken = await auth.currentUser.getIdToken();

      if (avatarStatus) avatarStatus.textContent = 'Đang cập nhật hồ sơ và xử lý avatar cũ...';

      const response = await fetch(
        'https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/avatar/update',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            photoURL: uploaded.url,
            publicId: uploaded.publicId
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        console.error('Lỗi cập nhật avatar:', result);
        throw new Error(result.error || 'Không thể cập nhật avatar.');
      }

      Object.assign(state.currentUser, {
        photoURL: result.photoURL,
        avatarPublicId: result.avatarPublicId
      });

const userAvatar = document.getElementById('user-avatar');
if (userAvatar) userAvatar.src = result.photoURL;

      if (result.cleanupPending) {
        console.warn('Avatar mới đã lưu; cần kiểm tra việc xóa ảnh cũ.');
       alert('Avatar mới đã được cập nhật,ảnh cũ chưa xóa được.');
      }
    }

    selectedAvatarFile = null;

    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = '';

    closeProfileModal();
    await updateDirectoryList();

    if (saveBtn) saveBtn.textContent = 'Lưu Thay Đổi';
    if (!selectedAvatarFile) {
      console.log('Đã lưu hồ sơ và xử lý avatar.');
    }
  } catch (error) {
    console.error('Lỗi cập nhật hồ sơ:', error);
    if (avatarStatus) avatarStatus.textContent = 'Lưu thất bại. Bạn có thể thử lại.';
    alert(`Không thể hoàn tất cập nhật hồ sơ: ${error.message || 'Lỗi không xác định'}`);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Lưu Thay Đổi';
    }
  }
}



window.openProfileEditModal = openProfileEditModal;
window.closeProfileModal = closeProfileModal;
window.handleSaveProfile = handleSaveProfile;
window.togglePendingProfile = togglePendingProfile;
window.approveMember = approveMember;
