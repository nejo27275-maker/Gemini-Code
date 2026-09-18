// src/cowork/client.js
// Roda no celular (Termux): conecta no gemini-code cowork server que está
// rodando no PC, na mesma rede local, e manda tarefas para ele executar lá.
'use strict';

const WebSocket = require('ws');
const readline = require('readline');

function connect(ip, port, token) {
  const url = `ws://${ip}:${port}`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`Conectado a ${url}. Autenticando...`);
    ws.send(JSON.stringify({ type: 'auth', token }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'auth_result') {
      if (!msg.ok) {
        console.error('Token inválido. Confira o token mostrado no PC.');
        process.exit(1);
      }
      console.log('Autenticado! Digite tarefas para o PC executar (Ctrl+C para sair).\n');
      promptLoop(ws);
    } else if (msg.type === 'status') {
      console.log(`[PC] ${msg.status}...`);
    } else if (msg.type === 'result') {
      console.log(`\n[PC responde]\n${msg.text}\n`);
      rlPromptAgain();
    } else if (msg.type === 'error') {
      console.error(`[erro] ${msg.error}`);
      rlPromptAgain();
    }
  });

  ws.on('error', (err) => console.error('Erro de conexão:', err.message));
  ws.on('close', () => console.log('Conexão encerrada.'));

  return ws;
}

let rl;
function promptLoop(ws) {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('gemini-cowork> ');
  rl.prompt();
  rl.on('line', (line) => {
    if (!line.trim()) return rl.prompt();
    ws.send(JSON.stringify({ type: 'task', prompt: line }));
  });
}

function rlPromptAgain() {
  if (rl) rl.prompt();
}

module.exports = { connect };
