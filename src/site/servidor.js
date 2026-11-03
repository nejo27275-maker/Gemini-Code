// src/site/servidor.js (v0.48.0) — o "modo site": conversar com o agente pelo navegador, por texto ou por VOZ, com a
// esfera animada (src/site/publico/). Só neste aparelho (127.0.0.1). Um servidor local que roda um agente com
// ferramentas precisa ser fechado:
//  - token aleatório a cada execução: a página recebe no fragmento da URL (#t=...: não vai para o servidor, nem para
//    log, nem no Referer) e manda em cada chamada no cabeçalho Authorization. Outro site aberto no seu navegador não
//    sabe o token, e um cabeçalho próprio obriga o navegador a pedir licença (CORS), que este servidor nunca dá;
//  - Host conferido (127.0.0.1/localhost na porta certa): contra DNS rebinding;
//  - Origin, quando vem, tem de ser a própria página; só JSON; corpo até 64 KB; uma conversa por vez;
//  - CSP fechada (só os nossos três arquivos, nada de fora), sem moldura (frame-ancestors), nosniff, no-referrer;
//  - as confirmações das ferramentas aparecem na página (src/ui/prompt.js, definirPerguntador) e, sem resposta,
//    expiram em "não". O texto mostrado passa por paraExibir; a página só usa textContent (nada vira HTML).
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PUBLICO = path.join(__dirname, 'publico');
const ARQUIVOS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
});
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'",
  "media-src 'self' blob: mediastream:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
const MAX_CORPO = 64 * 1024;
const MAX_TEXTO = 4000;
const PRAZO_PERGUNTA_MS = 120000;

const BASE = Object.freeze({
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
  'content-security-policy': CSP, 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'microphone=(self), camera=(), geolocation=(), payment=()',
});

function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Passou do limite: para de guardar e lê o resto até o fim, para conseguir RESPONDER 413 (derrubar a conexão no meio
// do envio dava "socket hang up" do outro lado); muito além do limite, aí sim derruba.
function lerCorpo(req, max) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (d) => {
      tamanho += d.length;
      if (tamanho > max * 16) { req.destroy(); return; }
      if (tamanho <= max) partes.push(d);
    });
    req.on('end', () => (tamanho > max ? reject(Object.assign(new Error('corpo grande demais'), { status: 413 })) : resolve(Buffer.concat(partes).toString('utf8'))));
    req.on('error', reject);
    req.on('close', () => { if (!req.complete) reject(new Error('conexão fechada')); });
  });
}

/**
 * Como o modo site conversa: o agente de sempre (runOnce) ou um aliado (mesmo caminho do "aliados chat").
 * @returns {(texto, { historico, onText, onFerramenta, onAlerta }) => Promise<{ texto, historico }>}
 */
function conversarComAgente({ aliado = null, runOnce = (...a) => require('../agent').runOnce(...a) } = {}) {
  return async (texto, { historico, onText, onFerramenta, onAlerta }) => {
    if (!aliado) {
      const r = await runOnce(texto, { history: historico, onText, onFerramenta });
      return { texto: r.text, historico: r.history };
    }
    const pa = require('../personalAgents');
    const { opcoes, ctx, alerta } = pa.prepararTurno(aliado.store, aliado.agente, texto, {});
    if (alerta) onAlerta(alerta);
    const r = await pa.comAgente(ctx, () => runOnce(texto, { history: historico, ...opcoes, onText, onFerramenta }));
    return { texto: r.text, historico: r.history };
  };
}

/**
 * @param {object} [o]
 * @param {string} [o.token]
 * @param {Function} [o.conversar] ver conversarComAgente
 * @param {(fn) => () => void} [o.definirPerguntador]
 * @param {number} [o.prazoPerguntaMs]
 * @param {(texto: string) => void} [o.log] o que aparece no terminal (o pedido e o fim)
 */
function criarServidorSite({
  token = crypto.randomBytes(24).toString('base64url'),
  conversar = conversarComAgente(),
  definirPerguntador = (fn) => require('../ui/prompt').definirPerguntador(fn),
  prazoPerguntaMs = PRAZO_PERGUNTA_MS,
  log = () => {},
} = {}) {
  const { paraExibir, semControlesInvisiveis } = require('../ui/textoSeguro');
  const conteudo = {};
  for (const [rota, [arquivo]] of Object.entries(ARQUIVOS)) conteudo[rota] = fs.readFileSync(path.join(PUBLICO, arquivo));
  let historico = [];
  let ocupado = false;
  const pendentes = new Map();

  const json = (res, status, obj) => {
    res.writeHead(status, { ...BASE, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const servidor = http.createServer((req, res) => {
    atender(req, res).catch(() => {
      // nunca deixa um erro escapar do callback (derrubaria o processo)
      if (!res.headersSent) json(res, 500, { erro: 'erro interno' }); else res.destroy();
    });
  });

  async function atender(req, res) {
    const porta = servidor.address().port;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${porta}` && host !== `localhost:${porta}`) return json(res, 421, { erro: 'Host inválido' });
    const origem = req.headers.origin;
    if (origem !== undefined && origem !== `http://127.0.0.1:${porta}` && origem !== `http://localhost:${porta}`) return json(res, 403, { erro: 'origem não permitida' });
    let caminho;
    try { caminho = new URL(req.url, 'http://x').pathname; } catch { return json(res, 400, { erro: 'endereço inválido' }); }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const a = ARQUIVOS[caminho];
      if (!a) return json(res, 404, { erro: 'não encontrado' });
      res.writeHead(200, { ...BASE, 'content-type': a[1], 'content-length': conteudo[caminho].length });
      return res.end(req.method === 'HEAD' ? undefined : conteudo[caminho]);
    }
    // OPTIONS (o "pedido de licença" do CORS) cai aqui: sem cabeçalhos de CORS, outro site nunca chama a API
    if (req.method !== 'POST') return json(res, 405, { erro: 'método não permitido' });
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { erro: 'use application/json' });
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !iguais(auth.slice(7), token)) return json(res, 401, { erro: 'token inválido — abra o endereço completo que o terminal mostrou' });
    let corpo;
    try { corpo = JSON.parse(await lerCorpo(req, MAX_CORPO)); } catch (e) { return json(res, e.status === 413 ? 413 : 400, { erro: e.status === 413 ? 'mensagem grande demais' : 'JSON inválido' }); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json(res, 400, { erro: 'JSON inválido' });

    if (caminho === '/api/conversa') return conversa(res, corpo);
    if (caminho === '/api/confirmar') {
      const p = pendentes.get(String(corpo.id));
      if (!p) return json(res, 404, { erro: 'essa pergunta não existe mais (expirou?)' });
      p.responder(typeof corpo.resposta === 'string' ? corpo.resposta.slice(0, 200) : '');
      return json(res, 200, { ok: true });
    }
    if (caminho === '/api/limpar') {
      if (ocupado) return json(res, 409, { erro: 'espere a resposta terminar' });
      historico = [];
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { erro: 'não encontrado' });
  }

  async function conversa(res, corpo) {
    const texto = typeof corpo.texto === 'string' ? semControlesInvisiveis(corpo.texto).trim() : '';
    if (!texto || texto.length > MAX_TEXTO) return json(res, 400, { erro: `mensagem vazia ou longa demais (máx. ${MAX_TEXTO})` });
    if (ocupado) return json(res, 409, { erro: 'ainda estou respondendo a mensagem anterior' });
    ocupado = true;
    res.writeHead(200, { ...BASE, 'content-type': 'application/x-ndjson; charset=utf-8' });
    let aberto = true;
    res.on('close', () => { aberto = false; });
    const enviar = (ev) => { if (aberto && !res.writableEnded) res.write(`${JSON.stringify(ev)}\n`); };
    log(`[site] você: ${texto.slice(0, 200)}`);
    const desfazer = definirPerguntador((pergunta) => new Promise((resolve) => {
      if (!aberto) return resolve(''); // a página fechou: ninguém para responder = "não"
      const id = crypto.randomBytes(8).toString('hex');
      const timer = setTimeout(() => { pendentes.delete(id); enviar({ tipo: 'pergunta-expirou', id }); resolve(''); }, prazoPerguntaMs);
      pendentes.set(id, { responder: (r) => { clearTimeout(timer); pendentes.delete(id); resolve(r); } });
      enviar({ tipo: 'pergunta', id, texto: paraExibir(pergunta).trim() });
    }));
    enviar({ tipo: 'estado', estado: 'pensando' });
    try {
      const r = await conversar(texto, {
        historico,
        onText: (t) => enviar({ tipo: 'parcial', texto: semControlesInvisiveis(String(t)) }),
        onFerramenta: (nome) => enviar({ tipo: 'ferramenta', nome: String(nome).slice(0, 80) }),
        onAlerta: (t) => enviar({ tipo: 'alerta', texto: String(t) }),
      });
      if (r && Array.isArray(r.historico)) historico = r.historico;
      enviar({ tipo: 'resposta', texto: semControlesInvisiveis(String((r && r.texto) || '')) });
    } catch (e) {
      enviar({ tipo: 'erro', texto: `Erro: ${e && e.message ? e.message : e}` });
    } finally {
      desfazer();
      for (const [, p] of pendentes) p.responder(''); // pergunta sem resposta = "não"
      ocupado = false;
      enviar({ tipo: 'fim' });
      if (!res.writableEnded) res.end();
      log('[site] resposta enviada');
    }
  }

  return { servidor, token, endereco: () => `http://127.0.0.1:${servidor.address().port}/#t=${token}` };
}

module.exports = { criarServidorSite, conversarComAgente, CSP, MAX_TEXTO };
