// Executor e agendador persistente para as rotinas aprovadas do gemini-code.
'use strict';

const crypto = require('crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { STATUSES, DEFAULT_TIMEZONE } = require('./routines');

function zonedMinuteKey(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function privateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0) || a >= 224;
  }
  if (version === 6) {
    // v0.41.0: comparar prefixos de TEXTO deixava passar IPv4 embutido em IPv6 — NAT64
    // (64:ff9b::7f00:1 = 127.0.0.1; comum em rede móvel IPv6), IPv4-compatível (::7f00:1),
    // 6to4 (2002:0a00:0001::) e formas expandidas (0:0:0:0:0:0:0:1). Agora o endereço é
    // expandido em 8 blocos e o IPv4 embutido passa pela mesma regra do IPv4.
    const h = blocosIpv6(address);
    const v4 = (x, y) => `${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`;
    const zerosAte = (n) => h.slice(0, n).every((v) => v === 0);
    if (zerosAte(6)) return privateAddress(v4(h[6], h[7])); // ::, ::1, ::a.b.c.d
    if (zerosAte(5) && h[5] === 0xffff) return privateAddress(v4(h[6], h[7])); // ::ffff:a.b.c.d
    if (zerosAte(4) && h[4] === 0xffff && h[5] === 0) return privateAddress(v4(h[6], h[7])); // SIIT
    if (h[0] === 0x64 && h[1] === 0xff9b) {
      if (h[2] === 1) return true; // 64:ff9b:1::/48, NAT64 de uso local
      if (h.slice(2, 6).every((v) => v === 0)) return privateAddress(v4(h[6], h[7])); // 64:ff9b::/96
    }
    if (h[0] === 0x2002) return privateAddress(v4(h[1], h[2])); // 6to4
    const p = h[0];
    return (p & 0xfe00) === 0xfc00 // fc00::/7 (ULA)
      || (p & 0xffc0) === 0xfe80 // fe80::/10 (link-local)
      || (p & 0xffc0) === 0xfec0 // fec0::/10 (site-local, obsoleto)
      || (p & 0xff00) === 0xff00 // ff00::/8 (multicast)
      || (p === 0x2001 && (h[1] === 0x0db8 || h[1] === 0)); // documentação e Teredo (IPv4 ofuscado)
  }
  return true;
}

/** "::ffff:1.2.3.4", "fe80::1%eth0", "0:0:0:0:0:0:0:1" -> 8 números de 16 bits. */
function blocosIpv6(endereco) {
  let s = String(endereco).toLowerCase();
  const zona = s.indexOf('%');
  if (zona >= 0) s = s.slice(0, zona);
  const m = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) s = `${m[1]}${((m[2] << 8) | m[3]).toString(16)}:${((m[4] << 8) | m[5]).toString(16)}`;
  const temDuplo = s.includes('::');
  const [cabeca, cauda] = temDuplo ? s.split('::') : [s, ''];
  const a = cabeca ? cabeca.split(':') : [];
  const b = temDuplo && cauda ? cauda.split(':') : [];
  const zeros = temDuplo ? Math.max(0, 8 - a.length - b.length) : 0;
  return [...a, ...Array(zeros).fill('0'), ...b].slice(0, 8).map((x) => parseInt(x || '0', 16) || 0);
}

async function ensurePublicTarget(urlString, allowPrivateTargets = false) {
  if (allowPrivateTargets) return;
  const url = new URL(urlString);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Destino local bloqueado por segurança. Defina ROUTINE_ALLOW_PRIVATE_TARGETS=1 somente em ambiente confiável.');
  }
  if (net.isIP(hostname)) {
    if (privateAddress(hostname)) throw new Error('Destino IP privado/reservado bloqueado por segurança.');
    return;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => privateAddress(record.address))) {
    throw new Error('O host resolve para um IP privado/reservado; verificação bloqueada por segurança.');
  }
}

async function executeHttpCheck(action, { allowPrivateTargets = process.env.ROUTINE_ALLOW_PRIVATE_TARGETS === '1' } = {}) {
  await ensurePublicTarget(action.url, allowPrivateTargets);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), action.timeoutMs);
  const started = Date.now();
  try {
    // v0.41.0: DNS fixado no endereço conferido (src/redeSegura.js); o fetch global resolvia de novo ao
    // conectar (DNS rebinding). Não segue redirecionamento, como antes (redirect: 'manual').
    const response = await require('./redeSegura').fetchComDnsFixado(action.url, {
      signal: controller.signal, permitirPrivado: allowPrivateTargets,
      headers: { 'user-agent': 'gemini-code-routine-monitor/1.0', accept: '*/*' },
    });
    const durationMs = Date.now() - started;
    const expected = action.expectedStatus === null ? (response.status >= 200 && response.status < 300) : response.status === action.expectedStatus;
    try { await response.body?.cancel(); } catch { /* corpo descartado: não afeta o resultado da verificação */ }
    const result = {
      ok: expected, statusCode: response.status, durationMs,
      url: action.url, checkedAt: new Date().toISOString(),
      message: expected ? 'Verificação HTTP aprovada.' : `Status HTTP inesperado: ${response.status}.`,
    };
    if (!expected) {
      const err = new Error(result.message);
      err.result = result;
      throw err;
    }
    return result;
  } catch (err) {
    if (err.result) throw err;
    const message = err.name === 'AbortError' || controller.signal.aborted ? `Timeout após ${action.timeoutMs} ms.` : err.message;
    const wrapped = new Error(message);
    wrapped.result = { ok: false, url: action.url, durationMs: Date.now() - started, checkedAt: new Date().toISOString(), message };
    throw wrapped;
  } finally { clearTimeout(timer); }
}

function createRoutineRunner({ store, maxRetries = 2, baseRetryMs = 500, now = () => new Date(), allowPrivateTargets = process.env.ROUTINE_ALLOW_PRIVATE_TARGETS === '1' } = {}) {
  if (!store) throw new Error('O executor precisa de um armazenamento de rotinas.');
  const inFlight = new Set();

  async function execute(id, { source = 'manual' } = {}) {
    if (inFlight.has(id)) throw new Error('Esta rotina já está em execução.');
    const routine = store.get(id);
    if (!routine) throw new Error('Rotina não encontrada.');
    inFlight.add(id);
    const execution = store.appendExecution({
      id: crypto.randomUUID(), routineId: id, routineName: routine.name, source,
      status: 'em_execucao', startedAt: now().toISOString(), finishedAt: null,
      attempts: [], result: null, error: null,
    });
    const priorStatus = routine.status;
    if (priorStatus !== STATUSES.PAUSED) store.update(id, { status: STATUSES.RUNNING });
    try {
      let result;
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (routine.action.type === 'http-check') result = await executeHttpCheck(routine.action, { allowPrivateTargets });
          else throw new Error(`Executor não implementado: ${routine.action.type}`);
          execution.attempts.push({ number: attempt + 1, ok: true, finishedAt: now().toISOString() });
          break;
        } catch (err) {
          lastError = err;
          execution.attempts.push({ number: attempt + 1, ok: false, error: err.message, finishedAt: now().toISOString() });
          // Falha HTTP ou timeout pode ser transitória; retentativa limitada.
          if (attempt < maxRetries) await new Promise((resolve) => setTimeout(resolve, baseRetryMs * (2 ** attempt)));
        }
      }
      if (lastError && !result) {
        const errorResult = lastError.result || { ok: false, message: lastError.message };
        store.updateExecution(execution.id, { status: 'falhou', finishedAt: now().toISOString(), attempts: execution.attempts, result: errorResult, error: lastError.message });
        const current = store.get(id);
        if (current) {
          const failurePatch = { lastRunAt: now().toISOString(), lastResult: { ok: false, message: lastError.message } };
          if (current.status !== STATUSES.PAUSED) failurePatch.status = priorStatus === STATUSES.DRAFT ? STATUSES.DRAFT : STATUSES.FAILED;
          store.update(id, failurePatch);
          if (priorStatus === STATUSES.ACTIVE && routine.trigger.type === 'interval') {
            const delay = routine.trigger.intervalMs;
            store.update(id, { nextRunAt: new Date(now().getTime() + delay).toISOString() });
          }
        }
        return { ...execution, status: 'falhou', result: errorResult, error: lastError.message };
      }
      store.updateExecution(execution.id, { status: 'concluida', finishedAt: now().toISOString(), attempts: execution.attempts, result, error: null });
      const current = store.get(id);
      if (current && current.status !== STATUSES.PAUSED) {
        const isOnce = routine.trigger.type === 'once';
        const patch = { lastRunAt: now().toISOString(), lastResult: result };
        if (current.status !== STATUSES.PAUSED) patch.status = isOnce ? STATUSES.COMPLETED : (priorStatus === STATUSES.DRAFT ? STATUSES.DRAFT : STATUSES.ACTIVE);
        if (routine.trigger.type === 'interval') patch.nextRunAt = new Date(now().getTime() + routine.trigger.intervalMs).toISOString();
        if (routine.trigger.type === 'cron') {
          // O tick grava lastCronSlotKey antes da execução para tornar o disparo idempotente.
          // A próxima execução é a próxima coincidência cron após o término.
          const { nextCronDate } = require('./routines');
          patch.nextRunAt = nextCronDate(routine.trigger.expression, now(), routine.trigger.timezone);
        }
        if (current.status !== STATUSES.PAUSED && isOnce) patch.nextRunAt = null;
        store.update(id, patch);
      }
      return { ...execution, status: 'concluida', result, attempts: execution.attempts };
    } finally {
      inFlight.delete(id);
    }
  }

  async function tick() {
    const due = store.due(now());
    const available = Math.max(0, 3 - inFlight.size);
    const selected = due.slice(0, available);
    await Promise.all(selected.map(async (routine) => {
      if (routine.trigger.type === 'cron') {
        store.update(routine.id, { lastCronSlotKey: zonedMinuteKey(now(), routine.trigger.timezone) });
      }
      try { await execute(routine.id, { source: 'agendador' }); }
      catch (err) { console.error(`[rotinas] Falha ao executar ${routine.id}: ${err.message}`); }
    }));
    return selected.length;
  }

  function start({ pollIntervalMs = 15000, onTick } = {}) {
    let stopped = false;
    let ticking = false;
    if (typeof store.recoverInterrupted === 'function') {
      const recovered = store.recoverInterrupted(now());
      if (recovered) console.log(`[rotinas] ${recovered} rotina(s) interrompida(s) recuperada(s).`);
    }
    const poll = async () => {
      if (stopped || ticking) return;
      ticking = true;
      try { const count = await tick(); if (onTick) onTick({ count, at: now().toISOString() }); }
      catch (err) { console.error(`[rotinas] Erro do agendador: ${err.message}`); }
      finally { ticking = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, pollIntervalMs);
    if (timer.unref) timer.unref();
    return { stop() { stopped = true; clearInterval(timer); }, tick: poll };
  }
  return { execute, tick, start, inFlight };
}

module.exports = { createRoutineRunner, executeHttpCheck, ensurePublicTarget, privateAddress, zonedMinuteKey };
