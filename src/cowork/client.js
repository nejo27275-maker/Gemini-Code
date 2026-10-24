// src/cowork/client.js
// Roda no celular (Termux): conecta no gemini-code cowork server que está
// rodando no PC, na mesma rede local, e manda tarefas para ele executar lá.
// v0.43.0: canal cifrado (src/cowork/canalSeguro.js). O token não vai mais pela rede, e o celular só
// manda tarefas depois que o PC prova que também conhece o token (um PC falso na rede não as recebe).
'use strict';

const readline = require('readline');
const canalSeguro = require('./canalSeguro');

const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024; // respostas do PC podem ser longas, mas não 100 MiB (padrão do ws)

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
  let msg = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      errorLog('[gemini-cowork] mensagem inválida recebida do servidor (ignorada).');
      return;
    }
  }
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'auth_result') {
    if (!msg.ok) {
      errorLog(msg.error && msg.error !== 'Token inválido.'
        ? `Autenticação recusada pelo PC: ${msg.error}`
        : 'Token inválido. Confira o token mostrado no PC.');
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

/**
 * Uma conexão do lado do cliente, sem depender do WebSocket: responde ao hello, confere a prova do PC e,
 * dali em diante, só aceita mensagens cifradas na ordem. Mensagens decifradas vão para handleServerMessage
 * (a confirmação do aperto de mão vira um auth_result ok, como antes). Qualquer desvio encerra a conexão.
 */
function criarConexaoCliente({ token, enviar, fechar, acoes = {} }) {
  const canal = canalSeguro.cliente(token);
  const errorLog = acoes.errorLog || console.error;
  let encerrada = false;
  const abortar = (texto) => {
    if (encerrada) return;
    encerrada = true;
    errorLog(texto);
    fechar();
  };
  return {
    get autenticado() { return canal.pronto; },
    aoReceber(raw) {
      if (encerrada) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return abortar('[gemini-cowork] mensagem inválida do PC; conexão encerrada.'); }
      if (!canal.pronto) {
        try {
          if (msg.type === 'hello') return enviar(canal.receberHello(msg));
          if (msg.type === 'auth_ok') {
            canal.confirmar(msg);
            return handleServerMessage({ type: 'auth_result', ok: true }, acoes);
          }
          if (msg.type === 'auth_result' && msg.ok === false) {
            encerrada = true;
            return handleServerMessage({ type: 'auth_result', ok: false, error: typeof msg.error === 'string' ? msg.error.slice(0, 300) : undefined }, acoes);
          }
          return abortar('[gemini-cowork] resposta inesperada do PC antes da autenticação; conexão encerrada.');
        } catch (e) {
          return abortar(`[gemini-cowork] ${e.message}`);
        }
      }
      let interna;
      try { interna = canal.abrir(msg); } catch (e) { return abortar(`[gemini-cowork] ${e.message}; conexão encerrada.`); }
      return handleServerMessage(interna, acoes);
    },
    enviarTarefa(prompt) {
      if (!encerrada) enviar(canal.selar({ type: 'task', prompt }));
    },
  };
}

function connect(ip, port, token) {
  const url = `ws://${ip}:${port}`;
  canalSeguro.validarToken(token); // erro claro antes de abrir a rede
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
  const ws = new WebSocket(url, { maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate: false, handshakeTimeout: 10000 });
  const conn = criarConexaoCliente({
    token,
    enviar: (obj) => ws.send(JSON.stringify(obj)),
    fechar: () => ws.close(),
    acoes: {
      onAutenticado: () => promptLoop(conn),
      onTokenInvalido: () => process.exit(1),
      onPromptAgain: rlPromptAgain,
    },
  });

  ws.on('open', () => console.log(`Conectado a ${url}. Autenticando pelo canal cifrado...`));
  ws.on('message', (raw) => conn.aoReceber(raw));
  ws.on('error', (err) => console.error('Erro de conexão:', err.message));
  ws.on('close', () => console.log('Conexão encerrada.'));

  return ws;
}

let rl;
function promptLoop(conn) {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('gemini-cowork> ');
  rl.prompt();
  rl.on('line', (line) => {
    if (!line.trim()) return rl.prompt();
    conn.enviarTarefa(line);
  });
}

function rlPromptAgain() {
  if (rl) rl.prompt();
}

module.exports = { connect, handleServerMessage, criarConexaoCliente, MAX_PAYLOAD_BYTES };
