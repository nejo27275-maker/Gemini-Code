// src/cowork/server.js
// "Gemini Cowork": um servidor que roda no PC (na mesma rede Wi-Fi/local que
// o celular) e recebe tarefas do gemini-code do celular. As tarefas rodam
// com o agente completo (arquivo, shell, MCP, skills) DIRETO NO PC.
//
// Segurança (v0.43.0): canal cifrado e autenticado dos dois lados (src/cowork/canalSeguro.js) — o token
// nunca passa pela rede e quem está no meio não lê nem altera as tarefas. Contra sobrecarga: no máximo
// MAX_CONEXOES ao mesmo tempo, 10 s para autenticar, IP bloqueado por 15 min depois de 5 tokens errados,
// teto de mensagens por minuto e uma tarefa por vez em cada conexão. Mesmo assim: não exponha esta
// porta na internet (um ataque distribuído de verdade se barra na rede, não no programa).
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { loadConfig, HOME_DIR, COWORK_TOKEN_PATH } = require('../config');
const { runOnce } = require('../agent');
const canalSeguro = require('./canalSeguro');
const { criarLimitador } = require('../limitador');

const TOKEN_PATH = COWORK_TOKEN_PATH;
// Tarefas são texto; sem limite, o ws aceita mensagens de até 100 MiB de
// qualquer um na rede, antes mesmo da autenticação.
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_CONEXOES = 8;
const PRAZO_AUTENTICACAO_MS = 10000;
const FALHAS_POR_IP = 5;
const JANELA_FALHAS_MS = 15 * 60 * 1000;
const MAX_MENSAGENS_POR_MINUTO = 60;

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

/** v0.43.0: troca o token (o antigo deixa de valer). Use depois de atualizar: o protocolo antigo o mandava aberto. */
function novoToken() {
  try { fs.unlinkSync(TOKEN_PATH); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return getOrCreateToken();
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
 * Processa uma mensagem JÁ DECIFRADA de um cliente autenticado (o aperto de mão e a cifra ficam em
 * criarConexao). Recebe um `send(objeto)` que quem chama decide como entregar (na conexão real, cifrado),
 * para ser testado sem WebSocket (ver tests/cowork-server.test.js).
 *
 * `connState` é `{ authed, history, ocupado }` e é mutado in-place — o mesmo objeto
 * deve ser reaproveitado entre chamadas para a mesma conexão.
 */
async function handleMessage(raw, connState, { send, runOnceFn = runOnce }) {
  let msg = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send({ type: 'error', error: 'JSON inválido' });
    }
  }
  if (!msg || typeof msg !== 'object') return send({ type: 'error', error: 'Mensagem inválida.' });

  if (!connState.authed) {
    return send({ type: 'error', error: 'Não autenticado: conclua o aperto de mão cifrado do cowork.' });
  }

  // v0.43.0: uma tarefa por vez. Antes várias rodavam juntas na mesma conversa (histórico embaralhado e,
  // de quem tem o token, um jeito fácil de ocupar o PC inteiro).
  if (connState.ocupado && (msg.type === 'task' || msg.type === 'reset')) {
    return send({ type: 'error', error: 'O PC ainda está rodando a tarefa anterior; espere a resposta.' });
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
    connState.ocupado = true;
    try {
      send({ type: 'status', status: 'rodando' });
      const { text, history: newHistory } = await runOnceFn(msg.prompt, { history: connState.history });
      connState.history = newHistory;
      send({ type: 'result', text });
    } catch (err) {
      send({ type: 'error', error: err.message });
    } finally {
      connState.ocupado = false;
    }
    return undefined;
  }
  return send({ type: 'error', error: `Tipo de mensagem desconhecido: ${String(msg.type).slice(0, 40)}` });
}

/**
 * Decide se uma conexão nova entra, antes do aperto de mão (barato: nem abre o WebSocket).
 * @returns {{ ok: true } | { ok: false, status: number, motivo: string }}
 */
function admitir({ ip, falhas, conexoesAbertas, maxConexoes = MAX_CONEXOES }) {
  if (falhas && falhas.bloqueado(ip)) {
    const min = Math.max(1, Math.ceil(falhas.restanteMs(ip) / 60000));
    return { ok: false, status: 429, motivo: `Muitas tentativas com token errado deste endereço; tente de novo em ${min} min.` };
  }
  if (conexoesAbertas >= maxConexoes) return { ok: false, status: 503, motivo: 'Conexões demais abertas; tente de novo em instantes.' };
  return { ok: true };
}

/**
 * Uma conexão do lado do servidor, sem depender do WebSocket: manda o hello na hora, exige a autenticação
 * como PRIMEIRA mensagem (dentro de `prazoMs`), depois só aceita mensagens cifradas, na ordem. Qualquer
 * desvio fecha a conexão. Token errado conta como falha do IP em `falhas`.
 * @returns {{ aoReceber(raw): Promise<void>, aoFechar(): void, estado: object }}
 */
function criarConexao({ token, enviar, fechar, ip = 'desconhecido', falhas = null, runOnceFn = runOnce, prazoMs = PRAZO_AUTENTICACAO_MS, maxPorMinuto = MAX_MENSAGENS_POR_MINUTO, agora = Date.now }) {
  const canal = canalSeguro.servidor(token);
  const connState = { authed: false, history: [], ocupado: false };
  const ritmo = criarLimitador({ max: maxPorMinuto, janelaMs: 60000, maxChaves: 1, agora });
  let encerrada = false;
  let prazo = null;
  const encerrar = (codigo, motivo) => {
    if (encerrada) return;
    encerrada = true;
    clearTimeout(prazo);
    fechar(codigo, motivo);
  };
  prazo = setTimeout(() => {
    if (canal.pronto || encerrada) return;
    enviar({ type: 'auth_result', ok: false, error: 'Tempo para autenticar esgotado.' });
    encerrar(4408, 'tempo para autenticar esgotado');
  }, prazoMs);
  if (prazo.unref) prazo.unref();
  enviar(canal.hello);

  return {
    estado: connState,
    async aoReceber(raw) {
      if (encerrada) return;
      if (!ritmo.registrar('conexao')) return encerrar(4429, 'mensagens demais por minuto');
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch {
        if (!canal.pronto && falhas) falhas.registrar(ip); // varredura mandando lixo também conta
        return encerrar(4400, 'JSON inválido');
      }
      if (!canal.pronto) {
        try {
          enviar(canal.receberAuth(msg));
          connState.authed = true;
          clearTimeout(prazo);
        } catch (e) {
          const conhecido = e instanceof canalSeguro.ErroDeCanal;
          if (falhas && (!conhecido || e.codigo !== 'versao')) falhas.registrar(ip);
          enviar({ type: 'auth_result', ok: false, error: conhecido ? e.message : 'Falha na autenticação.' });
          encerrar(4401, 'autenticação recusada');
        }
        return;
      }
      let interna;
      try { interna = canal.abrir(msg); } catch { return encerrar(4400, 'mensagem cifrada inválida'); }
      await handleMessage(interna, connState, { send: (o) => { if (!encerrada) enviar(canal.selar(o)); }, runOnceFn });
    },
    aoFechar() {
      encerrada = true;
      clearTimeout(prazo);
    },
  };
}

/**
 * @param {number} [port] porta (padrão coworkPort do config; 0 = uma livre qualquer)
 * @param {{ host?: string, runOnceFn?: Function, log?: Function }} [opcoes] host para escutar (padrão: todas as
 *   interfaces, para o celular alcançar); runOnceFn e log existem para o teste de ponta a ponta.
 */
function startServer(port, { host, runOnceFn = runOnce, log = console.log } = {}) {
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
  const finalPort = port === 0 ? 0 : port || cfg.coworkPort;
  const token = canalSeguro.validarToken(getOrCreateToken());
  const falhas = criarLimitador({ max: FALHAS_POR_IP, janelaMs: JANELA_FALHAS_MS });
  // perMessageDeflate desligado: compressão abre espaço para "bomba" de descompressão e não ajuda texto cifrado.
  const wss = new WebSocket.Server({
    port: finalPort,
    ...(host ? { host } : {}),
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
    verifyClient: ({ req }, aceitar) => {
      const r = admitir({ ip: req.socket.remoteAddress || 'desconhecido', falhas, conexoesAbertas: wss.clients.size });
      if (r.ok) aceitar(true);
      else aceitar(false, r.status, r.motivo);
    },
  });

  // v0.43.3: porta ocupada derrubava o processo com um evento "error" sem tratamento (pilha técnica no terminal).
  wss.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `A porta ${finalPort} já está em uso (outro cowork aberto?). Use outra: gemini-code cowork server PORTA`
      : `Erro no servidor do cowork: ${err.message}`);
    process.exitCode = 1;
  });

  wss.on('listening', () => {
    const porta = wss.address().port;
    log(`\nGemini Cowork rodando na porta ${porta} (canal cifrado: X25519 + AES-256-GCM; o token não passa pela rede).`);
    log(`Token de acesso (guarde, o celular vai pedir): ${token}`);
    log('IPs desta máquina na rede local:');
    localIps().forEach((ip) => log(`  ws://${ip}:${porta}`));
    log('\nNo celular, rode: gemini-code cowork connect <ip> --token ' + token);
  });

  wss.on('connection', (ws, req) => {
    const ip = (req && req.socket.remoteAddress) || 'desconhecido';
    const conn = criarConexao({
      token,
      ip,
      falhas,
      runOnceFn,
      enviar: (obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
      fechar: (codigo, motivo) => ws.close(codigo, motivo),
    });
    ws.on('message', (raw) => { conn.aoReceber(raw).catch(() => ws.terminate()); });
    ws.on('close', () => conn.aoFechar());
    ws.on('error', () => conn.aoFechar());
  });

  return wss;
}

module.exports = {
  startServer, getOrCreateToken, novoToken, localIps, handleMessage, criarConexao, admitir,
  MAX_PAYLOAD_BYTES, MAX_CONEXOES, PRAZO_AUTENTICACAO_MS, FALHAS_POR_IP, JANELA_FALHAS_MS, MAX_MENSAGENS_POR_MINUTO,
};
