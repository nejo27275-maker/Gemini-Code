// src/permissions.js (v0.41.0)
// Regras de permissão no config.json (que o modelo não consegue gravar):
//   "permissoes": { "negar": ["run_shell(git push*)", "write_file(*.env)"], "permitir": ["run_shell(npm test*)"] }
// - Formato: FERRAMENTA ou FERRAMENTA(PADRÃO). FERRAMENTA aceita * (ex.: "mcp__github__*").
//   PADRÃO é comparado com o alvo da chamada: comando (run_shell), caminho (arquivos), URL
//   (web_fetch); nas demais, o JSON dos argumentos. * = qualquer sequência (inclusive "/"), ? = 1 caractere.
// - negar: bloqueia antes de executar, em qualquer modo (chat, run, subagente, workflow).
//   Num comando composto (;, &&, ||, |, quebra de linha) basta UMA parte bater.
// - permitir: só dispensa a confirmação do run_shell, e nunca para comando composto ou com
//   redirecionamento/substituição — senão "npm test*" liberaria "npm test && rm -rf ~".
//   Comando destrutivo ou que toca arquivo protegido continua pedindo confirmação.
'use strict';

const path = require('path');

function globParaRegex(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 's');
}

function parseRegra(regra) {
  const m = String(regra).trim().match(/^([^()\s]+)(?:\((.*)\))?$/s);
  if (!m) return null;
  return { texto: String(regra).trim(), ferramenta: globParaRegex(m[1]), padrao: m[2] === undefined ? null : globParaRegex(m[2].trim()) };
}

const CAMPOS_CAMINHO = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files', 'glob_files', 'read_skill']);

/** Alvos de uma chamada (uma ou mais strings) contra os quais o PADRÃO é testado. */
function alvos(nome, args = {}) {
  if (nome === 'run_shell') return [String(args.command || '')];
  if (nome === 'web_fetch') return [String(args.url || '')];
  if (nome === 'edit_files' && Array.isArray(args.edits)) return args.edits.flatMap((e) => caminhos(e && e.path));
  if (CAMPOS_CAMINHO.has(nome)) return caminhos(args.path || '.');
  return [JSON.stringify(args)];
}

// Caminho como o modelo escreveu, relativo ao cwd e absoluto: "*.env" pega os três jeitos.
function caminhos(p) {
  if (typeof p !== 'string' || !p) return [];
  const abs = path.resolve(p);
  return [...new Set([p, path.relative(process.cwd(), abs) || '.', abs])];
}

const PARTES_SHELL = /&&|\|\||[;|\n]/;
const METACARACTERES = /[;&|`<>\n]|\$\(/;

function bate(regra, nome, args, { cadaParteDoShell = false } = {}) {
  if (!regra.ferramenta.test(nome)) return false;
  if (!regra.padrao) return true;
  let lista = alvos(nome, args);
  if (cadaParteDoShell && nome === 'run_shell') lista = [...lista, ...lista[0].split(PARTES_SHELL).map((s) => s.trim()).filter(Boolean)];
  return lista.some((a) => regra.padrao.test(a));
}

function regrasDe(cfg, chave) {
  const lista = cfg && cfg.permissoes && Array.isArray(cfg.permissoes[chave]) ? cfg.permissoes[chave] : [];
  return lista.map(parseRegra).filter(Boolean);
}

/** @returns {string|null} a regra de "negar" que bloqueia esta chamada, ou null. */
function negada(nome, args, cfg) {
  const r = regrasDe(cfg, 'negar').find((regra) => bate(regra, nome, args, { cadaParteDoShell: true }));
  return r ? r.texto : null;
}

/** true se um comando SIMPLES bate numa regra de "permitir" do run_shell. */
function shellPermitido(command, cfg) {
  if (typeof command !== 'string' || METACARACTERES.test(command)) return false;
  return regrasDe(cfg, 'permitir').some((regra) => regra.padrao && bate(regra, 'run_shell', { command: command.trim() }));
}

function validar(regra) {
  return parseRegra(regra) ? null : `Regra inválida: "${regra}". Use FERRAMENTA ou FERRAMENTA(PADRÃO), ex.: run_shell(npm test*)`;
}

module.exports = { negada, shellPermitido, parseRegra, validar, globParaRegex, alvos };
