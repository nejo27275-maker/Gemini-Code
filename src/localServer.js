// src/localServer.js (v0.37.0)
// Sobe/para o llama-server (llama.cpp) em segundo plano, sem precisar de duas abas do Termux.
// Só mexe em endereço LOCAL (127.0.0.1/localhost). Guarda o PID em ~/.gemini-code/llama-server.pid
// e o log em ~/.gemini-code/llama-server.log.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function dirDados() {
  const dir = path.join(process.env.HOME || os.homedir(), '.gemini-code');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const pidPath = () => path.join(dirDados(), 'llama-server.pid');
const logPath = () => path.join(dirDados(), 'llama-server.log');

function caminhos(env = process.env, config = {}) {
  const home = env.HOME || os.homedir();
  return {
    servidor: env.LLAMA_SERVER_BIN || path.join(home, 'llama.cpp', 'build', 'bin', 'llama-server'),
    // Prioridade: override da sessão > caminho escolhido no Gemini Code > compatibilidade legada.
    modelo: env.LLAMA_MODEL_PATH || (typeof config.llamaCppModelPath === 'string' && config.llamaCppModelPath.trim()) || path.join(home, 'models', 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'),
  };
}

/** Só sobe servidor se o endereço apontar para esta máquina. */
function enderecoLocal(url) {
  try {
    const u = new URL(url);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) return null;
    return { host: u.hostname === 'localhost' ? '127.0.0.1' : u.hostname.replace(/[[\]]/g, ''), port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
  } catch { return null; }
}

function threadsPadrao(env = process.env) {
  const n = Number(env.LLAMA_THREADS);
  if (Number.isInteger(n) && n > 0) return n;
  return Math.max(1, Math.min(4, (os.cpus() || []).length || 4));
}

/** Argumentos do llama-server. `--jinja` é necessário para o modelo usar ferramentas (tool calls). */
function montarArgs({ modelo, ctx, host, port, threads }) {
  return ['--model', modelo, '--ctx-size', String(ctx), '--threads', String(threads), '--host', host, '--port', String(port), '--jinja'];
}

function lerPid() {
  try { const n = Number(fs.readFileSync(pidPath(), 'utf8').trim()); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
}
function vivo(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.url endereço configurado (llamaCppUrl)
 * @param {number} o.ctx contexto (tokens)
 * @param {Function} o.status função async () => { ok, estado }
 * @param {number} [o.esperaMs] quanto esperar o modelo carregar
 * @param {Function} [o.log]
 * @param {Function} [o.spawnFn] injetável para teste
 */
async function iniciar({ url, ctx, status, esperaMs = 120000, log = () => {}, spawnFn = spawn, env = process.env, config = {} }) {
  const atual = await status();
  if (atual.ok) return { ok: true, ja: true, mensagem: 'llama.cpp já está respondendo.' };
  const end = enderecoLocal(url);
  if (!end) return { ok: false, mensagem: `O endereço ${url} não é desta máquina; inicie o servidor lá.` };
  const pidAntigo = lerPid();
  const { servidor, modelo } = caminhos(env, config);
  if (!vivo(pidAntigo)) {
    if (!fs.existsSync(servidor)) return { ok: false, mensagem: `Não achei llama-server em ${servidor}. Rode: bash android/termux-install.sh` };
    if (!fs.existsSync(modelo) || fs.statSync(modelo).size === 0) return { ok: false, mensagem: `Não achei o modelo GGUF em ${modelo}. Rode: bash android/termux-install.sh` };
    // Evita o Android matar o processo com a tela apagada (best-effort; só existe no Termux).
    try { spawnSync('termux-wake-lock', [], { timeout: 3000 }); } catch { /* fora do Termux */ }
    const out = fs.openSync(logPath(), 'a');
    const filho = spawnFn(servidor, montarArgs({ modelo, ctx, host: end.host, port: end.port, threads: threadsPadrao(env) }), { detached: true, stdio: ['ignore', out, out] });
    filho.on && filho.on('error', () => {});
    if (filho.unref) filho.unref();
    fs.writeFileSync(pidPath(), String(filho.pid || ''), { mode: 0o600 });
    log(`llama-server iniciado (PID ${filho.pid}); carregando o modelo...`);
  } else {
    log(`llama-server já está no ar (PID ${pidAntigo}); aguardando carregar...`);
  }
  const limite = Date.now() + esperaMs;
  while (Date.now() < limite) {
    const s = await status();
    if (s.ok) return { ok: true, mensagem: 'llama.cpp pronto.' };
    const pid = lerPid();
    if (!vivo(pid)) return { ok: false, mensagem: `O llama-server encerrou ao iniciar. Veja o log: ${logPath()}` };
    await dormir(1000);
  }
  return { ok: false, mensagem: `O modelo ainda não ficou pronto em ${Math.round(esperaMs / 1000)}s. Veja o log: ${logPath()}` };
}

function parar() {
  const pid = lerPid();
  if (!pid || !vivo(pid)) { try { fs.unlinkSync(pidPath()); } catch { /* nada */ } return { ok: true, mensagem: 'Nenhum llama-server iniciado por este programa.' }; }
  try { process.kill(pid, 'SIGTERM'); } catch (e) { return { ok: false, mensagem: `Não consegui encerrar o PID ${pid}: ${e.message}` }; }
  try { fs.unlinkSync(pidPath()); } catch { /* nada */ }
  try { spawnSync('termux-wake-unlock', [], { timeout: 3000 }); } catch { /* fora do Termux */ }
  return { ok: true, mensagem: `llama-server (PID ${pid}) encerrado.` };
}

module.exports = { iniciar, parar, caminhos, enderecoLocal, montarArgs, threadsPadrao, lerPid, vivo, pidPath, logPath };
