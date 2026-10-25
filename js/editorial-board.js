
import { db,auth } from './firebase-config.js';
import { state } from './app-state.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, setDoc, deleteDoc, serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const BOARD_COLLECTION = 'editorialBoard';
const MEMBERS_COLLECTION = 'members';

let boardMembers = [];
let approvedMembers = [];
let selectedMemberUid = '';
let isSaving = false;
let initialized = false;

const $ = (id) => document.getElementById(id);

function isAdmin() {
    return state.isAdmin === true;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function getMemberName(member = {}) {
  return member.displayName || member.name || member.fullName || 'Thành viên';
}

function getMemberAvatar(member = {}) {
  return member.photoURL || member.avatar || member.photoUrl || '';
}

function setStatus(message, isError = false) {
  const el = $('editorial-form-status');
  if (!el) return;

  el.textContent = message;
  el.style.color = isError ? '#ffb4a8' : '#f4d58d';
}

function normalizeRole(value) {
  return String(value || '').trim().slice(0, 100);
}

async function loadBoardMembers() {
  const list = $('editorial-board-list');
  if (!list) return;

  list.innerHTML = '<p class="footer-loading">Đang tải danh sách Ban Biên Tập...</p>';

  try {
    const boardQuery = query(
      collection(db, BOARD_COLLECTION),
      orderBy('order', 'asc'),
      limit(100)
    );

    const boardSnapshot = await getDocs(boardQuery);
    const results = [];

    for (const boardDoc of boardSnapshot.docs) {
      const entry = boardDoc.data();
      const uid = entry.uid || boardDoc.id;

      try {
        const memberSnapshot = await getDoc(doc(db, MEMBERS_COLLECTION, uid));

        if (!memberSnapshot.exists()) continue;

        const member = memberSnapshot.data();

        if (member.status !== 'approved') continue;

        results.push({
          uid,
          role: typeof entry.role === 'string' ? entry.role : '',
          order: Number.isInteger(entry.order) ? entry.order : 999,
          name: getMemberName(member),
          avatar: getMemberAvatar(member)
        });
      } catch (error) {
        console.warn('Không tải được hồ sơ Ban Biên Tập:', uid, error);
      }
    }

    boardMembers = results.sort((a, b) => a.order - b.order);
    renderBoardMembers();
  } catch (error) {
    console.error('Lỗi tải Ban Biên Tập:', error);
    list.innerHTML =
      '<p class="footer-loading">Chưa tải được danh sách. Vui lòng thử tải lại trang.</p>';
  }
}

function renderBoardMembers() {
  const list = $('editorial-board-list');
  const controls = $('editorial-admin-controls');
  if (!list) return;
  if (!boardMembers.length) {
    list.innerHTML = `
      <div class="footer-empty">
        <i class="fa-solid fa-users"></i>
        <p>Đang cập nhật thành viên</p>
      </div>`;
  } else {
    list.innerHTML = boardMembers.map((member, index) => {
      const avatar = member.avatar
        ? `<img class="editorial-avatar" src="${escapeHtml(member.avatar)}" alt="${escapeHtml(member.name)}" loading="lazy">`
        : `<span class="editorial-avatar editorial-avatar-fallback"><i class="fa-solid fa-user"></i></span>`;

      const deleteButton = isAdmin()
        ? `<button type="button" class="editorial-delete-btn" data-editorial-delete="${escapeHtml(member.uid)}" title="Xóa thành viên" aria-label="Xóa ${escapeHtml(member.name)} khỏi Ban Biên Tập"><i class="fa-solid fa-xmark"></i></button>`
        : '';

      return `
        <article class="editorial-board-card">
          <div class="editorial-avatar-wrap">
            ${avatar}
            
          </div>
          <div class="editorial-member-info">
            <h4 class="editorial-member-name">${escapeHtml(member.name)}</h4>
            <p class="editorial-member-role">${escapeHtml(member.role || 'Thành viên')}</p>
          </div>
          ${deleteButton}
        </article>`;
    }).join('');
  }

  if (controls) {
    controls.classList.toggle('hidden', !isAdmin());
  }
}

async function loadApprovedMembers() {
  const options = $('editorial-member-options');
  if (!options) return;

  options.innerHTML = '<p class="footer-loading">Đang tải thành viên...</p>';

  try {
    const membersQuery = query(
      collection(db, MEMBERS_COLLECTION),
      where('status', '==', 'approved'),
      orderBy('displayName', 'asc'),
      limit(300)
    );

    const snapshot = await getDocs(membersQuery);

    approvedMembers = snapshot.docs.map((memberDoc) => ({
      uid: memberDoc.id,
      ...memberDoc.data()
    })).sort((a, b) =>
      getMemberName(a).localeCompare(getMemberName(b), 'vi')
    );

    renderMemberOptions();
  } catch (error) {
    console.error('Lỗi tải danh sách thành viên:', error);
    options.innerHTML =
      '<p class="footer-loading">Không tải được danh sách thành viên. Kiểm tra quyền admin và Firestore Rules.</p>';
  }
}

function renderMemberOptions() {
  const options = $('editorial-member-options');
  const search = $('editorial-member-search');

  if (!options) return;

  const keyword = (search?.value || '').trim().toLocaleLowerCase('vi');
  const existingUids = new Set(boardMembers.map((member) => member.uid));

  const candidates = approvedMembers.filter((member) =>
    !existingUids.has(member.uid) &&
    getMemberName(member).toLocaleLowerCase('vi').includes(keyword)
  );

  if (!candidates.length) {
    options.innerHTML = '<p class="footer-loading">Không có thành viên phù hợp.</p>';
    return;
  }

  options.innerHTML = candidates.map((member) => {
    const name = getMemberName(member);
    const avatar = getMemberAvatar(member);

    const avatarHtml = avatar
      ? `<img class="editorial-member-option-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy">`
      : `<span class="editorial-member-option-avatar editorial-avatar-fallback"><i class="fa-solid fa-user"></i></span>`;

    return `
      <button type="button"
        class="editorial-member-option ${selectedMemberUid === member.uid ? 'is-selected' : ''}"
        data-editorial-select="${escapeHtml(member.uid)}">
        ${avatarHtml}
        <span>${escapeHtml(name)}</span>
        <i class="fa-solid fa-circle-check"></i>
      </button>`;
  }).join('');
}

function showAddPanel(show) {
  const panel = $('editorial-form-panel');
  if (!panel) return;

  panel.classList.toggle('hidden', !show);

  if (show) {
    selectedMemberUid = '';
    const search = $('editorial-member-search');
    if (search) search.value = '';
    setStatus('');
    renderMemberOptions();
    search?.focus();
  }
}

async function addBoardMember() {
  if (!isAdmin() || isSaving) return;

  if (!selectedMemberUid) {
    setStatus('Vui lòng chọn một thành viên.', true);
    return;
  }

  if (boardMembers.some((member) => member.uid === selectedMemberUid)) {
    setStatus('Thành viên này đã có trong Ban Biên Tập.', true);
    return;
  }

  const member = approvedMembers.find((item) => item.uid === selectedMemberUid);

  if (!member || member.status !== 'approved') {
    setStatus('Không tìm thấy hồ sơ thành viên hợp lệ. Hãy tải lại danh sách.', true);
    return;
  }

  const roleInput = window.prompt(
    'Nhập chức danh/vai trò:',
    'Thành viên Ban Biên Tập'
  );

  if (roleInput === null) return;

  const role = normalizeRole(roleInput) || 'Thành viên Ban Biên Tập';
  isSaving = true;

  const saveButton = $('editorial-save-btn');
  if (saveButton) saveButton.disabled = true;

  try {
    const uid = selectedMemberUid;

    await setDoc(doc(db, BOARD_COLLECTION, uid), {
      uid,
      role,
      order: boardMembers.length + 1,
      addedAt: serverTimestamp()
    });

    setStatus('Đã thêm thành viên vào Ban Biên Tập.');
    showAddPanel(false);
    await loadBoardMembers();
  } catch (error) {
    console.error('Lỗi thêm thành viên Ban Biên Tập:', error);
    setStatus('Thêm chưa thành công. Kiểm tra quyền admin và Firestore Rules.', true);
  } finally {
    isSaving = false;
    if (saveButton) saveButton.disabled = false;
  }
}

async function removeBoardMember(uid) {
  if (!isAdmin() || !uid) return;

  const member = boardMembers.find((item) => item.uid === uid);
  if (!member) return;

  const confirmed = window.confirm(
    `Xóa "${member.name}" khỏi Ban Biên Tập?\n\nHồ sơ thành viên sẽ không bị xóa.`
  );

  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, BOARD_COLLECTION, uid));
    await loadBoardMembers();
  } catch (error) {
    console.error('Lỗi xóa thành viên Ban Biên Tập:', error);
    window.alert('Xóa chưa thành công. Vui lòng kiểm tra quyền admin và Firestore Rules.');
  }
}

function bindEvents() {
  $('editorial-add-btn')?.addEventListener('click', async () => {
    if (!isAdmin()) return;
    showAddPanel(true);
    await loadApprovedMembers();
  });

  $('editorial-cancel-btn')?.addEventListener('click', () => {
    showAddPanel(false);
  });

  $('editorial-member-search')?.addEventListener('input', renderMemberOptions);

  $('editorial-member-options')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-editorial-select]');
    if (!button) return;

    selectedMemberUid = button.dataset.editorialSelect || '';
    renderMemberOptions();
  });

  $('editorial-save-btn')?.addEventListener('click', addBoardMember);

  $('editorial-board-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-editorial-delete]');
    if (!button) return;

    removeBoardMember(button.dataset.editorialDelete);
  });

  $('footer-back-to-top')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}


export function initEditorialBoard() {
  if (initialized) return;
  initialized = true;

  bindEvents();

  // Cập nhật giao diện khi Firebase xác định người dùng và quyền admin.
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      boardMembers = [];
      renderBoardMembers();
      await loadBoardMembers();
      return;
    }

    try {
      await user.getIdTokenResult(true);

      // applyAuthUser trong auth.js chịu trách nhiệm cập nhật state.isAdmin.
      // Đợi một nhịp để auth.js hoàn tất xử lý trạng thái đăng nhập.
      setTimeout(() => {
        renderBoardMembers();
        loadBoardMembers();
      }, 0);
    } catch (error) {
      console.error('[Editorial] Không xác minh được trạng thái đăng nhập:', error);
      renderBoardMembers();
    }
  });

  // Vẫn tải danh sách công khai ngay khi khởi tạo.
  loadBoardMembers();
}

