// Sessões persistentes: mantém histórico e metadados entre reinícios do CLI.
'use strict';

const crypto = require('crypto');
const path = require('path');
const { HOME_DIR } = require('./config');
const { lerJson, escreverJson } = require('./jsonStore');

const SESSIONS_PATH = path.join(HOME_DIR, 'sessions.json');
const VALID_HISTORY = (history) => Array.isArray(history) && history.every((m) =>
  m && typeof m === 'object' && ['user', 'model'].includes(m.role) && Array.isArray(m.parts));

function makeId() {
  return `ses_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function cleanName(name) {
  const value = String(name || '').trim().replace(/[\r\n\0]/g, ' ').slice(0, 100);
  return value || `Sessão ${new Date().toLocaleString('pt-BR')}`;
}

function createSessionStore({ dataPath = SESSIONS_PATH, clock = () => new Date() } = {}) {
  function read() {
    return lerJson(dataPath,
      (data) => data && data.version === 1 && Array.isArray(data.sessions)
        && (data.activeId === null || typeof data.activeId === 'string'),
      () => ({ version: 1, activeId: null, sessions: [] }));
  }
  function write(data) { escreverJson(dataPath, data); }
  function safeSummary(session) {
    return {
      id: session.id, name: session.name, cwd: session.cwd,
      createdAt: session.createdAt, updatedAt: session.updatedAt,
      modelName: session.modelName || null, messageCount: session.history.length,
    };
  }
  function create(name, { cwd = process.cwd(), modelName = null, history = [] } = {}) {
    if (!VALID_HISTORY(history)) throw new Error('Histórico da sessão inválido.');
    const data = read();
    const now = clock().toISOString();
    const session = {
      id: makeId(), name: cleanName(name), cwd: path.resolve(cwd),
      createdAt: now, updatedAt: now, modelName, history,
    };
    data.sessions.push(session);
    data.activeId = session.id;
    write(data);
    return session;
  }
  function list({ limit = 50 } = {}) {
    const cap = Number(limit);
    if (!Number.isInteger(cap) || cap < 1 || cap > 500) throw new Error('limit deve estar entre 1 e 500.');
    return read().sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, cap).map(safeSummary);
  }
  function get(id) {
    if (!id) return null;
    const data = read();
    const found = data.sessions.find((s) => s.id === id);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }
  function getActive() {
    const data = read();
    const found = data.sessions.find((s) => s.id === data.activeId);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }
  function setActive(id) {
    const data = read();
    if (!data.sessions.some((s) => s.id === id)) throw new Error(`Sessão não encontrada: ${id}`);
    data.activeId = id;
    write(data);
    return get(id);
  }
  function save(id, { history, modelName, name, cwd } = {}) {
    if (history !== undefined && !VALID_HISTORY(history)) throw new Error('Histórico da sessão inválido.');
    const data = read();
    const session = data.sessions.find((s) => s.id === id);
    if (!session) throw new Error(`Sessão não encontrada: ${id}`);
    if (history !== undefined) session.history = history;
    if (modelName !== undefined) session.modelName = modelName;
    if (name !== undefined) session.name = cleanName(name);
    if (cwd !== undefined) session.cwd = path.resolve(cwd);
    session.updatedAt = clock().toISOString();
    write(data);
    return JSON.parse(JSON.stringify(session));
  }
  function remove(id, { yes = false } = {}) {
    if (!yes) throw new Error('A exclusão exige confirmação explícita { yes: true }.');
    const data = read();
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((s) => s.id !== id);
    if (data.sessions.length === before) return false;
    if (data.activeId === id) data.activeId = data.sessions[0]?.id || null;
    write(data);
    return true;
  }
  return { create, list, get, getActive, setActive, save, remove, dataPath };
}

const defaultStore = createSessionStore();
module.exports = { SESSIONS_PATH, createSessionStore, ...defaultStore };
