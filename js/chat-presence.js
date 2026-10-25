
import { state, escapeHtml } from './app-state.js';
import { auth, db, rtdb } from './firebase-config.js';
import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onDisconnect, onValue, ref, serverTimestamp, set } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

let stopConnectedListener = null;
let stopMembersListener = null;
let stopStatusListeners = [];
let presenceUid = null;
let onlineStates = {};
let approvedMembers = [];

function renderChatMembers() {
  const container = document.getElementById('chat-member-list');
  const count = document.getElementById('chat-member-count');
  if (!container) return;

  const members = [...approvedMembers].sort((a, b) => {
    const onlineDiff = Number(onlineStates[b.uid] === true) - Number(onlineStates[a.uid] === true);
    return onlineDiff || a.name.localeCompare(b.name, 'vi');
  });

  const onlineCount = members.filter(member => onlineStates[member.uid] === true).length;
  if (count) count.textContent = `${members.length} thành viên · ${onlineCount} đang online`;

  if (!members.length) {
    container.innerHTML = '<p class="text-xs text-stone-400 p-3">Chưa có thành viên được duyệt.</p>';
    return;
  }

  container.innerHTML = members.map(member => {
    const avatar = typeof member.avatar === 'string' && member.avatar.startsWith('https://')
      ? member.avatar
      : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(member.uid)}`;
    const online = onlineStates[member.uid] === true;

    return `
      <div class="flex items-center gap-3 p-2 rounded-xl hover:bg-amber-50">
        <div class="relative shrink-0">
          <img src="${escapeHtml(avatar)}" alt="" class="w-10 h-10 rounded-full object-cover bg-stone-100">
          <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${online ? 'bg-green-500' : 'bg-stone-300'}"></span>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-stone-800 truncate">${escapeHtml(member.name)}</p>
          <p class="text-xs ${online ? 'text-green-600' : 'text-stone-400'}">${online ? 'Đang online' : 'Offline'}</p>
        </div>
      </div>
    `;
  }).join('');
}

function clearStatusListeners() {
  stopStatusListeners.forEach(stop => stop());
  stopStatusListeners = [];
  onlineStates = {};
}

function watchMemberStatuses() {
  clearStatusListeners();

  approvedMembers.forEach(member => {
    const statusRef = ref(rtdb, `status/${member.uid}`);
    const stop = onValue(statusRef, snapshot => {
      onlineStates[member.uid] = snapshot.val()?.state === 'online';
      renderChatMembers();
    }, error => {
      console.error('Không thể đọc trạng thái online:', error);
      onlineStates[member.uid] = false;
      renderChatMembers();
    });

    stopStatusListeners.push(stop);
  });

  renderChatMembers();
}

export function startChatPresence() {
  const user = auth.currentUser;
  if (!user || !(state.authStatus === 'approved' || state.isAdmin === true)) return;
  if (presenceUid === user.uid) return;

  stopChatPresence();
  presenceUid = user.uid;

  const connectedRef = ref(rtdb, '.info/connected');
  const myStatusRef = ref(rtdb, `status/${user.uid}`);

  stopConnectedListener = onValue(connectedRef, async snapshot => {
    if (snapshot.val() !== true || presenceUid !== user.uid) return;

    try {
      await onDisconnect(myStatusRef).set({
        state: 'offline',
        last_changed: serverTimestamp()
      });

      if (presenceUid !== user.uid) return;

      await set(myStatusRef, {
        state: 'online',
        last_changed: serverTimestamp()
      });
    } catch (error) {
      console.error('Không thể cập nhật trạng thái online:', error);
    }
  });

  const membersQuery = query(
    collection(db, 'members'),
    where('status', '==', 'approved')
  );

  stopMembersListener = onSnapshot(membersQuery, snapshot => {
    approvedMembers = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        name: data.displayName || 'Bạn học',
        avatar: data.photoURL || ''
      };
    });

    watchMemberStatuses();
  }, error => {
    console.error('Không thể tải danh sách thành viên chat:', error);
    const container = document.getElementById('chat-member-list');
    if (container) {
      container.innerHTML = '<p class="text-sm text-red-500 p-3">Không tải được danh sách. Hãy kiểm tra quyền Firestore.</p>';
    }
  });
}


export async function stopChatPresence() {
  if (stopConnectedListener) stopConnectedListener();
  if (stopMembersListener) stopMembersListener();

  stopConnectedListener = null;
  stopMembersListener = null;

  clearStatusListeners();
  approvedMembers = [];

  const oldUid = presenceUid;
  presenceUid = null;

  if (oldUid) {
    try {
      await set(ref(rtdb, `status/${oldUid}`), {
        state: 'offline',
        last_changed: serverTimestamp()
      });
    } catch (error) {
      console.error('Không thể cập nhật offline:', error);
    }
  }

  renderChatMembers();
}
