// src/cowork/server.js
// "Gemini Cowork": um servidor que roda no PC (na mesma rede Wi-Fi/local que
// o celular) e recebe tarefas do gemini-code do celular. As tarefas rodam
// com o agente completo (arquivo, shell, MCP, skills) DIRETO NO PC.
//
// Segurança: exige um token compartilhado (gerado na primeira vez e salvo em
// ~/.gemini-code/cowork-token.txt) — sem o token, a conexão é recusada.
// Isso só protege dentro da rede local; não exponha essa porta na internet.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { loadConfig, HOME_DIR, COWORK_TOKEN_PATH } = require('../config');
const { runOnce } = require('../agent');

const TOKEN_PATH = COWORK_TOKEN_PATH;
// Tarefas são texto; sem limite, o ws aceita mensagens de até 100 MiB de
// qualquer um na rede, antes mesmo da autenticação.
const MAX_PAYLOAD_BYTES = 1024 * 1024;

function getOrCreateToken() {
  // Corrigido: antes presumia que ~/.gemini-code já existia (só funcionava
  // porque startServer() sempre chama loadConfig() — que cria os
  // diretórios — antes de chamar isto aqui). Chamar getOrCreateToken()
  // isoladamente, fora dessa ordem, quebrava com ENOENT.
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  // v0.40.0: o token dá acesso ao agente inteiro (shell, arquivos); era gravado
  // com 0644, legível por qualquer usuário da máquina. Agora só o dono lê.
  if (fs.existsSync(TOKEN_PATH)) {
    try { fs.chmodSync(TOKEN_PATH, 0o600); } catch { /* Windows */ }
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

function tokensBatem(recebido, esperado) {
  if (typeof recebido !== 'string') return false;
  const a = crypto.createHash('sha256').update(recebido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

function localIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

/**
 * Processa uma mensagem recebida de um cliente conectado. Extraído do
 * `wss.on('connection', ...)` original para poder ser testado sem precisar
 * de um WebSocket de verdade (ver tests/cowork-server.test.js): em vez de
 * mandar pela conexão diretamente, recebe um `send(objeto)` que quem chama
 * decide como entregar (na wiring real, `ws.send(JSON.stringify(objeto))`).
 *
 * `connState` é `{ authed, history }` e é mutado in-place — o mesmo objeto
 * deve ser reaproveitado entre chamadas para a mesma conexão.
 */
async function handleMessage(raw, connState, { token, send, runOnceFn = runOnce }) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return send({ type: 'error', error: 'JSON inválido' });
  }

  if (msg.type === 'auth') {
    // Antes comparava com "===", que vaza timing (o tempo de comparação
    // varia com quantos caracteres batem no começo) — em teoria dá pra
    // usar isso pra descobrir o token caractere por caractere. Como o
    // token tem tamanho fixo (32 hex), comparamos os hashes SHA-256 dos
    // dois lados com timingSafeEqual, que sempre leva o mesmo tempo.
    connState.authed = tokensBatem(msg.token, token);
    return send({ type: 'auth_result', ok: connState.authed });
  }

  if (!connState.authed) {
    return send({ type: 'error', error: 'Não autenticado. Envie {type:"auth", token}.' });
  }

  if (msg.type === 'reset') {
    connState.history = [];
    return send({ type: 'reset_ok' });
  }

  if (msg.type === 'task') {
    // Item 9 da revisão: msg.prompt não era validado — podia chegar
    // undefined, um objeto, número etc., e só quebrava lá dentro do
    // runOnce/Gemini com um erro confuso. Valida aqui, cedo, com uma
    // mensagem clara pro cliente.
    if (typeof msg.prompt !== 'string' || !msg.prompt.trim()) {
      return send({ type: 'error', error: 'Campo "prompt" ausente ou vazio na tarefa.' });
    }
    try {
      send({ type: 'status', status: 'rodando' });
      const { text, history: newHistory } = await runOnceFn(msg.prompt, { history: connState.history });
      connState.history = newHistory;
      send({ type: 'result', text });
    } catch (err) {
      send({ type: 'error', error: err.message });
    }
  }
}

function startServer(port) {
  // Verifica a dependência de transporte antes de criar configurações ou tokens.
  // Assim, uma instalação incompleta não deixa arquivos laterais ao falhar.
  let WebSocket;
  try {
    WebSocket = require('ws');
  } catch (err) {
    const error = new Error('O recurso Cowork por WebSocket precisa da dependência ws. Execute `npm install` com acesso à internet e tente novamente.');
    error.cause = err;
    throw error;
  }

  const cfg = loadConfig();
  const finalPort = port || cfg.coworkPort;
  const token = getOrCreateToken();
  const wss = new WebSocket.Server({ port: finalPort, maxPayload: MAX_PAYLOAD_BYTES });

  console.log(`\nGemini Cowork rodando na porta ${finalPort}.`);
  console.log(`Token de acesso (guarde, o celular vai pedir): ${token}`);
  console.log('IPs desta máquina na rede local:');
  localIps().forEach((ip) => console.log(`  ws://${ip}:${finalPort}`));
  console.log('\nNo celular, rode: gemini-code cowork connect <ip> --token ' + token);

  wss.on('connection', (ws) => {
    const connState = { authed: false, history: [] };
    const send = (obj) => ws.send(JSON.stringify(obj));
    ws.on('message', (raw) => handleMessage(raw, connState, { token, send }));
  });

  return wss;
}

module.exports = { startServer, getOrCreateToken, localIps, tokensBatem, handleMessage, MAX_PAYLOAD_BYTES };
