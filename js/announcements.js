
import { rtdb, auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { state } from './app-state.js';
import { ref, push, set, update, remove, onValue, serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

const announcementRef = ref(rtdb, 'thongbao');

let announcements = {};
let selectedId = null;
let unsubscribeAnnouncements = null;
let initialized = false;

let unsubscribeReadVersions = null;
let currentUid = null;
let readVersions = {};

const $ = id => document.getElementById(id);

function isAdmin() {
  return state.isAdmin === true;
}


function announcementVersion(item) {
  const version = Number(item?.updatedAt || item?.createdAt || 0);
  return Number.isFinite(version) ? version : 0;
}

async function markAnnouncementRead(id) {
  if (!currentUid || !id) return;

  const item = announcements[id];
  if (!item) return;

  const version = announcementVersion(item);
  if (!version) return;

  // Cập nhật giao diện ngay, không cần đợi Firebase.
  readVersions[id] = version;

  const badge = document.querySelector(
    `.announcement-toggle[data-id="${CSS.escape(id)}"] .announcement-new-badge`
  );

  badge?.remove();

  await set(
    ref(rtdb, `thongbaoRead/${currentUid}/${id}`),
    version
  );
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


function getEditorText(id) {
  return document.getElementById(id)?.innerText?.trim() || '';
}

function getEditorHtml(id) {
  const editor = document.getElementById(id);
  if (!editor) return '';

  return sanitizeAnnouncementHtml(editor.innerHTML);
}

function sanitizeAnnouncementHtml(html) {
  const parsed = new DOMParser().parseFromString(
    String(html || ''),
    'text/html'
  );

  const allowedTags = new Set([
    'P', 'DIV', 'BR', 'SPAN',
    'B', 'STRONG', 'I', 'EM', 'U', 'S',
    'SUB', 'SUP',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI',
    'BLOCKQUOTE', 'HR',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT',
    'TR', 'TD', 'TH',
    'FONT'
  ]);

  const allowedStyles = new Set([
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration',
    'text-align',
    'color',
    'background-color',
    'line-height',
    'vertical-align',
    'margin',
    'margin-left',
    'margin-right',
    'margin-top',
    'margin-bottom',
    'padding',
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-color',
    'border-width',
    'border-style',
    'border-collapse',
    'width',
    'height'
  ]);

  function cleanNode(node) {
    for (const child of [...node.children]) {
      if (!allowedTags.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'].includes(child.tagName)) {
          child.remove();
        } else {
          child.replaceWith(...child.childNodes);
        }
        continue;
      }

      for (const attr of [...child.attributes]) {
        if (attr.name === 'style') {
          const cleanStyles = [];

          for (const rule of attr.value.split(';')) {
            const colon = rule.indexOf(':');
            if (colon < 1) continue;

            const property = rule.slice(0, colon).trim().toLowerCase();
            const value = rule.slice(colon + 1).trim();

            if (
              allowedStyles.has(property) &&
              value &&
              !/url\s*\(|expression\s*\(|javascript:|[{}<>]/i.test(value)
            ) {
              cleanStyles.push(`${property}: ${value}`);
            }
          }

          if (cleanStyles.length) {
            child.setAttribute('style', cleanStyles.join('; '));
          } else {
            child.removeAttribute('style');
          }
        } else if (
          !['colspan', 'rowspan'].includes(attr.name.toLowerCase())
        ) {
          child.removeAttribute(attr.name);
        }
      }

      cleanNode(child);
    }
  }

  cleanNode(parsed.body);
  return parsed.body.innerHTML;
}

function setEditorHtml(id, html) {
  const editor = document.getElementById(id);
  if (editor) {
    editor.innerHTML = sanitizeAnnouncementHtml(html);
  }
}


function formatDate(value) {
  if (!value) return '';
  const parts = String(value).split('-');
  return parts.length === 3
    ? `${parts[2]}/${parts[1]}/${parts[0]}`
    : value;
}

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function showForm(item = null) {
  selectedId = item?.id || null;

  setEditorHtml(
  'announcement-title',
  item?.titleHtml || escapeHtml(item?.title || '')
);

setEditorHtml(
  'announcement-content',
  item?.contentHtml || escapeHtml(item?.content || '')
);
  $('announcement-date').value = item?.date || today();
  $('announcement-form-wrap').classList.remove('hidden');
  $('announcement-submit-btn').classList.toggle('hidden', !!item);
  $('announcement-edit-btn').classList.toggle('hidden', !item);
  $('announcement-delete-btn').classList.toggle('hidden', !item);
  $('announcement-edit-btn').textContent = item ? 'Lưu' : 'Lưu';

  $('announcement-form-wrap').scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });
}

function closeForm() {
  selectedId = null;
  $('announcement-form')?.reset();
setEditorHtml('announcement-title', '');
setEditorHtml('announcement-content', '');
  $('announcement-form-wrap')?.classList.add('hidden');
  $('announcement-submit-btn')?.classList.remove('hidden');
  $('announcement-edit-btn')?.classList.add('hidden');
  $('announcement-delete-btn')?.classList.add('hidden');
}


function collapseAnnouncementDetails() {
  document.querySelectorAll(
    '#announcement-list .announcement-content'
  ).forEach(content => {
    content.classList.add('hidden');
  });

  document.querySelectorAll(
    '#announcement-list .announcement-toggle'
  ).forEach(toggle => {
    toggle.setAttribute('aria-expanded', 'false');

    const icon = toggle.querySelector('i');
    if (icon) {
      icon.classList.add('fa-plus');
      icon.classList.remove('fa-minus');
    }
  });
}


function fixAnnouncementTitleAlignment(html) {
  const parsed = new DOMParser().parseFromString(
    String(html || ''),
    'text/html'
  );

  const paragraphs = [...parsed.body.querySelectorAll('p')];
  const titleIndexes = [];

  paragraphs.forEach((p, index) => {
    const text = (p.textContent || '').replace(/\u00a0/g, ' ').trim();

    if (
      text === 'CHÀO MỪNG' ||
      text === 'NGÀY NHÀ GIÁO VIỆT NAM 20/11'
    ) {
      titleIndexes.push(index);

      // Xóa các khoảng trắng đệm và chỉ căn giữa đoạn tiêu đề.
      p.querySelectorAll('span').forEach(span => {
        span.innerHTML = span.innerHTML.replace(
          /^(?:\s|&nbsp;|&#160;|&#xA0;)+/gi,
          ''
        );
      });

      p.style.textAlign = 'center';
    }
  });

  return parsed.body.innerHTML;
}


function renderAnnouncements() {
  const list = $('announcement-list');
  if (!list) return;

  const items = Object.entries(announcements)
    .map(([id, item]) => ({ id, ...item }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (!items.length) {
    list.innerHTML = `
      <p class="rounded-lg bg-white/95 p-3 text-sm font-semibold text-stone-700">
        Chưa có thông báo. ${
         isAdmin()
   //         ? 'Nhấn “+ Cập nhật” để đăng thông báo đầu tiên.'
   //         : 'Mời bạn quay lại xem tin mới nhé!'
        }
      </p>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const safeId = escapeHtml(item.id);
    const safeTitle = item.titleHtml
      ? sanitizeAnnouncementHtml(item.titleHtml)
      : escapeHtml(item.title || 'Thông báo');

    const safeContent = item.contentHtml
  ? fixAnnouncementTitleAlignment(
      sanitizeAnnouncementHtml(item.contentHtml)
    )
  : escapeHtml(item.content || '');

const isNew =
  currentUid &&
  announcementVersion(item) > Number(readVersions[item.id] || 0);

    return `
      <article class="rounded-xl border border-white/60 bg-white/95 p-3 text-stone-800 shadow-sm">
        <button type="button"
                class="announcement-toggle flex w-full items-start justify-between gap-3 text-left"
                data-id="${safeId}"
                aria-expanded="false">
          <span class="announcement-heading min-w-0 flex-1 leading-relaxed">
  ${safeTitle}
</span>

${isNew ? `
  <span class="announcement-new-badge mt-0.5 shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
    New
  </span>` : ''}

          <i class="fa-solid fa-plus mt-1 shrink-0 text-emerald-700"></i>
        </button>

        <div class="announcement-content mt-3 hidden border-t border-stone-200 pt-3"
             data-content-id="${safeId}">
          <p class="mb-3 text-xs font-bold text-stone-600">
            Ngày: ${escapeHtml(formatDate(item.date))}
          </p>

          <div class="announcement-rich-content min-w-0 overflow-x-auto break-words text-sm leading-relaxed">
            ${safeContent}
          </div>

          ${isAdmin() ? `
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button"
                      class="announcement-edit rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
                      data-id="${safeId}">Sửa</button>
              <button type="button"
                      class="announcement-delete rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white"
                      data-id="${safeId}">Xóa</button>
            </div>` : ''}
        </div>
      </article>`;
  }).join('');
}


export function refreshAnnouncementPermissions() {
  const button = $('announcement-update-btn');
  if (button) button.classList.toggle('hidden', !isAdmin());

  renderAnnouncements();

  if (!isAdmin()) closeForm();
}

async function createAnnouncement() {
  if (!isAdmin()) throw new Error('Bạn không có quyền đăng thông báo.');

  const title = getEditorText('announcement-title');
const date = $('announcement-date').value;
const content = getEditorText('announcement-content');

const titleHtml = getEditorHtml('announcement-title');
const contentHtml = getEditorHtml('announcement-content');

if (!title || !date || !content) {
  alert('Nhập đủ tiêu đề, ngày và nội dung.');
  return;
}

  const newRef = push(announcementRef);

  await set(newRef, {
  title,
  date,
  content,
  titleHtml,
  contentHtml,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});

  closeForm();
}


async function updateAnnouncement() {
  if (!isAdmin() || !selectedId) {
    throw new Error('Không tìm thấy thông báo cần sửa.');
  }

  const title = getEditorText('announcement-title');
  const date = $('announcement-date').value;
  const content = getEditorText('announcement-content');

  const titleHtml = getEditorHtml('announcement-title');
  const contentHtml = getEditorHtml('announcement-content');

  if (!title || !date || !content) {
    alert('Anh vui lòng nhập đủ tiêu đề, ngày và nội dung.');
    return;
  }

  await update(ref(rtdb, `thongbao/${selectedId}`), {
    title,
    date,
    content,
    titleHtml,
    contentHtml,
    updatedAt: serverTimestamp()
  });

  closeForm();
}


async function deleteAnnouncement(id = selectedId) {
  if (!isAdmin() || !id) {
    throw new Error('Bạn không có quyền xóa thông báo.');
  }

  if (!confirm('Bạn có chắc muốn xóa thông báo này không?')) return;
  await remove(ref(rtdb, `thongbao/${id}`));
  closeForm();
}

export function initAnnouncements() {
  if (initialized) {
    refreshAnnouncementPermissions();
    return;
  }

  initialized = true;

onAuthStateChanged(auth, user => {
  currentUid = user?.uid || null;

  if (unsubscribeReadVersions) {
    unsubscribeReadVersions();
    unsubscribeReadVersions = null;
  }

  readVersions = {};

  if (!currentUid) {
    renderAnnouncements();
    return;
  }

  unsubscribeReadVersions = onValue(
    ref(rtdb, `thongbaoRead/${currentUid}`),
    snapshot => {
      const nextVersions = snapshot.val() || {};
      const changed =
        JSON.stringify(nextVersions) !== JSON.stringify(readVersions);

      readVersions = nextVersions;

      if (changed) renderAnnouncements();
    },
    error => {
      console.error(
        'Không thể tải trạng thái đã xem thông báo:',
        error
      );
    }
  );
});

  $('announcement-update-btn')?.addEventListener('click', () => {
    if (!isAdmin()) return;
    closeForm();
    showForm();
  });

  $('announcement-cancel-btn')?.addEventListener('click', closeForm);

  $('announcement-form')?.addEventListener('submit', async event => {
    event.preventDefault();

    try {
      await createAnnouncement();
    } catch (error) {
      console.error('Không thể đăng thông báo:', error);
      alert('Đăng thông báo chưa thành công. Bạn kiểm tra quyền Firebase nhé.');
    }
  });

  $('announcement-edit-btn')?.addEventListener('click', async () => {
    try {
      await updateAnnouncement();
    } catch (error) {
      console.error('Không thể sửa thông báo:', error);
      alert('Sửa thông báo chưa thành công. Bạn kiểm tra lại.');
    }
  });

  $('announcement-delete-btn')?.addEventListener('click', async () => {
    try {
      await deleteAnnouncement();
    } catch (error) {
      console.error('Không thể xóa thông báo:', error);
      alert('Xóa thông báo chưa thành công. Bạn kiểm tra lại nhé.');
    }
  });

  $('announcement-list')?.addEventListener('click', async event => {
    const toggle = event.target.closest('.announcement-toggle');
    const edit = event.target.closest('.announcement-edit');
    const del = event.target.closest('.announcement-delete');

    if (toggle) {
      const id = toggle.dataset.id;
      const content = document.querySelector(
        `[data-content-id="${CSS.escape(id)}"]`
      );
      if (!content) return;

      const opening = content.classList.contains('hidden');
      content.classList.toggle('hidden', !opening);
      toggle.setAttribute('aria-expanded', String(opening));

      const icon = toggle.querySelector('i');
      if (icon) {
  icon.classList.toggle('fa-plus', !opening);
  icon.classList.toggle('fa-minus', opening);
}

if (opening) {
  markAnnouncementRead(id).catch(error => {
    console.error('Không thể đánh dấu đã xem thông báo:', error);
  });
}

return;
    }

    
if (edit && isAdmin()) {
  const item = announcements[edit.dataset.id];

  if (item) {
    collapseAnnouncementDetails();
    showForm({ id: edit.dataset.id, ...item });
  }

  return;
}


    if (del && isAdmin()) {
      try {
        await deleteAnnouncement(del.dataset.id);
      } catch (error) {
        console.error('Không thể xóa thông báo:', error);
        alert('Xóa thông báo chưa thành công. Bạn kiểm tra lại nhé.');
      }
    }
  });

  unsubscribeAnnouncements = onValue(announcementRef, snapshot => {
    announcements = snapshot.val() || {};
    renderAnnouncements();
    refreshAnnouncementPermissions();
  }, error => {
    console.error('Không thể tải thông báo:', error);
    const list = $('announcement-list');
    if (list) {
      list.innerHTML = `
        <p class="rounded-lg bg-white p-3 text-sm font-semibold text-red-800">
          Không tải được thông báo. Vui lòng kiểm tra kết nối và quyền Firebase.
        </p>`;
    }
  });

  refreshAnnouncementPermissions();
}
