'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

class StateStream {
  constructor(response) {
    this.abortController = new AbortController();
    this.states = [];
    this.waiters = [];
    this.reader = response.body.getReader();
    this.run();
  }
  async run() {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find(line => line.startsWith('data: '));
          if (!dataLine) continue;
          const state = JSON.parse(dataLine.slice(6));
          this.states.push(state);
          this.waiters = this.waiters.filter(waiter => {
            if (!waiter.predicate(state)) return true;
            clearTimeout(waiter.timer);
            waiter.resolve(state);
            return false;
          });
        }
      }
    } catch { /* closed by test cleanup */ }
  }
  waitFor(predicate, timeout = 2500) {
    const found = [...this.states].reverse().find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        reject(new Error('サーバーの状態更新を待機中にタイムアウトしました。'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }
  close() { this.abortController.abort(); }
}

test('HTTP/SSE multiplayer flow keeps private roles and hands isolated through the result report', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    await new Promise(resolve => server.close(resolve));
  });
  const post = async (path, data) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    assert.equal(response.ok, true, result.error);
    return result;
  };
  const sourceResponse = await fetch(`${base}/app.js`);
  assert.equal(sourceResponse.status, 200);
  const privateSourceResponse = await fetch(`${base}/server.js`);
  assert.equal(privateSourceResponse.status, 404, 'server source must not be served to browsers');
  const open = async (code, token) => {
    const abortController = new AbortController();
    const response = await fetch(`${base}/events?room=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`, { signal: abortController.signal });
    assert.equal(response.ok, true);
    const stream = new StateStream(response);
    stream.abortController = abortController;
    clients.push(stream);
    return stream;
  };

  const roleCounts = { villager: 1, wolf: 1, bigwolf: 0, madman: 0, seer: 1, mayor: 0, vampire: 0, doctor: 1, teruteru: 1 };
  const host = await post('/api/create', { name: 'ホスト', code: `test-${Date.now()}`, count: 3, roleCounts });
  const players = [host];
  for (const name of ['参加者A', '参加者B']) players.push(await post('/api/join', { name, code: host.code }));
  const streams = await Promise.all(players.map(player => open(host.code, player.token)));
  await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'lobby')));

  await post('/api/action', { code: host.code, token: host.token, action: 'start' });
  const roleStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'role')));
  assert.equal(roleStates.every(value => value.private.role), true);
  assert.equal(roleStates.every(value => value.players.every(player => !Object.hasOwn(player, 'role'))), true, 'live public player list must not expose roles');

  for (const value of roleStates) await post('/api/action', { code: host.code, token: value.private.token, action: 'ready' });
  const nightStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'night')));
  const actions = nightStates.map(value => {
    const role = value.private.role;
    const other = value.players.find(player => player.id !== value.private.playerId);
    if (role === 'seer') return { type: 'seer', targetId: other.id };
    if (role === 'doctor') return { type: 'doctor', targetId: 'rest' };
    if (role === 'vampire') return { type: 'vampire', targetId: 'grave' };
    return { type: 'pass' };
  });
  for (let i = 0; i < nightStates.length; i++) await post('/api/action', { code: host.code, token: nightStates[i].private.token, action: 'night', choice: actions[i] });
  const dealingStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'dealing')));
  for (const value of dealingStates) {
    assert.equal(value.private.hand.length, 3);
    assert.equal(new Set(value.private.hand.map(item => item.id)).size, 3);
    assert.equal(value.publicCards.length, 0);
  }

  for (const value of dealingStates) await post('/api/action', { code: host.code, token: value.private.token, action: 'ready' });
  const morningStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'morning')));
  await post('/api/action', { code: host.code, token: host.token, action: 'chat', message: '朝のチャット確認' });
  const chattedStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.messages.some(message => message.text === '朝のチャット確認'))));
  assert.equal(chattedStates.every(value => value.messages.some(message => message.name === 'ホスト')), true);
  for (const value of chattedStates) await post('/api/action', { code: host.code, token: value.private.token, action: 'ready' });
  const cardStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'cards')));
  for (const value of cardStates) {
    const choice = value.private.hand[0];
    const targetId = ['researcher', 'ballot'].includes(choice.id) ? value.players.find(player => player.id !== value.private.playerId).id : undefined;
    await post('/api/action', { code: host.code, token: value.private.token, action: 'card', cardId: choice.id, targetId });
  }
  const resultStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'results')));
  assert.equal(resultStates.every(value => value.publicCards.length === 3), true);
  assert.equal(resultStates.every(value => value.publicCards.every(item => !Object.hasOwn(item, 'playerId'))), true, 'card owners remain hidden before the final reveal');

  for (const value of resultStates) await post('/api/action', { code: host.code, token: value.private.token, action: 'ready' });
  const discussionStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'lastTalk')));
  for (const value of discussionStates) await post('/api/action', { code: host.code, token: value.private.token, action: 'ready' });
  const voteStates = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'vote')));
  for (let i = 0; i < voteStates.length; i++) {
    const value = voteStates[i];
    await post('/api/action', { code: host.code, token: value.private.token, action: 'vote', targetId: value.players[(i + 1) % value.players.length].id });
  }
  const endings = await Promise.all(streams.map(stream => stream.waitFor(value => value.phase === 'ending')));
  assert.equal(endings.every(value => value.outcome.report.length === 3), true);
  assert.equal(endings.every(value => value.outcome.report.every(row => row.cardId && row.voteTargetId)), true);
  assert.equal(endings.every(value => Array.isArray(value.outcome.grave) && value.outcome.grave.length === 2), true);
});
