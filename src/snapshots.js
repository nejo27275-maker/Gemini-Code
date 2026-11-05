// src/snapshots.js
// Snapshots automáticos com git (v0.12.1+): a cada turno do chat, dentro de um repositório git, grava uma "foto" do
// projeto numa referência escondida (refs/gemini-code/snapshots). NÃO mexe na sua branch, no seu índice nem no
// stash, e não precisa de user.name/email. Cobre também o que run_shell mudou (que o /rewind não enxerga).
// Custo de IA: zero. Só roda se a pasta já for um repositório git (nunca faz `git init`).
// Segredos (.env, chaves .pem/.key, id_rsa, credentials.json) ficam fora da foto.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REF = 'refs/gemini-code/snapshots';
const EXCLUIR = [':(exclude,glob)**/.env', ':(exclude,glob)**/.env.*', ':(exclude,glob)**/*.pem', ':(exclude,glob)**/*.key', ':(exclude,glob)**/*.p12', ':(exclude,glob)**/id_rsa*', ':(exclude,glob)**/credentials.json', ':(exclude,glob)**/node_modules/**'];
const IDENT = { GIT_AUTHOR_NAME: 'gemini-code', GIT_AUTHOR_EMAIL: 'gemini-code@local', GIT_COMMITTER_NAME: 'gemini-code', GIT_COMMITTER_EMAIL: 'gemini-code@local' };

// v0.45.0: este git roda no projeto FORA de qualquer sandbox, a cada turno. Uma config de repositório plantada
// (core.fsmonitor; commit.gpgSign + gpg.program; filtros clean/process) faria ele rodar um comando. As primeiras
// ficam anuladas por -c (a linha de comando vence a config do repositório); filtro não dá para anular sem saber
// o nome, então com um filtro na config do repositório a foto é pulada (filtroNoRepositorio).
const SEGURO = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false'];

function git(args, cwd, env = {}) {
  return execFileSync('git', [...SEGURO, ...args], { cwd, env: { ...process.env, ...IDENT, ...env }, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 }).trim();
}

/** Há filtro (clean/process) definido na config do PRÓPRIO repositório? Na dúvida (git antigo), responde que sim. */
function filtroNoRepositorio(root) {
  try {
    const saida = git(['config', '--show-scope', '--includes', '--get-regexp', '^filter\\..*\\.(clean|process)$'], root);
    return saida.split('\n').some((l) => /^(local|worktree)\t/.test(l));
  } catch (err) {
    return err.status !== 1; // 1 = nenhum filtro; outro erro (ex.: git sem --show-scope): pula a foto
  }
}

function raiz(cwd = process.cwd()) {
  try { return git(['rev-parse', '--show-toplevel'], cwd) || null; } catch { return null; }
}
function ultimo(root) { try { return git(['rev-parse', '--verify', '-q', REF], root) || null; } catch { return null; } }

/** Tira uma foto. Devolve {commit, curto} ou null (sem repo, nada mudou, ou erro — nunca lança). */
function tirar({ cwd = process.cwd(), rotulo = '' } = {}) {
  const root = raiz(cwd);
  if (!root || filtroNoRepositorio(root)) return null;
  const idx = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-snap-')), 'index');
  try {
    const env = { GIT_INDEX_FILE: idx };
    const pai = ultimo(root);
    if (pai) git(['read-tree', pai], root, env);
    git(['add', '-A', '--', '.', ...EXCLUIR], root, env);
    const arvore = git(['write-tree'], root, env);
    if (pai && git(['rev-parse', `${pai}^{tree}`], root) === arvore) return null; // nada mudou desde a última foto
    const msg = String(rotulo || 'snapshot').replace(/\s+/g, ' ').slice(0, 120);
    const commit = git(['commit-tree', arvore, ...(pai ? ['-p', pai] : []), '-m', msg], root);
    git(['update-ref', REF, commit], root);
    return { commit, curto: commit.slice(0, 7) };
  } catch { return null; }
  finally { try { fs.rmSync(path.dirname(idx), { recursive: true, force: true }); } catch { /* */ } }
}

/** Fotos mais novas primeiro: [{commit, curto, em, rotulo}] */
function listar({ cwd = process.cwd(), limite = 10 } = {}) {
  const root = raiz(cwd);
  if (!root || !ultimo(root)) return [];
  try {
    return git(['log', REF, `-n${Math.max(1, limite)}`, '--format=%H%x09%cI%x09%s'], root).split('\n').filter(Boolean)
      .map((l) => { const [commit, em, ...r] = l.split('\t'); return { commit, curto: commit.slice(0, 7), em, rotulo: r.join('\t') }; });
  } catch { return []; }
}

/**
 * Volta os arquivos para a foto número `n` (1 = a mais nova). Antes de restaurar tira uma foto do estado atual,
 * então a própria restauração é reversível. Não apaga arquivos que não existiam na foto.
 */
function restaurar({ n = 1, cwd = process.cwd() } = {}) {
  const root = raiz(cwd);
  if (!root) throw new Error('Esta pasta não é um repositório git.');
  const fotos = listar({ cwd, limite: 200 });
  const alvo = fotos[n - 1];
  if (!alvo) throw new Error(fotos.length ? `Só existem ${fotos.length} foto(s). Use /snapshots para ver.` : 'Ainda não há fotos neste projeto.');
  const antes = tirar({ cwd, rotulo: `antes de restaurar ${alvo.curto}` });
  git(['restore', `--source=${alvo.commit}`, '--worktree', '--', '.', ...EXCLUIR], root);
  return { restaurada: alvo, fotoAntes: antes };
}

module.exports = { filtroNoRepositorio, tirar, listar, restaurar, raiz, REF };
