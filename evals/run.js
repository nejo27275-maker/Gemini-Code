#!/usr/bin/env node
// evals/run.js — tarefas reproduzíveis para medir agentes de programação.
//
//   node evals/run.js --self-test
//       Prova que cada verificador mede o que diz: tem que FALHAR no workspace
//       original e PASSAR depois da solução de referência (pasta solution/).
//   node evals/run.js --agent "gemini-code run {prompt}" [--tasks a,b] [--timeout 900] [--out r.json] [--keep]
//       Roda o comando do agente numa cópia nova de cada workspace ({prompt} vira
//       o enunciado já entre aspas) e depois o verificador, que fica FORA do
//       workspace (o agente não vê nem edita o critério). Mesmas tarefas e mesmos
//       verificadores para qualquer agente de linha de comando: condições comparáveis.
//
// Nada aqui chama modelo de IA por conta própria e nenhum resultado é inventado:
// sem --agent, só o autoteste roda. Veja docs/EVALS.md.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const TASKS_DIR = path.join(__dirname, 'tasks');
const CHECK_TIMEOUT_MS = 60000;

function listarTarefas(ids) {
  const todas = fs.readdirSync(TASKS_DIR)
    .filter((id) => fs.existsSync(path.join(TASKS_DIR, id, 'task.json')))
    .sort();
  const desconhecidas = (ids || []).filter((id) => !todas.includes(id));
  if (desconhecidas.length) throw new Error(`Tarefa(s) desconhecida(s): ${desconhecidas.join(', ')}. Disponíveis: ${todas.join(', ')}`);
  return (ids && ids.length ? todas.filter((id) => ids.includes(id)) : todas).map((id) => {
    const dir = path.join(TASKS_DIR, id);
    return { ...JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8')), id, dir };
  });
}

// Ambiente do agente e do verificador: sem NODE_TEST_CONTEXT (rodando dentro do
// `npm test`, ele mudaria o comportamento de um `node --test` aninhado).
function envLimpo(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function git(ws, args) {
  return spawnSync('git', args, {
    cwd: ws,
    encoding: 'utf8',
    env: envLimpo({ GIT_AUTHOR_NAME: 'eval', GIT_AUTHOR_EMAIL: 'eval@localhost', GIT_COMMITTER_NAME: 'eval', GIT_COMMITTER_EMAIL: 'eval@localhost' }),
  });
}

/** Cópia nova do workspace, como repositório git (para o agente poder usar diff/restore). */
function prepararWorkspace(tarefa, base) {
  const ws = fs.mkdtempSync(path.join(base, `${tarefa.id}-`));
  fs.cpSync(path.join(tarefa.dir, 'workspace'), ws, { recursive: true });
  if (git(ws, ['init', '-q']).status === 0) {
    git(ws, ['add', '-A']);
    // Sem assinatura nem hooks do git global do usuário (podem pedir senha ou falhar).
    git(ws, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'estado inicial da tarefa']);
  }
  return ws;
}

function verificar(tarefa, ws) {
  const r = spawnSync(process.execPath, [path.join(tarefa.dir, 'check.js'), ws], { cwd: ws, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, env: envLimpo() });
  const saida = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.error) return { passou: false, detalhe: `verificador não terminou: ${r.error.message}` };
  // Erro não tratado do verificador: a linha "AssertionError [...]: motivo" é o que interessa.
  const erro = saida.match(/^\w*Error(?: \[[A-Z_]+\])?: (.+)$/m);
  return { passou: r.status === 0, detalhe: r.status !== 0 && erro ? erro[1] : saida.split('\n').slice(-6).join('\n') };
}

function autoTeste({ ids, base = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-eval-')) } = {}) {
  const resultados = listarTarefas(ids).map((tarefa) => {
    const ws = prepararWorkspace(tarefa, base);
    const antes = verificar(tarefa, ws);
    fs.cpSync(path.join(tarefa.dir, 'solution'), ws, { recursive: true });
    const depois = verificar(tarefa, ws);
    return { id: tarefa.id, ok: !antes.passou && depois.passou, falhaSemSolucao: !antes.passou, passaComSolucao: depois.passou, detalhe: depois.passou ? antes.detalhe : depois.detalhe };
  });
  fs.rmSync(base, { recursive: true, force: true });
  return resultados;
}

const aspas = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function rodarAgente(comando, ws, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // stdin fechado: agente que pede confirmação não fica esperando ninguém.
    const filho = spawn(comando, { cwd: ws, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: envLimpo() });
    let saida = '';
    const guardar = (d) => { saida = (saida + d).slice(-20000); };
    filho.stdout.on('data', guardar);
    filho.stderr.on('data', guardar);
    let estourou = false;
    const timer = setTimeout(() => {
      estourou = true;
      try { process.kill(-filho.pid, 'SIGKILL'); } catch { filho.kill('SIGKILL'); }
    }, timeoutMs);
    filho.on('close', (codigo) => {
      clearTimeout(timer);
      resolve({ codigo, estourou, ms: Date.now() - t0, saida });
    });
  });
}

async function avaliarAgente({ agente, ids, timeoutSec, manter, log = console.log }) {
  if (!agente.includes('{prompt}')) throw new Error('O comando do agente precisa conter {prompt} (onde entra o enunciado).');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-eval-'));
  const tarefas = listarTarefas(ids);
  const resultados = [];
  for (const tarefa of tarefas) {
    const ws = prepararWorkspace(tarefa, base);
    const limite = (Number(timeoutSec) || tarefa.timeoutSec || 900) * 1000;
    log(`→ ${tarefa.id}: rodando o agente (limite ${limite / 1000}s)...`);
    const exec = await rodarAgente(agente.split('{prompt}').join(aspas(tarefa.prompt)), ws, limite);
    const v = verificar(tarefa, ws);
    const st = git(ws, ['status', '--porcelain']);
    const alterados = st.status === 0 ? st.stdout.split('\n').filter(Boolean).length : null; // null = sem git
    resultados.push({
      id: tarefa.id,
      capacidade: tarefa.capacidade,
      passou: v.passou,
      detalhe: v.detalhe,
      ms: exec.ms,
      codigoSaida: exec.codigo,
      estourouTempo: exec.estourou,
      arquivosAlterados: alterados,
      fimDaSaida: exec.saida.slice(-2000),
      ...(manter ? { workspace: ws } : {}),
    });
    log(`  ${v.passou ? 'PASSOU' : 'FALHOU'} em ${Math.round(exec.ms / 1000)}s${exec.estourou ? ' (tempo esgotado)' : ''}`);
  }
  if (!manter) fs.rmSync(base, { recursive: true, force: true });
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).stdout.trim() || null;
  return {
    quando: new Date().toISOString(),
    agente,
    ambiente: { node: process.version, plataforma: `${process.platform}-${process.arch}`, commitDasTarefas: commit },
    resumo: { tarefas: resultados.length, passaram: resultados.filter((r) => r.passou).length },
    resultados,
  };
}

function lerArgs(argv) {
  const o = { ids: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') o.autoTeste = true;
    else if (a === '--keep') o.manter = true;
    else if (['--agent', '--tasks', '--timeout', '--out'].includes(a)) {
      if (argv[i + 1] === undefined) throw new Error(`${a} precisa de um valor.`);
      const v = argv[++i];
      if (a === '--agent') o.agente = v;
      if (a === '--tasks') o.ids = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (a === '--timeout') o.timeoutSec = Number(v);
      if (a === '--out') o.saida = v;
    } else throw new Error(`Argumento desconhecido: ${a}`);
  }
  return o;
}

async function main(argv) {
  const o = lerArgs(argv);
  if (o.autoTeste) {
    const r = autoTeste({ ids: o.ids });
    for (const x of r) console.log(`${x.ok ? 'ok ' : 'ERRO'} ${x.id}${x.ok ? '' : ` (falha sem solução: ${x.falhaSemSolucao}, passa com solução: ${x.passaComSolucao})\n${x.detalhe}`}`);
    console.log(`\n${r.filter((x) => x.ok).length}/${r.length} verificadores válidos.`);
    return r.every((x) => x.ok) ? 0 : 1;
  }
  if (o.agente) {
    const rel = await avaliarAgente(o);
    console.log(`\n${rel.resumo.passaram}/${rel.resumo.tarefas} tarefas passaram (${o.agente}).`);
    if (o.saida) { fs.writeFileSync(o.saida, JSON.stringify(rel, null, 2)); console.log(`Relatório: ${o.saida}`); }
    else console.log(JSON.stringify(rel, null, 2));
    return 0;
  }
  console.log('Uso: node evals/run.js --self-test | --agent "COMANDO {prompt}" [--tasks a,b] [--timeout SEG] [--out arquivo.json] [--keep]');
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 2; });
}

module.exports = { listarTarefas, prepararWorkspace, verificar, autoTeste, avaliarAgente, lerArgs, aspas };
