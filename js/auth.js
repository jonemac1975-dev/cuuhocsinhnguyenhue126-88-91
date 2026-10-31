
import { state } from './app-state.js';
import { updateDirectoryList } from './directory.js';
import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, setDoc, serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { startChatPresence, stopChatPresence } from './chat-presence.js';
import { refreshAnnouncementPermissions } from './announcements.js';
import { syncPrivateIncomingCallListener} from './chat.js';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23f5f5f4'/%3E%3Ccircle cx='50' cy='37' r='17' fill='%23a8a29e'/%3E%3Cpath d='M18 88c3-19 15-29 32-29s29 10 32 29' fill='%23a8a29e'/%3E%3C/svg%3E";

let isSignUpMode = false;
let authActionInProgress = false;
let authMessageShown = false;

function getErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'Email này đã được đăng ký.',
    'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
    'auth/weak-password': 'Mật khẩu phải có ít nhất 6 ký tự.',
    'auth/invalid-credential': 'Email hoặc mật khẩu không chính xác.',
    'auth/user-not-found': 'Không tìm thấy tài khoản.',
    'auth/wrong-password': 'Email hoặc mật khẩu không chính xác.',
    'auth/too-many-requests': 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.',
    'auth/network-request-failed': 'Không thể kết nối mạng. Vui lòng thử lại.'
  };
  return messages[error.code] || 'Có lỗi xảy ra. Vui lòng thử lại.';
}

async function getMemberProfile(user) {
  const memberRef = doc(db, 'members', user.uid);
  const memberSnap = await getDoc(memberRef);

  if (!memberSnap.exists()) {
    const profile = {
      displayName: user.displayName || user.email?.split('@')[0] || 'Bạn học',
      email: user.email || '',
      photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.uid)}`,
      status: 'pending',
      createdAt: serverTimestamp()
    };
    await setDoc(memberRef, profile);
    return { ...profile, uid: user.uid };
  }

  return { ...memberSnap.data(), uid: user.uid, email: user.email || '' };
}

async function applyAuthUser(user) {
  if (!user) {
    state.currentUser = null;
    state.authStatus = 'guest';
    state.isAdmin = false;
    updateUserUI();
    updateDirectoryList();
    stopChatPresence();
    syncPrivateIncomingCallListener(false);
    return;
  }

  const [profile, tokenResult] = await Promise.all([
    getMemberProfile(user),
    user.getIdTokenResult(true)
  ]);

  state.isAdmin = tokenResult.claims.admin === true;
  state.authStatus = profile.status === 'approved' || state.isAdmin
    ? 'approved'
    : profile.status === 'rejected'
      ? 'rejected'
      : 'pending';

  state.currentUser = {
    uid: user.uid,
    displayName: profile.displayName || user.displayName || user.email?.split('@')[0] || 'Bạn học',
    email: user.email || '',
    photoURL: profile.photoURL || user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.uid)}`,
    status: profile.status,
    job: profile.job || '',
    location: profile.location || '',
    phone: profile.phone || '',
    facebook: profile.facebook || ''
  };

  
  updateUserUI();
  updateDirectoryList();

  if (state.authStatus === 'approved' || state.isAdmin === true) {
  startChatPresence();
  syncPrivateIncomingCallListener(true);
  } else {
  stopChatPresence();
  syncPrivateIncomingCallListener(false);
  }

  if (state.isAdmin === true) loadRecoveryRequests();

  if (state.authStatus === 'pending' && !authMessageShown) {
    authMessageShown = true;
    alert('Tài khoản đang chờ Admin duyệt. Bạn hoàn thiện hồ sơ trong thời gian chờ.');
  }

  if (state.authStatus === 'rejected' && !authMessageShown) {
    authMessageShown = true;
    alert('Tài khoản đã bị từ chối. Vui lòng liên hệ Admin.');
  }
}


export function openAuthModal() {
  if (auth.currentUser) {
    if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
      stopChatPresence().then(() => {
        signOut(auth).catch(error => alert(getErrorMessage(error)));
      });
    }
    return;
  }

  authMessageShown = false;
  document.getElementById('auth-modal').classList.remove('hidden');
}


export function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}


export function toggleAuthMode() {
  isSignUpMode = !isSignUpMode;
  document.getElementById('name-field').classList.toggle('hidden', !isSignUpMode);
  document.getElementById('forgot-password-wrap')?.classList.toggle('hidden', isSignUpMode);
  document.getElementById('auth-modal-title').innerText = isSignUpMode ? 'Đăng Ký Tài Khoản' : 'Đăng Nhập Thành Viên';
  document.getElementById('auth-submit-btn').innerText = isSignUpMode ? 'Tạo Tài Khoản' : 'Đăng Nhập';
  document.getElementById('toggle-auth-mode-btn').innerText = isSignUpMode ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký ngay';
}


export async function handleAuthSubmit(e) {
  e.preventDefault();

  if (authActionInProgress) return;

  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value.trim();
  const submitBtn = document.getElementById('auth-submit-btn');

  if (!email || !password) {
    alert('Vui lòng nhập email và mật khẩu.');
    return;
  }

  if (isSignUpMode && !name) {
    alert('Vui lòng nhập họ tên.');
    return;
  }

  authActionInProgress = true;
  const originalText = submitBtn.innerText;
  submitBtn.disabled = true;
  submitBtn.innerText = 'Đang xử lý...';

  try {
    if (isSignUpMode) {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const user = credential.user;
      const photoURL = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.uid)}`;

      await setDoc(doc(db, 'members', user.uid), {
        displayName: name,
        email: user.email,
        photoURL,
        status: 'pending',
        job: '',
        location: '',
        phone: '',
        facebook: '',
        createdAt: serverTimestamp()
      });

      authMessageShown = true;
      await applyAuthUser(user);
      closeAuthModal();
      alert('Đăng ký thành công! Bạn hoàn thiện hồ sơ và chờ Admin duyệt.');
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const user = credential.user;
      await applyAuthUser(user);
      closeAuthModal();

      if (state.authStatus === 'rejected') {
        alert('Tài khoản đã bị từ chối. Vui lòng liên hệ quản trị viên.');
      } else if (state.authStatus === 'pending') {
        alert('Đăng nhập thành công! Bạn hoàn thiện hồ sơ và chờ Admin duyệt.');
      } else {
        alert(`Chào bạn ${state.currentUser.displayName} trở lại!`);
      }
    }
  } catch (error) {
    console.error('Lỗi xác thực:', error);
    alert(getErrorMessage(error));
  } finally {
    authActionInProgress = false;
    submitBtn.disabled = false;
    submitBtn.innerText = originalText;
  }
}


async function loadRecoveryRequests() {
  const panel = document.getElementById('admin-recovery-panel');
  const list = document.getElementById('admin-recovery-list');
  if (!panel || !list) return;
  if (state.isAdmin !== true || !auth.currentUser) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  list.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'text-xs text-stone-500';
  loading.textContent = 'Đang tải yêu cầu...';
  list.appendChild(loading);

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch('https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/account-recovery/list', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Không tải được danh sách.');

    list.replaceChildren();
    if (!result.requests.length) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-stone-500';
      empty.textContent = 'Chưa có yêu cầu khôi phục tài khoản.';
      list.appendChild(empty);
      return;
    }

    result.requests.forEach(item => {
      const card = document.createElement('div');
      card.className = 'rounded-xl border border-stone-200 p-3 space-y-2';

      const name = document.createElement('p');
      name.className = 'font-bold text-sm text-stone-800';
      name.textContent = item.name || 'Chưa có họ tên';

      const phone = document.createElement('p');
      phone.className = 'text-sm text-stone-700';
      phone.textContent = `SĐT: ${item.phone || '—'}`;

      const note = document.createElement('p');
      note.className = 'text-xs text-stone-600 whitespace-pre-wrap';
      note.textContent = `Ghi chú: ${item.note || 'Không có'}`;

      const time = document.createElement('p');
      time.className = 'text-xs text-stone-500';
      time.textContent = item.createdAt ? `Gửi lúc: ${new Date(item.createdAt).toLocaleString('vi-VN')}` : '';

      const status = document.createElement('p');
      status.className = 'text-xs font-semibold';
      status.textContent = item.status === 'processed' ? 'Trạng thái: Đã xử lý' : item.status === 'rejected' ? 'Trạng thái: Đã từ chối' : 'Trạng thái: Chờ xử lý';
      status.classList.add(item.status === 'processed' ? 'text-green-700' : item.status === 'rejected' ? 'text-red-600' : 'text-amber-700');

      
card.append(name, phone, note, time, status);

const searchButton = document.createElement('button');
searchButton.type = 'button';
searchButton.className = 'rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white';
searchButton.textContent = 'Tìm tài khoản';

searchButton.addEventListener('click', async () => {
  searchButton.disabled = true;
  searchButton.textContent = 'Đang tìm...';

  let resultBox = card.querySelector('.recovery-search-results');
  if (!resultBox) {
    resultBox = document.createElement('div');
    resultBox.className = 'recovery-search-results mt-2 space-y-2';
    card.appendChild(resultBox);
  }

  resultBox.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'text-xs text-stone-500';
  loading.textContent = 'Đang tra cứu hồ sơ thành viên...';
  resultBox.appendChild(loading);

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch('https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/account-recovery/search-members', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: item.name || '', email: item.email || '' })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Không tra cứu được tài khoản.');
    }

    resultBox.replaceChildren();

    if (!result.members.length) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-amber-700';
      empty.textContent = 'Chưa tìm thấy tài khoản phù hợp. Bạn có thể tìm bằng email nếu biết email đăng ký.';
      resultBox.appendChild(empty);
      return;
    }

    const heading = document.createElement('p');
    heading.className = 'text-xs font-bold text-stone-700';
    heading.textContent = `Tìm thấy ${result.members.length} tài khoản phù hợp:`;
    resultBox.appendChild(heading);

    result.members.forEach(member => {
      const memberBox = document.createElement('div');
      memberBox.className = 'rounded-lg bg-stone-50 border border-stone-200 p-2';

      const memberName = document.createElement('p');
      memberName.className = 'text-sm font-semibold text-stone-800';
      memberName.textContent = member.displayName || 'Chưa có họ tên';

      const memberEmail = document.createElement('p');
      memberEmail.className = 'text-xs text-stone-700 break-all';
      memberEmail.textContent = `Email: ${member.email || 'Không có'}`;

      const memberPhone = document.createElement('p');
      memberPhone.className = 'text-xs text-stone-600';
      memberPhone.textContent = `SĐT: ${member.phone || 'Chưa cập nhật'}`;

      
memberBox.append(memberName, memberEmail, memberPhone);

if (member.email) {
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'mt-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white';
  resetButton.textContent = 'Gửi email đặt lại mật khẩu';

  resetButton.addEventListener('click', async () => {
    if (!confirm(`Gửi hướng dẫn đặt lại mật khẩu đến email:\n${member.email}?`)) return;

    resetButton.disabled = true;
    resetButton.textContent = 'Đang gửi...';

    try {
      await sendPasswordResetEmail(auth, member.email);
      alert('Đã yêu cầu gửi email đặt lại mật khẩu đến ' + member.email + '. Kiểm tra hộp thư và thư mục Spam.');
      resetButton.textContent = 'Đã gửi yêu cầu';
    } catch (error) {
      console.error('Lỗi gửi email khôi phục:', error);
      if (error.code === 'auth/too-many-requests') {
        alert('Thao tác quá nhiều lần. Vui lòng thử lại sau.');
      } else if (error.code === 'auth/network-request-failed') {
        alert('Lỗi kết nối mạng. Vui lòng thử lại.');
      } else {
        alert('Chưa gửi được email. Kiểm tra lại cấu hình Firebase Authentication và thử lại.');
      }
      resetButton.disabled = false;
      resetButton.textContent = 'Gửi email đặt lại mật khẩu';
    }
  });

  memberBox.appendChild(resetButton);
}

resultBox.appendChild(memberBox);

    });
  } catch (error) {
    resultBox.replaceChildren();
    const errorMessage = document.createElement('p');
    errorMessage.className = 'text-xs text-red-600';
    errorMessage.textContent = error.message || 'Không tra cứu được tài khoản.';
    resultBox.appendChild(errorMessage);
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = 'Tìm tài khoản';
  }
});

card.appendChild(searchButton);

if (item.status === 'pending') {


        const actions = document.createElement('div');
        actions.className = 'flex flex-wrap gap-2 pt-1';

        [['processed', 'Đã xử lý', 'bg-green-600'], ['rejected', 'Từ chối', 'bg-red-600']].forEach(([value, label, color]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `${color} rounded-lg px-3 py-2 text-xs font-semibold text-white`;
          button.textContent = label;
          button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Đang lưu...';
            try {
              const currentToken = await auth.currentUser.getIdToken();
              const updateResponse = await fetch('https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/account-recovery/update', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, status: value })
              });
              const updateResult = await updateResponse.json();
              if (!updateResponse.ok || !updateResult.success) throw new Error(updateResult.error || 'Không cập nhật được trạng thái.');
              await loadRecoveryRequests();
            } catch (error) {
              alert(error.message || 'Không cập nhật được yêu cầu.');
              button.disabled = false;
              button.textContent = label;
            }
          });
          actions.appendChild(button);
        });

        card.appendChild(actions);
      }

      list.appendChild(card);
    });
  } catch (error) {
    console.error('Lỗi tải yêu cầu khôi phục:', error);
    list.replaceChildren();
    const message = document.createElement('p');
    message.className = 'text-xs text-red-600';
    message.textContent = error.message || 'Không tải được danh sách yêu cầu.';
    list.appendChild(message);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'rounded-lg bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700';
    retry.textContent = 'Tải lại';
    retry.addEventListener('click', loadRecoveryRequests);
    list.appendChild(retry);
  }
}


export function openForgotAccount() {
  document.getElementById('forgot-account-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'forgot-account-modal';
  modal.className = 'fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4';
  modal.innerHTML = `
    <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h3 class="mb-2 text-lg font-bold text-stone-800">Khôi Phục Tài Khoản</h3>
      <p class="mb-4 text-sm text-stone-500">Nhập họ tên và số điện thoại đã đăng ký. Admin sẽ kiểm tra và hỗ trợ anh.</p>
      <form id="forgot-account-form" class="space-y-3">
        <input id="recovery-name" type="text" maxlength="100" required placeholder="Họ và tên" class="w-full rounded-xl border border-stone-200 px-4 py-3 text-sm">
        <input id="recovery-phone" type="tel" maxlength="20" required placeholder="Số điện thoại đã đăng ký" class="w-full rounded-xl border border-stone-200 px-4 py-3 text-sm">
        <textarea id="recovery-note" maxlength="500" rows="3" placeholder="Ghi chú thêm (nếu có)" class="w-full rounded-xl border border-stone-200 px-4 py-3 text-sm"></textarea>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="recovery-cancel" class="rounded-xl border border-stone-300 px-4 py-2 text-sm text-stone-700">Đóng</button>
          <button type="submit" id="recovery-submit" class="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white">Gửi yêu cầu</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(modal);
  modal.querySelector('#recovery-cancel').onclick = () => modal.remove();

  modal.querySelector('#forgot-account-form').onsubmit = async event => {
    event.preventDefault();

    const button = modal.querySelector('#recovery-submit');
    button.disabled = true;
    button.textContent = 'Đang gửi...';

    try {
      const response = await fetch('https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev/account-recovery/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: modal.querySelector('#recovery-name').value.trim(),
          phone: modal.querySelector('#recovery-phone').value.trim(),
          note: modal.querySelector('#recovery-note').value.trim()
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Gửi yêu cầu thất bại.');

      modal.remove();
      alert(result.message || 'Đã gửi yêu cầu. Vui lòng chờ Admin hỗ trợ.');
    } catch (error) {
      console.error('Lỗi gửi yêu cầu khôi phục:', error);
      alert(error.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.');
      button.disabled = false;
      button.textContent = 'Gửi yêu cầu';
    }
  };
}


export async function resetPassword() {
  const emailInput = document.getElementById('auth-email');
  const email = emailInput?.value.trim();

  if (!email) {
    alert('Nhập email đã đăng ký vào ô Email trước.');
    emailInput?.focus();
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    alert('Nếu email này đã đăng ký, nhấn OK và kiểm tra hộp thư và thư mục Spam để biết hướng dẫn đặt lại mật khẩu.');
  } catch (error) {
    console.error('Lỗi đặt lại mật khẩu:', error);
    if (error.code === 'auth/invalid-email') {
      alert('Địa chỉ email không hợp lệ.');
    } else if (error.code === 'auth/too-many-requests') {
      alert('Thao tác quá nhiều lần. Vui lòng thử lại sau.');
    } else {
      alert('Chưa thể gửi email đặt lại mật khẩu,thử lại hoặc liên hệ Admin.');
    }
  }
}


export function updateUserUI() {
  const avatarEl = document.getElementById('user-avatar');
  const nameEl = document.getElementById('user-name');
  const btnTextEl = document.getElementById('auth-btn-text');
  const profileBtn = document.getElementById('profile-edit-btn');

  if (!avatarEl || !nameEl || !btnTextEl) return;

  const postAvatar = document.getElementById('post-author-avatar');
  const postName = document.getElementById('post-author-name');

  if (state.currentUser) {
    avatarEl.src = state.currentUser.photoURL || DEFAULT_AVATAR;

    if (postAvatar) {
      postAvatar.src = state.currentUser.photoURL || DEFAULT_AVATAR;
    }

    if (postName) {
      postName.innerText = state.currentUser.displayName || 'Bạn học';
    }

    nameEl.innerText = state.currentUser.displayName || 'Bạn học';
    btnTextEl.innerText = 'Đăng Xuất';
  } else {
    avatarEl.src = DEFAULT_AVATAR;

    if (postAvatar) {
      postAvatar.src = DEFAULT_AVATAR;
    }

    if (postName) {
      postName.innerText = 'Cựu Học Sinh 126';
    }

    nameEl.innerText = 'Bạn học';
    btnTextEl.innerText = 'Đăng Nhập';
  }

  if (profileBtn) {
    profileBtn.classList.toggle(
      'hidden',
      !(state.currentUser && state.authStatus === 'pending')
    );
  }

  const recoveryPanel = document.getElementById('admin-recovery-panel');
  if (recoveryPanel) {
    recoveryPanel.classList.toggle('hidden', state.isAdmin !== true);
  }

  refreshAnnouncementPermissions();
}


onAuthStateChanged(auth, async user => {
  if (authActionInProgress) return;

  try {
    await applyAuthUser(user);
  } catch (error) {
    console.error('Không thể tải hồ sơ thành viên:', error);
    state.currentUser = null;
    state.authStatus = 'guest';
    state.isAdmin = false;
    updateUserUI();
    updateDirectoryList();
  }
});

window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.toggleAuthMode = toggleAuthMode;
window.handleAuthSubmit = handleAuthSubmit;
window.resetPassword = resetPassword;
window.openForgotAccount = openForgotAccount;
