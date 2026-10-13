// src/cowork/client.js
// Roda no celular (Termux): conecta no gemini-code cowork server que está
// rodando no PC, na mesma rede local, e manda tarefas para ele executar lá.
'use strict';

const readline = require('readline');

/**
 * Decide o que fazer com uma mensagem recebida do servidor. Extraído do
 * `ws.on('message', ...)` original pra poder testar as ramificações (JSON
 * inválido, auth_result ok/erro, status/result/error) sem precisar de uma
 * conexão WebSocket de verdade (ver tests/cowork-client.test.js).
 *
 * `actions` reúne os efeitos colaterais que dependiam da conexão/processo
 * de verdade, pra quem chama poder substituí-los em teste:
 *   - log(texto): equivalente a console.log
 *   - errorLog(texto): equivalente a console.error
 *   - onAutenticado(): chamado quando auth_result.ok === true (abria o
 *     prompt interativo)
 *   - onTokenInvalido(): chamado quando auth_result.ok === false (saía do
 *     processo)
 *   - onPromptAgain(): chamado depois de "result"/"error", pra continuar o
 *     prompt interativo
 */
function handleServerMessage(raw, actions) {
  const { log = console.log, errorLog = console.error, onAutenticado, onTokenInvalido, onPromptAgain } = actions;

  // Item 9 da revisão (set/2026): se o servidor (ou algo na rede) mandasse
  // um frame que não fosse JSON válido, esse JSON.parse sem try/catch
  // derrubava o cliente inteiro com uma exceção não tratada. Agora só
  // avisa e ignora a mensagem, mantendo a conexão de pé.
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    errorLog('[gemini-cowork] mensagem inválida recebida do servidor (ignorada).');
    return;
  }

  if (msg.type === 'auth_result') {
    if (!msg.ok) {
      errorLog('Token inválido. Confira o token mostrado no PC.');
      return onTokenInvalido && onTokenInvalido();
    }
    log('Autenticado! Digite tarefas para o PC executar (Ctrl+C para sair).\n');
    return onAutenticado && onAutenticado();
  } else if (msg.type === 'status') {
    log(`[PC] ${msg.status}...`);
  } else if (msg.type === 'result') {
    log(`\n[PC responde]\n${msg.text}\n`);
    onPromptAgain && onPromptAgain();
  } else if (msg.type === 'error') {
    errorLog(`[erro] ${msg.error}`);
    onPromptAgain && onPromptAgain();
  }
}

function connect(ip, port, token) {
  const url = `ws://${ip}:${port}`;
  // Carrega a dependência de rede somente ao conectar; a lógica de mensagens
  // permanece utilizável em testes offline e em instalações sem Cowork.
  let WebSocket;
  try {
    WebSocket = require('ws');
  } catch (err) {
    const error = new Error('O cliente Cowork precisa da dependência ws. Execute `npm install` com acesso à internet e tente novamente.');
    error.cause = err;
    throw error;
  }
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`Conectado a ${url}. Autenticando...`);
    ws.send(JSON.stringify({ type: 'auth', token }));
  });

  ws.on('message', (raw) => handleServerMessage(raw, {
    onAutenticado: () => promptLoop(ws),
    onTokenInvalido: () => process.exit(1),
    onPromptAgain: rlPromptAgain,
  }));

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

module.exports = { connect, handleServerMessage };
