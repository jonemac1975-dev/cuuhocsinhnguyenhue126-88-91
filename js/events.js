
import { state, escapeHtml } from './app-state.js';
import { db } from './firebase-config.js';
import {collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, runTransaction, serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
         

let eventsLoaded = false;
let loadingEvents = false;
let editingEventId = null;
let showPastEvents = false;
let showPastMiniEvents = false;

function canAccessEvents() {
  return state.authStatus === 'approved' || state.isAdmin;
}

function requireEventAccess() {
  if (canAccessEvents()) return true;
  alert(state.authStatus === 'pending'
    ? 'Tài khoản đang chờ Admin duyệt.'
    : state.authStatus === 'rejected'
      ? 'Tài khoản đã bị từ chối. Vui lòng liên hệ Admin.'
      : 'Bạn cần đăng nhập bằng tài khoản đã được duyệt.');
  return false;
}

function requireAdmin() {
  if (state.isAdmin) return true;
  alert('Chỉ Admin mới được tạo hoặc sửa sự kiện.');
  return false;
}


export async function loadEvents(force = false) {
  if (loadingEvents) return;
  if (eventsLoaded && !force) {
    renderEvents();
    return;
  }

  loadingEvents = true;
  const grid = document.getElementById('events-grid');
  if (grid) grid.innerHTML = '<p class="col-span-full text-center text-sm text-stone-500 p-6">Đang tải sự kiện...</p>';

  try {
    const snapshot = await getDocs(query(collection(db, 'events'), orderBy('createdAt', 'desc')));
    state.events = await Promise.all(snapshot.docs.map(async item => {
      const data = item.data();
      
      let attendeeDocs = [];
      if (canAccessEvents()) {
        const attendeeSnapshot = await getDocs(collection(db, 'events', item.id, 'attendees'));
        attendeeDocs = attendeeSnapshot.docs;
      }

      return {
        id: item.id,
        title: data.title || '',
        date: data.date || '',
        time: data.time || '',
        location: data.location || '',
        desc: data.desc || '',
        attendees: attendeeDocs.map(a => a.data().displayName || ''),
        attendeeUids: attendeeDocs.map(a => a.id)
      };
    }));
    eventsLoaded = true;
    renderEvents();
  } catch (error) {
    console.error('Lỗi tải sự kiện:', error);
    if (grid) grid.innerHTML = '<p class="col-span-full text-center text-sm text-red-600 p-6">Không tải được sự kiện. Bạn Vui lòng tải lại.</p>';
  } finally {
    loadingEvents = false;
  }
}


function getEventStatus(date) {
  if (!date) return 'upcoming';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(eventDate.getTime())) return 'upcoming';
  return eventDate < today ? 'past' : 'upcoming';
}



export function renderEvents() {
  const grid = document.getElementById('events-grid');
  const miniList = document.getElementById('mini-events-list');
  const createButton = document.getElementById('btn-create-event');

  if (createButton) {
    createButton.classList.toggle('hidden', !state.isAdmin);
    createButton.classList.toggle('flex', state.isAdmin);
  }

  
  if (!canAccessEvents() && grid) grid.innerHTML = '';

  
if (grid && canAccessEvents()) {
  const upcomingEvents = state.events
    .filter(ev => getEventStatus(ev.date) === 'upcoming')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const pastEvents = state.events
    .filter(ev => getEventStatus(ev.date) === 'past')
    .sort((a, b) => new Date(b.date) - new Date(a.date));

const renderEventCard = ev => `
<div data-event-id="${ev.id}" class="bg-white rounded-2xl p-5 border border-stone-200 shadow-sm flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between gap-2 mb-3">
          <span class="text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-lg">
            <i class="fa-regular fa-calendar-check mr-1"></i>${escapeHtml(ev.date)} (${escapeHtml(ev.time)})
          </span>
          <span class="text-xs text-stone-500 font-medium">${ev.attendees.length} Bạn tham gia</span>
        </div>
        <h3 class="font-bold text-base text-stone-800 mb-2">${escapeHtml(ev.title)}</h3>
        <p class="text-xs text-stone-600 mb-2"><i class="fa-solid fa-location-dot text-amber-600 mr-1"></i>${escapeHtml(ev.location)}</p>
        <p class="text-xs text-stone-500 leading-relaxed mb-4">${escapeHtml(ev.desc)}</p>
      </div>
      <div class="pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
        <div class="text-[11px] text-stone-500 truncate min-w-0">
          <b>Đã ĐK:</b> ${ev.attendees.map(escapeHtml).join(', ') || 'Chưa có'}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${state.isAdmin ? `<button onclick="editEvent('${ev.id}')" class="bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs px-3 py-1.5 rounded-lg font-semibold"><i class="fa-solid fa-pen mr-1"></i>Sửa</button>` : ''}
          ${state.isAdmin ? `<button onclick="deleteEvent('${ev.id}')" class="bg-red-100 hover:bg-red-200 text-red-700 text-xs px-3 py-1.5 rounded-lg font-semibold"><i class="fa-solid fa-trash mr-1"></i>Xóa</button>` : ''}
          ${getEventStatus(ev.date) === 'past'
            ? `<button disabled class="bg-stone-300 text-stone-500 text-xs px-3.5 py-1.5 rounded-xl font-medium cursor-not-allowed">Đã Qua Ngày</button>`
            : `<button onclick="toggleAttendEvent('${ev.id}')" class="bg-amber-600 hover:bg-amber-700 text-white text-xs px-3.5 py-1.5 rounded-xl font-medium">${ev.attendeeUids.includes(state.currentUser?.uid) ? 'Hủy Đăng Ký' : 'Tham Gia'}</button>`}
        </div>
      </div>
    </div>
  `;

  grid.innerHTML = `
    ${upcomingEvents.map(renderEventCard).join('')}
    ${pastEvents.length ? `
      <div class="col-span-full">
        <button
          onclick="togglePastEvents()"
          class="flex items-center gap-2 text-sm font-bold text-stone-700 hover:text-amber-700 py-2"
        >
          <i class="fa-solid ${showPastEvents ? 'fa-minus' : 'fa-plus'}"></i>
          Sự kiện đã qua (${pastEvents.length})
        </button>
      </div>
      ${showPastEvents ? pastEvents.map(renderEventCard).join('') : ''}
    ` : ''}
    ${!upcomingEvents.length && !pastEvents.length
      ? '<div class="col-span-full text-center text-sm text-stone-500 p-6">Chưa có sự kiện.</div>'
      : ''}
  `;
}
  
  

if (miniList) {
  const upcomingMiniEvents = [...state.events]
    .filter(ev => getEventStatus(ev.date) === 'upcoming')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const pastMiniEvents = [...state.events]
    .filter(ev => getEventStatus(ev.date) === 'past')
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  
const renderMiniEvent = (ev, past = false) => `
  <div
    role="button"
    tabindex="0"
    onclick="window.openMiniEvent('${ev.id}')"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.openMiniEvent('${ev.id}')}"
    title="Bấm để xem sự kiện"
    class="p-2.5 rounded-xl border cursor-pointer hover:shadow-sm hover:ring-2 hover:ring-amber-300 transition ${
      past
        ? 'bg-stone-100 border-stone-200 opacity-50'
        : 'bg-amber-50/60 border-amber-100/80 event-blink'
    }"
  >
    <h5 class="font-bold text-xs ${
      past ? 'text-stone-500' : 'text-stone-800'
    } truncate">${escapeHtml(ev.title)}</h5>
    <p class="text-[11px] ${
      past ? 'text-stone-400' : 'text-amber-800'
    } font-medium mt-0.5">
      <i class="fa-regular fa-clock mr-1"></i>${escapeHtml(ev.date)}
    </p>
  </div>
`;


  miniList.innerHTML = [
    upcomingMiniEvents.map(ev => renderMiniEvent(ev)).join(''),

    pastMiniEvents.length
      ? `
        <button
          type="button"
          onclick="togglePastMiniEvents()"
          class="w-full text-left text-xs font-semibold text-amber-700 hover:text-amber-900 py-2 px-1"
        >
          ${showPastMiniEvents ? '－' : '＋'}
          Sự kiện đã qua (${pastMiniEvents.length})
        </button>
        ${
          showPastMiniEvents
            ? pastMiniEvents.map(ev => renderMiniEvent(ev, true)).join('')
            : ''
        }
      `
      : ''
  ].join('');

  if (!upcomingMiniEvents.length && !pastMiniEvents.length) {
    miniList.innerHTML =
      '<p class="text-xs text-stone-400 text-center py-3">Chưa có sự kiện.</p>';
  } else if (!upcomingMiniEvents.length && !showPastMiniEvents) {
    miniList.innerHTML = `
      <p class="text-xs text-stone-400 text-center py-2">
        Chưa có sự kiện gì sắp tới.
      </p>
      ${
        pastMiniEvents.length
          ? `
            <button
              type="button"
              onclick="togglePastMiniEvents()"
              class="w-full text-left text-xs font-semibold text-amber-700 hover:text-amber-900 py-2 px-1"
            >
              ＋ Sự kiện đã qua (${pastMiniEvents.length})
            </button>
          `
          : ''
      }
    `;
  }
}

}

export function toggleEventModal(show) {
  if (show && !requireAdmin()) return;
  const modal = document.getElementById('event-modal');
  const form = document.getElementById('create-event-form');
  const heading = modal?.querySelector('h3');
  const submit = form?.querySelector('button[type="submit"]');

  if (show && !editingEventId) {
    form?.reset();
    if (heading) heading.textContent = 'Tạo Sự Kiện Họp Lớp / Gặp Mặt';
    if (submit) submit.textContent = 'Tạo Sự Kiện';
  }

  if (!show) editingEventId = null;
  if (modal) modal.classList.toggle('hidden', !show);
}

export function editEvent(eventId) {
  if (!requireAdmin()) return;
  const ev = state.events.find(item => item.id === eventId);
  if (!ev) return alert('Không tìm thấy sự kiện.');

  editingEventId = eventId;
  document.getElementById('event-title').value = ev.title;
  document.getElementById('event-date').value = ev.date;
  document.getElementById('event-time').value = ev.time;
  document.getElementById('event-location').value = ev.location;
  document.getElementById('event-desc').value = ev.desc;

  const modal = document.getElementById('event-modal');
  const heading = modal?.querySelector('h3');
  const submit = document.querySelector('#create-event-form button[type="submit"]');
  if (heading) heading.textContent = 'Chỉnh Sửa Sự Kiện';
  if (submit) submit.textContent = 'Lưu Thay Đổi';
  if (modal) modal.classList.remove('hidden');
}

export async function handleCreateEvent(e) {
  e.preventDefault();
  if (!requireAdmin()) return;

  const title = document.getElementById('event-title').value.trim();
  const date = document.getElementById('event-date').value;
  const time = document.getElementById('event-time').value;
  const location = document.getElementById('event-location').value.trim();
  const desc = document.getElementById('event-desc').value.trim();

  if (!title || !date || !time || !location) {
    alert('Vui lòng nhập đầy đủ tên, ngày, giờ và địa điểm sự kiện.');
    return;
  }

  const submit = document.querySelector('#create-event-form button[type="submit"]');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Đang lưu...';
  }

  try {
    if (editingEventId) {
      await updateDoc(doc(db, 'events', editingEventId), {
        title, date, time, location, desc, updatedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, 'events'), {
        title, date, time, location, desc, attendees: [], createdAt: serverTimestamp(),
        createdBy: state.currentUser?.uid || ''
      });
    }

    document.getElementById('create-event-form')?.reset();
    editingEventId = null;
    toggleEventModal(false);
    eventsLoaded = false;
    await loadEvents(true);
    alert('Đã lưu sự kiện thành công.');
  } catch (error) {
    console.error('Lỗi lưu sự kiện:', error);
    alert(`Không thể lưu sự kiện: ${error.message || 'Lỗi không xác định'}`);
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = editingEventId ? 'Lưu Thay Đổi' : 'Tạo Sự Kiện';
    }
  }
}


export async function deleteEvent(eventId) {
  if (!requireAdmin()) return;

  const ev = state.events.find(item => item.id === eventId);
  if (!ev) {
    alert('Không tìm thấy sự kiện.');
    return;
  }

  const confirmed = confirm(
    `Bạn có chắc muốn xóa sự kiện "${ev.title}" không?\n\n` +
    'Tất cả đăng ký tham gia của sự kiện này cũng sẽ bị xóa. ' +
    'Thao tác này không thể hoàn tác.'
  );

  if (!confirmed) return;

  try {
    const attendeesRef = collection(db, 'events', eventId, 'attendees');
    const attendeeSnapshot = await getDocs(attendeesRef);

    // Xóa các đăng ký tham gia trước.
    for (const attendee of attendeeSnapshot.docs) {
      await deleteDoc(attendee.ref);
    }

    // Chỉ xóa sự kiện sau khi xử lý xong danh sách đăng ký.
    await deleteDoc(doc(db, 'events', eventId));

    eventsLoaded = false;
    await loadEvents(true);

    alert('Đã xóa sự kiện thành công.');
  } catch (error) {
    console.error('Lỗi xóa sự kiện:', error);
    alert(
      `Không thể xóa sự kiện: ${error.message || 'Lỗi không xác định'}`
    );
  }
}


export async function toggleAttendEvent(eventId) {
  if (!requireEventAccess()) return;

  const user = state.currentUser;
  const name = user?.displayName;
  if (!user?.uid || !name) {
    alert('Không lấy được thông tin tài khoản. Bạn vui lòng đăng nhập lại.');
    return;
  }

  const eventRef = doc(db, 'events', eventId);
  const attendeeRef = doc(db, 'events', eventId, 'attendees', user.uid);

  try {
    await runTransaction(db, async transaction => {
      const eventSnapshot = await transaction.get(eventRef);
      if (!eventSnapshot.exists()) throw new Error('Sự kiện không còn tồn tại.');

      const attendeeSnapshot = await transaction.get(attendeeRef);
      if (attendeeSnapshot.exists()) {
        transaction.delete(attendeeRef);
      } else {
        transaction.set(attendeeRef, {
          uid: user.uid,
          displayName: name,
          joinedAt: serverTimestamp()
        });
      }
    });

    eventsLoaded = false;
    await loadEvents(true);
  } catch (error) {
    console.error('Lỗi đăng ký sự kiện:', error);
    alert(`Không thể cập nhật đăng ký: ${error.message || 'Lỗi không xác định'}`);
  }
}


export function togglePastEvents() {
  showPastEvents = !showPastEvents;
  renderEvents();
}


window.openMiniEvent = function (eventId) {
  console.log('Đã click sự kiện mini:', eventId);

  // Chuyển tab bằng hàm có sẵn trong main.js
  window.switchTab('events');

  // Chờ danh sách render xong rồi tìm sự kiện
  let attempts = 0;

  function findEventCard() {
    const card = document.querySelector(
      `#events-grid [data-event-id="${eventId}"]`
    );

    if (card) {
      card.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      card.classList.add('ring-2', 'ring-amber-400');

      setTimeout(() => {
        card.classList.remove('ring-2', 'ring-amber-400');
      }, 1800);

      return;
    }

    if (++attempts < 20) {
      setTimeout(findEventCard, 250);
    } else {
      console.warn('Không tìm thấy thẻ sự kiện:', eventId);
    }
  }

  setTimeout(findEventCard, 300);
};


window.togglePastEvents = togglePastEvents;
window.toggleEventModal = toggleEventModal;
window.handleCreateEvent = handleCreateEvent;
window.toggleAttendEvent = toggleAttendEvent;
window.editEvent = editEvent;
window.deleteEvent = deleteEvent;

function initMiniEvents() {
  if (!document.getElementById('mini-events-list')) return;
  loadEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMiniEvents, { once: true });
} else {
  initMiniEvents();
}

window.togglePastMiniEvents = function () {
  showPastMiniEvents = !showPastMiniEvents;
  renderEvents();
};