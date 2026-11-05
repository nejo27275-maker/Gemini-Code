// src/emAndamento.js (v0.49.1) — os comandos de terminal que estão rodando AGORA em primeiro plano (run_shell,
// run_checks). O Ctrl+C do chat e o "Parar" do modo site os interrompem como um terminal faria: SIGINT no comando e em
// tudo que ele abriu (o git, por exemplo, ainda limpa o próprio lock), e quem não sair em 2 s leva SIGKILL. Uma sandbox
// (isolada, só lê o .git) é encerrada direto. E nenhum fica órfão quando o gemini-code sai.
'use strict';

const ativos = new Set();
const PRAZO_SIGKILL_MS = 2000;

const vivo = (filho) => filho.exitCode === null && filho.signalCode === null;

function sinalizar(item, sinal) {
  const sandbox = require('./sandbox');
  if (item.sandboxId !== undefined) { sandbox.matarSandbox(item.filho.pid, item.sandboxId); return; }
  if (process.platform !== 'win32') sandbox.matarDescendentes(item.filho.pid, sinal);
  try { item.filho.kill(sinal); } catch { /* já saiu */ }
}

/**
 * Acompanha um processo filho em primeiro plano (chame `fim()` quando ele terminar).
 * @param {import('child_process').ChildProcess} filho
 * @param {{ sandboxId?: string }} [o] `sandboxId`: é uma sandbox (src/sandbox.js)
 */
function acompanhar(filho, { sandboxId } = {}) {
  const item = { filho, sandboxId, interrompido: false };
  ativos.add(item);
  return { interrompido: () => item.interrompido, fim: () => { ativos.delete(item); } };
}

/** Interrompe todos os comandos em andamento (Ctrl+C / "Parar"). Devolve quantos eram. */
function interromperTodos() {
  let n = 0;
  for (const item of ativos) {
    if (item.interrompido || !vivo(item.filho)) continue;
    item.interrompido = true;
    n++;
    sinalizar(item, 'SIGINT');
    const t = setTimeout(() => { if (vivo(item.filho)) sinalizar(item, 'SIGKILL'); }, PRAZO_SIGKILL_MS);
    if (t.unref) t.unref();
  }
  return n;
}

/** O que a ferramenta devolve ao modelo quando o comando foi interrompido (com a saída que deu tempo de sair). */
function textoInterrompido(stdout, stderr) {
  const partes = [];
  if (stdout) partes.push(String(stdout));
  if (stderr) partes.push(`[stderr]\n${stderr}`);
  const saida = partes.join('\n').trim();
  return `Interrompido pelo usuário (Ctrl+C ou "Parar") antes de terminar. Não rode de novo sem ele pedir.${saida ? `\nSaída até ali:\n${saida}` : ''}`;
}

// saindo (Ctrl+C duas vezes, SIGTERM, fim do programa): nenhum comando em primeiro plano fica rodando sozinho
process.on('exit', () => { for (const item of ativos) if (vivo(item.filho)) sinalizar(item, 'SIGKILL'); });

module.exports = { acompanhar, interromperTodos, textoInterrompido, PRAZO_SIGKILL_MS };
