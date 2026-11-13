'use strict';

const { randomInt } = require('node:crypto');

const ROLES = [
  { id: 'villager', name: '村人', team: '村人陣営', desc: '特殊能力はありません。会議で人狼を探します。' },
  { id: 'wolf', name: '人狼', team: '人狼陣営', desc: '正体を隠し、投票を生き延びましょう。' },
  { id: 'bigwolf', name: '大狼', team: '人狼陣営', desc: '夜に墓場の役職をすべて確認します。人狼・大狼どうしは互いを確認できます。' },
  { id: 'madman', name: '狂人', team: '人狼陣営', desc: '人狼の正体は知りません。人狼陣営が勝てば勝利します。' },
  { id: 'seer', name: '占い師', team: '村人陣営', desc: 'プレイヤー1人の役職を確認します。' },
  { id: 'mayor', name: '村長', team: '村人陣営', desc: '最終投票で2票分として数えます。' },
  { id: 'vampire', name: '吸血鬼', team: '村人陣営', desc: 'プレイヤーまたは墓場の役職と自分の役職を入れ替えます。' },
  { id: 'doctor', name: '医者', team: '村人陣営', desc: 'プレイヤー1人を村人にします。休診も選べます。' },
  { id: 'teruteru', name: 'てるてる', team: '単独', desc: '自分が処刑されると単独勝利します。' }
];

const CARDS = [
  { id: 'savior', name: '救世主', icon: '✦', desc: '参加者の過半数が出した場合、現在の人狼への投票に1票加えます。' },
  { id: 'shadow', name: 'シャドウ', icon: '◐', desc: '人狼・大狼・狂人が全員出した場合、現在の人狼への投票から1票減らします。' },
  { id: 'researcher', name: '研究員', icon: '⌕', desc: '参加者の過半数以上の研究員が同じ人を選ぶと、夜の行動後の役職を公開します。' },
  { id: 'selfhelp', name: '自己啓発', icon: '◇', desc: '自分が夜の能力対象だったか確認します。' },
  { id: 'reveal', name: '自己開示', icon: '◎', desc: '元の役職が人狼・大狼でなかったと証明します。' },
  { id: 'monk', name: 'お坊さん', icon: '☼', desc: '過半数が使用すると墓場の役職を1枚確認します。' },
  { id: 'ballot', name: '選挙権', icon: '＋', desc: '指定した人への投票に1票加えます。' },
  { id: 'scout', name: '調査団', icon: '⌖', desc: '現在の人狼を確認します。人狼に投票されると人狼陣営勝利。' }
];

const ROLE_BY_ID = new Map(ROLES.map(role => [role.id, role]));
const CARD_BY_ID = new Map(CARDS.map(card => [card.id, card]));
const WOLF_ROLES = new Set(['wolf', 'bigwolf']);
const WOLF_TEAM = new Set(['wolf', 'bigwolf', 'madman']);

function shuffle(items, below = randomInt) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = below(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function validateSetup(count, roleCounts) {
  if (!Number.isInteger(count) || count < 3 || count > 8) throw new Error('参加人数は3〜8人にしてください。');
  if (!roleCounts || typeof roleCounts !== 'object') throw new Error('役職設定がありません。');
  for (const role of ROLES) {
    const n = roleCounts[role.id] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 8) throw new Error(`${role.name}の人数が不正です。`);
  }
  const extraKeys = Object.keys(roleCounts).filter(key => !ROLE_BY_ID.has(key));
  if (extraKeys.length) throw new Error('未対応の役職が含まれています。');
  const total = ROLES.reduce((sum, role) => sum + (roleCounts[role.id] ?? 0), 0);
  if (total !== count + 2) throw new Error(`役職は合計${count + 2}枚にしてください。`);
}

function dealRoles(room, below = randomInt) {
  validateSetup(room.count, room.roleCounts);
  if (room.players.length !== room.count) throw new Error('設定した人数がそろっていません。');
  const deck = shuffle(ROLES.flatMap(role => Array(room.roleCounts[role.id] ?? 0).fill(role.id)), below);
  room.players.forEach((player, index) => {
    player.role = deck[index];
    player.originalRole = deck[index];
    player.hand = [];
    player.actionSubmitted = false;
    player.cardSubmitted = false;
    player.voteSubmitted = false;
    player.nightInfo = null;
  });
  room.grave = deck.slice(room.count);
  for (const player of room.players) player.knownAllies = getWolfAllies(room, player);
  room.ready = new Set();
  room.nightActions = new Map();
  room.submissions = new Map();
  room.votes = new Map();
  room.actionLog = [];
  room.cardResults = [];
  room.publicCards = [];
  room.outcome = null;
  room.round += 1;
  room.phase = 'role';
}

function getWolfAllies(room, player) {
  if (!WOLF_ROLES.has(player.role)) return [];
  return room.players
    .filter(other => other.id !== player.id && WOLF_ROLES.has(other.role))
    .map(other => ({ id: other.id, name: other.name, role: other.role }));
}

function dealHands(room, below = randomInt) {
  for (const player of room.players) {
    player.hand = shuffle(CARDS, below).slice(0, 3).map(card => ({ ...card }));
    player.cardSubmitted = false;
    player.actionSubmitted = false;
  }
  room.submissions = new Map();
  room.publicCards = [];
  room.cardResults = [];
}

function playerById(room, id) {
  return room.players.find(player => player.id === id);
}

function roleName(id) {
  return ROLE_BY_ID.get(id)?.name || '不明';
}

function cardName(id) {
  return CARD_BY_ID.get(id)?.name || '不明';
}

function resolveNight(room) {
  const actions = room.players
    .map(player => ({ player, action: room.nightActions.get(player.id) }))
    .filter(row => row.action);
  // Simultaneous choices resolve in a fixed order to avoid network timing affecting the result.
  for (const { player, action } of actions.filter(x => x.action.type === 'seer')) {
    const target = playerById(room, action.targetId);
    player.nightInfo = { kind: 'seer', targetName: target.name, role: target.role };
    room.actionLog.push({ kind: '占い', actorId: player.id, actorRole: 'seer', targetId: target.id, beforeRole: target.role, afterRole: target.role });
  }
  for (const { player, action } of actions.filter(x => x.action.type === 'vampire')) {
    const beforeActor = player.role;
    if (action.targetId.startsWith('grave:')) {
      const graveIndex = Number(action.targetId.split(':')[1]);
      const beforeTarget = room.grave[graveIndex];
      room.grave[graveIndex] = beforeActor;
      player.role = beforeTarget;
      player.nightInfo = { kind: 'vampire', targetName: `墓場 ${graveIndex + 1}枚目`, beforeRole: beforeActor, receivedRole: beforeTarget };
      room.actionLog.push({ kind: '交換', actorId: player.id, actorRole: 'vampire', targetId: 'grave', graveIndex, beforeRole: beforeTarget, afterRole: beforeActor, actorAfterRole: player.role });
    } else {
      const target = playerById(room, action.targetId);
      const beforeTarget = target.role;
      target.role = beforeActor;
      player.role = beforeTarget;
      player.nightInfo = { kind: 'vampire', targetName: target.name, beforeRole: beforeActor, receivedRole: beforeTarget };
      room.actionLog.push({ kind: '交換', actorId: player.id, actorRole: 'vampire', targetId: target.id, beforeRole: beforeTarget, afterRole: beforeActor, actorAfterRole: player.role });
    }
  }
  for (const { player, action } of actions.filter(x => x.action.type === 'doctor')) {
    if (action.targetId === 'rest') {
      room.actionLog.push({ kind: '休診', actorId: player.id, actorRole: 'doctor', targetId: null, beforeRole: null, afterRole: null });
      continue;
    }
    const target = playerById(room, action.targetId);
    const beforeRole = target.role;
    target.role = 'villager';
    room.actionLog.push({ kind: '治療', actorId: player.id, actorRole: 'doctor', targetId: target.id, beforeRole, afterRole: 'villager' });
  }
}

function resolveCardSubmissions(room, below = randomInt) {
  const rows = [...room.submissions.entries()].map(([playerId, submission]) => ({ player: playerById(room, playerId), ...submission }));
  room.publicCards = shuffle(rows, below).map(row => ({ cardId: row.cardId, targetId: row.targetId || null }));
  room.cardResults = [];
  const researchers = rows.filter(row => row.cardId === 'researcher');
  const byTarget = new Map();
  for (const row of researchers) {
    if (!row.targetId) continue;
    byTarget.set(row.targetId, (byTarget.get(row.targetId) || 0) + 1);
  }
  const researcherThreshold = Math.floor(room.players.length / 2) + 1;
  for (const [targetId, n] of byTarget) {
    if (n >= researcherThreshold) {
      const target = playerById(room, targetId);
      room.cardResults.push({ kind: '研究員', targetId, role: target.role, text: `夜の行動後、${target.name}の役職は「${roleName(target.role)}」です。` });
    }
  }
  if (rows.filter(row => row.cardId === 'monk').length > room.players.length / 2) {
    const role = room.grave[below(room.grave.length)];
    room.cardResults.push({ kind: 'お坊さん', text: `墓場の役職を1枚確認しました：「${roleName(role)}」。` });
  }
  const activeWolf = room.players.find(player => WOLF_ROLES.has(player.role));
  const saviorActive = rows.filter(row => row.cardId === 'savior').length > room.players.length / 2;
  const wolfTeam = room.players.filter(player => WOLF_TEAM.has(player.role));
  const shadowActive = wolfTeam.length > 0 && wolfTeam.every(player => rows.some(row => row.player.id === player.id && row.cardId === 'shadow'));
  room.cardModifiers = { activeWolfId: activeWolf?.id || null, saviorActive, shadowActive };
  for (const player of room.players) {
    const submission = room.submissions.get(player.id);
    if (!submission) continue;
    if (submission.cardId === 'selfhelp') {
      player.cardInfo = {
        kind: '自己啓発',
        text: room.actionLog.some(row => row.targetId === player.id)
          ? '夜にあなたを対象にした能力がありました。'
          : '夜にあなたを対象にした能力はありませんでした。'
      };
    } else if (submission.cardId === 'scout') {
      player.cardInfo = { kind: '調査団', targetId: activeWolf?.id || null, text: activeWolf ? `現在の人狼は${activeWolf.name}です。` : '現在、人狼はいません。' };
    } else if (submission.cardId === 'reveal') {
      const wasWolf = WOLF_ROLES.has(player.originalRole);
      if (wasWolf) {
        player.cardInfo = { kind: '自己開示', text: '元の役職が人狼・大狼のため、このカードは使用できません。' };
        continue;
      }
      player.cardInfo = { kind: '自己開示', text: '元の役職は人狼・大狼ではありません。' };
      room.cardResults.push({ kind: '自己開示', text: `${player.name}は元の役職が人狼・大狼ではないと証明しました。` });
    }
  }
}

function resolveVotes(room) {
  const counts = Object.fromEntries(room.players.map(player => [player.id, 0]));
  counts.peace = 0;
  for (const [playerId, targetId] of room.votes) {
    const voter = playerById(room, playerId);
    counts[targetId] += voter.role === 'mayor' ? 2 : 1;
  }
  for (const [playerId, submission] of room.submissions) {
    if (submission.cardId === 'ballot' && submission.targetId) counts[submission.targetId] += 1;
  }
  const { activeWolfId, saviorActive, shadowActive } = room.cardModifiers || {};
  if (activeWolfId && saviorActive) counts[activeWolfId] += 1;
  if (activeWolfId && shadowActive) counts[activeWolfId] = Math.max(0, counts[activeWolfId] - 1);

  const playerCounts = room.players.map(player => counts[player.id]);
  const peaceOutcome = playerCounts.every(voteCount => voteCount === playerCounts[0]);
  const highest = Math.max(...Object.values(counts));
  let leaders = Object.entries(counts).filter(([, voteCount]) => voteCount === highest).map(([id]) => id);
  if (peaceOutcome) leaders = ['peace'];
  else if (leaders.includes('peace') && leaders.length > 1) leaders = leaders.filter(id => id !== 'peace');
  const executedIds = peaceOutcome ? [] : leaders.filter(id => id !== 'peace');
  const peaceVoted = !peaceOutcome && leaders.length === 1 && leaders[0] === 'peace';
  const wolves = room.players.filter(player => WOLF_ROLES.has(player.role));
  const teruteru = room.players.find(player => player.role === 'teruteru');
  const teruteruWon = !!teruteru && executedIds.includes(teruteru.id);
  const scoutSabotage = !!activeWolfId && [...room.submissions.entries()].some(([playerId, submission]) =>
    submission.cardId === 'scout' && room.votes.get(activeWolfId) === playerId
  );
  const winningSide = teruteruWon ? 'teruteru'
    : scoutSabotage || (wolves.length > 0 && (peaceOutcome || !wolves.every(player => executedIds.includes(player.id)))) ? 'wolf'
      : 'village';
  const scoreChanges = {};
  for (const player of room.players) {
    const wins = winningSide === 'teruteru' ? player.role === 'teruteru' && teruteruWon
      : winningSide === 'wolf' ? WOLF_TEAM.has(player.role)
        : !WOLF_TEAM.has(player.role) && player.role !== 'teruteru';
    scoreChanges[player.id] = wins ? 1 : 0;
    room.scores.set(player.id, (room.scores.get(player.id) || 0) + scoreChanges[player.id]);
  }
  room.outcome = { counts, leaders, executedIds, peaceOutcome, peaceVoted, winningSide, scoutSabotage, scoreChanges };
  room.phase = 'ending';
}

module.exports = {
  ROLES, CARDS, ROLE_BY_ID, CARD_BY_ID, WOLF_ROLES, WOLF_TEAM,
  shuffle, validateSetup, dealRoles, dealHands, getWolfAllies, resolveNight,
  resolveCardSubmissions, resolveVotes, roleName, cardName
};
