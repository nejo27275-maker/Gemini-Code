// src/hooks.js
// Hooks (v0.13.0): comandos SEUS que rodam antes e depois de cada ferramenta do agente, sem gastar IA.
// Exemplos: bloquear run_shell com "rm -rf", rodar o lint depois de edit_file, avisar no Termux quando algo grava.
//
// Arquivo: ~/.gemini-code/hooks.json (só o GLOBAL, de propósito: um repositório baixado não pode registrar
// comandos que rodam na sua máquina sozinhos). Formato:
//   { "PreToolUse":  [ { "matcher": "run_shell", "command": "meu-filtro.sh", "timeout": 10 } ],
//     "PostToolUse": [ { "matcher": "edit_file|write_file", "command": "npm run lint --silent" } ] }
// - matcher: regex que precisa casar com o NOME INTEIRO da ferramenta ("*" ou vazio = todas).
// - command: roda com `sh -c`, recebendo no stdin um JSON {event, tool, args, cwd, resultado?}
//   e as variáveis GEMINI_CODE_EVENT e GEMINI_CODE_TOOL. timeout em segundos (padrão 10, máx. 60).
// - Saída com código 2 em PreToolUse BLOQUEIA a ferramenta e o texto da saída vai para o modelo como motivo.
//   Em PostToolUse, código 2 anexa a saída ao resultado da ferramenta (bom para erros de lint).
//   Qualquer outro código ≠ 0 só mostra um aviso; hook que falha ou estoura o tempo nunca derruba o agente.
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
// HOOKS_PATH está em PROTECTED_PATHS: o modelo não grava este arquivo (write_file/edit_file).
const { HOOKS_PATH } = require('./config');

const EVENTOS = ['PreToolUse', 'PostToolUse'];
let arquivo = HOOKS_PATH;
let cache = { mtime: -1, hooks: {} };

function definirArquivo(p) { arquivo = p; cache = { mtime: -1, hooks: {} }; }

function carregar() {
  try {
    const st = fs.statSync(arquivo);
    if (st.mtimeMs === cache.mtime) return cache.hooks;
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    const hooks = {};
    for (const ev of EVENTOS) {
      hooks[ev] = (Array.isArray(bruto[ev]) ? bruto[ev] : []).filter((h) => h && typeof h.command === 'string' && h.command.trim());
    }
    cache = { mtime: st.mtimeMs, hooks };
    return hooks;
  } catch { cache = { mtime: -1, hooks: {} }; return {}; }
}

function casa(matcher, tool) {
  if (!matcher || matcher === '*') return true;
  try { return new RegExp(`^(?:${matcher})$`).test(tool); } catch { return false; }
}

/**
 * Roda os hooks do evento para a ferramenta.
 * @returns {{bloqueado:boolean, mensagem:string, avisos:string[]}}
 */
function executar(evento, { tool, args, resultado, cwd = process.cwd() } = {}) {
  const r = { bloqueado: false, mensagem: '', avisos: [] };
  const lista = (carregar()[evento] || []).filter((h) => casa(h.matcher, tool));
  for (const h of lista) {
    const segundos = Math.min(60, Math.max(1, Number(h.timeout) || 10));
    const entrada = JSON.stringify({ event: evento, tool, args, cwd, ...(resultado !== undefined ? { resultado: String(resultado).slice(0, 20000) } : {}) });
    let p;
    try {
      p = spawnSync('sh', ['-c', h.command], { input: entrada, encoding: 'utf8', timeout: segundos * 1000, cwd, env: { ...process.env, GEMINI_CODE_EVENT: evento, GEMINI_CODE_TOOL: tool }, maxBuffer: 1024 * 1024 });
    } catch (e) { r.avisos.push(`hook falhou ao iniciar: ${e.message}`); continue; }
    // EPIPE = o hook terminou sem ler o stdin (ex.: `echo ...; exit 2`). Ele rodou e tem código de saída: não é falha.
    if (p.error && p.error.code === 'EPIPE' && p.status !== null) p.error = undefined;
    if (p.error) { r.avisos.push(`hook "${h.command}" não terminou (${p.error.code === 'ETIMEDOUT' ? `passou de ${segundos}s` : p.error.message})`); continue; }
    const saida = `${p.stdout || ''}${p.stderr || ''}`.trim().slice(0, 2000);
    if (p.status === 2) { r.bloqueado = true; r.mensagem = [r.mensagem, saida || `hook "${h.command}" respondeu código 2`].filter(Boolean).join('\n'); if (evento === 'PreToolUse') break; }
    else if (p.status !== 0) r.avisos.push(`hook "${h.command}" saiu com código ${p.status}${saida ? `: ${saida.slice(0, 200)}` : ''}`);
  }
  return r;
}

function resumo() {
  const h = carregar();
  return EVENTOS.flatMap((ev) => (h[ev] || []).map((x) => `  ${ev} [${x.matcher || '*'}] ${x.command}`));
}

module.exports = { executar, resumo, definirArquivo, EVENTOS };
