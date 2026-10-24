// src/tools/protectedPaths.js
// Decide se um caminho pedido pelo modelo cai num arquivo protegido do próprio
// gemini-code. Compara o caminho REAL (symlinks resolvidos, inclusive quebrados —
// gravar num link quebrado cria o alvo — e pastas que são symlink) e o inode (hard
// link), porque um repositório clonado pode trazer docs/settings.json ->
// ~/.gemini-code/config.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { PROTECTED_PATHS, PROTECTED_DIRS, SECRET_PATHS } = require('../config');

const MAX_SYMLINKS = 40;

function caminhoReal(p, saltos = 0) {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch { /* não existe ou é symlink quebrado */ }
  const pai = path.dirname(abs);
  if (pai === abs || saltos > MAX_SYMLINKS) return abs;
  const paiReal = caminhoReal(pai, saltos + 1);
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) {
      return caminhoReal(path.resolve(paiReal, fs.readlinkSync(abs)), saltos + 1);
    }
  } catch { /* não existe: segue pelo pai */ }
  return path.join(paiReal, path.basename(abs));
}

function mesmoInode(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.ino !== 0 && sa.dev === sb.dev && sa.ino === sb.ino;
  } catch { return false; }
}

function bateCom(lista, p) {
  const real = caminhoReal(p);
  return lista.some((prot) => real === caminhoReal(prot) || mesmoInode(real, prot));
}

const MAX_ENTRADAS_VARRIDAS = 5000;

/** Inodes dos arquivos dentro das pastas protegidas (para achar hard link). Varredura limitada. */
function inodesDasPastas(pastas) {
  const inodes = new Set();
  const pendentes = [...pastas];
  let vistas = 0;
  while (pendentes.length && vistas < MAX_ENTRADAS_VARRIDAS) {
    const dir = pendentes.pop();
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entradas) {
      if (++vistas > MAX_ENTRADAS_VARRIDAS) break;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) pendentes.push(p);
      else if (e.isFile()) { try { const s = fs.statSync(p); if (s.ino) inodes.add(`${s.dev}:${s.ino}`); } catch { /* sumiu */ } }
    }
  }
  return inodes;
}

/**
 * v0.42.0: dentro de uma pasta protegida (agentes pessoais). Caminho real dentro dela, ou hard link
 * para um arquivo de lá — só procurado quando o alvo tem mais de um link, que é raro.
 */
function dentroDePastaProtegida(p, pastas = PROTECTED_DIRS) {
  const real = caminhoReal(p);
  const reais = pastas.map((d) => caminhoReal(d));
  if (reais.some((d) => real === d || real.startsWith(d + path.sep))) return true;
  try {
    const s = fs.statSync(real);
    return s.isFile() && s.nlink > 1 && s.ino !== 0 && inodesDasPastas(reais).has(`${s.dev}:${s.ino}`);
  } catch { return false; }
}

/** O modelo não pode GRAVAR (config, mcp.json, hooks.json, tokens, agentes pessoais). */
const isProtected = (p) => bateCom(PROTECTED_PATHS, p) || dentroDePastaProtegida(p);
/** O modelo não pode nem LER (API key, segredos de MCP, tokens). */
const isSecret = (p) => bateCom(SECRET_PATHS, p);

/**
 * Para varreduras (search_files): calcula UMA vez os inodes dos segredos que existem e
 * compara com o stat de cada arquivo (stat segue links, então pega symlink e hard link).
 * Sem inode (alguns sistemas de arquivos), cai na comparação completa.
 */
function verificadorDeSegredos() {
  const inodes = new Set();
  for (const p of SECRET_PATHS) {
    try { const s = fs.statSync(p); if (s.ino) inodes.add(`${s.dev}:${s.ino}`); } catch { /* não existe */ }
  }
  return (arquivo, stat) => (stat && stat.ino ? inodes.has(`${stat.dev}:${stat.ino}`) : isSecret(arquivo));
}

/**
 * v0.41.0: a sessão de convidado ("só leitura") lia QUALQUER arquivo da máquina (chaves SSH, outros
 * projetos). Agora só dentro da pasta em que o gemini-code foi aberto. Compara caminhos reais
 * (symlink e ".." não escapam). Sessão de dono: sem restrição.
 * @returns {string|null} mensagem de bloqueio ou null
 */
function foraDoProjetoParaConvidado(p, raiz = process.cwd()) {
  let papel = null;
  try { papel = require('../security').getSessionRole(); } catch { /* sem security: dono */ }
  if (papel !== 'guest') return null;
  const base = caminhoReal(raiz);
  const alvo = caminhoReal(p);
  if (alvo === base || alvo.startsWith(base + path.sep)) return null;
  return `Bloqueado: a sessão de convidado só lê arquivos dentro do projeto (${base}).`;
}

/**
 * v0.44.0: caminho para gravar um .png NOVO pedido pelo modelo (print do adb e do navegador): só `.png` e
 * nunca dentro das áreas protegidas do gemini-code. Quem grava usa a flag 'wx' (não sobrescreve nada).
 */
function destinoPngNovo(arquivo, prefixo = 'tela') {
  const destino = path.resolve(String(arquivo || `${prefixo}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`));
  if (path.extname(destino).toLowerCase() !== '.png') throw new Error('o print precisa ser salvo num arquivo .png.');
  if (isProtected(destino) || isSecret(destino)) throw new Error('esse caminho é protegido do gemini-code; escolha outro lugar para o print.');
  return destino;
}

const MSG_SEGREDO =
  'Bloqueado: este arquivo (ou o destino deste link) guarda segredos do próprio gemini-code ' +
  '(API key, segredos de MCP ou token de acesso) e não pode ser lido por ferramentas do modelo. ' +
  'Para ver a configuração, peça ao usuário para rodar "gemini-code config show" (mostra mascarado).';

module.exports = { caminhoReal, mesmoInode, isProtected, isSecret, dentroDePastaProtegida, verificadorDeSegredos, foraDoProjetoParaConvidado, destinoPngNovo, MSG_SEGREDO };
