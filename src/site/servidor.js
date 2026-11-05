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
// v0.52.0: o site só precisa da chave do Gemini — a página pede quando falta (/api/chave: conferida na API, salva
// como o "config set-key", nunca devolvida nem escrita no log) e, com a chave, tudo vai direto ao Gemini (o modelo
// local do modo híbrido não entra: é o Gemini que vê as fotos e cria imagens). E o modo até terminar: a página fechada
// não para o agente, as perguntas esperam a página voltar, e /api/historico mostra o andamento.
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
const PRAZO_PERGUNTA_ATE_TERMINAR_MS = 30 * 60 * 1000; // no modo até terminar, a pergunta espera a pessoa voltar
const CHAVE_OK = /^[A-Za-z0-9_.-]{20,200}$/;
const MAX_TENTATIVAS_CHAVE = 10; // por 10 minutos (cada uma é uma chamada ao Google)

/**
 * A chave do Gemini de verdade: o estado (sem nunca devolver a chave), conferir com a API e salvar. Trocável nos testes.
 * precisa = o site depende do Gemini (modo híbrido ou gemini, sem modo solo nem nuvem openai), não há chave e não há
 * modelo local instalado para seguir sem ela.
 */
function chavesPadrao() {
  const config = () => require('../config');
  return {
    estado() {
      const cfg = config().loadConfig();
      const provider = cfg.provider || 'hybrid';
      const solo = require('../solo').ativo(cfg);
      const dependeDoGemini = !solo && (provider === 'hybrid' || provider === 'gemini') && cfg.hybridCloud !== 'openai';
      let local = false;
      if (provider === 'hybrid') { try { local = fs.existsSync(require('../localServer').caminhos(process.env, cfg).modelo); } catch { /* sem local */ } }
      const configurada = Boolean(cfg.apiKey);
      return { configurada, precisa: dependeDoGemini && !configurada && !local, protegida: Boolean(cfg.apiKeyLocked) && !configurada };
    },
    async validar(chave) {
      // a lista de modelos: a chamada mais barata que confere a chave (não gasta cota de geração)
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': chave }, signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (res.ok) return true;
      if (res.status === 400 || res.status === 401 || res.status === 403) throw Object.assign(new Error('chave recusada'), { recusada: true });
      return false; // 429, 5xx: não deu para conferir agora
    },
    salvar(chave) { config().saveConfig({ apiKey: chave }); },
  };
}

// v0.53.2: ouvir pelo microfone do aparelho com o Termux:API, quando o navegador não deixa (o Chrome recusa o
// microfone, ou não tem reconhecimento de voz). O app Termux:API tem a sua própria permissão do microfone. Sem o app,
// o termux-speech-to-text fica pendurado para sempre: por isso o prazo, e quem para mata o comando e o que ele abriu.
// Sem argumentos: nada da página entra no comando.
const PRAZO_OUVIR_MS = 45000;
/**
 * A saída do termux-speech-to-text: os parciais, um por linha, cada um com tudo o que ouviu até ali (vale o último).
 * Sem a permissão do microfone, o Termux:API escreve o pedido no lugar do texto (e abre a janela para permitir).
 */
function lerSaidaDoTermux(saida) {
  const linhas = String(saida || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linhas.some((l) => /^Please grant the following permissions? to use this command/i.test(l))) return { texto: '', permissao: true };
  return { texto: linhas.length ? linhas[linhas.length - 1] : '', permissao: false };
}
/** Troca os controles C0 (e o DEL) por espaço: o texto ouvido vai para o modelo e para o log do terminal. */
const semControlesC0 = (t) => Array.from(String(t), (c) => { const cp = c.codePointAt(0); return cp < 0x20 || cp === 0x7f ? ' ' : c; }).join('');
/**
 * O termux-speech-to-text roda quando a pessoa toca no microfone, fora de qualquer sandbox: como o bwrap e o python3
 * (src/sandbox.js, acharProgramaConfiavel), só um que o modelo não pode ter plantado (fora do projeto, da temporária e
 * das pastas liberadas). No Termux ele fica em $PREFIX/bin.
 */
function programaDoTermux() {
  if (process.platform === 'win32' || process.env.GEMINI_CODE_FORCE_NO_TERMUX_API === '1') return null;
  try {
    const sb = require('../sandbox');
    let extras = [];
    try { extras = require('../config').loadConfig().pastasGravaveis || []; } catch { /* sem config: só as áreas de sempre */ }
    return sb.acharProgramaConfiavel('termux-speech-to-text', { proibidas: sb.areasDoModelo({ extras }) });
  } catch { return null; }
}
// nenhum fica ouvindo depois que o gemini-code sai (Ctrl+C no terminal)
const ouvintesVivos = new Set();
let saidaVigiada = false;
function matarOuvinte(filho) {
  if (process.platform !== 'win32') require('../sandbox').matarDescendentes(filho.pid, 'SIGKILL');
  try { filho.kill('SIGKILL'); } catch { /* já saiu */ }
}
/** Ouve pelo programa dado (o termux-speech-to-text) e devolve o texto. `signal` cancela; o prazo também. */
function ouvirCom(programa, { signal, prazoMs = PRAZO_OUVIR_MS } = {}) {
  return new Promise((resolve, reject) => {
    let filho;
    try { filho = require('child_process').spawn(programa, [], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { reject(e); return; }
    if (!saidaVigiada) { saidaVigiada = true; process.on('exit', () => { for (const f of ouvintesVivos) matarOuvinte(f); }); }
    ouvintesVivos.add(filho);
    let saida = '';
    let motivo = null;
    let fim = false;
    const matar = (m) => { if (fim || motivo) return; motivo = m; matarOuvinte(filho); };
    const timer = setTimeout(() => matar('prazo'), prazoMs);
    const aoAbortar = () => matar('cancelado');
    if (signal) { if (signal.aborted) aoAbortar(); else signal.addEventListener('abort', aoAbortar, { once: true }); }
    filho.stdout.setEncoding('utf8');
    filho.stdout.on('data', (d) => { if (saida.length < 1024 * 1024) saida += d; });
    const terminar = (erro, codigo) => {
      if (fim) return;
      fim = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', aoAbortar);
      ouvintesVivos.delete(filho);
      if (motivo) { reject(Object.assign(new Error(motivo === 'prazo' ? 'o Termux:API não respondeu' : 'cancelado'), { prazo: motivo === 'prazo', cancelado: motivo === 'cancelado' })); return; }
      if (erro) { reject(erro); return; }
      const lido = lerSaidaDoTermux(saida);
      if (lido.permissao) { reject(Object.assign(new Error('o Termux:API pediu a permissão do microfone'), { permissao: true })); return; }
      if (codigo !== 0 && !lido.texto) { reject(new Error(`o termux-speech-to-text saiu com o código ${codigo}`)); return; }
      resolve(lido.texto);
    };
    filho.on('error', (e) => terminar(e));
    filho.on('close', (codigo) => terminar(null, codigo));
    // morto por nós (prazo, cancelar): termina na saída, sem esperar o cano (algo que escapou ainda pode segurá-lo)
    filho.on('exit', () => { if (motivo) { terminar(null, null); try { filho.stdout.destroy(); } catch { /* já fechou */ } } });
  });
}
/** O que a página mostra quando o Termux não ouviu (sem detalhes do sistema: só o caminho para resolver). */
function erroDeOuvir(e) {
  if (e && e.permissao) return 'O Termux:API pediu a permissão do microfone: toque em "Permitir" na janela que abriu e depois no microfone de novo. Se a janela não abriu: Configurações do Android › Apps › Termux:API › Permissões › Microfone › Permitir.';
  if (e && e.prazo) return 'O Termux não respondeu: confira se o app Termux:API está instalado (da mesma loja do Termux; o pacote sozinho não basta) e se ele tem a permissão do microfone (Configurações do Android › Apps › Termux:API › Permissões).';
  return 'Não consegui ouvir pelo Termux: confira o app Termux:API (da mesma loja do Termux) e a permissão do microfone dele (Configurações do Android › Apps › Termux:API › Permissões), e rode "pkg install termux-api".';
}
function ouvirPadrao() {
  return {
    disponivel: () => Boolean(programaDoTermux()),
    ouvir: ({ signal } = {}) => {
      const programa = programaDoTermux();
      return programa ? ouvirCom(programa, { signal }) : Promise.reject(new Error('termux-speech-to-text não encontrado'));
    },
  };
}

/** Erro do agente que é a chave (falta ou foi recusada): a página mostra de novo o pedido da chave. */
const erroDeChave = (msg) => /Nenhuma API key|chave recusada|API key not valid|API_KEY_INVALID/i.test(String(msg || ''));

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
      if (!t.trim() || t.startsWith('[hook Stop do usuário]') || t.startsWith('[modo até terminar]')) continue;
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
/**
 * v0.52.0: no modo site, com a chave da nuvem, tudo vai para a nuvem (o Gemini, por padrão): o modelo local do modo
 * híbrido (llama.cpp) não vê fotos nem cria imagens, e no celular quase nunca está instalado. Quem escolheu um provedor
 * (local, openai, code-ia) ou o modo solo segue com o dele.
 */
function modeloDoSite(cfg) {
  if (require('../solo').ativo(cfg) || (cfg.provider || 'hybrid') !== 'hybrid') return undefined;
  const temNuvem = cfg.hybridCloud === 'openai' ? Boolean(require('../providers/openai').chave(cfg)) : Boolean(cfg.apiKey);
  return temNuvem ? '@cloud' : undefined;
}

function conversarComAgente({ aliado = null, runOnce = (...a) => require('../agent').runOnce(...a), loadConfig = () => require('../config').loadConfig() } = {}) {
  const resultado = (r) => ({
    texto: r.text, historico: r.history, ...(r.interrompido ? { interrompido: true } : {}), ...(r.fim ? { fim: r.fim } : {}),
  });
  // v0.51.0: `imagens` — as fotos que a pessoa mandou pela página, para o modelo ver (como o /imagem do terminal)
  // v0.52.0: `ateTerminar`/`onContinuar` — o modo até terminar (src/agent.js)
  return async (texto, { historico, onText, onFerramenta, onAlerta, signal, imagens = [], ateTerminar = false, onContinuar }) => {
    let modelName;
    try { modelName = modeloDoSite(loadConfig()); } catch { /* config ilegível: o roteador decide */ }
    const comuns = { onText, onFerramenta, signal, imagens, ...(ateTerminar ? { ateTerminar: true, onContinuar } : {}) };
    if (!aliado) return resultado(await runOnce(texto, { history: historico, ...(modelName ? { modelName } : {}), ...comuns }));
    const pa = require('../personalAgents');
    const { opcoes, ctx, alerta } = pa.prepararTurno(aliado.store, aliado.agente, texto, {});
    if (alerta) onAlerta(alerta);
    // o modelo próprio do aliado, se ele tiver, vale sobre a regra do site
    const modelo = opcoes.modelName ? {} : (modelName ? { modelName } : {});
    return resultado(await pa.comAgente(ctx, () => runOnce(texto, { history: historico, ...modelo, ...opcoes, ...comuns })));
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
 * @param {string[]|null} [o.sugestoes] v0.52.0: as sugestões de conversa do aliado (no lugar das da página)
 * @param {{ listar: () => {nome: string, descricao?: string}[], abrir: (nome: string|null) => {nome: string|null, conversar: Function, sugestoes?: string[]} }|null} [o.aliados]
 *   v0.53.0: trocar de aliado pela página (um site só). Sem isto, o aliado é o da linha de comando.
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
  chaves = chavesPadrao(),
  prazoPerguntaAteTerminarMs = PRAZO_PERGUNTA_ATE_TERMINAR_MS,
  ateTerminarPadrao = () => { try { return require('../config').loadConfig().modoAteTerminar === true; } catch { return false; } },
  sugestoes = null,
  aliados = null,
  ouvirNoAparelho = ouvirPadrao(),
} = {}) {
  const { paraExibir, semControlesInvisiveis } = require('../ui/textoSeguro');
  // v0.52.0: as sugestões do aliado (ex.: o "treinador"); texto guardado pelo usuário, mas limpo e curto mesmo assim
  const limparSugestoes = (lista) => (Array.isArray(lista) ? lista : [])
    .map((s) => semControlesInvisiveis(String(s)).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 4);
  const limparNome = (n) => (n ? semControlesInvisiveis(String(n)).slice(0, 80) : null);
  // v0.53.0: com quem a página conversa agora (troca pela página com /api/aliado, se o servidor receber `aliados`)
  let atual = { nome: limparNome(aliado), conversar, sugestoes: limparSugestoes(sugestoes) };
  function listaDeAliados() {
    if (!aliados) return null;
    try {
      return aliados.listar().filter((a) => a && typeof a.nome === 'string' && a.nome).slice(0, 50)
        .map((a) => ({ nome: limparNome(a.nome), descricao: semControlesInvisiveis(String(a.descricao || '')).replace(/\s+/g, ' ').trim().slice(0, 140) }));
    } catch { return []; }
  }
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
  // v0.53.2: o microfone do aparelho pelo Termux:API (um por vez; a disponibilidade é conferida uma vez)
  let ouvindo = false;
  let disponibilidadeOuvir = null;
  const podeOuvirNoAparelho = () => {
    if (!ouvirNoAparelho) return Promise.resolve(false);
    if (!disponibilidadeOuvir) disponibilidadeOuvir = Promise.resolve().then(() => ouvirNoAparelho.disponivel()).then(Boolean, () => false);
    return disponibilidadeOuvir;
  };
  // v0.52.0: o que a resposta em andamento já fez (para a página que voltar no meio, no modo até terminar)
  let andamento = null;
  let tentativasChave = [];
  let conferindoChave = false;

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
    if (ouvindo) ouvindo.abort(); // v0.53.2: "Parar" também encerra o microfone do Termux
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
      let chave = { configurada: true, precisa: false };
      try { const e = chaves.estado(); chave = { configurada: Boolean(e.configurada), precisa: Boolean(e.precisa) }; } catch { /* sem config: nada a pedir */ }
      return json(res, 200, {
        mensagens: comMidias(paraExibicao(historico)), ocupado, aliado: atual.nome,
        chave, ateTerminarPadrao: Boolean(ateTerminarPadrao()),
        ...(atual.sugestoes.length ? { sugestoes: atual.sugestoes } : {}),
        ...(aliados ? { aliados: listaDeAliados() } : {}),
        ouvirNoAparelho: await podeOuvirNoAparelho(),
        ...(ocupado && andamento ? { andamento: retratoDoAndamento() } : {}),
        perguntas: [...pendentes].map(([id, p]) => ({ id, texto: p.texto })),
      });
    }
    if (caminho === '/api/chave') return salvarChave(res, corpo);
    if (caminho === '/api/midia') return servirMidia(res, corpo);
    if (caminho === '/api/limpar') {
      if (ocupado) return json(res, 409, { erro: 'espere a resposta terminar' });
      historico = [];
      turnos = [];
      midias.clear(); // os arquivos ficam no disco; a página só deixa de mostrá-los
      return json(res, 200, { ok: true });
    }
    if (caminho === '/api/aliado') return trocarAliado(res, corpo);
    if (caminho === '/api/ouvir') return ouvirPeloAparelho(res);
    return json(res, 404, { erro: 'não encontrado' });
  }

  /**
   * v0.53.0: POST /api/aliado {nome} (null = o agente geral): troca com quem a página conversa, como reabrir o site com
   * --aliado. Só um aliado que existe, nunca no meio de uma resposta, e a conversa começa do zero (cada um tem as
   * suas ferramentas, a sua memória e as suas instruções: o histórico de um não vai para o outro).
   */
  function trocarAliado(res, corpo) {
    if (!aliados) return json(res, 404, { erro: 'a troca de aliado não está ligada neste site' });
    if (ocupado) return json(res, 409, { erro: 'espere a resposta terminar (ou pare) para trocar' });
    const pedido = corpo.nome === null || corpo.nome === undefined || corpo.nome === '' ? null : corpo.nome;
    if (pedido !== null && (typeof pedido !== 'string' || pedido.length > 80)) return json(res, 400, { erro: 'nome de aliado inválido' });
    if (pedido !== null && !(listaDeAliados() || []).some((a) => a.nome === pedido)) return json(res, 404, { erro: 'esse aliado não existe (crie com: gemini-code aliados criar)' });
    let novo;
    try { novo = aliados.abrir(pedido); } catch (e) { return json(res, 400, { erro: `não deu para abrir o aliado: ${semControlesInvisiveis(String((e && e.message) || e)).slice(0, 200)}` }); }
    if (!novo || typeof novo.conversar !== 'function') return json(res, 400, { erro: 'não deu para abrir o aliado' });
    atual = { nome: limparNome(novo.nome), conversar: novo.conversar, sugestoes: limparSugestoes(novo.sugestoes) };
    historico = [];
    turnos = [];
    midias.clear();
    log(atual.nome ? `[site] agora com o aliado "${atual.nome}"` : '[site] agora com o agente geral');
    return json(res, 200, { ok: true, aliado: atual.nome, sugestoes: atual.sugestoes });
  }

  /**
   * v0.53.2: POST /api/ouvir — ouve pelo microfone do aparelho (Termux:API) e devolve só o texto. Para quando o navegador
   * não deixa usar o microfone. Um por vez, nunca no meio de uma resposta, com prazo; o texto não vai para o log.
   * A página cancela fechando o pedido (ou "Parar"): o termux-speech-to-text é encerrado na hora.
   */
  async function ouvirPeloAparelho(res) {
    if (!(await podeOuvirNoAparelho())) return json(res, 404, { erro: 'o microfone pelo Termux não está disponível: instale o app Termux:API (da mesma loja do Termux) e rode "pkg install termux-api"' });
    if (ocupado) return json(res, 409, { erro: 'espere a resposta terminar' });
    if (ouvindo) return json(res, 409, { erro: 'já estou ouvindo' });
    const ctrl = new AbortController();
    ouvindo = ctrl;
    let terminou = false;
    res.on('close', () => { if (!terminou) ctrl.abort(); });
    log('[site] ouvindo pelo microfone do aparelho (Termux:API)');
    try {
      const ouvido = await ouvirNoAparelho.ouvir({ signal: ctrl.signal });
      const texto = semControlesInvisiveis(semControlesC0(ouvido || '')).replace(/\s+/g, ' ').trim().slice(0, 4000);
      return json(res, 200, { texto });
    } catch (e) {
      if (ctrl.signal.aborted) return res.writableEnded || res.destroyed ? undefined : json(res, 200, { texto: '', cancelado: true });
      return json(res, 502, { erro: erroDeOuvir(e), motivo: e && e.permissao ? 'permissao' : e && e.prazo ? 'prazo' : 'falhou' });
    } finally { terminou = true; ouvindo = false; }
  }

  /** POST /api/chave {chave}: confere com o Gemini e salva (como o "config set-key"). A chave nunca volta nem vai para o log. */
  async function salvarChave(res, corpo) {
    const chave = typeof corpo.chave === 'string' ? corpo.chave.trim() : '';
    if (!CHAVE_OK.test(chave)) return json(res, 400, { erro: 'isso não parece uma chave da API do Gemini: copie a chave inteira (ela começa com "AIza")' });
    let e;
    try { e = chaves.estado(); } catch { e = {}; }
    if (e.protegida) return json(res, 409, { erro: 'a chave atual está protegida por senha mestra: troque pelo terminal (gemini-code config remove-passphrase e depois set-key)' });
    const agora = Date.now();
    tentativasChave = tentativasChave.filter((t) => agora - t < 10 * 60 * 1000);
    if (tentativasChave.length >= MAX_TENTATIVAS_CHAVE) return json(res, 429, { erro: 'tentativas demais: espere alguns minutos' });
    if (conferindoChave) return json(res, 409, { erro: 'já estou conferindo uma chave' });
    tentativasChave.push(agora);
    conferindoChave = true;
    let conferida;
    try {
      try { conferida = Boolean(await chaves.validar(chave)); } catch (err) {
        if (err && err.recusada) return json(res, 400, { erro: 'o Gemini recusou essa chave: confira se copiou inteira (aistudio.google.com/apikey)' });
        conferida = false; // sem internet agora: salva sem conferir (a primeira conversa confere)
      }
      chaves.salvar(chave);
      log(`[site] chave da API do Gemini salva${conferida ? ' (conferida com o Gemini)' : ' (não deu para conferir agora)'}`);
      return json(res, 200, { ok: true, conferida });
    } finally { conferindoChave = false; }
  }

  /** O andamento para a página que voltou no meio: texto (o fim dele), ferramentas, mídias e continuações. */
  function retratoDoAndamento() {
    return {
      texto: andamento.texto.length > 20000 ? andamento.texto.slice(-20000) : andamento.texto,
      ferramentas: andamento.ferramentas.slice(0, 20),
      midias: andamento.gerados.map(publico).filter(Boolean),
      continuacoes: andamento.continuacoes,
      ateTerminar: andamento.ateTerminar,
    };
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
    // v0.52.0: modo até terminar — pedido pela página (o botão "Até terminar")
    const ateTerminar = corpo.ateTerminar === true;
    ocupado = true;
    const ctrl = new AbortController();
    parador = ctrl;
    res.writeHead(200, { ...BASE, 'content-type': 'application/x-ndjson; charset=utf-8' });
    let aberto = true;
    let terminou = false;
    // a página fechou (ou recarregou) no meio: ninguém está olhando, então o agente para — menos no modo até terminar,
    // em que ele segue (a pessoa volta e vê o andamento; a pergunta espera por ela)
    res.on('close', () => {
      aberto = false;
      if (terminou) return;
      if (ateTerminar) log('[site] a página fechou; no modo até terminar o agente continua (abra de novo para acompanhar)');
      else parar('a página fechou');
    });
    const enviar = (ev) => { if (aberto && !res.writableEnded) res.write(`${JSON.stringify(ev)}\n`); };
    log(`[site] você: ${texto.slice(0, 200)}${ateTerminar ? ' (modo até terminar)' : ''}`);
    const gerados = [];
    andamento = { texto: '', ferramentas: [], gerados, continuacoes: 0, ateTerminar };
    const desfazer = definirPerguntador((pergunta) => new Promise((resolve) => {
      if (ctrl.signal.aborted || (!aberto && !ateTerminar)) return resolve(''); // "Parar" ou página fechada: ninguém responde = "não"
      const id = crypto.randomBytes(8).toString('hex');
      const textoPergunta = paraExibir(pergunta).trim();
      const prazo = ateTerminar ? prazoPerguntaAteTerminarMs : prazoPerguntaMs;
      const timer = setTimeout(() => { pendentes.delete(id); enviar({ tipo: 'pergunta-expirou', id }); resolve(''); }, prazo);
      pendentes.set(id, { texto: textoPergunta, responder: (r) => { clearTimeout(timer); pendentes.delete(id); resolve(r); } });
      enviar({ tipo: 'pergunta', id, texto: textoPergunta });
    }));
    // v0.51.0: o que as ferramentas criarem agora (foto editada, vídeo...) aparece na página
    const pararDeOuvir = require('../midiaGerada').observar((caminho) => {
      const m = registrarMidia(caminho, 'agente');
      if (!m || gerados.includes(m.id)) return;
      gerados.push(m.id);
      enviar({ tipo: 'midia', ...m });
    });
    enviar({ tipo: 'estado', estado: 'pensando' });
    try {
      const r = await atual.conversar(texto, {
        historico,
        onText: (t) => {
          const limpo = semControlesInvisiveis(String(t));
          andamento.texto += limpo;
          // a página que volta vê só o fim (retratoDoAndamento); numa tarefa longa, a memória não cresce sem parar
          if (andamento.texto.length > 100000) andamento.texto = andamento.texto.slice(-20000);
          enviar({ tipo: 'parcial', texto: limpo });
        },
        onFerramenta: (nome) => {
          const n = String(nome).slice(0, 80);
          if (andamento.ferramentas.length < 20 && !andamento.ferramentas.includes(n)) andamento.ferramentas.push(n);
          enviar({ tipo: 'ferramenta', nome: n });
        },
        onAlerta: (t) => enviar({ tipo: 'alerta', texto: String(t) }),
        signal: ctrl.signal,
        imagens,
        ...(ateTerminar ? { ateTerminar: true, onContinuar: (n) => { andamento.continuacoes = n; enviar({ tipo: 'continuando', n }); } } : {}),
      });
      if (r && Array.isArray(r.historico)) {
        historico = r.historico;
        if (anexos.length || gerados.length) {
          turnos.push({ texto, sufixo, anexos, gerados: [...gerados] });
          if (turnos.length > 200) turnos.shift();
        }
      }
      enviar({
        tipo: 'resposta', texto: semControlesInvisiveis(String((r && r.texto) || '')),
        ...(r && r.interrompido ? { interrompido: true } : {}), ...(r && r.fim ? { fim: r.fim } : {}),
      });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      enviar({ tipo: 'erro', texto: `Erro: ${msg}`, ...(erroDeChave(msg) ? { chave: true } : {}) });
    } finally {
      terminou = true;
      andamento = null;
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
  modeloDoSite, chavesPadrao, erroDeChave,
  lerSaidaDoTermux, ouvirCom, ouvirPadrao, erroDeOuvir, PRAZO_OUVIR_MS,
};
