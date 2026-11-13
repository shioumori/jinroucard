'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROLES, CARDS, shuffle, validateSetup, dealRoles, dealHands,
  getWolfAllies, resolveNight, resolveCardSubmissions, resolveVotes
} = require('../game-core');

function makeRoom(roleCounts, names = ['A', 'B', 'C', 'D', 'E']) {
  return {
    count: names.length, roleCounts,
    players: names.map((name, i) => ({ id: `p${i}`, name, host: i === 0, online: true })),
    scores: new Map(names.map((_, i) => [`p${i}`, 0])), round: 0, phase: 'lobby', actionLog: []
  };
}

function noSwap(max) { return max - 1; }
function reverseShuffle(max) { return 0; }
function seeded(seed) {
  return max => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % max;
  };
}

test('setup validates participant count and exactly two grave roles', () => {
  const counts = { villager: 3, wolf: 1, bigwolf: 0, madman: 1, seer: 1, mayor: 0, vampire: 0, doctor: 0, teruteru: 1 };
  assert.equal(validateSetup(5, counts), undefined);
  assert.throws(() => validateSetup(5, { ...counts, villager: 2 }), /合計7枚/);
  assert.throws(() => validateSetup(2, counts), /3〜8人/);
});

test('cryptographic Fisher-Yates can change ordering and role allocation preserves the full deck', () => {
  assert.deepEqual(shuffle([1, 2, 3, 4], noSwap), [1, 2, 3, 4]);
  assert.notDeepEqual(shuffle([1, 2, 3, 4], reverseShuffle), [1, 2, 3, 4]);
  const counts = { villager: 3, wolf: 1, bigwolf: 1, madman: 1, seer: 1, mayor: 0, vampire: 0, doctor: 0, teruteru: 0 };
  const room = makeRoom(counts, ['A', 'B', 'C', 'D', 'E']);
  dealRoles(room, reverseShuffle);
  assert.equal(room.players.length, 5);
  assert.equal(room.grave.length, 2);
  const allRoles = [...room.players.map(player => player.role), ...room.grave];
  for (const item of ROLES) assert.equal(allRoles.filter(id => id === item.id).length, counts[item.id] || 0);
  assert.equal(room.players.every(player => player.originalRole === player.role), true);
});

test('every player receives a random three-card hand with no duplicate type in that hand', () => {
  const room = makeRoom({});
  dealHands(room, seeded(91));
  for (const player of room.players) {
    assert.equal(player.hand.length, 3);
    assert.equal(new Set(player.hand.map(item => item.id)).size, 3);
    assert.equal(player.hand.every(item => CARDS.some(source => source.id === item.id)), true);
  }
  assert.notDeepEqual(room.players[0].hand.map(item => item.id), room.players[1].hand.map(item => item.id));
});

test('Wolf and Big Wolf see one another, while the Madman has no revealed allies', () => {
  const counts = { villager: 1, wolf: 1, bigwolf: 1, madman: 1, seer: 1, mayor: 0, vampire: 0, doctor: 1, teruteru: 0 };
  const room = makeRoom(counts, ['A', 'B', 'C', 'D']);
  dealRoles(room, noSwap);
  const wolf = room.players.find(player => player.role === 'wolf');
  const bigwolf = room.players.find(player => player.role === 'bigwolf');
  const madman = room.players.find(player => player.role === 'madman');
  assert.equal(wolf.knownAllies.some(player => player.id === bigwolf.id && player.role === 'bigwolf'), true);
  assert.equal(bigwolf.knownAllies.some(player => player.id === wolf.id && player.role === 'wolf'), true);
  assert.deepEqual(getWolfAllies(room, madman), []);
  assert.deepEqual(room.grave, ['seer', 'doctor']);
});

test('night actions resolve in stable seat order: seer, vampire, doctor', () => {
  const room = makeRoom({});
  room.players[0].role = 'seer';
  room.players[1].role = 'vampire';
  room.players[2].role = 'doctor';
  room.players[3].role = 'wolf';
  room.players[4].role = 'villager';
  room.nightActions = new Map([
    ['p0', { type: 'seer', targetId: 'p1' }],
    ['p1', { type: 'vampire', targetId: 'p3' }],
    ['p2', { type: 'doctor', targetId: 'p3' }]
  ]);
  resolveNight(room);
  assert.equal(room.players[0].nightInfo.role, 'vampire');
  assert.equal(room.players[1].role, 'wolf');
  assert.equal(room.players[3].role, 'villager');
  assert.deepEqual(room.actionLog.map(row => row.kind), ['占い', '交換', '治療']);
});

test('Vampire can choose either grave role; Doctor can choose clinic rest', () => {
  const vampireRoom = makeRoom({});
  vampireRoom.players[0].role = 'vampire';
  vampireRoom.grave = ['wolf', 'villager'];
  vampireRoom.nightActions = new Map([['p0', { type: 'vampire', targetId: 'grave:1' }]]);
  resolveNight(vampireRoom);
  assert.equal(vampireRoom.players[0].role, 'villager');
  assert.deepEqual(vampireRoom.grave, ['wolf', 'vampire']);
  assert.equal(vampireRoom.actionLog[0].graveIndex, 1);

  const doctorRoom = makeRoom({});
  doctorRoom.players[0].role = 'doctor';
  doctorRoom.players[1].role = 'wolf';
  doctorRoom.nightActions = new Map([['p0', { type: 'doctor', targetId: 'rest' }]]);
  resolveNight(doctorRoom);
  assert.equal(doctorRoom.players[1].role, 'wolf');
  assert.equal(doctorRoom.actionLog[0].kind, '休診');
});

test('Savior needs a strict participant majority and Shadow needs every current wolf-team member', () => {
  const room = makeRoom({});
  room.players.forEach((player, i) => { player.role = ['wolf', 'bigwolf', 'madman', 'villager', 'villager'][i]; });
  room.grave = ['seer', 'doctor'];
  room.submissions = new Map([
    ['p0', { cardId: 'shadow' }], ['p1', { cardId: 'shadow' }], ['p2', { cardId: 'shadow' }],
    ['p3', { cardId: 'savior' }], ['p4', { cardId: 'savior' }]
  ]);
  resolveCardSubmissions(room, noSwap);
  assert.equal(room.cardModifiers.saviorActive, false);
  assert.equal(room.cardModifiers.shadowActive, true);
  room.votes = new Map([['p0', 'p3'], ['p1', 'p4'], ['p2', 'p4'], ['p3', 'p0'], ['p4', 'p0']]);
  resolveVotes(room);
  assert.equal(room.outcome.counts.p0, 1);
  assert.equal(room.outcome.winningSide, 'wolf');
  assert.equal(room.outcome.scoreChanges.p2, 1);
});

test('Savior activates when three of five players submit it', () => {
  const room = makeRoom({});
  room.players.forEach((player, i) => { player.role = i === 0 ? 'wolf' : 'villager'; });
  room.grave = ['seer', 'doctor'];
  room.submissions = new Map([
    ['p0', { cardId: 'savior' }], ['p1', { cardId: 'savior' }], ['p2', { cardId: 'savior' }],
    ['p3', { cardId: 'monk' }], ['p4', { cardId: 'monk' }]
  ]);
  resolveCardSubmissions(room, noSwap);
  assert.equal(room.cardModifiers.saviorActive, true);
  room.votes = new Map([['p0', 'p1'], ['p1', 'p0'], ['p2', 'p0'], ['p3', 'p2'], ['p4', 'p3']]);
  resolveVotes(room);
  assert.equal(room.outcome.counts.p0, 3);
});

test('equal votes across all players make Peace Village; wolves win if present', () => {
  const room = makeRoom({});
  room.players.forEach((player, i) => { player.role = ['wolf', 'villager', 'teruteru', 'madman', 'seer'][i]; });
  room.submissions = new Map(); room.cardModifiers = {};
  room.votes = new Map(room.players.map((player, i) => [player.id, room.players[(i + 1) % room.players.length].id]));
  resolveVotes(room);
  assert.equal(room.outcome.peaceOutcome, true);
  assert.equal(room.outcome.executedIds.length, 0);
  assert.equal(room.outcome.winningSide, 'wolf');
  assert.equal(room.outcome.scoreChanges.p0, 1);
  assert.equal(room.outcome.scoreChanges.p2, 0);
});

test('equal votes without wolves give points to neither Teruteru nor Madman', () => {
  const room = makeRoom({});
  room.players.forEach((player, i) => { player.role = ['villager', 'teruteru', 'madman', 'seer', 'doctor'][i]; });
  room.submissions = new Map(); room.cardModifiers = {};
  room.votes = new Map(room.players.map((player, i) => [player.id, room.players[(i + 1) % room.players.length].id]));
  resolveVotes(room);
  assert.equal(room.outcome.peaceOutcome, true);
  assert.equal(room.outcome.winningSide, 'village');
  assert.equal(room.outcome.scoreChanges.p0, 1);
  assert.equal(room.outcome.scoreChanges.p1, 0);
  assert.equal(room.outcome.scoreChanges.p2, 0);
});
