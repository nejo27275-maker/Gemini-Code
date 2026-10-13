// src/trust.js (v0.41.0) — confiança no projeto
// AGENTS.md, CLAUDE.md, .cursorrules etc. de um repositório entram no prompt do sistema com
// prioridade alta, e os comandos de .gemini-code/commands viram /comandos. Num repositório
// clonado de terceiros isso é injeção de instruções. Como o Claude Code, o chat agora pergunta
// uma vez por pasta se confia; "negar" mantém só o conhecimento global.
// Decisão vale para a pasta e as subpastas (a mais específica vence). Fica em
// ~/.gemini-code/confianca.json, que está em PROTECTED_PATHS: o modelo não se dá confiança.
// Sem terminal (run, cowork), pasta ainda não decidida carrega, como o `claude -p`; para
// bloquear de vez: gemini-code confianca negar [PASTA].
'use strict';

const fs = require('fs');
const path = require('path');
const { TRUST_PATH } = require('./config');

function ler() {
  try {
    const d = JSON.parse(fs.readFileSync(TRUST_PATH, 'utf8'));
    return d && typeof d.pastas === 'object' && d.pastas ? d : { pastas: {} };
  } catch { return { pastas: {} }; }
}

function real(dir) {
  try { return fs.realpathSync(path.resolve(dir)); } catch { return path.resolve(dir); }
}

/** 'confiar' | 'negar' | null para a pasta (ou a pasta-mãe mais próxima com decisão). */
function estado(dir = process.cwd()) {
  const { pastas } = ler();
  let atual = real(dir);
  for (;;) {
    if (pastas[atual] === 'confiar' || pastas[atual] === 'negar') return pastas[atual];
    const pai = path.dirname(atual);
    if (pai === atual) return null;
    atual = pai;
  }
}

function definir(dir, decisao) {
  if (!['confiar', 'negar', null].includes(decisao)) throw new Error('Decisão inválida (use confiar, negar ou esquecer).');
  const d = ler();
  const alvo = real(dir);
  if (decisao === null) delete d.pastas[alvo];
  else d.pastas[alvo] = decisao;
  fs.mkdirSync(path.dirname(TRUST_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(TRUST_PATH, JSON.stringify(d, null, 2), { mode: 0o600 });
  return alvo;
}

// "Não respondeu" (sem terminal) nega só nesta execução, sem salvar.
const negadasNestaSessao = new Set();
function negarNestaSessao(dir = process.cwd()) { negadasNestaSessao.add(real(dir)); }

/** Instruções/comandos do projeto podem ser carregados? (só "negar" bloqueia). */
function projetoLiberado(dir = process.cwd()) {
  const r = real(dir);
  for (const negada of negadasNestaSessao) if (r === negada || r.startsWith(negada + path.sep)) return false;
  return estado(dir) !== 'negar';
}

/** Arquivos do PROJETO que entrariam no prompt (exclui o conhecimento global de ~/.gemini-code). */
function instrucoesDoProjeto(dir = process.cwd()) {
  const { HOME_DIR } = require('./config');
  const globais = real(HOME_DIR) + path.sep;
  const arquivos = require('./knowledge').arquivosDeProjeto(dir).filter((f) => !real(f).startsWith(globais));
  const comandos = path.join(dir, '.gemini-code', 'commands');
  if (fs.existsSync(comandos) && !real(comandos).startsWith(globais)) arquivos.push(comandos + path.sep);
  return arquivos;
}

module.exports = { estado, definir, projetoLiberado, negarNestaSessao, instrucoesDoProjeto, ler };
