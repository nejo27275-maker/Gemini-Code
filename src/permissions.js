// src/permissions.js (v0.41.0)
// Regras de permissão no config.json (que o modelo não consegue gravar):
//   "permissoes": { "negar": ["run_shell(git push*)", "write_file(*.env)"], "permitir": ["run_shell(npm test*)"] }
// - Formato: FERRAMENTA ou FERRAMENTA(PADRÃO). FERRAMENTA aceita * (ex.: "mcp__github__*").
//   PADRÃO é comparado com o alvo da chamada: comando (run_shell), caminho (arquivos), URL
//   (web_fetch); nas demais, o JSON dos argumentos. * = qualquer sequência (inclusive "/"), ? = 1 caractere.
// - negar: bloqueia antes de executar, em qualquer modo (chat, run, subagente, workflow).
//   Num comando composto (;, &, &&, ||, |, quebra de linha) ou com subcomando ($(...), `...`,
//   (...), { ...; }) basta UMA parte bater.
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
  if (nome === 'web_fetch') return urls(args.url);
  // v0.44.0: no navegador, as regras olham a URL (ex.: "negar": ["browser(*banco*)"]); sem URL, a chamada inteira.
  if (nome === 'browser') return args.url ? urls(args.url) : [JSON.stringify(args)];
  // v0.44.1: no adb, o comando como se escreve ("tecla ok", "abrir_app com.netflix.ninja") — antes só o JSON
  // ({"acao":"tecla",...}) e os exemplos "adb(tecla*)" da documentação nunca batiam. O JSON continua valendo.
  if (nome === 'adb') return [textoAdb(args), JSON.stringify(args)];
  if (nome === 'edit_files' && Array.isArray(args.edits)) return args.edits.flatMap((e) => caminhos(e && e.path));
  if (CAMPOS_CAMINHO.has(nome)) return caminhos(args.path || '.');
  return [JSON.stringify(args)];
}

// URL como o modelo escreveu e normalizada (HTTPS://Exemplo.COM:443/x → https://exemplo.com/x): sem isso
// variações de maiúsculas/porta padrão escapavam de web_fetch(https://exemplo.com/*).
const CAMPOS_ADB = ['tecla', 'app', 'link', 'texto', 'espaco', 'chave', 'valor', 'comando', 'arquivo', 'porta', 'linhas'];
function textoAdb(args) {
  const partes = [String(args.acao || '')];
  // conectar/desconectar/parear: o alvo é o assunto do comando ("conectar 192.168.0.50")
  if (['conectar', 'desconectar', 'parear'].includes(args.acao) && args.alvo) partes.push(String(args.alvo));
  for (const c of CAMPOS_ADB) if (args[c] !== undefined && args[c] !== null && args[c] !== '') partes.push(String(args[c]));
  return partes.join(' ');
}

function urls(u) {
  const bruta = String(u || '');
  let normal = '';
  try { normal = new URL(bruta.trim()).href; } catch { /* inválida: fica só a bruta */ }
  return [...new Set([bruta, normal].filter(Boolean))];
}

// Caminho como o modelo escreveu, relativo ao cwd e absoluto: "*.env" pega os três jeitos.
function caminhos(p) {
  if (typeof p !== 'string' || !p) return [];
  const abs = path.resolve(p);
  return [...new Set([p, path.relative(process.cwd(), abs) || '.', abs])];
}

// Separa também & (segundo plano), $( ` ( ) { }: sem isso "true & git push", "echo $(git push)"
// e "(git push)" escapavam de run_shell(git push*). Partes a mais só deixam o "negar" mais rígido.
const PARTES_SHELL = /&&|\|\||\$\(|[;|&\n`(){}]/;
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

// edit_files (v0.41.0) faz o mesmo que várias chamadas de edit_file: regras e hooks escritos para
// edit_file valem para cada edição dele — senão "negar": ["edit_file(*.env)"] era contornado.
function equivalentes(nome, args = {}) {
  if (nome === 'edit_files' && Array.isArray(args.edits)) return args.edits.filter((e) => e && typeof e === 'object').map((e) => ({ nome: 'edit_file', args: e }));
  return [];
}

/** @returns {string|null} a regra de "negar" que bloqueia esta chamada, ou null. */
function negada(nome, args, cfg) {
  const chamadas = [{ nome, args }, ...equivalentes(nome, args)];
  const r = regrasDe(cfg, 'negar').find((regra) => chamadas.some((c) => bate(regra, c.nome, c.args, { cadaParteDoShell: true })));
  return r ? r.texto : null;
}

/** true se um comando SIMPLES bate numa regra de "permitir" do run_shell. */
function shellPermitido(command, cfg) {
  if (typeof command !== 'string' || METACARACTERES.test(command)) return false;
  return regrasDe(cfg, 'permitir').some((regra) => regra.padrao && bate(regra, 'run_shell', { command: command.trim() }));
}

/**
 * true se uma chamada (de qualquer ferramenta que NÃO seja o run_shell) bate numa regra de "permitir".
 * Usado pela ferramenta adb (src/tools/adbTools.js) para dispensar a confirmação de ações específicas,
 * ex.: "permitir": ["adb(tecla *)", "adb(abrir_app com.netflix*)"]. Não vale para run_shell (esse usa shellPermitido, que
 * é mais restrito por causa de comandos compostos).
 */
function permitido(nome, args, cfg) {
  if (nome === 'run_shell') return false;
  return regrasDe(cfg, 'permitir').some((regra) => bate(regra, nome, args));
}

function validar(regra) {
  return parseRegra(regra) ? null : `Regra inválida: "${regra}". Use FERRAMENTA ou FERRAMENTA(PADRÃO), ex.: run_shell(npm test*)`;
}

module.exports = { negada, shellPermitido, permitido, parseRegra, validar, globParaRegex, alvos, equivalentes };
