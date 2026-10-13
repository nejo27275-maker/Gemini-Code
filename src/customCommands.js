// src/customCommands.js
// Comandos de barra seus (padrão "slash commands" de Claude Code/Codex): um arquivo .md vira /nome.
//   <projeto>/.gemini-code/commands/revisar.md   e   ~/.gemini-code/commands/*.md
// Dentro do arquivo: $ARGUMENTS (tudo que veio depois do comando) e $1..$9 (palavras). Linha inicial opcional
// "description: ..." (entre ---) aparece na lista. O comando do projeto vale mais que o global; nome de comando
// embutido (/help, /clear…) nunca é substituído.
'use strict';

const fs = require('fs');
const path = require('path');

const RESERVADOS = new Set(['help', 'imagem', 'foto', 'clear', 'model', 'codeia', 'ensinar', 'ensinados', 'esquecer', 'local', 'cloud', 'auto', 'save', 'session', 'ciencia', 'agenda', 'projetos', 'compact', 'commands', 'todo', 'tarefas', 'rewind', 'snapshots', 'hooks', 'plano', 'aprovar', 'custo', 'passo', 'workflows']);
const TAM_MAX = 20 * 1024;

function lerDir(dir) {
  const out = new Map();
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (!e.isFile() || path.extname(e.name).toLowerCase() !== '.md') continue;
    const nome = path.basename(e.name, '.md').toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(nome) || RESERVADOS.has(nome)) continue;
    let texto;
    try {
      const p = path.join(dir, e.name);
      if (fs.statSync(p).size > TAM_MAX) continue;
      texto = fs.readFileSync(p, 'utf8');
    } catch { continue; }
    let descricao = '';
    const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (m) {
      const d = m[1].match(/^description:\s*(.+)$/m);
      if (d) descricao = d[1].trim();
      texto = texto.slice(m[0].length);
    }
    texto = texto.trim();
    if (texto) out.set(nome, { nome, descricao, modelo: texto, arquivo: path.join(dir, e.name) });
  }
  return out;
}

/** Map nome -> comando. Projeto sobrescreve global. */
function carregar({ cwd = process.cwd(), home } = {}) {
  const todos = new Map();
  if (home) for (const [k, v] of lerDir(path.join(home, 'commands'))) todos.set(k, { ...v, origem: 'global' });
  for (const [k, v] of lerDir(path.join(cwd, '.gemini-code', 'commands'))) todos.set(k, { ...v, origem: 'projeto' });
  return todos;
}

function expandir(modelo, args = '') {
  const palavras = String(args).trim().split(/\s+/).filter(Boolean);
  let usouArgs = /\$ARGUMENTS|\$[1-9]/.test(modelo);
  let t = modelo.replace(/\$ARGUMENTS/g, String(args).trim()).replace(/\$([1-9])/g, (_, n) => palavras[Number(n) - 1] || '');
  if (!usouArgs && String(args).trim()) t += `\n\n${String(args).trim()}`;
  return t.trim();
}

/** "/revisar src/a.js" -> { nome, texto } se existir; senão null. */
function resolver(linha, comandos) {
  const m = String(linha || '').trim().match(/^\/([a-zA-Z0-9][\w-]*)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const c = comandos.get(m[1].toLowerCase());
  return c ? { nome: c.nome, texto: expandir(c.modelo, m[2] || '') } : null;
}

module.exports = { carregar, expandir, resolver, RESERVADOS };
