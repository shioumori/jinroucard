'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomInt, randomUUID } = require('node:crypto');
const {
  ROLES, CARDS, ROLE_BY_ID, CARD_BY_ID, WOLF_ROLES,
  validateSetup, dealRoles, dealHands, getWolfAllies, resolveNight,
  resolveCardSubmissions, resolveVotes, roleName, cardName
} = require('./game-core');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const rooms = new Map();
const PUBLIC_FILES = new Set([
  'index.html', 'styles.css', 'app.js', 'assets/werewolf.png', 'assets/villager.png', 'assets/night-village.png', 'assets/day-village.png',
  ...ROLES.map(item => `assets/roles/${item.id}.png`), ...CARDS.map(item => `assets/cards/${item.id}.png`)
]);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY'
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('リクエストが大きすぎます。'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('送信データを読み取れませんでした。')); }
    });
    req.on('error', reject);
  });
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function newPlayer(name, host) {
  return {
    id: randomUUID(), token: randomBytes(32).toString('base64url'), name: String(name || '').trim().slice(0, 24) || 'プレイヤー',
    host, online: false, stream: null, role: null, originalRole: null, hand: [],
    actionSubmitted: false, cardSubmitted: false, voteSubmitted: false, nightInfo: null, cardInfo: null
  };
}

function findPlayer(room, token) {
  return room.players.find(player => player.token === token);
}

function ensureHost(room) {
  const host = room.players.find(player => player.host && player.online);
  if (host) return;
  for (const player of room.players) player.host = false;
  const replacement = room.players.find(player => player.online);
  if (replacement) replacement.host = true;
}

function publicState(room, viewer) {
  const ending = room.phase === 'ending';
  const everyoneReady = room.ready.size;
  const data = {
    code: room.code, phase: room.phase, round: room.round, count: room.count,
    discussionSeconds: room.discussionSeconds, phaseEndsAt: room.phaseEndsAt || null,
    roleCounts: room.roleCounts, players: room.players.map(player => ({
      id: player.id, name: player.name, online: player.online, isHost: player.host,
      ready: room.ready.has(player.id), submitted: player.cardSubmitted,
      actionSubmitted: player.actionSubmitted, voteSubmitted: player.voteSubmitted,
      role: ending ? player.role : undefined, originalRole: ending ? player.originalRole : undefined
    })),
    readyCount: everyoneReady, hostId: room.players.find(player => player.host)?.id,
    cardSubmittedCount: room.players.filter(player => player.cardSubmitted).length,
    actionSubmittedCount: room.players.filter(player => player.actionSubmitted).length,
    voteSubmittedCount: room.players.filter(player => player.voteSubmitted).length,
    cardResults: ['results', 'lastTalk', 'vote', 'ending'].includes(room.phase) ? room.cardResults : [],
    publicCards: ['results', 'lastTalk', 'vote', 'ending'].includes(room.phase) ? room.publicCards : [],
    messages: room.messages.filter(message => message.round === room.round),
    scores: Object.fromEntries(room.scores)
  };
  if (ending && room.outcome) {
    data.outcome = {
      counts: room.outcome.counts,
      leaders: room.outcome.leaders,
      executedIds: room.outcome.executedIds,
      peaceOutcome: room.outcome.peaceOutcome,
      peaceVoted: room.outcome.peaceVoted,
      winningSide: room.outcome.winningSide,
      scoutSabotage: room.outcome.scoutSabotage,
      grave: room.grave,
      report: room.players.map(player => ({
        playerId: player.id, name: player.name, role: player.role, originalRole: player.originalRole,
        cardId: room.submissions.get(player.id)?.cardId || null,
        cardTargetId: room.submissions.get(player.id)?.targetId || null,
        voteTargetId: room.votes.get(player.id) || null,
        scoreChange: room.outcome.scoreChanges[player.id] || 0,
        totalScore: room.scores.get(player.id) || 0
      })),
      actionLog: room.actionLog.map(row => ({ ...row }))
    };
  }
  const ownSubmission = room.submissions.get(viewer.id);
  data.private = {
    playerId: viewer.id, name: viewer.name, token: viewer.token, isHost: viewer.host,
    role: viewer.role, originalRole: viewer.originalRole,
    allies: viewer.knownAllies || [],
    grave: viewer.originalRole === 'bigwolf' && !ending ? room.grave : undefined,
    hand: viewer.hand,
    nightInfo: viewer.nightInfo,
    ownActions: room.actionLog.filter(row => row.actorId === viewer.id).map(row => ({ ...row })),
    cardInfo: viewer.cardInfo,
    submittedCardId: ownSubmission?.cardId || null,
    submittedCardTargetId: ownSubmission?.targetId || null,
    ownVote: room.votes.get(viewer.id) || null,
    ownActionSubmitted: viewer.actionSubmitted,
    ownCardSubmitted: viewer.cardSubmitted,
    ownVoteSubmitted: viewer.voteSubmitted
  };
  return data;
}

function pushPlayer(room, player) {
  if (!player.stream || player.stream.destroyed) return;
  player.stream.write(`event: state\ndata: ${JSON.stringify(publicState(room, player))}\n\n`);
}

function broadcast(room) {
  room.lastActivity = Date.now();
  ensureHost(room);
  for (const player of room.players) pushPlayer(room, player);
}

function sendError(res, message, status = 400) {
  json(res, status, { error: message });
}

function connectStream(req, res, url) {
  const room = rooms.get(url.searchParams.get('room'));
  const player = room && findPlayer(room, url.searchParams.get('token'));
  if (!room || !player) return sendError(res, '部屋または参加者が見つかりません。', 404);
  if (player.stream && player.stream !== res) player.stream.end();
  player.online = true;
  player.stream = res;
  ensureHost(room);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY'
  });
  res.write('retry: 1500\n\n');
  pushPlayer(room, player);
  broadcast(room);
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keep-alive\n\n'); }, 20000);
  res.on('close', () => {
    clearInterval(heartbeat);
    if (player.stream === res) {
      player.stream = null;
      player.online = false;
      broadcast(room);
    }
  });
}

function joinRoom(body) {
  const code = String(body.code ?? '');
  if (!code.length) throw new Error('部屋コードを入力してください。');
  const room = rooms.get(code);
  if (!room) throw new Error('部屋が見つかりません。');
  const existing = body.token && findPlayer(room, body.token);
  if (existing) return { room, player: existing };
  if (room.phase !== 'lobby') throw new Error('この試合はすでに始まっています。');
  if (room.players.length >= room.count) throw new Error('この部屋は満員です。');
  const player = newPlayer(body.name, false);
  if (room.players.some(existing => existing.name.toLocaleLowerCase() === player.name.toLocaleLowerCase())) {
    throw new Error('同じ名前の参加者がいます。別の名前にしてください。');
  }
  room.players.push(player);
  room.scores.set(player.id, 0);
  return { room, player };
}

function resetRound(room) {
  clearPhaseTimer(room);
  room.ready.clear(); room.nightActions.clear(); room.submissions.clear(); room.votes.clear();
  room.cardResults = []; room.publicCards = []; room.actionLog = []; room.outcome = null; room.cardModifiers = null;
  room.messages = [];
  for (const player of room.players) {
    player.role = null; player.originalRole = null; player.hand = [];
    player.actionSubmitted = false; player.cardSubmitted = false; player.voteSubmitted = false;
    player.nightInfo = null; player.cardInfo = null; player.knownAllies = [];
  }
}

function allReady(room) {
  return room.ready.size === room.players.length;
}

function clearPhaseTimer(room) {
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
  room.phaseEndsAt = null;
}

function startDiscussionTimer(room, phase) {
  clearPhaseTimer(room);
  const seconds = room.discussionSeconds?.[phase] || 0;
  if (!seconds) return;
  room.phaseEndsAt = Date.now() + seconds * 1000;
  room.phaseTimer = setTimeout(() => {
    if (room.phase !== phase) return;
    room.ready.clear();
    room.phase = phase === 'morning' ? 'cards' : 'vote';
    clearPhaseTimer(room);
    broadcast(room);
  }, seconds * 1000);
}

function advanceReadyPhase(room, player) {
  if (room.ready.has(player.id)) return;
  room.ready.add(player.id);
  if (!allReady(room)) return;
  room.ready.clear();
  const previous = room.phase;
  clearPhaseTimer(room);
  if (previous === 'role') room.phase = 'night';
  else if (previous === 'dealing') room.phase = 'morning';
  else if (previous === 'morning') room.phase = 'cards';
  else if (previous === 'results') room.phase = 'lastTalk';
  else if (previous === 'lastTalk') room.phase = 'vote';
  if (['morning', 'lastTalk'].includes(room.phase)) startDiscussionTimer(room, room.phase);
}

function validateNightChoice(room, player, choice) {
  const role = player.role;
  if (['seer', 'vampire', 'doctor'].includes(role) && !choice) throw new Error('夜の行動を選んでください。');
  if (!['seer', 'vampire', 'doctor'].includes(role)) return { type: 'pass' };
  if (role === 'doctor' && choice.targetId === 'rest') return { type: 'doctor', targetId: 'rest' };
  if (role === 'vampire' && ['grave:0', 'grave:1'].includes(choice.targetId)) return { type: 'vampire', targetId: choice.targetId };
  const target = room.players.find(item => item.id === choice.targetId && item.id !== player.id);
  if (!target) throw new Error('対象のプレイヤーを選んでください。');
  return { type: role, targetId: target.id };
}

function submitCard(room, player, body) {
  if (player.cardSubmitted) throw new Error('カードは提出済みです。');
  const card = player.hand.find(item => item.id === body.cardId);
  if (!card) throw new Error('手札からカードを選んでください。');
  if (card.id === 'reveal' && ['wolf', 'bigwolf'].includes(player.originalRole)) throw new Error('人狼・大狼は自己開示を使用できません。');
  let targetId = null;
  if (['researcher', 'ballot'].includes(card.id)) {
    const target = room.players.find(item => item.id === body.targetId);
    if (!target) throw new Error('カードの対象を選んでください。');
    targetId = target.id;
  }
  player.cardSubmitted = true;
  room.submissions.set(player.id, { cardId: card.id, targetId });
  if (room.players.every(item => item.cardSubmitted)) {
    resolveCardSubmissions(room);
    room.phase = 'results';
    room.ready.clear();
  }
}

function submitVote(room, player, targetId) {
  if (player.voteSubmitted) throw new Error('投票済みです。');
  const validTarget = targetId === 'peace' || room.players.some(item => item.id === targetId);
  if (!validTarget) throw new Error('投票先を選んでください。');
  player.voteSubmitted = true;
  room.votes.set(player.id, targetId);
  if (room.players.every(item => item.voteSubmitted)) resolveVotes(room);
}

function applyAction(room, player, body) {
  const action = body.action;
  if (action === 'chat') {
    if (!['morning', 'lastTalk'].includes(room.phase)) throw new Error('今は会議チャットを送信できません。');
    const text = String(body.message ?? '').trim();
    if (!text || text.length > 300) throw new Error('メッセージは1〜300文字で入力してください。');
    room.messages.push({ playerId: player.id, name: player.name, text, phase: room.phase, round: room.round, at: Date.now() });
    if (room.messages.length > 100) room.messages.splice(0, room.messages.length - 100);
    return;
  }
  switch (action) {
    case 'start': {
      if (!player.host || room.phase !== 'lobby') throw new Error('ホストだけが試合を開始できます。');
      if (room.players.length !== room.count || room.players.some(item => !item.online)) throw new Error('設定した人数が全員オンラインになると開始できます。');
      resetRound(room);
      dealRoles(room);
      return;
    }
    case 'settings': {
      if (!player.host || room.phase !== 'lobby') throw new Error('ロビーでホストだけが設定できます。');
      validateSetup(body.count, body.roleCounts);
      if (room.players.length > body.count) throw new Error('参加人数より少ない人数には変更できません。');
      room.count = body.count;
      room.roleCounts = Object.fromEntries(ROLES.map(role => [role.id, body.roleCounts[role.id] || 0]));
      const discussionSeconds = body.discussionSeconds || {};
      for (const phase of ['morning', 'lastTalk']) {
        const seconds = Number(discussionSeconds[phase] ?? room.discussionSeconds?.[phase] ?? 120);
        if (!Number.isInteger(seconds) || seconds < 30 || seconds > 600 || seconds % 30 !== 0) throw new Error('会議時間は30秒〜10分、30秒刻みで設定してください。');
      }
      room.discussionSeconds = {
        morning: Number(discussionSeconds.morning ?? room.discussionSeconds?.morning ?? 120),
        lastTalk: Number(discussionSeconds.lastTalk ?? room.discussionSeconds?.lastTalk ?? 120)
      };
      return;
    }
    case 'ready': {
      if (!['role', 'dealing', 'morning', 'results', 'lastTalk'].includes(room.phase)) throw new Error('今は確認操作を行えません。');
      advanceReadyPhase(room, player);
      return;
    }
    case 'night': {
      if (room.phase !== 'night' || player.actionSubmitted) throw new Error('夜の行動は送信済みか、受付時間外です。');
      const choice = validateNightChoice(room, player, body.choice);
      room.nightActions.set(player.id, choice);
      player.actionSubmitted = true;
      if (room.players.every(item => item.actionSubmitted)) {
        resolveNight(room);
        dealHands(room);
        room.phase = 'dealing';
      }
      return;
    }
    case 'card':
      if (room.phase !== 'cards') throw new Error('カード提出の時間ではありません。');
      submitCard(room, player, body);
      return;
    case 'vote':
      if (room.phase !== 'vote') throw new Error('投票時間ではありません。');
      submitVote(room, player, body.targetId);
      return;
    case 'rematch':
      if (!player.host || room.phase !== 'ending') throw new Error('ホストだけが次の試合を準備できます。');
      resetRound(room);
      room.phase = 'lobby';
      return;
    default:
      throw new Error('対応していない操作です。');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const room = rooms.get(url.searchParams.get('room'));
    const player = room && findPlayer(room, url.searchParams.get('token'));
    return player ? json(res, 200, { ok: true }) : sendError(res, '部屋への参加情報が見つかりません。', 404);
  }
  if (req.method === 'GET' && url.pathname === '/events') return connectStream(req, res, url);
  if (req.method === 'POST' && ['/api/create', '/api/join', '/api/action'].includes(url.pathname)) {
    let body;
    try { body = await readJson(req); } catch (error) { return sendError(res, error.message); }
    try {
      if (url.pathname === '/api/create') {
        validateSetup(body.count, body.roleCounts);
        const code = body.code === undefined || body.code === '' ? makeCode() : String(body.code);
        if (rooms.has(code)) throw new Error('この部屋コードはすでに使用されています。');
        const room = {
          code, count: body.count, roleCounts: Object.fromEntries(ROLES.map(role => [role.id, body.roleCounts[role.id] || 0])),
          players: [], scores: new Map(), phase: 'lobby', round: 0, ready: new Set(),
          nightActions: new Map(), submissions: new Map(), votes: new Map(), actionLog: [], cardResults: [], publicCards: [], messages: [], discussionSeconds: { morning: 120, lastTalk: 120 }, phaseTimer: null, phaseEndsAt: null, createdAt: Date.now(), lastActivity: Date.now()
        };
        const player = newPlayer(body.name, true);
        room.players.push(player); room.scores.set(player.id, 0); rooms.set(code, room);
        return json(res, 201, { code, token: player.token, playerId: player.id });
      }
      if (url.pathname === '/api/join') {
        const { room, player } = joinRoom(body);
        return json(res, 200, { code: room.code, token: player.token, playerId: player.id });
      }
      const room = rooms.get(String(body.code ?? ''));
      const player = room && findPlayer(room, body.token);
      if (!room || !player) throw new Error('部屋への参加情報が確認できません。', { cause: 401 });
      applyAction(room, player, body);
      broadcast(room);
      return json(res, 200, { ok: true });
    } catch (error) {
      const status = error.cause === 401 ? 401 : 400;
      return sendError(res, error.message, status);
    }
  }
  if (req.method !== 'GET') return sendError(res, 'この操作はサポートされていません。', 405);
  let decoded;
  try { decoded = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, ''); }
  catch { return sendError(res, 'ファイルが見つかりません。', 404); }
  if (!PUBLIC_FILES.has(decoded)) return sendError(res, 'ファイルが見つかりません。', 404);
  const file = path.resolve(ROOT, decoded);
  fs.readFile(file, (error, contents) => {
    if (error) return sendError(res, 'ファイルが見つかりません。', 404);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    res.end(contents);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (!res.headersSent) sendError(res, 'サーバーで問題が発生しました。', 500);
      else res.end();
      if (process.env.NODE_ENV !== 'test') console.error(error);
    });
  });
}

if (require.main === module) {
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    for (const [code, room] of rooms) {
      if (room.lastActivity < cutoff && room.players.every(player => !player.online)) rooms.delete(code);
    }
  }, 10 * 60 * 1000);
  cleanup.unref();
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => console.log(`夜明け前 server listening on ${PORT}`));
}

module.exports = { createServer, rooms, publicState, applyAction };
