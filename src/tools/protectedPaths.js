// src/tools/protectedPaths.js
// Decide se um caminho pedido pelo modelo cai num arquivo protegido do próprio
// gemini-code. Compara o caminho REAL (symlinks resolvidos, inclusive quebrados —
// gravar num link quebrado cria o alvo — e pastas que são symlink) e o inode (hard
// link), porque um repositório clonado pode trazer docs/settings.json ->
// ~/.gemini-code/config.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { PROTECTED_PATHS, SECRET_PATHS } = require('../config');

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

/** O modelo não pode GRAVAR (config, mcp.json, hooks.json, tokens). */
const isProtected = (p) => bateCom(PROTECTED_PATHS, p);
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

const MSG_SEGREDO =
  'Bloqueado: este arquivo (ou o destino deste link) guarda segredos do próprio gemini-code ' +
  '(API key, segredos de MCP ou token de acesso) e não pode ser lido por ferramentas do modelo. ' +
  'Para ver a configuração, peça ao usuário para rodar "gemini-code config show" (mostra mascarado).';

module.exports = { caminhoReal, mesmoInode, isProtected, isSecret, verificadorDeSegredos, MSG_SEGREDO };
