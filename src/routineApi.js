// API HTTP autenticada para operar rotinas persistentes do gemini-code.
'use strict';

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { HOME_DIR, ROUTINE_API_TOKEN_PATH } = require('./config');

const TOKEN_PATH = ROUTINE_API_TOKEN_PATH;
const MAX_BODY_BYTES = 64 * 1024;

function getOrCreateToken() {
  if (process.env.ROUTINE_API_TOKEN) {
    if (process.env.ROUTINE_API_TOKEN.length < 24) throw new Error('ROUTINE_API_TOKEN deve ter pelo menos 24 caracteres.');
    return { token: process.env.ROUTINE_API_TOKEN, created: false, source: 'environment' };
  }
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  try {
    const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    if (token.length < 24) throw new Error('O token salvo da API está inválido; renomeie/remova o arquivo e inicie novamente.');
    return { token, created: false, source: TOKEN_PATH };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const token = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(TOKEN_PATH, `${token}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    return { token: fs.readFileSync(TOKEN_PATH, 'utf8').trim(), created: false, source: TOKEN_PATH };
  }
  try { fs.chmodSync(TOKEN_PATH, 0o600); } catch { /* Windows pode não expor chmod equivalente */ }
  return { token, created: true, source: TOKEN_PATH };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function sendJson(res, status, body) {
  const serialized = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(serialized),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(serialized);
}

async function readJson(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('Corpo da requisição excede 64 KB.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON inválido.'), { statusCode: 400 }); }
}

function createRoutineApiServer({ store, runner, token = getOrCreateToken().token, rateLimit = 120, rateWindowMs = 60000 } = {}) {
  if (!store || !runner) throw new Error('A API precisa do armazenamento e do executor de rotinas.');
  const requestCounts = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'gemini-code-routines', time: new Date().toISOString() });
    }
    if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found' });

    const address = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = requestCounts.get(address);
    if (!bucket || now - bucket.start >= rateWindowMs) requestCounts.set(address, { start: now, count: 1 });
    else {
      bucket.count += 1;
      if (bucket.count > rateLimit) return sendJson(res, 429, { error: 'rate_limit', message: 'Muitas requisições; tente novamente em instantes.' });
    }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), token)) {
      return sendJson(res, 401, { error: 'unauthorized', message: 'Envie Authorization: Bearer <token>.' });
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/routines') {
        const routines = store.list({ status: url.searchParams.get('status') || undefined, category: url.searchParams.get('category') || undefined, priority: url.searchParams.get('priority') || undefined });
        return sendJson(res, 200, { routines });
      }
      if (req.method === 'POST' && url.pathname === '/api/routines') {
        const payload = await readJson(req);
        const routine = store.create(payload);
        return sendJson(res, 201, { routine, message: 'Rotina criada como rascunho; ative explicitamente para permitir execução automática.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/executions') {
        return sendJson(res, 200, { executions: store.executions({ limit: url.searchParams.get('limit') || 100 }) });
      }
      const match = url.pathname.match(/^\/api\/routines\/([a-f0-9-]+)(?:\/(activate|pause|resume|run|executions))?$/i);
      if (!match) return sendJson(res, 404, { error: 'not_found' });
      const [, id, action] = match;
      const routine = store.get(id);
      if (!routine) return sendJson(res, 404, { error: 'routine_not_found' });
      if (req.method === 'GET' && !action) return sendJson(res, 200, { routine });
      if (req.method === 'GET' && action === 'executions') return sendJson(res, 200, { executions: store.executions({ routineId: id, limit: url.searchParams.get('limit') || 100 }) });
      if (req.method === 'POST' && action === 'activate') return sendJson(res, 200, { routine: store.activate(id) });
      if (req.method === 'POST' && action === 'pause') return sendJson(res, 200, { routine: store.pause(id) });
      if (req.method === 'POST' && action === 'resume') return sendJson(res, 200, { routine: store.resume(id) });
      if (req.method === 'POST' && action === 'run') {
        const outcome = await runner.execute(id, { source: 'api' });
        return sendJson(res, outcome.status === 'falhou' ? 502 : 200, { execution: outcome });
      }
      return sendJson(res, 405, { error: 'method_not_allowed' });
    } catch (err) {
      const conflict = err.message && /já está em execução|não é possível|não pode ser|já passou|pause a rotina/i.test(err.message);
      const invalid = err.message && /inválid|obrigat|precisa|fuso|cron|intervalo|URL|timeoutMs|código HTTP|status|missedPolicy/i.test(err.message);
      const status = err.statusCode || (conflict ? 409 : invalid ? 400 : 500);
      return sendJson(res, status, { error: status === 400 ? 'invalid_request' : 'internal_error', message: err.message });
    }
  });
  return server;
}

function startRoutineApi({ store, runner, host = process.env.ROUTINE_API_HOST || '127.0.0.1', port = Number(process.env.ROUTINE_API_PORT || 8787), token } = {}) {
  const tokenInfo = token ? { token, created: false, source: 'provided' } : getOrCreateToken();
  const server = createRoutineApiServer({ store, runner, token: tokenInfo.token });
  server.listen(port, host, () => {
    console.log(`[rotinas] API disponível em http://${host}:${server.address().port}`);
    console.log(`[rotinas] token: ${tokenInfo.created ? tokenInfo.token : `já configurado (${tokenInfo.source}); não será exibido novamente`}`);
    console.log('[rotinas] /health é público; todas as rotas /api exigem o bearer token. Use HTTPS/proxy seguro para acesso remoto.');
  });
  return { server, tokenInfo };
}

module.exports = { TOKEN_PATH, getOrCreateToken, safeEqual, readJson, createRoutineApiServer, startRoutineApi };
