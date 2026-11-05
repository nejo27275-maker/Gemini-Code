// src/tools/sintaxe.js (v0.50.0) — confere a sintaxe depois de uma edição, como um editor com verificador ligado.
// Só avisa quando a EDIÇÃO quebrou o arquivo (antes estava certo e agora não; num arquivo novo, se ele já nasce com
// erro). Arquivo que já tinha erro, ou formato que o conferidor não entende do mesmo jeito, não vira alarme falso.
// Só ANALISA, nunca roda o código, e lê o texto pela entrada padrão (nada de arquivo temporário):
//   .json            JSON.parse; aceita comentários e vírgula sobrando (tsconfig.json, .vscode/*.json)
//   .js .cjs .mjs    node --check (o mesmo node do gemini-code, sem NODE_OPTIONS); .js vale como CommonJS ou ESM
//   .py              python3 -I -S, ast.parse
//   .sh .bash        bash -n, com ambiente limpo (sem BASH_ENV)
// O python3 e o bash vêm das pastas do sistema ou de uma pasta do PATH fora das áreas que o modelo grava: um
// "python3" plantado no projeto rodaria sem ninguém aprovar (src/sandbox.js, acharProgramaConfiavel).
// Desliga com "conferirSintaxe": false na config.
'use strict';

const path = require('path');
const { execFile } = require('child_process');

const LINGUAGENS = { '.json': 'json', '.js': 'js', '.cjs': 'cjs', '.mjs': 'mjs', '.py': 'python', '.sh': 'shell', '.bash': 'shell' };
const MAX_BYTES = 1024 * 1024;
const PRAZO_MS = 5000;
const TERMUX = '/data/data/com.termux/files/usr/bin';
const LOCAIS = {
  python3: ['/usr/bin/python3', '/usr/local/bin/python3', '/bin/python3', '/opt/homebrew/bin/python3', `${TERMUX}/python3`]
    // no macOS sem as ferramentas de desenvolvedor, o /usr/bin/python3 abre uma janela pedindo para instalar
    .filter((p) => !(process.platform === 'darwin' && p === '/usr/bin/python3')),
  bash: ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash', `${TERMUX}/bash`],
};

function linguagemDe(caminho) { return LINGUAGENS[path.extname(String(caminho || '')).toLowerCase()] || null; }

/** JSON com comentários (// e /* *\/) e vírgula sobrando antes de } ou ] — o "JSONC" do tsconfig e do VS Code. */
function semComentarios(t) {
  let saida = '';
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      saida += t.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && t[i + 1] === '/') {
      while (i < t.length && t[i] !== '\n') i++;
    } else if (c === '/' && t[i + 1] === '*') {
      const fim = t.indexOf('*/', i + 2);
      i = fim < 0 ? t.length : fim + 2;
    } else { saida += c; i++; }
  }
  return saida.replace(/,(\s*[}\]])/g, '$1');
}

function linhaDaPosicao(texto, pos) { return texto.slice(0, pos).split('\n').length; }

/** `tolerante`: aceita JSONC (coment\u00E1rios e v\u00EDrgula sobrando). Um package.json n\u00E3o aceita; um tsconfig.json aceita. */
function checarJson(texto, { tolerante = true } = {}) {
  const t = String(texto).replace(/^\uFEFF/, '');
  try { JSON.parse(t); return { ok: true }; } catch (e) {
    if (tolerante) { try { JSON.parse(semComentarios(t)); return { ok: true }; } catch { /* erro de verdade */ } }
    const pos = /position (\d+)/.exec(e.message);
    const linha = /line (\d+)/.exec(e.message);
    const msg = e.message.replace(/\s*in JSON at position \d+.*$/, '').replace(/^JSON\.parse: /, '');
    return { ok: false, erro: `${linha ? `linha ${linha[1]}: ` : pos ? `linha ${linhaDaPosicao(t, Number(pos[1]))}: ` : ''}${msg}` };
  }
}

/** Roda `arquivo` com o texto na entrada padrão. { codigo, saida } ou null se não deu para conferir (sem programa, prazo). */
function rodarComEntrada(arquivo, args, entrada, env) {
  return new Promise((resolve) => {
    let filho;
    try {
      filho = execFile(arquivo, args, { timeout: PRAZO_MS, maxBuffer: 256 * 1024, env, windowsHide: true }, (err, stdout, stderr) => {
        if (err && (err.killed || typeof err.code !== 'number')) return resolve(null);
        resolve({ codigo: err ? err.code : 0, saida: String(stderr || '') });
      });
    } catch { return resolve(null); }
    filho.stdin.on('error', () => { /* o programa pode sair antes de ler tudo */ });
    filho.stdin.end(entrada);
  });
}

const envNode = () => ({ ...process.env, NODE_OPTIONS: '' });
const envLimpo = () => ({ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });

function mensagemNode(saida) {
  const linha = /\[stdin\]:(\d+)/.exec(saida);
  const erro = String(saida).split('\n').map((l) => l.trim()).find((l) => /^[A-Z][A-Za-z]*Error\b/.test(l));
  return `${linha ? `linha ${linha[1]}: ` : ''}${erro || String(saida).trim().split('\n')[0] || 'erro de sintaxe'}`;
}

async function checarJs(texto, tipo) {
  const usaModulo = /^\s*(import|export)\b/m.test(texto);
  // .js: vale se a sintaxe for válida como CommonJS OU como ESM (o tipo depende do package.json e da detecção do Node)
  const ordem = tipo === 'mjs' ? [true] : tipo === 'cjs' ? [false] : (usaModulo ? [true, false] : [false, true]);
  let primeiro = null;
  for (const modulo of ordem) {
    const r = await rodarComEntrada(process.execPath, [...(modulo ? ['--input-type=module'] : []), '--check'], texto, envNode());
    if (!r) return null;
    if (r.codigo === 0) return { ok: true };
    if (!primeiro) primeiro = r;
  }
  return { ok: false, erro: mensagemNode(primeiro.saida) };
}

function programa(nome, cfg) {
  if (process.platform === 'win32') return null;
  try {
    const sb = require('../sandbox');
    return sb.acharProgramaConfiavel(nome, { locais: LOCAIS[nome], proibidas: sb.areasDoModelo({ extras: (cfg && cfg.pastasGravaveis) || [] }) });
  } catch { return null; }
}

async function checarPython(texto, cfg) {
  const py = programa('python3', cfg);
  if (!py) return null;
  const r = await rodarComEntrada(py, ['-I', '-S', '-c', 'import ast,sys\nast.parse(sys.stdin.buffer.read())'], texto, envLimpo());
  if (!r) return null;
  if (r.codigo === 0) return { ok: true };
  const linha = /File "<unknown>", line (\d+)/.exec(r.saida);
  const msg = (r.saida.trim().split('\n').pop() || 'erro de sintaxe').trim();
  return { ok: false, erro: `${linha ? `linha ${linha[1]}: ` : ''}${msg}` };
}

async function checarShell(texto, cfg) {
  const bash = programa('bash', cfg);
  if (!bash) return null;
  const r = await rodarComEntrada(bash, ['-n'], texto, envLimpo());
  if (!r) return null;
  if (r.codigo === 0) return { ok: true };
  const msg = (r.saida.trim().split('\n')[0] || 'erro de sintaxe').replace(/^[^:]*bash: /, '').replace(/^line (\d+):/, 'linha $1:');
  return { ok: false, erro: msg };
}

/** { ok: true } | { ok: false, erro } | null (formato não conferido, ou não deu para conferir). */
async function checar(lingua, texto, cfg) {
  if (texto === null || texto === undefined || Buffer.byteLength(String(texto)) > MAX_BYTES) return null;
  if (lingua === 'json') return checarJson(texto);
  if (lingua === 'js' || lingua === 'cjs' || lingua === 'mjs') return checarJs(String(texto), lingua);
  if (lingua === 'python') return checarPython(String(texto), cfg);
  if (lingua === 'shell') return checarShell(String(texto), cfg);
  return null;
}

/**
 * JSON: o arquivo que era JSON estrito continua sendo conferido como estrito (a vírgula sobrando quebra o
 * package.json); o que já usava comentários (tsconfig) ou é novo vale como JSONC.
 */
function conferirJson(caminho, antes, depois) {
  if (Buffer.byteLength(String(depois)) > MAX_BYTES) return null;
  const temAntes = antes !== null && antes !== undefined;
  const estritoAntes = temAntes && checarJson(antes, { tolerante: false }).ok;
  const agora = checarJson(depois, { tolerante: !estritoAntes });
  if (agora.ok) return null;
  if (temAntes) {
    if (!estritoAntes && !checarJson(antes, { tolerante: true }).ok) return null; // já estava quebrado
    return `Atenção: depois desta edição, ${caminho} ficou com erro de sintaxe (antes estava certo): ${agora.erro}. Corrija antes de seguir.`;
  }
  return `Atenção: o arquivo novo ${caminho} tem erro de sintaxe: ${agora.erro}. Corrija antes de seguir.`;
}

/**
 * Aviso para o modelo se a edição quebrou a sintaxe; null se está tudo certo (ou não dá para saber).
 * `antes` = conteúdo anterior (null para arquivo novo). Nunca lança.
 */
async function conferirDepoisDeEditar(caminho, antes, depois, { cfg } = {}) {
  try {
    let config = cfg;
    if (!config) { try { config = require('../config').loadConfig(); } catch { config = {}; } }
    if (config && config.conferirSintaxe === false) return null;
    const lingua = linguagemDe(caminho);
    if (!lingua) return null;
    if (lingua === 'json') return conferirJson(caminho, antes, depois);
    const agora = await checar(lingua, depois, config);
    if (!agora || agora.ok) return null;
    if (antes !== null && antes !== undefined) {
      const antigo = await checar(lingua, antes, config);
      if (!antigo || !antigo.ok) return null; // já estava com erro (ou não dá para saber): não é culpa desta edição
      return `Atenção: depois desta edição, ${caminho} ficou com erro de sintaxe (antes estava certo): ${agora.erro}. Corrija antes de seguir.`;
    }
    return `Atenção: o arquivo novo ${caminho} tem erro de sintaxe: ${agora.erro}. Corrija antes de seguir.`;
  } catch { return null; }
}

module.exports = { linguagemDe, checar, conferirDepoisDeEditar, semComentarios, LOCAIS };
