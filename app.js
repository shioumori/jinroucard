'use strict';

const ROLES = [
  { id: 'villager', name: '村人', team: '村人陣営', color: '#a7b4c5', desc: '特殊能力はありません。会議で人狼を探します。' },
  { id: 'wolf', name: '人狼', team: '人狼陣営', color: '#ef8585', desc: '正体を隠し、投票を生き延びましょう。' },
  { id: 'bigwolf', name: '大狼', team: '人狼陣営', color: '#d66e63', desc: '墓場の役職をすべて確認できます。人狼・大狼どうしは互いの役職を確認できます。' },
  { id: 'madman', name: '狂人', team: '人狼陣営', color: '#d993b2', desc: '人狼が誰かは知りません。人狼陣営が勝てば勝利します。' },
  { id: 'seer', name: '占い師', team: '村人陣営', color: '#91b7ef', desc: 'プレイヤー1人の役職を確認します。' },
  { id: 'mayor', name: '村長', team: '村人陣営', color: '#efc778', desc: '最終投票で2票分として数えます。' },
  { id: 'vampire', name: '吸血鬼', team: '村人陣営', color: '#c0a2ed', desc: 'プレイヤーまたは墓場の役職と自分の役職を交換します。' },
  { id: 'doctor', name: '医者', team: '村人陣営', color: '#8bd3c7', desc: 'プレイヤー1人を村人にします。治療しない「休診」も選べます。' },
  { id: 'teruteru', name: 'てるてる', team: '単独', color: '#f4d988', desc: '最多票で処刑されると単独勝利します。' }
];
const CARDS = [
  { id: 'savior', name: '救世主', icon: '✦', desc: '参加者の過半数が出した場合、人狼への投票に1票加えます。' },
  { id: 'shadow', name: 'シャドウ', icon: '◐', desc: '人狼・大狼・狂人が全員出した場合、人狼への投票から1票減らします。' },
  { id: 'researcher', name: '研究員', icon: '⌕', desc: '参加者の過半数以上の研究員が同じ人を選ぶと、夜の行動前の役職を公開します。' },
  { id: 'selfhelp', name: '自己啓発', icon: '◇', desc: '自分が夜の能力対象だったか確認します。能力者の役職は分かりません。' },
  { id: 'reveal', name: '自己開示', icon: '◎', desc: '元の役職が人狼・大狼でないことを証明します。' },
  { id: 'monk', name: 'お坊さん', icon: '☼', desc: '参加者の過半数が使うと墓場の役職を1枚公開します。' },
  { id: 'ballot', name: '選挙権', icon: '＋', desc: '指定した人への投票に1票加えます。' },
  { id: 'scout', name: '調査団', icon: '⌖', desc: '現在の人狼を確認します。人狼が調査団を出した人に投票すると人狼陣営が勝利します。' }
];
const DEFAULT_COUNTS = { villager: 3, wolf: 1, bigwolf: 0, madman: 1, seer: 1, mayor: 0, vampire: 0, doctor: 0, teruteru: 1 };
const state = {
  page: 'home', name: '', room: null, token: '', code: '', stream: null, error: '',
  count: 5, roleCounts: { ...DEFAULT_COUNTS }, draftCounts: null, draftCount: 5,
  draftRoomCode: '', draftDiscussion: { morning: 120, lastTalk: 120 }, pendingTarget: null, pendingCard: null, error: ''
};
const app = document.querySelector('#app');
const dialog = document.querySelector('#rulesDialog');
let toastTimer;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function role(id) { return ROLES.find(item => item.id === id) || { name: '不明', team: '不明' }; }
function card(id) { return CARDS.find(item => item.id === id) || { name: '不明', icon: '？' }; }
function rolePortrait(id) { return ['wolf', 'bigwolf'].includes(id) ? './assets/werewolf.png' : id === 'villager' ? './assets/villager.png' : `./assets/roles/${id}.png`; }
function cardArtwork(id) { return `./assets/cards/${encodeURIComponent(id)}.png`; }
function total(counts) { return Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0); }
function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function render() {
  if (state.room) return renderOnline();
  if (state.page === 'setup') return renderSetup();
  if (state.page === 'join') return renderJoin();
  renderHome();
}
function renderHome() {
  app.innerHTML = `${state.error ? `<div class="alert">${esc(state.error)}</div>` : ''}<section class="hero"><div class="moon"></div><span class="eyebrow">A ONE NIGHT CARD GAME</span><h1>夜明け前<br><strong>人狼</strong></h1><p>〜カードで紡ぐ、真実の夜〜</p><div class="hero-mascots" aria-hidden="true"><img class="hero-villager" src="./assets/villager.png" alt=""><span class="hero-orb">✦</span><img class="hero-wolf" src="./assets/werewolf.png" alt=""></div><div class="hero-caption">月明かりの村で、物語が始まる</div></section><div class="actions"><button class="button button-primary" id="createRoom">ゲームを始める →</button><button class="button button-secondary" id="joinRoom">部屋に参加する</button></div><div class="feature-row"><div class="feature"><b>🌙 一夜限り</b><span>秘密の役職と<br>最後の投票</span></div><div class="feature"><b>🂡 ひみつの手札</b><span>8種類のカードで<br>流れを変える</span></div><div class="feature"><b>👥 3〜8人</b><span>部屋コードで<br>オンライン対戦</span></div></div><div class="callout" style="margin-top:20px">参加者ごとの秘密情報はサーバーから本人にだけ送信します。</div>`;
  document.querySelector('#createRoom').onclick = () => { state.page = 'setup'; state.error = ''; render(); };
  document.querySelector('#joinRoom').onclick = () => { state.page = 'join'; state.error = ''; render(); };
}
function roleRows(counts, playerCount, editable) {
  return ROLES.map(item => `<div class="role-row"><div class="role-label"><img class="role-mini" src="./assets/roles/${item.id}.png" alt=""><div><div class="role-name">${item.name}</div><span class="role-desc">${item.team}</span></div></div>${editable ? `<div class="stepper"><button type="button" data-role="${item.id}" data-delta="-1">−</button><b>${counts[item.id] || 0}</b><button type="button" data-role="${item.id}" data-delta="1">+</button></div>` : `<strong>${counts[item.id] || 0}</strong>`}<span></span></div>`).join('');
}
function fitCounts(nextCount) {
  state.count = nextCount;
  let sum = total(state.roleCounts);
  const removalOrder = ['teruteru', 'mayor', 'doctor', 'vampire', 'madman', 'bigwolf', 'villager', 'seer', 'wolf'];
  for (const id of removalOrder) while (sum > nextCount + 2 && state.roleCounts[id] > 0) { state.roleCounts[id]--; sum--; }
  while (sum < nextCount + 2) { state.roleCounts.villager++; sum++; }
}
function bindSetup(counts, playerCount, afterChange) {
  document.querySelectorAll('[data-count]').forEach(button => button.onclick = () => {
    const count = Number(button.dataset.count);
    if (counts === state.roleCounts) fitCounts(count);
    else {
      state.draftCount = count;
      state.draftCounts = adjustCounts(state.draftCounts, count);
    }
    afterChange();
  });
  document.querySelectorAll('[data-role]').forEach(button => button.onclick = () => {
    const id = button.dataset.role, delta = Number(button.dataset.delta);
    if ((counts[id] || 0) + delta < 0 || total(counts) + delta > playerCount + 2) return;
    counts[id] = (counts[id] || 0) + delta;
    afterChange();
  });
}
function adjustCounts(source, count) {
  const next = { ...source };
  let sum = total(next);
  const removalOrder = ['teruteru', 'mayor', 'doctor', 'vampire', 'madman', 'bigwolf', 'villager', 'seer', 'wolf'];
  for (const id of removalOrder) while (sum > count + 2 && next[id] > 0) { next[id]--; sum--; }
  while (sum < count + 2) { next.villager++; sum++; }
  return next;
}
function renderSetup() {
  const sum = total(state.roleCounts), valid = sum === state.count + 2;
  app.innerHTML = `<div class="page-head"><button class="back" id="backHome">← ホーム</button><span class="eyebrow">ROOM SETUP</span><h1>部屋をつくる</h1><p>役職の合計は参加人数＋2枚です。墓場には余った2役職を置きます。</p></div><div class="panel"><div class="panel-title">参加人数</div><div class="segmented">${[3,4,5,6,7,8].map(n => `<button data-count="${n}" class="${state.count === n ? 'active' : ''}">${n}人</button>`).join('')}</div><div class="field"><label for="hostName">あなたの名前</label><input class="input" id="hostName" maxlength="24" value="${esc(state.name)}" placeholder="名前を入力"></div></div><div class="panel"><div class="panel-title">役職の枚数 <small>${sum} / ${state.count + 2}</small></div><div class="role-list">${roleRows(state.roleCounts, state.count, true)}</div><p class="total-note">墓場：${Math.max(0, sum - state.count)}枚</p>${valid ? '' : `<div class="alert">役職を合計${state.count + 2}枚にしてください。</div>`}</div><div class="field"><label for="customCode">部屋コード（空欄なら自動生成）</label><input class="input" id="customCode" value="" placeholder="好きな文字を設定できます"></div>${state.error ? `<div class="alert">${esc(state.error)}</div>` : ''}<button class="button button-primary" id="createNow" ${valid ? '' : 'disabled'}>オンライン部屋をつくる →</button>`;
  document.querySelector('#backHome').onclick = () => { state.page = 'home'; render(); };
  document.querySelector('#hostName').oninput = event => { state.name = event.target.value; };
  bindSetup(state.roleCounts, state.count, renderSetup);
  document.querySelector('#createNow').onclick = async () => {
    state.name = document.querySelector('#hostName').value.trim() || 'プレイヤー';
    await createRoom(document.querySelector('#customCode').value);
  };
}
function renderJoin() {
  app.innerHTML = `<div class="page-head"><button class="back" id="backHome">← ホーム</button><span class="eyebrow">JOIN ROOM</span><h1>部屋に参加する</h1><p>ホストから受け取った部屋コードを入力します。</p></div><div class="panel"><div class="field"><label for="joinName">あなたの名前</label><input class="input" id="joinName" maxlength="24" value="${esc(state.name)}" placeholder="名前を入力"></div><div class="field"><label for="joinCode">部屋コード</label><input class="input" id="joinCode" placeholder="部屋コード"></div></div>${state.error ? `<div class="alert">${esc(state.error)}</div>` : ''}<button class="button button-primary" id="joinNow">部屋に入る →</button>`;
  document.querySelector('#backHome').onclick = () => { state.page = 'home'; render(); };
  document.querySelector('#joinNow').onclick = async () => {
    state.name = document.querySelector('#joinName').value.trim() || 'プレイヤー';
    await joinRoom(document.querySelector('#joinCode').value);
  };
}
async function api(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'サーバーに接続できませんでした。');
  return result;
}
function rememberSession(code, token) {
  localStorage.setItem(`yoake-session:${code}`, token);
  localStorage.setItem('yoake-last-room', code);
  state.code = code; state.token = token;
}
async function createRoom(customCode) {
  try {
    state.error = '';
    const result = await api('/api/create', { name: state.name, code: customCode, count: state.count, roleCounts: state.roleCounts });
    rememberSession(result.code, result.token);
    openStream(result.code, result.token);
  } catch (error) { state.error = error.message; renderSetup(); }
}
async function joinRoom(code) {
  try {
    state.error = '';
    const token = localStorage.getItem(`yoake-session:${code}`) || '';
    const result = await api('/api/join', { name: state.name, code, token });
    rememberSession(result.code, result.token);
    openStream(result.code, result.token);
  } catch (error) { state.error = error.message; renderJoin(); document.querySelector('#joinName').value = state.name; document.querySelector('#joinCode').value = code; }
}
function openStream(code, token) {
  if (state.stream) state.stream.close();
  state.code = code; state.token = token; state.page = 'connecting'; state.room = null; state.error = '';
  app.innerHTML = `<div class="empty">部屋に接続しています…</div>`;
  const stream = new EventSource(`/events?room=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
  state.stream = stream;
  stream.addEventListener('state', event => {
    const previousPhase = state.room?.phase;
    const chatFocused = document.activeElement?.id === 'chatMessage';
    const chatValue = chatFocused ? document.activeElement.value : '';
    const chatPosition = chatFocused ? document.activeElement.selectionStart : null;
    const claimForm = document.querySelector('#claimForm');
    const claimSnapshot = claimForm ? {
      open: claimForm.closest('details')?.open || false,
      type: document.querySelector('#claimType')?.value,
      target: document.querySelector('#claimTarget')?.value,
      role: document.querySelector('#claimRole')?.value,
      resultRole: document.querySelector('#claimResultRole')?.value
    } : null;
    state.room = JSON.parse(event.data);
    state.pendingTarget = previousPhase === state.room.phase ? state.pendingTarget : null;
    state.pendingCard = previousPhase === state.room.phase ? state.pendingCard : null;
    state.page = 'online';
    renderOnline();
    if (claimSnapshot && previousPhase === state.room.phase) {
      const currentForm = document.querySelector('#claimForm');
      if (currentForm) {
        currentForm.closest('details').open = claimSnapshot.open;
        document.querySelector('#claimType').value = claimSnapshot.type;
        document.querySelector('#claimTarget').value = claimSnapshot.target;
        document.querySelector('#claimRole').value = claimSnapshot.role;
        document.querySelector('#claimResultRole').value = claimSnapshot.resultRole;
        document.querySelector('#claimType').dispatchEvent(new Event('change'));
      }
    }
    if (chatFocused) {
      const input = document.querySelector('#chatMessage');
      if (input) {
        input.value = chatValue;
        input.focus();
        input.setSelectionRange(chatPosition, chatPosition);
      }
    }
  });
  stream.onerror = async () => {
    if (state.room) return;
    try {
      const response = await fetch(`/api/session?room=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
      if (!response.ok) {
        stream.close();
        localStorage.removeItem('yoake-last-room');
        state.stream = null; state.error = '前回の部屋は終了したか、サーバーが再起動しています。新しい部屋を作成するか、もう一度参加してください。';
        renderHome();
      }
    } catch { app.innerHTML = `<div class="empty">接続中です。サーバーの起動と通信を確認しています…</div>`; }
  };
}
async function send(action, extra = {}) {
  try {
    await api('/api/action', { code: state.code, token: state.token, action, ...extra });
    return true;
  } catch (error) { showToast(error.message); }
  return false;
}
function phaseTitle(phase) {
  return ({ lobby: 'ロビー', role: '役職確認', night: '夜の行動', dealing: 'カード配布', morning: '朝の会議', cards: 'カード提出', results: 'カード公開', lastTalk: '最後の会議', vote: '最終投票', ending: '試合結果' })[phase] || '夜明け前';
}
function progressWidth(phase) {
  return ({ lobby: 3, role: 12, night: 24, dealing: 34, morning: 44, cards: 57, results: 67, lastTalk: 78, vote: 89, ending: 100 })[phase] || 0;
}
function phaseHeader(room) {
  const sequence = [{ label: '役職確認', icon: '🎭' }, { label: '夜の行動', icon: '☾' }, { label: '朝の会議', icon: '☼' }, { label: 'カード提出', icon: '▤' }, { label: '最後の会議', icon: '♛' }];
  const index = ({ role: 0, night: 1, dealing: 1, morning: 2, cards: 3, results: 4, lastTalk: 4, vote: 4, ending: 4 })[room.phase] ?? 0;
  const steps = room.phase === 'lobby' ? '' : `<nav class="phase-steps" aria-label="ゲームの進行">${sequence.map((step, i) => `<div class="phase-step ${i < index ? 'done' : i === index ? 'active' : ''}" ${i === index ? 'aria-current="step"' : ''}><span>${step.icon}</span><b>${step.label}</b></div>`).join('')}</nav>`;
  const deadline = ['morning', 'lastTalk', 'cards', 'vote'].includes(room.phase) && room.phaseEndsAt ? `<span class="timer" id="phaseTimer" data-deadline="${room.phaseEndsAt}"></span>` : '';
  return `<div class="game-top"><span class="phase-pill">${phaseTitle(room.phase)}</span>${deadline}<span class="timer">${room.round ? `${room.round}試合目` : '部屋コード：' + esc(room.code)}</span></div>${steps}${room.phase !== 'lobby' ? personalRecord(room) : ''}`;
}
function personalRecord(room) {
  const self = room.private;
  const ownRole = self.role ? `${role(self.role).name}${self.originalRole !== self.role ? `（元：${role(self.originalRole).name}）` : ''}` : '未配布';
  const actions = (self.ownActions || []).map(row => {
    const target = row.targetId === 'grave' ? `墓場 ${Number(row.graveIndex) + 1}枚目` : room.players.find(p => p.id === row.targetId)?.name || '不明';
    if (row.kind === '占い') return `<li class="action-record"><span>占い：</span>${esc(target)} の役職 <img class="record-role-icon" src="${rolePortrait(row.beforeRole)}" alt="">${esc(role(row.beforeRole).name)}</li>`;
    if (row.kind === '交換') return `<li class="action-record"><span>交換：</span>${esc(target)}と交換。あなたの役職 <img class="record-role-icon" src="${rolePortrait(row.actorAfterRole)}" alt="">${esc(role(row.actorAfterRole).name)}</li>`;
    if (row.kind === '治療') return `<li class="action-record"><span>治療：</span>${esc(target)}を村人にしました</li>`;
    if (row.kind === '休診') return '<li>医者：休診</li>';
    return `<li>${esc(row.kind)}</li>`;
  });
  if (self.nightInfo?.kind === 'seer' && !actions.some(text => text.includes('占い：'))) actions.push(`<li class="action-record"><span>占い：</span>${esc(self.nightInfo.targetName)} の役職 <img class="record-role-icon" src="${rolePortrait(self.nightInfo.role)}" alt="">${esc(role(self.nightInfo.role).name)}</li>`);
  const hand = (self.hand || []).map(item => `${item.name}${item.id === self.submittedCardId ? '（提出済み）' : ''}`).join('、') || 'まだ配られていません';
  const submitted = self.submittedCardId ? `${card(self.submittedCardId).name}${self.submittedCardTargetId ? `（対象：${esc(room.players.find(p => p.id === self.submittedCardTargetId)?.name || '不明')}）` : ''}` : '未提出';
  const cardResult = self.cardInfo ? `<div>${esc(self.cardInfo.text)}</div>` : '';
  return `<details class="panel personal-record"><summary>自分の記録</summary><div class="record-content"><div><b>現在の役職</b>：${esc(ownRole)}</div><div><b>手札</b>：${esc(hand)}</div><div><b>提出カード</b>：${esc(submitted)}</div><b>夜の行動</b>${actions.length ? `<ul>${actions.join('')}</ul>` : '<div>記録された行動はありません。</div>'}${cardResult}</div></details>`;
}
setInterval(() => {
  const timer = document.querySelector('#phaseTimer');
  if (!timer) return;
  const seconds = Math.max(0, Math.ceil((Number(timer.dataset.deadline) - Date.now()) / 1000));
  timer.textContent = `残り ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}, 500);
function playerList(room) {
  return `<div class="player-list">${room.players.map(player => `<div class="player-item"><img class="avatar portrait-avatar" src="${seatPortrait(player.id)}" alt=""><span class="player-name">${esc(player.name)}</span>${player.isHost ? '<em>ホスト</em>' : ''}<em>${player.online ? (player.ready ? '準備OK' : 'オンライン') : '再接続待ち'}</em></div>`).join('')}</div>`;
}
// Seat portraits are decorative identities, independent of the secretly dealt role.
const SEAT_PORTRAITS = ['villager', 'seer', 'vampire', 'mayor', 'doctor', 'teruteru', 'madman', 'villager'];
function seatPortrait(id) { const seed = [...String(id)].reduce((sum, char) => sum + char.charCodeAt(0), 0); return `./assets/roles/${SEAT_PORTRAITS[seed % SEAT_PORTRAITS.length]}.png`; }
function onlinePanel(title, content, small = '') {
  return `<div class="panel"><div class="panel-title">${title}${small ? `<small>${small}</small>` : ''}</div>${content}</div>`;
}
function renderOnline() {
  const room = state.room, self = room.private;
  if (!room || !self) return renderHome();
  const pages = { lobby: renderLobbyOnline, role: renderRoleOnline, night: renderNightOnline, dealing: renderDealingOnline, morning: renderMorningOnline, cards: renderCardsOnline, results: renderResultsOnline, lastTalk: renderLastTalkOnline, vote: renderVoteOnline, ending: renderEndingOnline };
  (pages[room.phase] || renderHome)();
}
function renderLobbyOnline() {
  const room = state.room, self = room.private;
  if (self.isHost) {
    if (state.draftRoomCode !== room.code) {
      state.draftRoomCode = room.code;
      state.draftCounts = { ...room.roleCounts };
      state.draftCount = room.count;
      state.draftDiscussion = { ...(room.discussionSeconds || { morning: 120, lastTalk: 120 }) };
    }
  }
  const durationOptions = (selected) => [30,60,90,120,180,300,600].map(n => `<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>${n < 60 ? `${n}秒` : `${n / 60}分${n % 60 ? '30秒' : ''}`}</option>`).join('');
  const discussionSettings = self.isHost
    ? `<div class="field"><label for="morningTime">朝の会議時間</label><select class="input" id="morningTime">${durationOptions(state.draftDiscussion.morning)}</select></div><div class="field"><label for="lastTalkTime">最後の会議時間</label><select class="input" id="lastTalkTime">${durationOptions(state.draftDiscussion.lastTalk)}</select></div>`
    : `<p class="total-note">会議時間：朝 ${room.discussionSeconds?.morning || 120}秒 ／ 最後 ${room.discussionSeconds?.lastTalk || 120}秒</p>`;
  const settings = self.isHost ? `<div class="panel"><div class="panel-title">ホスト設定 <small>${total(state.draftCounts || room.roleCounts)} / ${(state.draftCount || room.count) + 2} 枚</small></div><div class="segmented">${[3,4,5,6,7,8].map(n => `<button data-count="${n}" class="${(state.draftCount || room.count) === n ? 'active' : ''}">${n}人</button>`).join('')}</div><div class="role-list">${roleRows(state.draftCounts || room.roleCounts, state.draftCount || room.count, true)}</div>${discussionSettings}<button class="button button-secondary" id="saveSettings" style="width:100%;margin-top:12px">設定を更新</button></div>` : onlinePanel('役職設定', `<div class="role-list">${roleRows(room.roleCounts, room.count, false)}</div>${discussionSettings}`, `${total(room.roleCounts)}枚`);
  app.innerHTML = `${phaseHeader(room)}<div class="page-head"><span class="eyebrow">ROOM ${esc(room.code)}</span><h1>${self.isHost ? '部屋をつくりました' : '部屋に参加しました'}</h1><p>部屋コードを共有してプレイヤーを招待してください。</p></div>${onlinePanel('部屋コード', `<div class="lobby-code">${esc(room.code)}</div><button class="button button-secondary" id="copyCode" style="width:100%">コードをコピー</button>`)}${onlinePanel('プレイヤー', playerList(room), `${room.players.length} / ${room.count}人`)}${settings}<div class="callout">全員が接続し、役職合計が参加人数＋2枚になると開始できます。${room.players.length < room.count ? ` あと${room.count - room.players.length}人です。` : ''}</div>${self.isHost ? `<div class="phase-actions"><button class="button button-primary" id="startGame" ${room.players.length === room.count && room.players.every(p => p.online) && total(room.roleCounts) === room.count + 2 ? '' : 'disabled'}>ゲームを始める →</button></div>` : `<div class="empty">ホストがゲームを開始するのを待っています。</div>`}`;
  document.querySelector('#copyCode').onclick = async () => { try { await navigator.clipboard.writeText(room.code); showToast('部屋コードをコピーしました。'); } catch { showToast(room.code); } };
  if (self.isHost) {
    bindSetup(state.draftCounts, state.draftCount, renderOnline);
    document.querySelector('#saveSettings').onclick = () => {
      state.draftDiscussion = { morning: Number(document.querySelector('#morningTime').value), lastTalk: Number(document.querySelector('#lastTalkTime').value) };
      send('settings', { count: state.draftCount, roleCounts: state.draftCounts, discussionSeconds: state.draftDiscussion });
    };
    document.querySelector('#startGame').onclick = () => send('start');
  }
}
function readyButton(label = '確認した →') {
  const room = state.room, self = room.private;
  if (room.players.find(p => p.id === self.playerId)?.ready) return `<div class="callout">全員の確認を待っています（${room.readyCount} / ${room.players.length}人）。</div>`;
  return `<button class="button button-primary" id="readyAction">${label}</button><div class="total-note">確認済み：${room.readyCount} / ${room.players.length}人</div>`;
}
function wireReady(label) { const button = document.querySelector('#readyAction'); if (button) button.onclick = () => send('ready'); }
function renderRoleOnline() {
  const room = state.room, self = room.private, ownRole = role(self.role);
  const allies = self.allies?.length ? onlinePanel('確認できる人狼の仲間', self.allies.map(p => `<div class="result-card"><b>${esc(p.name)}</b><span>${role(p.role).name}</span></div>`).join('')) : '';
  const grave = self.role === 'bigwolf' ? onlinePanel('墓場（大狼だけに表示）', (self.grave || []).map((id, i) => `<div class="result-card"><b>墓場 ${i + 1}枚目</b><span>${role(id).name}</span></div>`).join('')) : '';
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card role-showcase"><span class="eyebrow">YOUR SECRET ROLE</span><img class="role-portrait" src="${rolePortrait(self.role)}" alt="${ownRole.name}のキャラクター"><h1>${ownRole.name}</h1><p>${ownRole.desc}</p><div class="secret-role"><span>あなたの陣営</span><strong>${ownRole.team}</strong></div></section>${allies}${grave}<div class="callout">${self.role === 'madman' ? '狂人には人狼・大狼が誰かは表示されません。' : 'この画面の役職情報はあなただけに送られています。'}準備ができたら次へ進んでください。</div><div class="phase-actions">${readyButton('役職を確認した →')}</div>`;
  wireReady();
}
function targetButtons(players, selected, options = []) {
  return `<div class="seat-grid">${players.map(player => `<button class="seat ${selected === player.id ? 'selected' : ''}" data-target="${esc(player.id)}"><img class="seat-portrait" src="${seatPortrait(player.id)}" alt=""><b>${esc(player.name)}</b><small>プレイヤー</small></button>`).join('')}${options.map(option => `<button class="seat ${selected === option.id ? 'selected' : ''}" data-target="${option.id}"><span class="seat-symbol">${option.id.startsWith('grave') ? '✦' : '☼'}</span><b>${option.label}</b><small>${option.detail || ''}</small></button>`).join('')}</div>`;
}
function renderNightOnline() {
  const room = state.room, self = room.private, ownRole = role(self.role);
  const active = ['seer', 'doctor', 'vampire'].includes(self.role);
  const opts = self.role === 'doctor' ? [{ id: 'rest', label: '休診', detail: '誰も村人にしない' }] : self.role === 'vampire' ? [{ id: 'grave:0', label: '墓場 1枚目', detail: '役職を交換' }, { id: 'grave:1', label: '墓場 2枚目', detail: '役職を交換' }] : [];
  const already = self.ownActionSubmitted;
  const grave = self.role === 'bigwolf' ? onlinePanel('墓場（大狼だけに表示）', (self.grave || []).map((id, i) => `<div class="result-card"><b>墓場 ${i + 1}枚目</b><span>${role(id).name}</span></div>`).join('')) : '';
  const action = active ? `<div class="label">${self.role === 'doctor' ? '治療先を選ぶ（休診できます）' : '対象を選ぶ'}</div>${targetButtons(room.players.filter(p => p.id !== self.playerId), state.pendingTarget, opts)}<button class="button button-primary" id="sendNight" ${state.pendingTarget ? '' : 'disabled'}>行動を確定する →</button>` : `<button class="button button-primary" id="sendNight">${self.role === 'bigwolf' ? '墓場を確認した →' : '夜の確認を終える →'}</button>`;
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card role-showcase night-showcase"><span class="eyebrow">NIGHT ACTION</span><img class="role-portrait" src="${rolePortrait(self.role)}" alt="${ownRole.name}のキャラクター"><h1>${ownRole.name}</h1><p>${active ? ownRole.desc : '能力の確認を終えたら次へ進みます。'}</p></section>${grave}${already ? `<div class="callout">行動を送信しました。ほかのプレイヤーを待っています（${room.actionSubmittedCount} / ${room.players.length}人）。</div>` : action}`;
  document.querySelectorAll('[data-target]').forEach(button => button.onclick = () => { state.pendingTarget = button.dataset.target; renderNightOnline(); });
  const submit = document.querySelector('#sendNight');
  if (submit && !already) submit.onclick = () => {
    const type = active ? self.role : 'pass';
    send('night', { choice: active ? { targetId: state.pendingTarget } : { type } });
  };
}
function renderDealingOnline() {
  const room = state.room, self = room.private;
  const nightInfo = self.nightInfo?.kind === 'seer' ? `<div class="callout role-callout">占い結果：${esc(self.nightInfo.targetName)} の役職 <img class="record-role-icon" src="${rolePortrait(self.nightInfo.role)}" alt="">${esc(role(self.nightInfo.role).name)}</div>` : self.nightInfo?.kind === 'vampire' ? `<div class="callout role-callout">交換結果：${esc(self.nightInfo.targetName)}と交換。あなたの役職 <img class="record-role-icon" src="${rolePortrait(self.nightInfo.receivedRole)}" alt="">${esc(role(self.nightInfo.receivedRole).name)}</div>` : '';
  const hand = (self.hand || []).map(item => `<div class="playing-card"><img class="card-art" src="${cardArtwork(item.id)}" alt=""><b>${item.name}</b><small>${item.desc}</small></div>`).join('');
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card"><span class="eyebrow">PRIVATE CARD HAND</span><h1>カードが配られました</h1><p>各プレイヤーに3枚ずつ配られます。手札は本人だけに表示されます。</p></section>${nightInfo}<div class="hand">${hand}</div><div class="callout">カードを確認したら次へ進みます。朝の会議後に1枚提出します。</div><div class="phase-actions">${readyButton('手札を確認した →')}</div>`;
  wireReady();
}
function renderMorningOnline() {
  const room = state.room, me = room.players.find(p => p.id === room.private.playerId);
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card morning-showcase"><div><span class="eyebrow">MORNING DISCUSSION</span><h1>朝の会議</h1><p>会話して、みんなが進んだらカード提出へ。</p></div><img src="./assets/villager.png" alt="ランタンを掲げる村人" class="meeting-portrait"></section>${onlinePanel('プレイヤー', playerList(room), `${room.players.length}人`)}${claimPanel(room)}${chatPanel(room)}<div class="phase-actions">${readyButton('カードを選ぶ →')}</div>`;
  wireChat();
  wireClaims();
  wireReady();
}
function needsTarget(cardId) { return ['researcher', 'ballot'].includes(cardId); }
function renderCardsOnline() {
  const room = state.room, self = room.private, submitted = self.ownCardSubmitted;
  const selected = (self.hand || []).find(item => item.id === state.pendingCard);
  const targets = needsTarget(selected?.id) ? `<div class="label">カードの対象を選ぶ</div>${targetButtons(room.players, state.pendingTarget)}` : '';
  const hand = (self.hand || []).map(item => {
    const unusableReveal = item.id === 'reveal' && ['wolf', 'bigwolf'].includes(self.originalRole);
    return `<button class="playing-card ${state.pendingCard === item.id ? 'selected' : ''}" data-card="${item.id}" ${unusableReveal ? 'disabled' : ''}><img class="card-art" src="${cardArtwork(item.id)}" alt=""><b>${item.name}</b><small>${unusableReveal ? '人狼・大狼は使用できません。' : item.desc}</small>${state.pendingCard === item.id ? '<span class="card-mark">✓</span>' : ''}</button>`;
  }).join('');
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card"><span class="eyebrow">15 SECOND CARD PICK</span><h1>使うカードを選ぶ</h1><p>1枚選ぶと次へ。時間切れ時は手札から自動で選びます。</p></section>${submitted ? `<div class="callout">提出済み。ほかの人の選択を待っています。</div>` : `<div class="hand">${hand}</div>${targets}<button class="button button-primary" id="submitCard" ${selected && (!needsTarget(selected.id) || state.pendingTarget) ? '' : 'disabled'}>このカードで進む</button>`}`;
  document.querySelectorAll('[data-card]').forEach(button => button.onclick = () => { state.pendingCard = button.dataset.card; state.pendingTarget = null; renderCardsOnline(); });
  document.querySelectorAll('[data-target]').forEach(button => button.onclick = () => { state.pendingTarget = button.dataset.target; renderCardsOnline(); });
  const submit = document.querySelector('#submitCard');
  if (submit) submit.onclick = () => send('card', { cardId: state.pendingCard, targetId: state.pendingTarget });
}
function renderResultsOnline() {
  const room = state.room, self = room.private;
  const exposed = (room.publicCards || []).map(item => `<div class="result-card"><img class="result-card-art" src="${cardArtwork(item.cardId)}" alt=""><b>${card(item.cardId).name}</b><span>${item.targetId ? `対象：${esc(room.players.find(p => p.id === item.targetId)?.name || '不明')}` : '提出済み'}</span></div>`).join('');
  const reports = (room.cardResults || []).map(item => `<div class="result-card">${item.role ? `<img class="result-role-art" src="${rolePortrait(item.role)}" alt="">` : ''}<b>${esc(item.kind)}</b><span>${esc(item.text)}</span></div>`).join('');
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card"><span class="eyebrow">CARDS REVEALED</span><h1>カードが出そろいました</h1><p>カードの種類と対象を公開します。誰が出したかはまだ分かりません。</p></section>${onlinePanel('匿名の提出カード', exposed)}${reports ? onlinePanel('追加情報', reports) : ''}${self.cardInfo ? `<div class="callout">${esc(self.cardInfo.text)}</div>` : ''}<div class="phase-actions">${readyButton('確認して最後の会議へ →')}</div>`;
  wireReady();
}
function renderLastTalkOnline() {
  const room = state.room;
  const exposed = (room.publicCards || []).map(item => `<div class="revealed-card"><img class="result-card-art" src="${cardArtwork(item.cardId)}" alt=""><div><b>${card(item.cardId).name}</b><small>${item.targetId ? `対象：${esc(room.players.find(p => p.id === item.targetId)?.name || '不明')}` : '提出カード'}</small></div></div>`).join('');
  const reports = (room.cardResults || []).map(item => `<div class="card-effect">${item.role ? `<img class="claim-role-icon" src="${rolePortrait(item.role)}" alt="">` : ''}<b>${esc(item.kind)}</b><span>${esc(item.text)}</span></div>`).join('');
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card"><span class="eyebrow">FINAL DISCUSSION</span><h1>最後の会議</h1><p>カード情報と発言をもとに投票先を決めましょう。</p></section>${onlinePanel('提出カード', `<div class="revealed-card-grid">${exposed}</div>`)}${reports ? onlinePanel('カード効果', `<div class="card-effect-list">${reports}</div>`) : ''}${claimPanel(room)}${chatPanel(room)}<div class="phase-actions">${readyButton('投票へ →')}</div>`;
  wireChat();
  wireClaims();
  wireReady();
}
function claimPanel(room) {
  const roles = ROLES.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
  const targets = room.players.map(player => `<option value="${esc(player.id)}">${esc(player.name)}</option>`).join('');
  const claims = (room.claims || []).filter(claim => claim.round === room.round).map(claim => claimMarkup(claim, room)).join('') || '<div class="empty">まだ表明はありません。</div>';
  return `<div class="panel claim-panel"><div class="panel-title">カミングアウト <details class="claim-composer"><summary>表明する</summary><form id="claimForm" class="claim-form"><label for="claimType">内容</label><select class="input" id="claimType"><option value="role">自分の役職</option><option value="seer">占い結果</option><option value="vampire">吸血鬼の交換</option><option value="doctor">医者の治療</option><option value="grave">大狼の墓場情報</option></select><div class="field" id="claimTargetField"><label for="claimTarget">相手</label><select class="input" id="claimTarget">${targets}</select></div><div class="field"><label id="claimRoleLabel" for="claimRole">表明する役職</label><select class="input" id="claimRole">${roles}</select></div><div class="field" id="claimResultField"><label for="claimResultRole">交換後の自分の役職</label><select class="input" id="claimResultRole">${roles}</select></div><button class="button button-secondary" type="submit">表明する</button></form></details></div><div class="claim-list">${claims}</div><small class="claim-note">申告は自由。真偽は発言から推理しましょう。</small></div>`;
}
function claimMarkup(claim, room) {
  const speaker = room.players.find(player => player.id === claim.playerId)?.name || 'プレイヤー';
  const target = room.players.find(player => player.id === claim.targetId)?.name || '不明';
  const claimedRole = role(claim.roleId).name;
  const roleIcon = `<img class="claim-role-icon" src="${rolePortrait(claim.roleId)}" alt="">`;
  const statement = claim.claimType === 'role' ? `役職は ${roleIcon}${esc(claimedRole)}`
    : claim.claimType === 'seer' ? `占い：${esc(target)} は ${roleIcon}${esc(claimedRole)}`
      : claim.claimType === 'vampire' ? `交換：${esc(target)}（${roleIcon}${esc(claimedRole)}）と交換、自分は <img class="claim-role-icon" src="${rolePortrait(claim.resultRoleId)}" alt="">${esc(role(claim.resultRoleId).name)}`
        : claim.claimType === 'doctor' ? `治療：${esc(target)}（${roleIcon}${esc(claimedRole)} → 村人）`
          : `墓場：${roleIcon}${esc(claimedRole)}`;
  return `<div class="claim-row"><img class="claim-speaker" src="${seatPortrait(claim.playerId)}" alt=""><div><b>${esc(speaker)}</b><span>${statement}</span></div></div>`;
}
function wireClaims() {
  const form = document.querySelector('#claimForm');
  if (!form) return;
  const type = document.querySelector('#claimType');
  const targetField = document.querySelector('#claimTargetField');
  const resultField = document.querySelector('#claimResultField');
  const roleLabel = document.querySelector('#claimRoleLabel');
  const updateFields = () => {
    targetField.hidden = !['seer', 'vampire', 'doctor'].includes(type.value);
    resultField.hidden = type.value !== 'vampire';
    roleLabel.textContent = type.value === 'role' ? '自分の役職' : type.value === 'grave' ? '墓場にあった役職' : type.value === 'seer' ? '占った相手の役職' : type.value === 'doctor' ? '治療前の相手の役職' : '交換相手の役職';
  };
  type.onchange = updateFields;
  updateFields();
  form.onsubmit = event => {
    event.preventDefault();
    send('claim', { claimType: type.value, roleId: document.querySelector('#claimRole').value, targetId: document.querySelector('#claimTarget').value || null, resultRoleId: document.querySelector('#claimResultRole').value });
  };
}
function chatPanel(room) {
  const messages = (room.messages || []).map(message => `<div class="chat-message"><b>${esc(message.name)}</b><span>${esc(message.text)}</span></div>`).join('') || '<div class="empty">会議を始めましょう。</div>';
  return onlinePanel('会議チャット', `<div class="chat-log">${messages}</div><form id="chatForm" class="chat-form"><input class="input" id="chatMessage" maxlength="300" autocomplete="off" placeholder="メッセージを入力"><button class="button button-secondary" type="submit">送信</button></form>`);
}
function wireChat() {
  const form = document.querySelector('#chatForm');
  if (!form) return;
  form.onsubmit = async event => {
    event.preventDefault();
    const input = document.querySelector('#chatMessage'), text = input.value.trim();
    if (!text) return;
    if (await send('chat', { message: text })) {
      const currentInput = document.querySelector('#chatMessage');
      if (currentInput) currentInput.value = '';
    }
  };
}
function renderVoteOnline() {
  const room = state.room, self = room.private, submitted = self.ownVoteSubmitted;
  const choices = [...room.players.filter(player => player.id !== self.playerId).map(player => ({ id: player.id, label: player.name })), { id: 'peace', label: '平和村' }];
  app.innerHTML = `${phaseHeader(room)}<section class="phase-card"><span class="eyebrow">15 SECOND VOTE</span><h1>投票先を選ぶ</h1><p>自分以外のプレイヤーか平和村を選択。全員の投票で結果へ進みます。</p></section>${submitted ? `<div class="callout">投票済み。ほかの人の投票を待っています。</div>` : `<div class="seat-grid">${choices.map(choice => `<button class="seat ${state.pendingTarget === choice.id ? 'selected' : ''}" data-target="${choice.id}">${esc(choice.label)}<small>投票する</small></button>`).join('')}</div><button class="button button-primary" id="castVote" ${state.pendingTarget ? '' : 'disabled'}>投票する</button>`}`;
  document.querySelectorAll('[data-target]').forEach(button => button.onclick = () => { state.pendingTarget = button.dataset.target; renderVoteOnline(); });
  const submit = document.querySelector('#castVote');
  if (submit) submit.onclick = () => send('vote', { targetId: state.pendingTarget });
}
function renderEndingOnline() {
  const room = state.room, outcome = room.outcome, report = outcome.report;
  const title = outcome.winningSide === 'teruteru' ? 'てるてるの単独勝利' : outcome.winningSide === 'wolf' ? '人狼陣営の勝利' : '村人陣営の勝利';
  const winningPlayers = report.filter(item => item.scoreChange > 0);
  const winningLineup = winningPlayers.map(item => `<div class="winner-member"><img src="${rolePortrait(item.role)}" alt=""><span>${esc(item.name)}</span></div>`).join('');
  const reason = outcome.peaceOutcome
    ? room.players.some(player => ['wolf', 'bigwolf'].includes(player.role)) ? '得票数が全プレイヤーで同じです。平和村判定となり、人狼・大狼が勝利しました。' : '得票数が全プレイヤーで同じです。平和村判定となり、てるてる・狂人以外が勝利しました。'
    : outcome.peaceVoted ? '平和村が最多票です。プレイヤーは処刑されませんでした。'
    : outcome.winningSide === 'teruteru' ? 'てるてるが最多票で処刑されました。'
      : outcome.winningSide === 'wolf' ? outcome.scoutSabotage ? '人狼が調査団を出したプレイヤーに投票しました。' : '人狼・大狼が処刑を免れました。'
        : '人狼・大狼が処刑されました。';
  const bars = Object.entries(outcome.counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
    const name = id === 'peace' ? '平和村' : room.players.find(player => player.id === id)?.name || '不明';
    return `<div class="vote-line"><span>${esc(name)}</span><div class="bar" style="width:${Math.max(6, n / Math.max(...Object.values(outcome.counts)) * 100)}%"></div><b>${n}</b></div>`;
  }).join('');
  const results = report.map(item => {
    const voteTarget = item.voteTargetId === 'peace' ? '平和村' : room.players.find(player => player.id === item.voteTargetId)?.name || '不明';
    const cardTarget = room.players.find(player => player.id === item.cardTargetId)?.name;
    const oldRole = item.originalRole !== item.role ? `（元：${role(item.originalRole).name}）` : '';
    const executed = outcome.executedIds.includes(item.playerId) ? '処刑' : '';
    const actionRows = (outcome.actionLog || []).filter(row => row.actorId === item.playerId).map(row => {
      const target = row.targetId === 'grave' ? `墓場${Number(row.graveIndex) + 1}枚目` : room.players.find(player => player.id === row.targetId)?.name || '不明';
      if (row.kind === '占い') return `<li>占い：${esc(target)} は <img class="claim-role-icon" src="${rolePortrait(row.beforeRole)}" alt="">${role(row.beforeRole).name}</li>`;
      if (row.kind === '休診') return '<li>医者：休診</li>';
      if (row.kind === '治療') return `<li>医者：${esc(target)}を治療（村人になりました）</li>`;
      if (row.kind === '交換') return `<li>吸血鬼：${esc(target)}と交換、自分は <img class="claim-role-icon" src="${rolePortrait(row.actorAfterRole)}" alt="">${role(row.actorAfterRole).name}</li>`;
      return '';
    }).filter(Boolean).join('') || '<li>特別な夜の行動なし</li>';
    return `<article class="final-player-row"><div class="final-player-head"><img class="result-role-art" src="${rolePortrait(item.role)}" alt=""><div><b>${esc(item.name)}${executed ? ` · ${executed}` : ''}</b><small>役職：${role(item.role).name}${oldRole}</small></div><span class="final-score">+${item.scoreChange}点</span></div><div class="final-player-facts"><div><small>投票先</small><b>${esc(voteTarget)}</b></div><div><small>提出カード</small><span>${item.cardId ? `<img class="result-card-art" src="${cardArtwork(item.cardId)}" alt="">${esc(card(item.cardId).name)}${cardTarget ? ` / 対象 ${esc(cardTarget)}` : ''}` : 'なし'}</span></div><div><small>夜の行動</small><ul>${actionRows}</ul></div><div class="score-total">今回 ${item.scoreChange > 0 ? '+' : ''}${item.scoreChange}点　/　累計 ${item.totalScore}点</div></div></article>`;
  }).join('');
  const claims = (room.claims || []).map(claim => claimMarkup(claim, room)).join('') || '<div class="empty">申告はありませんでした。</div>';
  app.innerHTML = `${phaseHeader(room)}<div class="ending-screen"><div class="winner-banner ${outcome.winningSide}"><span class="eyebrow">THE NIGHT IS OVER</span><h1>${title}</h1><p>${reason}</p><div class="winner-lineup">${winningLineup || '<span>勝利チームなし</span>'}</div></div><div class="winner"><div class="winner-icon">${outcome.winningSide === 'teruteru' ? '🎭' : outcome.winningSide === 'wolf' ? '🌘' : '🌅'}</div><p>勝利チームは各 +1点</p></div>${onlinePanel('投票数', `${bars}${outcome.peaceOutcome ? '<div class="total-note">全員の得票数が同じ：平和村判定</div>' : ''}`)}${onlinePanel('プレイヤー別結果', `<div class="final-player-list">${results}</div>`)}${onlinePanel('カミングアウト記録', `<div class="claim-list">${claims}</div>`)}${onlinePanel('墓場', (outcome.grave || []).map(id => role(id).name).join('・'))}<div class="phase-actions">${state.room.private.isHost ? '<button class="button button-primary" id="rematch">次の試合を設定 →</button>' : '<div class="callout">ホストが次の試合を準備するのを待っています。</div>'}</div></div>`;
  const rematch = document.querySelector('#rematch');
  if (rematch) rematch.onclick = () => send('rematch');
}

function guide(type = 'flow') {
  document.querySelectorAll('.guide-tab').forEach(button => button.classList.toggle('active', button.dataset.guide === type));
  const content = document.querySelector('#guideContent');
  const counts = state.room?.roleCounts || state.roleCounts;
  const entries = type === 'flow'
    ? [['役職確認・夜', '役職を確認して能力を使います。大狼は墓場を見て、人狼と大狼は仲間を確認します。'], ['朝の会議', '自由に話し合い、カミングアウトで役職や行動結果を申告できます。'], ['カード選択', '15秒以内に手札から1枚選びます。全員の提出後、匿名カードを見ながら最後の会議へ進みます。'], ['最後の会議・投票', '再び申告や議論をして、15秒以内に自分以外か平和村へ投票します。時間切れでは未選択分を自動処理します。'], ['勝利・ポイント', '試合結果に役職・行動・投票・カードとポイントを表示します。']]
    : type === 'roles' ? ROLES.map(item => [`${item.name} — ${counts[item.id] || 0}枚`, `${item.team} — ${item.desc}`, rolePortrait(item.id)])
      : CARDS.map(item => [`${item.icon} ${item.name}`, item.desc, cardArtwork(item.id)]);
  content.innerHTML = entries.map(([heading, text, art]) => `<div class="guide-entry">${art ? `<img class="guide-art" src="${art}" alt="">` : ''}<div><b>${esc(heading)}</b><p>${esc(text)}</p></div></div>`).join('');
}
document.querySelector('#helpButton').onclick = () => { guide('flow'); dialog.showModal(); };
document.querySelector('#rulesLink').onclick = () => { guide('flow'); dialog.showModal(); };
document.querySelector('.close-dialog').onclick = () => dialog.close();
document.querySelectorAll('.guide-tab').forEach(button => button.onclick = () => guide(button.dataset.guide));

async function resumeLastRoom() {
  const code = localStorage.getItem('yoake-last-room');
  if (!code) return;
  const token = localStorage.getItem(`yoake-session:${code}`);
  if (token) openStream(code, token);
}
render();
resumeLastRoom();
