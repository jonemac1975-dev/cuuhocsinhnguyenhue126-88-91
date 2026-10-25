

import { auth, db, rtdb } from './firebase-config.js';
import { state } from './app-state.js';
import { uploadToCloudinary } from './cloudinary.js';
import { ref, onValue} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { collection, getDocs} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';


const $ = id => document.getElementById(id);

const albumRef = ref(rtdb, 'kyuc');

let memoryPhotos = [];
let currentSheet = 0;
let mobilePage = 0;
let albumOpen = false;
let initialized = false;
let turnBusy = false;
let coverToken = 0;
let unsubscribeAlbum = null;

const MEMORY_ALBUM_API =
  'https://cuuhocsinh126-admin-api.thaythanhtoanly.workers.dev';

let editingPhotoId = null;
let editingTargetUid = null;
let adminMembersLoaded = false;

function canManageMemoryAlbum() {
  return Boolean(
    auth.currentUser &&
    (state.isAdmin === true || state.authStatus === 'approved')
  );
}


async function callMemoryAlbumApi(path, payload) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error('Bạn cần đăng nhập để thực hiện thao tác này.');
  }

  const token = await user.getIdToken();

  const response = await fetch(`${MEMORY_ALBUM_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();
  let result = {};

  try {
    result = rawText ? JSON.parse(rawText) : {};
  } catch {
    result = { message: rawText };
  }

  if (!response.ok) {
    console.error('Memory album API error:', {
      path,
      status: response.status,
      response: result
    });

    throw new Error(
      result.message ||
      result.error ||
      `Worker trả về HTTP ${response.status}.`
    );
  }

  if (result.success === false) {
    console.error('Memory album save failed:', result);
    throw new Error(
      result.message || result.error || 'Worker không lưu được ảnh.'
    );
  }

  return result;
}


function setMemoryAlbumStatus(message, isError = false) {
  const status = $('memory-album-form-status');
  if (!status) return;

  status.textContent = message;
  status.className = isError
    ? 'text-sm text-red-700'
    : 'text-sm text-emerald-700';
}

function selectedMemoryTargetUid() {
  if (!state.isAdmin) return auth.currentUser?.uid || '';

  return $('memory-album-member-select')?.value ||
    auth.currentUser?.uid ||
    '';
}

async function loadMemoryAlbumAdminMembers() {
  if (!state.isAdmin || adminMembersLoaded) return;

  const wrap = $('memory-album-admin-member-wrap');
  const select = $('memory-album-member-select');

  if (!wrap || !select) return;

  wrap.classList.remove('hidden');

  try {
    const snapshot = await getDocs(collection(db, 'members'));

    const members = snapshot.docs.map(memberDoc => {
      const member = memberDoc.data();

      return {
        uid: memberDoc.id,
        name: member.displayName || member.email || memberDoc.id
      };
    });

    select.replaceChildren();

    const ownOption = document.createElement('option');
    ownOption.value = auth.currentUser?.uid || '';
    ownOption.textContent = 'Ảnh của tôi';
    select.appendChild(ownOption);

    members
      .filter(member => member.uid !== auth.currentUser?.uid)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      .forEach(member => {
        const option = document.createElement('option');
        option.value = member.uid;
        option.textContent = member.name;
        select.appendChild(option);
      });

    adminMembersLoaded = true;
  } catch (error) {
    console.error('Không tải được danh sách thành viên:', error);
    setMemoryAlbumStatus(
      'Không tải được danh sách thành viên. Bạn thử mở lại biểu mẫu nhé.',
      true
    );
  }
}

function renderMemoryAlbumManageList() {
  const list = $('memory-album-manage-list');
  if (!list) return;

  if (!canManageMemoryAlbum()) {
    list.textContent = 'Đăng nhập bằng tài khoản thành viên đã được duyệt để quản lý ảnh.';
    return;
  }

  const targetUid = selectedMemoryTargetUid();

  const photos = memoryPhotos.filter(photo =>
    photo.uid === targetUid &&
    (state.isAdmin || photo.uid === auth.currentUser?.uid)
  );

  if (!photos.length) {
    list.textContent = 'Chưa có ảnh nào.Bạn thêm ảnh mới ở phía trên.';
    return;
  }

  list.replaceChildren();

  photos.forEach(photo => {
    const card = document.createElement('div');
    card.className =
         'flex flex-row items-start gap-3 rounded-xl border border-amber-200 bg-white p-3';

    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = 'Ảnh kỷ niệm';
    img.loading = 'lazy';
    img.className =
   'h-24 w-[40%] shrink-0 rounded-lg object-cover sm:h-24 sm:w-[108px]';
    const details = document.createElement('div');
    details.className = 'min-w-0 flex-1';

    const note = document.createElement('p');
    note.className = 'whitespace-pre-wrap break-words text-sm text-stone-700';
    note.textContent = photo.note || 'Chưa có lời nhắn.';

    const owner = document.createElement('p');
    owner.className = 'mt-1 text-xs text-stone-500';
    owner.textContent = photo.memberName || 'Cựu học sinh 12/6';

    const actions = document.createElement('div');
    actions.className = 'mt-2 flex flex-wrap gap-1.5';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.dataset.action = 'edit';
    editButton.dataset.photoId = photo.id;
    editButton.dataset.uid = photo.uid;
    editButton.className =
  'rounded-md bg-amber-100 px-2 py-1.5 text-[11px] font-bold text-amber-900 hover:bg-amber-200';
    editButton.textContent = 'Sửa lời nhắn';

    const replaceButton = document.createElement('button');
    replaceButton.type = 'button';
    replaceButton.dataset.action = 'replace';
    replaceButton.dataset.photoId = photo.id;
    replaceButton.dataset.uid = photo.uid;
    replaceButton.className =
  'rounded-md bg-sky-100 px-2 py-1.5 text-[11px] font-bold text-sky-900 hover:bg-sky-200';
    replaceButton.textContent = 'Thay ảnh';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.dataset.action = 'delete';
    deleteButton.dataset.photoId = photo.id;
    deleteButton.dataset.uid = photo.uid;
    deleteButton.className =
  'rounded-md bg-red-100 px-2 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-200';
    deleteButton.textContent = 'Xóa ảnh';

    actions.append(editButton, replaceButton, deleteButton);
    details.append(note, owner, actions);
    card.append(img, details);
    list.appendChild(card);
  });
}

function resetMemoryAlbumForm() {
  editingPhotoId = null;
  editingTargetUid = null;

  $('memory-album-form')?.reset();

  const input = $('memory-album-photo-input');
  if (input) input.required = true;

  const saveButton = $('memory-album-save-btn');
  if (saveButton) {
    saveButton.innerHTML =
      '<i class="fa-solid fa-cloud-arrow-up mr-1"></i>Lưu ảnh';
  }

  $('memory-album-cancel-edit-btn')?.classList.add('hidden');

  const memberSelect = $('memory-album-member-select');
  if (memberSelect) memberSelect.disabled = false;

  setMemoryAlbumStatus('');
}

function startEditingMemoryPhoto(photo, replaceImage = false) {
  editingPhotoId = photo.id;
  editingTargetUid = photo.uid;

  const memberSelect = $('memory-album-member-select');

  if (memberSelect && state.isAdmin) {
    memberSelect.value = photo.uid;
    memberSelect.disabled = true;
  }

  $('memory-album-note-input').value = photo.note || '';

  const input = $('memory-album-photo-input');
  input.value = '';
  input.required = replaceImage;

  $('memory-album-save-btn').innerHTML = replaceImage
    ? '<i class="fa-solid fa-arrows-rotate mr-1"></i>Thay ảnh'
    : '<i class="fa-solid fa-floppy-disk mr-1"></i>Lưu lời nhắn';

  $('memory-album-cancel-edit-btn')?.classList.remove('hidden');

  setMemoryAlbumStatus(
    replaceImage
      ? 'Chọn ảnh mới rồi bấm Thay ảnh. Nếu không chọn ảnh, hãy hủy thao tác này.'
      : 'Đang sửa lời nhắn. Để nguyên ô chọn ảnh trống rồi bấm Lưu lời nhắn.'
  );

  $('memory-album-form-panel')?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  if (replaceImage) input.focus();
}


async function handleMemoryAlbumSubmit(event) {
  event.preventDefault();

  if (!canManageMemoryAlbum()) {
    setMemoryAlbumStatus(
      'Tài khoản chưa được duyệt hoặc chưa đăng nhập.',
      true
    );
    return;
  }

  const saveButton = $('memory-album-save-btn');
  const input = $('memory-album-photo-input');
  const note = $('memory-album-note-input').value.trim();
  const file = input.files?.[0] || null;

  const targetUid = editingTargetUid ||
    selectedMemoryTargetUid();

  const oldPhoto = editingPhotoId
    ? memoryPhotos.find(photo =>
        photo.id === editingPhotoId &&
        photo.uid === targetUid
      )
    : null;

  if (editingPhotoId && !oldPhoto) {
    setMemoryAlbumStatus('Không tìm thấy ảnh cần cập nhật.', true);
    return;
  }

  if (!targetUid) {
    setMemoryAlbumStatus('Không xác định được thành viên.', true);
    return;
  }

  if (!editingPhotoId && !file) {
    setMemoryAlbumStatus('Chọn một ảnh trước khi lưu.', true);
    return;
  }

  if (note.length > 500) {
    setMemoryAlbumStatus('Lời nhắn không được vượt quá 500 ký tự.', true);
    return;
  }

  if (file && !file.type.startsWith('image/')) {
    setMemoryAlbumStatus('Vui lòng chọn tệp hình ảnh.', true);
    return;
  }

  saveButton.disabled = true;
  setMemoryAlbumStatus('Đang xử lý ảnh, Bạn chờ một chút nhé...');

  try {
    let uploaded = null;
    
if (file) {
  uploaded = await uploadToCloudinary(file, 'album');
}

    const payload = {
      uid: targetUid,
      note,
      url: uploaded?.url || oldPhoto?.url,
      publicId: uploaded?.publicId || oldPhoto?.publicId
    };

    // Sửa lời nhắn: giữ nguyên ảnh và ID hiện tại.
    // Thay ảnh: tạo bản ghi ảnh mới trước, sau đó mới xóa ảnh cũ.
    if (editingPhotoId && !file) {
      payload.photoId = editingPhotoId;
    }

    const result = await callMemoryAlbumApi(
      '/memory-album/save',
      payload
    );

    if (editingPhotoId && file && oldPhoto) {
      try {
        await callMemoryAlbumApi('/memory-album/delete', {
          uid: oldPhoto.uid,
          photoId: oldPhoto.id
        });

        setMemoryAlbumStatus(
          'Đã thay ảnh mới và xóa ảnh cũ thành công.'
        );
      } catch (deleteError) {
        console.error('Ảnh mới đã lưu nhưng ảnh cũ chưa xóa:', deleteError);

        setMemoryAlbumStatus(
          'Ảnh mới đã lưu, nhưng chưa xóa được ảnh cũ. Bạn kiểm tra lại danh sách ảnh nhé.',
          true
        );
      }
    } else {
      setMemoryAlbumStatus(result.message || 'Đã lưu ảnh thành công.');
    }

    resetMemoryAlbumForm();
  } catch (error) {
    console.error('Memory album save error:', error);

    setMemoryAlbumStatus(
      error.message || 'Không lưu được ảnh. Bạn thử lại nhé.',
      true
    );
  } finally {
    saveButton.disabled = false;
  }
}

async function handleMemoryAlbumManageClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  if (!canManageMemoryAlbum()) {
    setMemoryAlbumStatus('Bạn cần đăng nhập bằng tài khoản được duyệt.', true);
    return;
  }

  const photo = memoryPhotos.find(item =>
    item.id === button.dataset.photoId &&
    item.uid === button.dataset.uid
  );

  if (!photo) {
    setMemoryAlbumStatus('Không tìm thấy ảnh cần thao tác.', true);
    return;
  }

  // Thành viên chỉ được thao tác với ảnh của chính mình.
  if (!state.isAdmin && photo.uid !== auth.currentUser?.uid) {
    setMemoryAlbumStatus('Bạn không có quyền thao tác ảnh này.', true);
    return;
  }

  if (button.dataset.action === 'edit') {
    startEditingMemoryPhoto(photo, false);
    return;
  }

  if (button.dataset.action === 'replace') {
    startEditingMemoryPhoto(photo, true);
    return;
  }

  if (button.dataset.action === 'delete') {
    if (!confirm('Bạn có chắc muốn xóa ảnh kỷ niệm này không?')) {
      return;
    }

    button.disabled = true;

    try {
      await callMemoryAlbumApi('/memory-album/delete', {
        uid: photo.uid,
        photoId: photo.id
      });

      setMemoryAlbumStatus('Đã xóa ảnh kỷ niệm thành công.');
    } catch (error) {
      console.error('Memory album delete error:', error);

      setMemoryAlbumStatus(
        error.message || 'Không xóa được ảnh. Bạn thử lại nhé.',
        true
      );
    } finally {
      button.disabled = false;
    }
  }
}

function openMemoryAlbumForm() {
  if (!canManageMemoryAlbum()) {
    alert('Bạn cần đăng nhập bằng tài khoản thành viên đã được duyệt để quản lý ảnh.');
    return;
  }

  resetMemoryAlbumForm();

  const panel = $('memory-album-form-panel');
  panel?.classList.remove('hidden');

  loadMemoryAlbumAdminMembers().then(() => {
    renderMemoryAlbumManageList();
  });

  renderMemoryAlbumManageList();

  panel?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}


function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function isMobileBook() {
  return window.matchMedia('(max-width: 600px)').matches;
}

function createEmptyPage() {
  const page = document.createElement('div');
  page.className = 'memory-book-page';

  const content = document.createElement('div');
  content.className = 'memory-book-page-content';

  const empty = document.createElement('div');
  empty.className = 'memory-book-empty';
  empty.textContent =
    'Các bạn hãy sưu tập những bức ảnh quý giá của một thời học sinh đưa vào Album của lớp mình, để lưu lại những kỷ niệm khó quên';

  content.appendChild(empty);
  page.appendChild(content);

  return page;
}

function createPhotoPage(photo, index, total) {
  if (!photo) return createEmptyPage();

  const page = document.createElement('div');
  page.className = 'memory-book-page';

  const content = document.createElement('div');
  content.className = 'memory-book-page-content';

  const img = document.createElement('img');
  img.className = 'memory-book-photo';
  img.src = photo.url;
  img.alt = `Ảnh kỷ niệm trang ${index + 1}`;
  img.loading = 'eager';
  img.decoding = 'async';

  const note = document.createElement('div');
  note.className = 'memory-book-note';
  note.textContent =
    photo.note || 'Một khoảnh khắc đáng nhớ của lớp mình.';

  content.append(img, note);

  const footer = document.createElement('div');
  footer.className = 'memory-book-page-footer';

  const member = document.createElement('span');
  member.textContent = photo.memberName || 'Cựu học sinh 12/6';

  const pageNumber = document.createElement('span');
  pageNumber.textContent = `${index + 1}/${total}`;

  footer.append(member, pageNumber);
  page.append(content, footer);

  return page;
}

function createSheet(frontPhoto, frontIndex, backPhoto, backIndex) {
  const sheet = document.createElement('div');
  sheet.className = 'memory-book-sheet';

  const front = createPhotoPage(
    frontPhoto,
    frontIndex,
    memoryPhotos.length
  );
  front.classList.add('memory-book-page-front');

  const back = createPhotoPage(
    backPhoto,
    backIndex,
    memoryPhotos.length
  );
  back.classList.add('memory-book-page-back');

  sheet.append(front, back);

  return sheet;
}

function updatePageControls() {
  const prevBtn = $('memory-album-prev-btn');
  const nextBtn = $('memory-album-next-btn');
  const pageNumber = $('memory-album-page-number');
  const container = $('memory-book-container');

  if (!prevBtn || !nextBtn || !pageNumber || !container) return;

  const total = memoryPhotos.length;

  if (total === 0) {
    pageNumber.textContent = 'Trang 0 / 0';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  if (isMobileBook()) {
    pageNumber.textContent = `Trang ${mobilePage + 1} / ${total}`;
    prevBtn.disabled = mobilePage <= 0;
    nextBtn.disabled = mobilePage >= total - 1;
    return;
  }

  const firstVisible = currentSheet === 0
    ? 1
    : Math.min(currentSheet * 2, total);

  const lastVisible = Math.min(
    total,
    currentSheet * 2 + 1
  );

  pageNumber.textContent = firstVisible === lastVisible
    ? `Trang ${firstVisible} / ${total}`
    : `Trang ${firstVisible}–${lastVisible} / ${total}`;

  prevBtn.disabled = currentSheet <= 0;
  nextBtn.disabled = currentSheet >= Math.ceil(total / 2);
}

function updateSheetLayers() {
  const container = $('memory-book-container');
  if (!container) return;

  const sheets = [
    ...container.querySelectorAll('.memory-book-sheet')
  ];

  const total = sheets.length;

  sheets.forEach((sheet, index) => {
    if (index < currentSheet) {
      // Các tờ đã lật nằm dưới những tờ chưa lật.
      sheet.style.zIndex = String(index + 1);
    } else {
      sheet.style.zIndex = String(total - index + currentSheet);
    }
  });
}

function renderDesktopBook() {
  const container = $('memory-book-container');
  if (!container) return;

  container.classList.remove('memory-book-mobile');
  container.replaceChildren();

  const total = memoryPhotos.length;

  if (total === 0) {
    const sheet = document.createElement('div');
    sheet.className = 'memory-book-sheet';
    sheet.append(
      createEmptyPage(),
      createEmptyPage()
    );

    sheet.children[0].classList.add('memory-book-page-front');
    sheet.children[1].classList.add('memory-book-page-back');

    container.appendChild(sheet);
    sheet.style.zIndex = '1';

    updatePageControls();
    return;
  }

  const sheetCount = Math.ceil(total / 2);

  currentSheet = Math.max(
    0,
    Math.min(currentSheet, sheetCount)
  );

  for (let i = 0; i < sheetCount; i++) {
    const frontIndex = i * 2;
    const backIndex = frontIndex + 1;

    const sheet = createSheet(
      memoryPhotos[frontIndex],
      frontIndex,
      memoryPhotos[backIndex],
      backIndex
    );

    if (i < currentSheet) {
      sheet.classList.add('flipped');
    }

    container.appendChild(sheet);
  }

  updateSheetLayers();
  updatePageControls();
}

function renderMobileBook() {
  const container = $('memory-book-container');
  if (!container) return;

  container.classList.add('memory-book-mobile');
  container.replaceChildren();

  const total = memoryPhotos.length;

  if (total === 0) {
    const sheet = document.createElement('div');
    sheet.className = 'memory-book-sheet';

    const front = createEmptyPage();
    front.classList.add('memory-book-page-front');

    const back = createEmptyPage();
    back.classList.add('memory-book-page-back');

    sheet.append(front, back);
    container.appendChild(sheet);

    updatePageControls();
    return;
  }

  mobilePage = Math.max(
    0,
    Math.min(mobilePage, total - 1)
  );

  // Trên điện thoại, mỗi lần chỉ hiển thị một trang.
  const sheet = createSheet(
    memoryPhotos[mobilePage],
    mobilePage,
    memoryPhotos[mobilePage + 1],
    mobilePage + 1
  );

  container.appendChild(sheet);
  sheet.style.zIndex = '1';

  updatePageControls();
}

function renderAlbumPage() {
  if (isMobileBook()) {
    renderMobileBook();
  } else {
    renderDesktopBook();
  }
}

function renderAlbumSummary() {
  const summary = $('memory-album-summary');
  if (!summary) return;

  const total = memoryPhotos.length;

  summary.textContent = total
    ? `Album hiện có ${total} ảnh kỷ niệm của các thành viên lớp mình.`
    : 'Nơi lưu giữ những bức ảnh và lời nhắn của tất cả thành viên lớp mình.';
}

function finishCoverOpening(token) {
  if (token !== coverToken || !albumOpen) return;

  const cover = $('memory-book-cover');
  const openView = $('memory-book-open-view');
  const controls = $('memory-book-controls');

  if (!cover || !openView || !controls) return;

  cover.classList.remove('memory-book-opening', 'hidden');
  cover.style.display = 'none';

  openView.style.display = '';
  controls.style.display = '';

  renderAlbumPage();
}


function openAlbum() {
  const book = $('memory-album-book');
  const cover = $('memory-book-cover');
  const openView = $('memory-book-open-view');
  const controls = $('memory-book-controls');

  if (!book || !cover || !openView || !controls) return;

  albumOpen = true;
  turnBusy = false;
  currentSheet = 0;
  mobilePage = 0;

  book.classList.remove('hidden');
$('memory-album-intro')?.classList.add('hidden');


  // Ẩn bìa, mở thẳng vào các trang bên trong.
  cover.classList.remove('memory-book-opening');
  cover.classList.add('hidden');
  cover.style.display = 'none';
  cover.onanimationend = null;

  openView.style.display = '';
  controls.style.display = '';

  coverToken++;

  renderAlbumPage();

  book.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}


function closeAlbum() {
  albumOpen = false;
  turnBusy = false;
  coverToken++;

  const book = $('memory-album-book');
  const cover = $('memory-book-cover');
  const openView = $('memory-book-open-view');
  const controls = $('memory-book-controls');

  book?.classList.add('hidden');

  if (cover) {
    cover.classList.remove('memory-book-opening');
    cover.classList.add('hidden');
    cover.style.display = '';
    cover.onanimationend = null;
  }

  if (openView) openView.style.display = '';
  if (controls) controls.style.display = '';
  showMemoryAlbumIntro();
}

function turnDesktopBook(direction) {
  if (turnBusy || !albumOpen || isMobileBook()) return;

  const container = $('memory-book-container');
  if (!container) return;

  const sheetCount = Math.ceil(memoryPhotos.length / 2);
  if (sheetCount === 0) return;

  if (direction === 'next') {
    if (currentSheet >= sheetCount) return;

    const sheets = container.querySelectorAll('.memory-book-sheet');
    const sheet = sheets[currentSheet];

    if (!sheet) return;

    turnBusy = true;
    sheet.classList.add('flipped');
    currentSheet++;
  } else {
    if (currentSheet <= 0) return;

    currentSheet--;

    const sheets = container.querySelectorAll('.memory-book-sheet');
    const sheet = sheets[currentSheet];

    if (!sheet) return;

    turnBusy = true;
    sheet.classList.remove('flipped');
  }

  updateSheetLayers();
  updatePageControls();

  // Khóa nút trong lúc trang đang lật.
  window.setTimeout(() => {
    turnBusy = false;
  }, 900);
}

function turnMobileBook(direction) {
  if (turnBusy || !albumOpen || !isMobileBook()) return;

  const targetPage = mobilePage + (direction === 'next' ? 1 : -1);

  if (targetPage < 0 || targetPage >= memoryPhotos.length) return;

  const container = $('memory-book-container');
  const sheet = container?.querySelector('.memory-book-sheet');

  if (!sheet) return;

  turnBusy = true;

  // Mặt sau của tờ giấy là trang sẽ chuyển tới.
  const backPage = sheet.querySelector('.memory-book-page-back');

  if (backPage) {
    backPage.replaceWith(
      createPhotoPage(
        memoryPhotos[targetPage],
        targetPage,
        memoryPhotos.length
      )
    );

    const newBackPage = sheet.lastElementChild;
    newBackPage.classList.add('memory-book-page-back');
  }

  sheet.classList.add('flipped');

  window.setTimeout(() => {
    mobilePage = targetPage;
    turnBusy = false;
    renderMobileBook();
  }, 900);
}

function turnBook(direction) {
  if (isMobileBook()) {
    turnMobileBook(direction);
  } else {
    turnDesktopBook(direction);
  }
}

function startAlbumListener() {
  if (unsubscribeAlbum) return;

  unsubscribeAlbum = onValue(
    albumRef,
    snapshot => {
      const data = snapshot.val() || {};
      const photos = [];

      Object.entries(data).forEach(([uid, memberPhotos]) => {
        if (!memberPhotos || typeof memberPhotos !== 'object') return;

        Object.entries(memberPhotos).forEach(([id, photo]) => {
          if (!photo || typeof photo.url !== 'string' || !photo.url) {
            return;
          }

          let parsedUrl;

          try {
            parsedUrl = new URL(photo.url);
          } catch {
            return;
          }

          // Chỉ hiển thị ảnh HTTPS được lưu trên Cloudinary.
          if (
            parsedUrl.protocol !== 'https:' ||
            parsedUrl.hostname !== 'res.cloudinary.com'
          ) {
            return;
          }

          photos.push({
            id,
            uid,
            url: parsedUrl.href,
	    publicId: typeof photo.publicId === 'string'
		? photo.publicId
		: '',
            note: typeof photo.note === 'string' ? photo.note : '',
            memberName: typeof photo.memberName === 'string'
              ? photo.memberName
              : 'Cựu học sinh 12/6',
            createdAt: Number(photo.createdAt) || 0,
            updatedAt: Number(photo.updatedAt) || 0
          });
        });
      });

      // Ảnh cũ trước, ảnh mới sau.
      photos.sort((a, b) =>
        (a.createdAt - b.createdAt) ||
        a.id.localeCompare(b.id)
      );

      memoryPhotos = photos;

      currentSheet = Math.min(
        currentSheet,
        Math.ceil(memoryPhotos.length / 2)
      );

      mobilePage = Math.min(
        mobilePage,
        Math.max(0, memoryPhotos.length - 1)
      );

      	renderAlbumSummary();
	renderMemoryAlbumManageList();

      if (albumOpen && $('memory-book-open-view')?.style.display !== 'none') {
        renderAlbumPage();
      }
    },
    error => {
      console.error('Không tải được album ảnh ký ức:', error);

      const summary = $('memory-album-summary');

      if (summary) {
        summary.textContent =
          'Chưa tải được dữ liệu album. Vui lòng kiểm tra kết nối và quyền RTDB.';
      }
    }
  );
}

export function initMemoryAlbum() {
  if (initialized) return;
  initialized = true;

  $('memory-album-open-btn')?.addEventListener('click', openAlbum);
  $('memory-album-close-btn')?.addEventListener('click', closeAlbum);
  $('memory-album-update-btn')
  ?.addEventListener('click', () => {
    closeAlbum();
    $('memory-album-intro')?.classList.add('hidden');
    openMemoryAlbumForm();
  });

$('memory-album-form-close-btn')
  ?.addEventListener('click', () => {
    $('memory-album-form-panel')?.classList.add('hidden');
    $('memory-album-intro')?.classList.remove('hidden');
  });

$('memory-album-form')
  ?.addEventListener('submit', handleMemoryAlbumSubmit);

$('memory-album-manage-list')
  ?.addEventListener('click', handleMemoryAlbumManageClick);

$('memory-album-cancel-edit-btn')
  ?.addEventListener('click', resetMemoryAlbumForm);

$('memory-album-member-select')
  ?.addEventListener('change', renderMemoryAlbumManageList);
  $('memory-album-prev-btn')?.addEventListener('click', () => {
    turnBook('prev');
  });

  $('memory-album-next-btn')?.addEventListener('click', () => {
    turnBook('next');
  });

  // Khi đổi kích thước màn hình, dựng lại chế độ sách tương ứng.
  window.addEventListener('resize', () => {
    if (albumOpen && $('memory-book-open-view')?.style.display !== 'none') {
      renderAlbumPage();
    }
  });

  renderAlbumSummary();
  renderAlbumPage();
  startAlbumListener();
}

initMemoryAlbum();



function hideMemoryAlbumIntro() {
  $('memory-album-intro')?.classList.add('hidden');
}

function showMemoryAlbumIntro() {
  $('memory-album-intro')?.classList.remove('hidden');
}