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
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const WebSocket = require('ws');
const { loadConfig, HOME_DIR } = require('../config');
const { runOnce } = require('../agent');

const TOKEN_PATH = path.join(HOME_DIR, 'cowork-token.txt');

function getOrCreateToken() {
  if (fs.existsSync(TOKEN_PATH)) return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(TOKEN_PATH, token);
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

function startServer(port) {
  const cfg = loadConfig();
  const finalPort = port || cfg.coworkPort;
  const token = getOrCreateToken();

  const wss = new WebSocket.Server({ port: finalPort });

  console.log(`\nGemini Cowork rodando na porta ${finalPort}.`);
  console.log(`Token de acesso (guarde, o celular vai pedir): ${token}`);
  console.log('IPs desta máquina na rede local:');
  localIps().forEach((ip) => console.log(`  ws://${ip}:${finalPort}`));
  console.log('\nNo celular, rode: gemini-code cowork connect <ip> --token ' + token);

  wss.on('connection', (ws) => {
    let authed = false;
    let history = [];

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return ws.send(JSON.stringify({ type: 'error', error: 'JSON inválido' }));
      }

      if (msg.type === 'auth') {
        // Antes comparava com "===", que vaza timing (o tempo de comparação
        // varia com quantos caracteres batem no começo) — em teoria dá pra
        // usar isso pra descobrir o token caractere por caractere. Como o
        // token tem tamanho fixo (32 hex), comparamos os hashes SHA-256 dos
        // dois lados com timingSafeEqual, que sempre leva o mesmo tempo.
        authed = tokensBatem(msg.token, token);
        return ws.send(JSON.stringify({ type: 'auth_result', ok: authed }));
      }

      if (!authed) {
        return ws.send(JSON.stringify({ type: 'error', error: 'Não autenticado. Envie {type:"auth", token}.' }));
      }

      if (msg.type === 'reset') {
        history = [];
        return ws.send(JSON.stringify({ type: 'reset_ok' }));
      }

      if (msg.type === 'task') {
        try {
          ws.send(JSON.stringify({ type: 'status', status: 'rodando' }));
          const { text, history: newHistory } = await runOnce(msg.prompt, { history });
          history = newHistory;
          ws.send(JSON.stringify({ type: 'result', text }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      }
    });
  });

  return wss;
}

module.exports = { startServer, getOrCreateToken, localIps };
