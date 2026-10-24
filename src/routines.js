// Núcleo persistente de rotinas. A persistência é local ao host que executa
// o serviço; para execução fora da sessão/dispositivo, implante o serviço.
'use strict';

const path = require('path');
const crypto = require('crypto');
const { HOME_DIR, ROUTINES_PATH } = require('./config');
const { lerJson, escreverJson } = require('./jsonStore');

const EXECUTIONS_PATH = path.join(HOME_DIR, 'routine-executions.json');
const DEFAULT_TIMEZONE = 'America/Recife';
const STATUSES = Object.freeze({
  DRAFT: 'rascunho', ACTIVE: 'ativa', RUNNING: 'em_execucao', WAITING: 'aguardando_evento',
  PAUSED: 'pausada', COMPLETED: 'concluida', FAILED: 'falhou', APPROVAL: 'requer_autorizacao',
});
const VALID_STATUSES = new Set(Object.values(STATUSES));

function validarFuso(timeZone = DEFAULT_TIMEZONE) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) throw new Error('Informe um fuso horário válido.');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); }
  catch { throw new Error(`Fuso horário inválido: ${timeZone}`); }
  return timeZone;
}

function parseCronField(field, min, max, name) {
  if (typeof field !== 'string' || !field) throw new Error(`Campo cron inválido: ${name}`);
  const values = new Set();
  for (const part of field.split(',')) {
    if (!part) throw new Error(`Campo cron inválido: ${name}`);
    const [base, stepText, ...extra] = part.split('/');
    if (extra.length || (stepText !== undefined && !/^\d+$/.test(stepText))) {
      throw new Error(`Passo cron inválido no campo ${name}`);
    }
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) throw new Error(`Passo cron fora do limite no campo ${name}`);
    let start; let end;
    if (base === '*') { start = min; end = max; }
    else if (/^\d+$/.test(base)) {
      start = Number(base); end = stepText === undefined ? start : max;
    } else {
      const match = base.match(/^(\d+)-(\d+)$/);
      if (!match) throw new Error(`Valor cron inválido no campo ${name}: ${base}`);
      start = Number(match[1]); end = Number(match[2]);
    }
    if (start < min || start > max || end < min || end > max || start > end) {
      throw new Error(`Valor cron fora do limite no campo ${name}: ${base}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

function parseCron(expression) {
  if (typeof expression !== 'string' || expression.trim().split(/\s+/).length !== 5) {
    throw new Error('Cron deve ter cinco campos: minuto hora dia-do-mês mês dia-da-semana.');
  }
  const parts = expression.trim().split(/\s+/);
  const rawWeekday = parseCronField(parts[4], 0, 7, 'dia da semana');
  return {
    expression: expression.trim(),
    minute: parseCronField(parts[0], 0, 59, 'minuto'),
    hour: parseCronField(parts[1], 0, 23, 'hora'),
    day: parseCronField(parts[2], 1, 31, 'dia do mês'),
    month: parseCronField(parts[3], 1, 12, 'mês'),
    weekday: new Set([...rawWeekday].map((value) => value === 7 ? 0 : value)),
    dayWildcard: parts[2] === '*',
    weekdayWildcard: parts[4] === '*',
  };
}

const FORMATTERS = new Map();
function formatterFor(timeZone) {
  if (!FORMATTERS.has(timeZone)) FORMATTERS.set(timeZone, new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23',
  }));
  return FORMATTERS.get(timeZone);
}

function partesNoFuso(date, timeZone, formatter = formatterFor(timeZone)) {
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[values.weekday];
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), weekday,
  };
}

function cronMatchesParsed(cron, date, timeZone, formatter) {
  const p = partesNoFuso(date, timeZone, formatter);
  const dayMatches = cron.day.has(p.day);
  const weekdayMatches = cron.weekday.has(p.weekday);
  const calendarDayMatches = cron.dayWildcard ? weekdayMatches
    : cron.weekdayWildcard ? dayMatches : (dayMatches || weekdayMatches);
  return cron.minute.has(p.minute) && cron.hour.has(p.hour)
    && cron.month.has(p.month) && calendarDayMatches;
}

function cronMatches(expression, date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const timezone = validarFuso(timeZone);
  return cronMatchesParsed(parseCron(expression), date, timezone);
}

function nextCronDate(expression, from = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const timezone = validarFuso(timeZone);
  const cron = parseCron(expression);
  const formatter = formatterFor(timezone);
  const start = Math.floor(from.getTime() / 60000) * 60000 + 60000;
  // Limite de 1 ano: evita busca infinita para expressões impossíveis.
  for (let t = start; t <= start + 5 * 366 * 24 * 60 * 60000; t += 60000) {
    const candidate = new Date(t);
    if (cronMatchesParsed(cron, candidate, timezone, formatter)) return candidate.toISOString();
  }
  throw new Error('Não foi encontrada próxima execução cron nos próximos cinco anos.');
}

function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value || '').trim().match(/^(\d+)\s*(ms|s|m|min|h|d)$/i);
  if (!match) throw new Error('Duração inválida. Use exemplos como 30s, 5m, 2h ou 1d.');
  const number = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'ms' ? 1 : ['s'].includes(unit) ? 1000
    : ['m', 'min'].includes(unit) ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return number * multiplier;
}

// v0.44.0: rotina "agente" — o agente faz uma tarefa sozinho no horário marcado. Ninguém está olhando: toda
// confirmação vira "não" (src/ui/prompt.js), então o que roda sem perguntar é só o que já roda sem perguntar no
// chat (leitura, ou o que o usuário liberou com regras "permitir"). Por padrão, só ferramentas de leitura.
const FERRAMENTAS_ROTINA_PADRAO = Object.freeze(['read_file', 'list_dir', 'search_files', 'glob_files']);

function validarAcaoAgente(action) {
  const { semControlesInvisiveis } = require('./ui/textoSeguro');
  const prompt = typeof action.prompt === 'string' ? semControlesInvisiveis(action.prompt).trim() : '';
  if (!prompt || prompt.length > 8000) throw new Error('A rotina de agente precisa de um pedido (prompt) com até 8000 caracteres.');
  const ferramentas = action.ferramentas === undefined ? [...FERRAMENTAS_ROTINA_PADRAO] : action.ferramentas;
  if (!Array.isArray(ferramentas) || ferramentas.length > 40 || ferramentas.some((t) => typeof t !== 'string')) {
    throw new Error('ferramentas precisa ser uma lista de nomes (vazia = nenhuma ferramenta).');
  }
  const nativas = require('./tools').nomesNativos();
  const desconhecida = ferramentas.find((t) => !nativas.includes(t) && !/^mcp__[\w-]+__[\w-]+$/.test(t));
  if (desconhecida) throw new Error(`Ferramenta desconhecida: ${desconhecida}. Disponíveis: ${nativas.join(', ')} (e as mcp__servidor__ferramenta).`);
  const maxPassos = action.maxPassos === undefined ? 20 : Number(action.maxPassos);
  if (!Number.isInteger(maxPassos) || maxPassos < 1 || maxPassos > 60) throw new Error('maxPassos precisa ser um inteiro entre 1 e 60.');
  return { type: 'agente', prompt, ferramentas: [...new Set(ferramentas)], maxPassos, notificar: action.notificar === true };
}

// v0.44.1: rotina "adb" — controla a TV/celular no horário marcado, SEM IA (sem custo, funciona offline). Quem
// cria a rotina (o usuário, pelo terminal ou pela API com token; o modelo não grava o routines.json) aprova os
// passos ali; por isso eles rodam sem perguntar. Só ações que não destroem nada: nunca reiniciar, desinstalar,
// limpar dados, instalar, config nem o shell livre.
const ACOES_ROTINA_ADB = Object.freeze(['tecla', 'abrir_app', 'fechar_app', 'abrir_link', 'digitar', 'estado', 'info', 'esperar']);
const MAX_PASSOS_ADB = 20;

function validarPassoAdb(passo, i) {
  const adb = require('./tools/adbTools');
  const onde = `passo ${i + 1}`;
  if (!passo || typeof passo !== 'object' || Array.isArray(passo)) throw new Error(`${onde}: inválido.`);
  const acao = String(passo.acao || '').trim();
  if (!ACOES_ROTINA_ADB.includes(acao)) {
    throw new Error(`${onde}: "${acao}" não pode rodar sozinho numa rotina. Use: ${ACOES_ROTINA_ADB.join(', ')}.`);
  }
  if (acao === 'esperar') {
    const segundos = Number(passo.segundos);
    if (!Number.isInteger(segundos) || segundos < 1 || segundos > 60) throw new Error(`${onde}: esperar precisa de 1 a 60 segundos.`);
    return { acao, segundos };
  }
  if (acao === 'tecla') {
    if (!adb.teclaValida(passo.tecla)) throw new Error(`${onde}: tecla desconhecida "${passo.tecla}". Use: ${Object.keys(adb.TECLAS).join(', ')}.`);
    return { acao, tecla: String(passo.tecla).trim() };
  }
  if (acao === 'abrir_app' || acao === 'fechar_app') {
    if (!adb.PACOTE_OK.test(String(passo.app || ''))) throw new Error(`${onde}: informe o pacote do app (ex.: com.netflix.ninja).`);
    return { acao, app: passo.app };
  }
  if (acao === 'abrir_link') {
    const link = adb.validarLink(passo.link);
    if (passo.app !== undefined && !adb.PACOTE_OK.test(String(passo.app))) throw new Error(`${onde}: pacote do app inválido.`);
    return { acao, link, ...(passo.app ? { app: passo.app } : {}) };
  }
  if (acao === 'digitar') {
    const texto = typeof passo.texto === 'string' ? passo.texto : '';
    if (!texto || texto.length > adb.MAX_TEXTO) throw new Error(`${onde}: digitar precisa de um texto de até ${adb.MAX_TEXTO} caracteres.`);
    return { acao, texto };
  }
  return { acao }; // estado, info: só leem
}

function validarAcaoAdb(action) {
  const adb = require('./tools/adbTools');
  const alvo = adb.validarAlvo(action.alvo);
  if (!Array.isArray(action.passos) || !action.passos.length || action.passos.length > MAX_PASSOS_ADB) {
    throw new Error(`A rotina de aparelho precisa de 1 a ${MAX_PASSOS_ADB} passos.`);
  }
  const passos = action.passos.map(validarPassoAdb);
  if (passos.every((p) => p.acao === 'esperar')) throw new Error('A rotina de aparelho precisa de pelo menos um passo além de esperar.');
  return { type: 'adb', ...(alvo ? { alvo } : {}), passos, notificar: action.notificar === true };
}

function validarAcao(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('A rotina precisa de uma ação válida.');
  if (action.type === 'agente') return validarAcaoAgente(action);
  if (action.type === 'adb') return validarAcaoAdb(action);
  if (action.type !== 'http-check') {
    throw new Error('Ação inválida. Use http-check (verificar um site), agente (o agente faz uma tarefa sozinho) ou adb (comandos para a TV/celular).');
  }
  let url;
  try { url = new URL(action.url); } catch { throw new Error('URL inválida para a ação http-check.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('A URL precisa usar HTTP/HTTPS e não pode conter credenciais.');
  }
  const timeoutMs = action.timeoutMs === undefined ? 10000 : Number(action.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new Error('timeoutMs precisa estar entre 1000 e 60000.');
  }
  const expectedStatus = action.expectedStatus === undefined ? null : Number(action.expectedStatus);
  if (expectedStatus !== null && (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599)) {
    throw new Error('expectedStatus precisa ser um código HTTP entre 100 e 599.');
  }
  return { type: 'http-check', url: url.toString(), timeoutMs, expectedStatus };
}

function validarGatilho(trigger, now = new Date()) {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) throw new Error('Informe um gatilho.');
  const timeZone = validarFuso(trigger.timezone || DEFAULT_TIMEZONE);
  if (trigger.type === 'once') {
    const at = new Date(trigger.runAt);
    if (!trigger.runAt || !Number.isFinite(at.getTime())) throw new Error('runAt precisa ser uma data ISO válida.');
    if (at.getTime() <= now.getTime()) throw new Error('A execução única precisa estar no futuro.');
    return { type: 'once', runAt: at.toISOString(), timezone: timeZone };
  }
  if (trigger.type === 'interval') {
    const intervalMs = Number(trigger.intervalMs);
    if (!Number.isInteger(intervalMs) || intervalMs < 60000 || intervalMs > 365 * 86400000) {
      throw new Error('O intervalo precisa estar entre 1 minuto e 365 dias.');
    }
    return { type: 'interval', intervalMs, timezone: timeZone };
  }
  if (trigger.type === 'cron') {
    const cron = parseCron(trigger.expression);
    return { type: 'cron', expression: cron.expression, timezone: timeZone };
  }
  throw new Error('Gatilho inválido. Use once, interval ou cron.');
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    throw new Error('Nome obrigatório com até 120 caracteres.');
  }
  return name.trim();
}

function createRoutineStore({ dataPath = ROUTINES_PATH, executionsPath = EXECUTIONS_PATH } = {}) {
  function loadRoutines() {
    return lerJson(dataPath, (data) => data && data.version === 1 && Array.isArray(data.routines), () => ({ version: 1, routines: [] }));
  }
  function saveRoutines(data) { escreverJson(dataPath, data); }
  function loadExecutions() {
    return lerJson(executionsPath, (data) => data && data.version === 1 && Array.isArray(data.executions), () => ({ version: 1, executions: [] }));
  }
  function saveExecutions(data) { escreverJson(executionsPath, data); }
  function create(input, now = new Date()) {
    if (!input || typeof input !== 'object') throw new Error('Dados da rotina inválidos.');
    const name = validateName(input.name);
    const trigger = validarGatilho(input.trigger, now);
    const action = validarAcao(input.action);
    if (input.missedPolicy !== undefined && !['skip', 'run_once'].includes(input.missedPolicy)) {
      throw new Error('missedPolicy deve ser skip ou run_once.');
    }
    const list = loadRoutines();
    const id = crypto.randomUUID();
    const nowIso = now.toISOString();
    let nextRunAt = null;
    if (trigger.type === 'once') nextRunAt = trigger.runAt;
    if (trigger.type === 'interval') nextRunAt = new Date(now.getTime() + trigger.intervalMs).toISOString();
    if (trigger.type === 'cron') nextRunAt = nextCronDate(trigger.expression, now, trigger.timezone);
    const routine = {
      id, name, description: String(input.description || '').trim().slice(0, 1000),
      category: String(input.category || ({ agente: 'agente', adb: 'aparelho' }[action.type] || 'monitoramento')).trim().slice(0, 60) || 'monitoramento',
      priority: ['baixa', 'normal', 'alta', 'critica'].includes(input.priority) ? input.priority : 'normal',
      trigger, action, status: STATUSES.DRAFT, createdAt: nowIso, updatedAt: nowIso,
      nextRunAt, lastRunAt: null, lastResult: null, lastCronSlotKey: null,
      missedPolicy: ['skip', 'run_once'].includes(input.missedPolicy) ? input.missedPolicy : 'skip',
    };
    list.routines.push(routine);
    saveRoutines(list);
    return routine;
  }
  function list({ status, category, priority } = {}) {
    let items = loadRoutines().routines;
    if (status) items = items.filter((r) => r.status === status);
    if (category) items = items.filter((r) => r.category === category);
    if (priority) items = items.filter((r) => r.priority === priority);
    return items.slice().sort((a, b) => (a.nextRunAt || '9999').localeCompare(b.nextRunAt || '9999'));
  }
  function get(id) { return loadRoutines().routines.find((r) => r.id === id) || null; }
  function update(id, updater) {
    const data = loadRoutines();
    const index = data.routines.findIndex((r) => r.id === id);
    if (index < 0) return null;
    data.routines[index] = { ...data.routines[index], ...updater, updatedAt: new Date().toISOString() };
    saveRoutines(data);
    return data.routines[index];
  }
  function activate(id, now = new Date()) {
    const routine = get(id);
    if (!routine) return null;
    if (![STATUSES.DRAFT, STATUSES.PAUSED, STATUSES.FAILED].includes(routine.status)) throw new Error(`Não é possível ativar uma rotina no estado ${routine.status}.`);
    let nextRunAt = routine.nextRunAt;
    if (routine.trigger.type === 'interval') nextRunAt = new Date(now.getTime() + routine.trigger.intervalMs).toISOString();
    if (routine.trigger.type === 'cron') nextRunAt = nextCronDate(routine.trigger.expression, now, routine.trigger.timezone);
    if (routine.trigger.type === 'once' && new Date(routine.trigger.runAt) <= now) throw new Error('A data da execução única já passou. Crie outra rotina com uma data futura.');
    return update(id, { status: STATUSES.ACTIVE, nextRunAt, lastCronSlotKey: null });
  }
  function pause(id) {
    const routine = get(id);
    if (!routine) return null;
    if (routine.status === STATUSES.COMPLETED) throw new Error('Uma rotina concluída não pode ser pausada.');
    return update(id, { status: STATUSES.PAUSED });
  }
  function resume(id, now) { return activate(id, now); }
  function remove(id) {
    const data = loadRoutines();
    const routine = data.routines.find((r) => r.id === id);
    if (!routine) return false;
    if (![STATUSES.DRAFT, STATUSES.PAUSED, STATUSES.FAILED, STATUSES.COMPLETED].includes(routine.status)) {
      throw new Error('Pause a rotina antes de removê-la.');
    }
    data.routines = data.routines.filter((r) => r.id !== id);
    saveRoutines(data);
    return true;
  }
  function appendExecution(execution) {
    const data = loadExecutions();
    data.executions.push(execution);
    if (data.executions.length > 1000) data.executions.splice(0, data.executions.length - 1000);
    saveExecutions(data);
    return execution;
  }
  function updateExecution(id, patch) {
    const data = loadExecutions();
    const execution = data.executions.find((item) => item.id === id);
    if (!execution) return null;
    Object.assign(execution, patch);
    saveExecutions(data);
    return execution;
  }
  function executions({ routineId, limit = 100, status } = {}) {
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    let items = loadExecutions().executions;
    if (routineId) items = items.filter((e) => e.routineId === routineId);
    if (status) items = items.filter((e) => e.status === status);
    return items.slice(-boundedLimit).reverse();
  }
  function recoverInterrupted(now = new Date()) {
    const data = loadRoutines();
    const interrupted = data.routines.filter((routine) => routine.status === STATUSES.RUNNING);
    const logs = loadExecutions();
    const orphaned = logs.executions.filter((execution) => execution.status === 'em_execucao');
    if (!interrupted.length && !orphaned.length) return 0;
    for (const routine of interrupted) {
      routine.status = STATUSES.ACTIVE;
      routine.updatedAt = now.toISOString();
      // lastRunAt só é gravado ao fim da execução; tarefas únicas interrompidas
      // voltam a ser elegíveis conforme a política de recuperação configurada.
      routine.lastResult = { ok: false, interrupted: true, message: 'Execução interrompida pelo encerramento do processo; rotina recuperada pelo agendador.', at: now.toISOString() };
    }
    if (interrupted.length) saveRoutines(data);
    for (const execution of logs.executions) {
      if (execution.status === 'em_execucao' && interrupted.some((routine) => routine.id === execution.routineId)) {
        execution.status = 'falhou';
        execution.finishedAt = now.toISOString();
        execution.error = 'Processo encerrado durante a execução; tarefa recuperada para tentativa futura.';
        execution.result = { ok: false, interrupted: true, message: execution.error };
      }
    }
    if (orphaned.length) saveExecutions(logs);
    return Math.max(interrupted.length, orphaned.length);
  }
  function due(now = new Date()) {
    const dueRoutines = [];
    for (const routine of list({ status: STATUSES.ACTIVE })) {
      const nextAt = routine.nextRunAt ? new Date(routine.nextRunAt).getTime() : Infinity;
      if (nextAt > now.getTime()) continue;
      const lateBy = now.getTime() - nextAt;
      // Política explícita para quedas: nunca reproduzir uma fila inteira de
      // intervalos perdidos. 'skip' salta uma janela vencida há pelo menos um
      // período; 'run_once' agrupa a indisponibilidade em uma única execução.
      if (routine.trigger.type === 'interval') {
        if (routine.missedPolicy === 'skip' && lateBy >= routine.trigger.intervalMs) {
          update(routine.id, { nextRunAt: new Date(now.getTime() + routine.trigger.intervalMs).toISOString(), lastResult: { ok: true, skipped: true, message: 'Janela perdida ignorada após indisponibilidade do agendador.', at: now.toISOString() } });
          appendExecution({ id: crypto.randomUUID(), routineId: routine.id, routineName: routine.name, source: 'recuperação', status: 'ignorada', startedAt: now.toISOString(), finishedAt: now.toISOString(), attempts: [], result: { ok: true, skipped: true, message: 'Janela perdida ignorada; próxima execução recalculada.' }, error: null });
          continue;
        }
        dueRoutines.push(routine);
        continue;
      }
      if (routine.trigger.type === 'once') {
        if (routine.missedPolicy === 'skip' && lateBy > 60000) {
          update(routine.id, { status: STATUSES.COMPLETED, nextRunAt: null, lastRunAt: now.toISOString(), lastResult: { ok: false, skipped: true, message: 'Execução única perdida após indisponibilidade do agendador.', at: now.toISOString() } });
          appendExecution({ id: crypto.randomUUID(), routineId: routine.id, routineName: routine.name, source: 'recuperação', status: 'ignorada', startedAt: now.toISOString(), finishedAt: now.toISOString(), attempts: [], result: { ok: false, skipped: true, message: 'Execução única ignorada por política de recuperação.' }, error: null });
          continue;
        }
        dueRoutines.push(routine);
        continue;
      }
      if (routine.trigger.type === 'cron') {
        if (lateBy > 60000 && routine.missedPolicy === 'skip') {
          update(routine.id, { nextRunAt: nextCronDate(routine.trigger.expression, now, routine.trigger.timezone) });
          appendExecution({ id: crypto.randomUUID(), routineId: routine.id, routineName: routine.name, source: 'recuperação', status: 'ignorada', startedAt: now.toISOString(), finishedAt: now.toISOString(), attempts: [], result: { ok: true, skipped: true, message: 'Instante cron perdido ignorado após indisponibilidade.' }, error: null });
          continue;
        }
        const parts = partesNoFuso(now, routine.trigger.timezone);
        const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
        const recoveringOnce = routine.missedPolicy === 'run_once' && lateBy > 60000;
        if (recoveringOnce || (cronMatches(routine.trigger.expression, now, routine.trigger.timezone) && routine.lastCronSlotKey !== key)) dueRoutines.push(routine);
      }
    }
    return dueRoutines;
  }
  return { dataPath, executionsPath, create, list, get, update, activate, pause, resume, remove, appendExecution, updateExecution, executions, due, recoverInterrupted };
}

const defaultStore = createRoutineStore();
module.exports = {
  ROUTINES_PATH, EXECUTIONS_PATH, DEFAULT_TIMEZONE, STATUSES, VALID_STATUSES,
  parseDuration, parseCron, cronMatches, nextCronDate, validarGatilho, validarAcao, createRoutineStore, FERRAMENTAS_ROTINA_PADRAO,
  ACOES_ROTINA_ADB,
  ...defaultStore,
};
