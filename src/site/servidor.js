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
// v0.48.1: "Parar" de verdade — /api/parar (botão, Esc) e a página fechada no meio param o agente (runOnce com
// signal): nada de seguir rodando ferramentas e gastando cota com ninguém olhando; a pergunta aberta vira "não".
// v0.49.0: duas páginas com a mesma API e a mesma segurança — "/" (voz, com a esfera) e "/chat" (conversa por texto,
// comum) — e /api/historico, para a conversa voltar à tela depois de recarregar a página.
// v0.51.0: foto, vídeo e áudio pela página. /api/enviar é a única rota que não é JSON: o arquivo cru, só nos tipos
// de mídia da lista (nunca text/plain, multipart/form-data ou x-www-form-urlencoded, os que outro site manda sem
// pedir licença), conferido pelos primeiros bytes, com a mesma chave e as mesmas travas de Host/Origin; vai para
// <pasta>/midia-recebida/ com o nome saneado, nunca sobrescreve, até 1 GB, um envio por vez. O que as ferramentas
// criam na conversa (foto editada, vídeo, capa) chega à página num evento "midia" (src/midiaGerada.js), e /api/midia
// só devolve os arquivos que este servidor registrou (recebidos ou criados nesta conversa), conferidos de novo na
// hora: nada de segredo do gemini-code, nada de link simbólico no lugar.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const stream = require('stream');

const PUBLICO = path.join(__dirname, 'publico');
const HTML = 'text/html; charset=utf-8';
const JS = 'text/javascript; charset=utf-8';
const CSS = 'text/css; charset=utf-8';
const ARQUIVOS = Object.freeze({
  '/': ['index.html', HTML],
  '/app.js': ['app.js', JS],
  '/app.css': ['app.css', CSS],
  '/chat': ['chat.html', HTML],
  '/chat.js': ['chat.js', JS],
  '/chat.css': ['chat.css', CSS],
  '/comum.js': ['comum.js', JS],
});
const CSP = [
  // v0.51.0: blob: nas imagens — a prévia da foto (a que você escolheu, ou a que veio da API com a chave) é um blob local
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "connect-src 'self'",
  "media-src 'self' blob: mediastream:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
const MAX_CORPO = 64 * 1024;
const MAX_TEXTO = 16000; // v0.49.0: cabe colar um trecho de código no chat (16 mil caracteres ainda cabem no corpo de 64 KB)
const PRAZO_PERGUNTA_MS = 120000;
const AVISO_INTERROMPIDO = '(interrompido por você)'; // o mesmo de src/agent.js (conferido em teste)
const MARCA_HOOK = '\n\n[contexto adicionado por hook do usuário]\n';
const MARCA_IMAGEM = /^\[imagem [\w.+/-]+ enviada nesta mensagem; já analisada\]$/; // src/imagens.js, depois do turno

// v0.51.0: mídia pela página
const PASTA_RECEBIDA = 'midia-recebida';
const MAX_ENVIO = 1024 * 1024 * 1024; // 1 GB: alguns minutos de vídeo de celular em 4K
const MAX_ANEXOS = 10;
const MAX_MIDIAS = 500;
const MAX_DESCARTE = 16 * 1024 * 1024; // envio recusado no meio: lê até isto para conseguir responder; além, derruba
/** Tipo do envio -> extensão. A extensão do arquivo final vem daqui, nunca do nome que a página mandou. */
const TIPOS_ENVIO = Object.freeze({
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'video/3gpp': '.3gp',
  'video/x-m4v': '.m4v', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac',
  'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
});
/** Extensão -> [tipo de mídia, Content-Type] do que a página pode mostrar. */
const MIDIA_POR_EXT = Object.freeze({
  '.jpg': ['imagem', 'image/jpeg'], '.jpeg': ['imagem', 'image/jpeg'], '.png': ['imagem', 'image/png'], '.webp': ['imagem', 'image/webp'],
  '.gif': ['imagem', 'image/gif'], '.mp4': ['video', 'video/mp4'], '.m4v': ['video', 'video/mp4'], '.mov': ['video', 'video/quicktime'],
  '.webm': ['video', 'video/webm'], '.mkv': ['video', 'video/x-matroska'], '.3gp': ['video', 'video/3gpp'], '.mp3': ['audio', 'audio/mpeg'],
  '.m4a': ['audio', 'audio/mp4'], '.aac': ['audio', 'audio/aac'], '.ogg': ['audio', 'audio/ogg'], '.opus': ['audio', 'audio/ogg'],
  '.wav': ['audio', 'audio/wav'],
});
const ROTULO_MIDIA = Object.freeze({ imagem: 'foto', video: 'vídeo', audio: 'áudio' });

const comStatus = (status, mensagem) => Object.assign(new Error(mensagem), { status });

/** "2,4 MB" */
function tamanhoLegivel(n) {
  const u = ['bytes', 'KB', 'MB', 'GB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(v < 10 ? 1 : 0).replace('.', ',') : v} ${u[i]}`;
}

/** Os primeiros bytes batem com o tipo informado? (Uma página HTML chamada de foto não entra.) */
function assinaturaOk(ext, b) {
  const txt = (i, j) => b.toString('latin1', i, j);
  if (b.length < 12) return false;
  switch (ext) {
    case '.jpg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case '.png': return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case '.gif': return /^GIF8[79]a$/.test(txt(0, 6));
    case '.webp': return txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP';
    case '.wav': return txt(0, 4) === 'RIFF' && txt(8, 12) === 'WAVE';
    case '.webm': case '.mkv': return b.readUInt32BE(0) === 0x1a45dfa3;
    case '.ogg': case '.opus': return txt(0, 4) === 'OggS';
    case '.mp3': return txt(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case '.aac': return txt(0, 4) === 'ADIF' || (b[0] === 0xff && (b[1] & 0xf6) === 0xf0);
    default: return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(txt(4, 8)); // mp4, mov, m4v, 3gp, m4a
  }
}

/**
 * O nome do arquivo recebido: só o nome (nunca uma pasta), sem controles nem caracteres que o Windows recusa, sem
 * ponto ou traço no começo, curto, e com a extensão do TIPO do arquivo (um "foto.html" mandado como image/jpeg vira
 * "foto.jpg"). A página manda o nome em encodeURIComponent (cabeçalho só aceita latin1).
 */
function nomeDoEnvio(bruto, ext) {
  const { semControlesInvisiveis } = require('../ui/textoSeguro');
  let n = String(bruto || '');
  try { n = decodeURIComponent(n); } catch { /* fica o que veio */ }
  n = semControlesInvisiveis(n.normalize('NFC')).split(/[\\/]/).pop()
    // eslint-disable-next-line no-control-regex -- tirar os caracteres de controle é o objetivo
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/[<>:"|?*%#]/g, '_').replace(/\s+/g, ' ').trim()
    .replace(/\.[^.\s]{1,8}$/, '')
    .replace(/^[.\-\s]+/, '').replace(/[.\s]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `_${n}`;
  n = Array.from(n).slice(0, 80).join('').trim();
  return `${n || 'arquivo'}${ext}`;
}

/**
 * Grava o corpo do pedido em `destino` (arquivo novo), conferindo os primeiros bytes e o tamanho no caminho.
 * Recusado no meio, lê o resto (até MAX_DESCARTE) para conseguir responder o motivo; além disso, derruba.
 */
function salvarCorpo(req, destino, { max, ext }) {
  return new Promise((resolve, reject) => {
    let feito = false;
    let erro = null;
    let tamanho = 0;
    let descartado = 0;
    let cabeca = Buffer.alloc(0);
    let conferido = false;
    const ws = fs.createWriteStream(destino, { flags: 'wx', mode: 0o600 });
    // na falha, só responde depois que o arquivo fechou: senão um "open" ainda pendente recriava o temporário depois de apagado
    const fim = (e, v) => {
      if (feito) return;
      feito = true;
      if (!e) { resolve(v); return; }
      ws.destroy();
      if (ws.closed) reject(e); else ws.once('close', () => reject(e));
    };
    const falhar = (e) => { if (erro) return; erro = e; ws.destroy(); req.resume(); };
    ws.on('error', (e) => { falhar(e); if (req.complete) fim(erro); });
    req.on('data', (d) => {
      if (erro) { descartado += d.length; if (descartado > MAX_DESCARTE) { req.destroy(); fim(erro); } return; }
      tamanho += d.length;
      if (tamanho > max) return falhar(comStatus(413, `arquivo grande demais (máx. ${tamanhoLegivel(max)})`));
      if (!conferido) {
        cabeca = Buffer.concat([cabeca, d.subarray(0, 16)]).subarray(0, 16);
        if (cabeca.length >= 12) {
          if (!assinaturaOk(ext, cabeca)) return falhar(comStatus(415, 'o conteúdo do arquivo não é do tipo informado'));
          conferido = true;
        }
      }
      if (!ws.write(d)) { req.pause(); ws.once('drain', () => req.resume()); }
    });
    req.on('end', () => {
      if (!erro && !conferido) falhar(comStatus(400, 'arquivo vazio ou cortado'));
      if (erro) return fim(erro);
      ws.end();
      ws.once('finish', () => fim(null, tamanho));
    });
    req.on('error', (e) => { falhar(e); fim(erro); });
    req.on('close', () => { if (!req.complete) { falhar(new Error('a conexão caiu no meio do envio')); fim(erro); } });
  });
}

/** Põe o arquivo recebido no nome final sem nunca sobrescrever (-2, -3...): link (atômico) ou, sem link, cópia exclusiva. */
async function publicar(tmp, dir, nome) {
  const ext = path.extname(nome);
  const base = nome.slice(0, nome.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const alvo = path.join(dir, i === 1 ? nome : `${base}-${i}${ext}`);
    try {
      try { fs.linkSync(tmp, alvo); } catch (e) {
        if (e.code === 'EEXIST') throw e;
        await fs.promises.copyFile(tmp, alvo, fs.constants.COPYFILE_EXCL); // cartão de memória, alguns Android: sem link
      }
      fs.rmSync(tmp, { force: true });
      return alvo;
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw comStatus(409, 'arquivos demais com esse nome na pasta');
}

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
 * O histórico do agente (formato do Gemini) -> o que a página mostra: as falas da pessoa e as respostas do agente, com
 * as ferramentas que ele usou. Resultados de ferramenta, pensamentos do modelo e instruções internas (hooks) ficam de
 * fora. Um turno com vários textos (antes e depois das ferramentas) vira uma mensagem só, como aparece ao vivo.
 * @returns {{ quem: 'voce'|'agente'|'aviso', texto: string, ferramentas?: string[], interrompido?: true }[]}
 */
function paraExibicao(historico, { max = 200 } = {}) {
  const { semControlesInvisiveis } = require('../ui/textoSeguro');
  const out = [];
  let agente = null;
  const fecharAgente = () => {
    if (agente && (agente.texto || agente.ferramentas.length || agente.interrompido)) out.push(agente);
    agente = null;
  };
  for (const m of Array.isArray(historico) ? historico : []) {
    if (!m || !Array.isArray(m.parts)) continue;
    const textos = m.parts.filter((p) => p && typeof p.text === 'string' && !p.thought && !MARCA_IMAGEM.test(p.text)).map((p) => p.text);
    if (m.role === 'user') {
      if (m.parts.some((p) => p && p.functionResponse)) continue; // resultado de ferramenta: não é fala de ninguém
      const t = textos.join('\n');
      if (!t.trim() || t.startsWith('[hook Stop do usuário]')) continue;
      fecharAgente();
      if (t.startsWith('[...histórico do meio da conversa foi omitido')) { out.push({ quem: 'aviso', texto: 'O meio desta conversa foi resumido para caber.' }); continue; }
      const corte = t.indexOf(MARCA_HOOK);
      out.push({ quem: 'voce', texto: corte >= 0 ? t.slice(0, corte) : t });
    } else if (m.role === 'model') {
      if (!agente) agente = { quem: 'agente', texto: '', ferramentas: [] };
      for (const p of m.parts) {
        const nome = p && p.functionCall && p.functionCall.name;
        if (nome && agente.ferramentas.length < 20 && !agente.ferramentas.includes(String(nome).slice(0, 80))) agente.ferramentas.push(String(nome).slice(0, 80));
      }
      const t = textos.join('').trim();
      if (t === AVISO_INTERROMPIDO) agente.interrompido = true;
      else if (t) agente.texto = agente.texto ? `${agente.texto}\n\n${t}` : t;
    }
  }
  fecharAgente();
  return out.slice(-max).map((x) => {
    const y = { ...x, texto: semControlesInvisiveis(String(x.texto)).slice(0, 50000) };
    if (y.quem === 'agente' && !y.ferramentas.length) delete y.ferramentas;
    return y;
  });
}

/**
 * Como o modo site conversa: o agente de sempre (runOnce) ou um aliado (mesmo caminho do "aliados chat").
 * @returns {(texto, { historico, onText, onFerramenta, onAlerta, signal }) => Promise<{ texto, historico, interrompido? }>}
 */
function conversarComAgente({ aliado = null, runOnce = (...a) => require('../agent').runOnce(...a) } = {}) {
  const resultado = (r) => ({ texto: r.text, historico: r.history, ...(r.interrompido ? { interrompido: true } : {}) });
  // v0.51.0: `imagens` — as fotos que a pessoa mandou pela página, para o modelo ver (como o /imagem do terminal)
  return async (texto, { historico, onText, onFerramenta, onAlerta, signal, imagens = [] }) => {
    if (!aliado) return resultado(await runOnce(texto, { history: historico, onText, onFerramenta, signal, imagens }));
    const pa = require('../personalAgents');
    const { opcoes, ctx, alerta } = pa.prepararTurno(aliado.store, aliado.agente, texto, {});
    if (alerta) onAlerta(alerta);
    return resultado(await pa.comAgente(ctx, () => runOnce(texto, { history: historico, ...opcoes, onText, onFerramenta, signal, imagens })));
  };
}

/**
 * @param {object} [o]
 * @param {string} [o.token]
 * @param {Function} [o.conversar] ver conversarComAgente
 * @param {(fn) => () => void} [o.definirPerguntador]
 * @param {number} [o.prazoPerguntaMs]
 * @param {(texto: string) => void} [o.log] o que aparece no terminal (o pedido e o fim)
 * @param {string|null} [o.aliado] nome do aliado, só para a página mostrar com quem você conversa
 * @param {string} [o.pasta] v0.51.0: a pasta do projeto (os arquivos recebidos vão para <pasta>/midia-recebida)
 * @param {number} [o.maxEnvio] v0.51.0: tamanho máximo de um arquivo recebido
 * @param {(nome: string) => boolean} [o.ligarFerramenta] v0.51.0: liga uma ferramenta sob demanda nesta execução
 */
function criarServidorSite({
  token = crypto.randomBytes(24).toString('base64url'),
  conversar = conversarComAgente(),
  definirPerguntador = (fn) => require('../ui/prompt').definirPerguntador(fn),
  prazoPerguntaMs = PRAZO_PERGUNTA_MS,
  log = () => {},
  aliado = null,
  pasta = process.cwd(),
  maxEnvio = MAX_ENVIO,
  ligarFerramenta = (nome) => require('../tools').ligarNaSessao(nome),
} = {}) {
  const { paraExibir, semControlesInvisiveis } = require('../ui/textoSeguro');
  const conteudo = {};
  for (const [rota, [arquivo]] of Object.entries(ARQUIVOS)) conteudo[rota] = fs.readFileSync(path.join(PUBLICO, arquivo));
  let historico = [];
  let ocupado = false;
  let parador = null; // AbortController da conversa em andamento
  const pendentes = new Map();
  // v0.51.0: mídia — o que este servidor pode mostrar (id -> arquivo conferido), os turnos que tiveram mídia (para a
  // conversa voltar com as fotos depois de recarregar) e o envio em andamento (um por vez)
  const midias = new Map();
  let turnos = [];
  let enviando = false;

  let pastaReal = pasta;
  try { pastaReal = fs.realpathSync(pasta); } catch { /* fica como veio */ }
  // o caminho que o agente recebe: relativo à pasta do projeto (os arquivos registrados estão pelo caminho real)
  const relativo = (f) => {
    const r = path.relative(pastaReal, f);
    return !r || r.startsWith('..') || path.isAbsolute(r) ? f : r.split(path.sep).join('/');
  };
  const publico = (id) => {
    const m = midias.get(id);
    return m ? { id, nome: semControlesInvisiveis(m.nome), midia: m.midia, tamanho: m.tamanho } : null;
  };

  /** Registra um arquivo que a página pode ver: só mídia conhecida, arquivo comum, fora dos segredos do gemini-code. */
  function registrarMidia(caminho, origem) {
    const { isSecret, isProtected } = require('../tools/protectedPaths');
    let real;
    let st;
    try { real = fs.realpathSync(caminho); st = fs.statSync(real); } catch { return null; }
    const tipo = MIDIA_POR_EXT[path.extname(real).toLowerCase()];
    if (!tipo || !st.isFile() || st.size === 0 || isSecret(real) || isProtected(real)) return null;
    for (const [id, m] of midias) if (m.caminho === real && m.tamanho === st.size && m.mtime === st.mtimeMs) return publico(id);
    const id = crypto.randomBytes(12).toString('base64url');
    midias.set(id, { caminho: real, nome: path.basename(real).slice(0, 200), midia: tipo[0], mime: tipo[1], tamanho: st.size, mtime: st.mtimeMs, origem });
    while (midias.size > MAX_MIDIAS) midias.delete(midias.keys().next().value);
    return publico(id);
  }

  /** <pasta>/midia-recebida: criada na primeira vez (com um .gitignore, para as fotos não irem para o git); nunca um link. */
  function pastaRecebida() {
    const { isSecret, isProtected } = require('../tools/protectedPaths');
    const dir = path.join(fs.realpathSync(pasta), PASTA_RECEBIDA);
    let st = null;
    try { st = fs.lstatSync(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!st) {
      fs.mkdirSync(dir, { mode: 0o700 });
      try { fs.writeFileSync(path.join(dir, '.gitignore'), '# fotos, vídeos e áudios recebidos pelo modo site do gemini-code: fora do git\n*\n', { flag: 'wx' }); } catch { /* já existe */ }
      st = fs.lstatSync(dir);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw comStatus(409, `"${PASTA_RECEBIDA}" na pasta do projeto não é uma pasta comum (é um link?): não guardo nada aí`);
    if (isSecret(dir) || isProtected(dir)) throw comStatus(409, 'a pasta do projeto é protegida do gemini-code: não guardo nada aí');
    // o que sobrou de um envio cortado quando o programa fechou no meio (mais de 1 dia): sai
    try {
      for (const n of fs.readdirSync(dir)) {
        if (!n.startsWith('.recebendo-')) continue;
        const f = path.join(dir, n);
        const s = fs.lstatSync(f);
        if (s.isFile() && Date.now() - s.mtimeMs > 24 * 3600 * 1000) fs.rmSync(f, { force: true });
      }
    } catch { /* melhor esforço */ }
    return dir;
  }

  /** POST /api/enviar: o arquivo cru (já com a chave conferida). */
  async function receber(req, res) {
    // recusado antes de ler: fecha a conexão (senão o Node lia, e jogava fora, o arquivo inteiro para reaproveitá-la)
    const recusar = (status, erro) => { res.setHeader('connection', 'close'); return json(res, status, { erro }); };
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (tipo === 'image/heic' || tipo === 'image/heif') {
      return recusar(415, 'foto HEIC (do iPhone) ainda não dá para editar aqui: no iPhone, Ajustes > Câmera > Formatos > "Mais Compatível", ou mande pela galeria como JPEG');
    }
    const ext = TIPOS_ENVIO[tipo];
    if (!ext) return recusar(415, 'tipo de arquivo não aceito: mande foto (jpg, png, webp, gif), vídeo (mp4, mov, webm, mkv, 3gp) ou áudio (mp3, m4a, aac, ogg, wav)');
    if (Number(req.headers['content-length']) > maxEnvio) return recusar(413, `arquivo grande demais (máx. ${tamanhoLegivel(maxEnvio)})`);
    if (enviando) return recusar(409, 'espere o envio anterior terminar');
    enviando = true;
    let tmp = null;
    try {
      const dir = pastaRecebida();
      tmp = path.join(dir, `.recebendo-${crypto.randomBytes(8).toString('hex')}`);
      const tamanho = await salvarCorpo(req, tmp, { max: maxEnvio, ext });
      const final = await publicar(tmp, dir, nomeDoEnvio(req.headers['x-nome'], ext));
      tmp = null;
      const m = registrarMidia(final, 'voce');
      if (!m) throw comStatus(500, 'não consegui registrar o arquivo recebido');
      // um vídeo (ou o áudio de um vídeo): a ferramenta "video" entra nesta execução (é sob demanda)
      if (m.midia !== 'imagem') ligarFerramenta('video');
      log(`[site] recebido: ${relativo(final)} (${tamanhoLegivel(tamanho)})`);
      return json(res, 200, { ok: true, ...m, caminho: relativo(final) });
    } catch (e) {
      if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch { /* melhor esforço */ } tmp = null; }
      const status = e.status || (e.code === 'ENOSPC' ? 507 : 500);
      return json(res, status, { erro: e.status ? e.message : status === 507 ? 'sem espaço no aparelho para guardar o arquivo' : 'não consegui guardar o arquivo' });
    } finally {
      if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch { /* melhor esforço */ } }
      enviando = false;
    }
  }

  /** POST /api/midia {id}: o arquivo, se ainda for o mesmo que foi registrado (nada de link no lugar, nada de segredo). */
  function servirMidia(res, corpo) {
    const m = midias.get(typeof corpo.id === 'string' ? corpo.id : '');
    const sumiu = 'essa mídia não está mais disponível';
    if (!m) return json(res, 404, { erro: sumiu });
    const { isSecret, isProtected } = require('../tools/protectedPaths');
    let fd = null;
    try {
      const real = fs.realpathSync(m.caminho);
      if (real !== m.caminho || isSecret(real) || isProtected(real)) throw comStatus(404, sumiu);
      fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const st = fs.fstatSync(fd);
      if (!st.isFile()) throw comStatus(404, sumiu);
      res.writeHead(200, {
        ...BASE, 'content-type': m.mime, 'content-length': st.size,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(m.nome)}`,
      });
      const rs = fs.createReadStream('', { fd, autoClose: true });
      fd = null;
      stream.pipeline(rs, res, () => {});
    } catch (e) {
      if (fd !== null) fs.closeSync(fd);
      return json(res, e.status || 404, { erro: e.status ? e.message : sumiu });
    }
    return undefined;
  }

  /** O histórico para a página, com as fotos/vídeos de cada turno de volta no lugar (casados pelo texto da pessoa). */
  function comMidias(msgs) {
    let k = 0;
    for (let i = 0; i < msgs.length && turnos.length; i++) {
      if (msgs[i].quem !== 'voce') continue;
      let j = k;
      while (j < turnos.length && turnos[j].texto !== msgs[i].texto) j++;
      if (j >= turnos.length) continue;
      k = j + 1;
      const t = turnos[j];
      if (t.sufixo && msgs[i].texto.endsWith(t.sufixo)) msgs[i].texto = msgs[i].texto.slice(0, msgs[i].texto.length - t.sufixo.length).trimEnd();
      const anexos = t.anexos.map(publico).filter(Boolean);
      if (anexos.length) msgs[i].midias = anexos;
      const gerados = t.gerados.map(publico).filter(Boolean);
      if (gerados.length && msgs[i + 1] && msgs[i + 1].quem === 'agente') msgs[i + 1].midias = gerados;
    }
    return msgs;
  }

  /** Para a conversa em andamento (se houver): o agente para no próximo ponto seguro e a pergunta aberta vira "não". */
  function parar(motivo) {
    if (!parador) return false;
    if (!parador.signal.aborted) {
      parador.abort();
      // v0.49.1: um comando de terminal em andamento é interrompido como num terminal (src/emAndamento.js)
      const comandos = require('../emAndamento').interromperTodos();
      log(`[site] parado (${motivo})${comandos ? ` — ${comandos} comando(s) interrompido(s)` : ''}`);
    }
    for (const [, p] of pendentes) p.responder('');
    return true;
  }

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
    const auth = String(req.headers.authorization || '');
    const autorizado = auth.startsWith('Bearer ') && iguais(auth.slice(7), token);
    const SEM_CHAVE = { erro: 'token inválido — abra o endereço completo que o terminal mostrou' };
    // v0.51.0: a única rota que não é JSON (o arquivo cru); a chave vem antes de ler qualquer byte
    if (caminho === '/api/enviar') {
      if (autorizado) return receber(req, res);
      res.setHeader('connection', 'close'); // sem ler o arquivo: senão o Node lia (e jogava fora) o envio inteiro
      return json(res, 401, SEM_CHAVE);
    }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { erro: 'use application/json' });
    if (!autorizado) return json(res, 401, SEM_CHAVE);
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
    if (caminho === '/api/parar') return json(res, 200, { ok: true, parando: parar('pela página') });
    if (caminho === '/api/historico') {
      return json(res, 200, { mensagens: comMidias(paraExibicao(historico)), ocupado, aliado: aliado ? semControlesInvisiveis(String(aliado)).slice(0, 80) : null });
    }
    if (caminho === '/api/midia') return servirMidia(res, corpo);
    if (caminho === '/api/limpar') {
      if (ocupado) return json(res, 409, { erro: 'espere a resposta terminar' });
      historico = [];
      turnos = [];
      midias.clear(); // os arquivos ficam no disco; a página só deixa de mostrá-los
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { erro: 'não encontrado' });
  }

  async function conversa(res, corpo) {
    const escrito = typeof corpo.texto === 'string' ? semControlesInvisiveis(corpo.texto).trim() : '';
    // v0.51.0: anexos = ids de arquivos que a página enviou antes (/api/enviar)
    let anexos = [];
    if (corpo.anexos !== undefined) {
      const ok = Array.isArray(corpo.anexos) && corpo.anexos.length <= MAX_ANEXOS
        && corpo.anexos.every((id) => typeof id === 'string' && midias.has(id) && midias.get(id).origem === 'voce');
      if (!ok) return json(res, 400, { erro: 'anexo desconhecido ou demais (envie o arquivo de novo)' });
      anexos = [...new Set(corpo.anexos)];
    }
    if ((!escrito && !anexos.length) || escrito.length > MAX_TEXTO) return json(res, 400, { erro: `mensagem vazia ou longa demais (máx. ${MAX_TEXTO})` });
    if (ocupado) return json(res, 409, { erro: 'ainda estou respondendo a mensagem anterior' });
    // o agente fica sabendo onde estão os arquivos (e vê as fotos, como no /imagem do terminal)
    const sufixo = anexos.length
      ? `[arquivos que enviei pela página: ${anexos.map((id) => { const m = midias.get(id); return `${relativo(m.caminho)} (${ROTULO_MIDIA[m.midia]}, ${tamanhoLegivel(m.tamanho)})`; }).join('; ')}]`
      : '';
    const texto = escrito && sufixo ? `${escrito}\n\n${sufixo}` : escrito || sufixo;
    // no máximo ~15 MB de fotos por mensagem para o modelo (o pedido tem limite); as outras ele recebe só pelo caminho
    const { lerImagem, MAX_BYTES } = require('../imagens');
    const imagens = [];
    let bytes = 0;
    for (const id of anexos) {
      const m = midias.get(id);
      if (m.midia !== 'imagem' || bytes + m.tamanho > MAX_BYTES) continue;
      try { imagens.push(lerImagem(m.caminho)); bytes += m.tamanho; } catch { /* sumiu ou mudou: ele ainda recebe o caminho */ }
    }
    ocupado = true;
    const ctrl = new AbortController();
    parador = ctrl;
    res.writeHead(200, { ...BASE, 'content-type': 'application/x-ndjson; charset=utf-8' });
    let aberto = true;
    let terminou = false;
    // a página fechou (ou recarregou) no meio: ninguém está olhando, então o agente para
    res.on('close', () => { aberto = false; if (!terminou) parar('a página fechou'); });
    const enviar = (ev) => { if (aberto && !res.writableEnded) res.write(`${JSON.stringify(ev)}\n`); };
    log(`[site] você: ${texto.slice(0, 200)}`);
    const desfazer = definirPerguntador((pergunta) => new Promise((resolve) => {
      if (!aberto || ctrl.signal.aborted) return resolve(''); // página fechada ou "Parar": ninguém responde = "não"
      const id = crypto.randomBytes(8).toString('hex');
      const timer = setTimeout(() => { pendentes.delete(id); enviar({ tipo: 'pergunta-expirou', id }); resolve(''); }, prazoPerguntaMs);
      pendentes.set(id, { responder: (r) => { clearTimeout(timer); pendentes.delete(id); resolve(r); } });
      enviar({ tipo: 'pergunta', id, texto: paraExibir(pergunta).trim() });
    }));
    // v0.51.0: o que as ferramentas criarem agora (foto editada, vídeo...) aparece na página
    const gerados = [];
    const pararDeOuvir = require('../midiaGerada').observar((caminho) => {
      const m = registrarMidia(caminho, 'agente');
      if (!m || gerados.includes(m.id)) return;
      gerados.push(m.id);
      enviar({ tipo: 'midia', ...m });
    });
    enviar({ tipo: 'estado', estado: 'pensando' });
    try {
      const r = await conversar(texto, {
        historico,
        onText: (t) => enviar({ tipo: 'parcial', texto: semControlesInvisiveis(String(t)) }),
        onFerramenta: (nome) => enviar({ tipo: 'ferramenta', nome: String(nome).slice(0, 80) }),
        onAlerta: (t) => enviar({ tipo: 'alerta', texto: String(t) }),
        signal: ctrl.signal,
        imagens,
      });
      if (r && Array.isArray(r.historico)) {
        historico = r.historico;
        if (anexos.length || gerados.length) {
          turnos.push({ texto, sufixo, anexos, gerados: [...gerados] });
          if (turnos.length > 200) turnos.shift();
        }
      }
      enviar({ tipo: 'resposta', texto: semControlesInvisiveis(String((r && r.texto) || '')), ...(r && r.interrompido ? { interrompido: true } : {}) });
    } catch (e) {
      enviar({ tipo: 'erro', texto: `Erro: ${e && e.message ? e.message : e}` });
    } finally {
      terminou = true;
      pararDeOuvir();
      desfazer();
      for (const [, p] of pendentes) p.responder(''); // pergunta sem resposta = "não"
      if (parador === ctrl) parador = null;
      ocupado = false;
      enviar({ tipo: 'fim' });
      if (!res.writableEnded) res.end();
      log(ctrl.signal.aborted ? '[site] conversa parada' : '[site] resposta enviada');
    }
  }

  /** O endereço completo (com a chave) de uma das páginas: '/' (voz) ou '/chat'. */
  const endereco = (pagina = '/') => `http://127.0.0.1:${servidor.address().port}${pagina === '/chat' ? '/chat' : '/'}#t=${token}`;
  return { servidor, token, endereco };
}

module.exports = {
  criarServidorSite, conversarComAgente, paraExibicao, CSP, MAX_TEXTO, AVISO_INTERROMPIDO,
  PASTA_RECEBIDA, MAX_ENVIO, TIPOS_ENVIO, nomeDoEnvio, assinaturaOk, tamanhoLegivel,
};
