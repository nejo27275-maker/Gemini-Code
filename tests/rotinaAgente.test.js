'use strict';
// v0.44.0: rotina "agente" — o agente faz uma tarefa sozinho no horário marcado. Sem ninguém olhando, toda
// confirmação vira "não" (o run_shell não roda), só ferramentas de leitura por padrão, nenhuma repetição
// automática, resposta guardada como artefato e notificação opcional.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-rotina-agente-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoutineStore, FERRAMENTAS_ROTINA_PADRAO } = require('../src/routines');
const { createRoutineRunner, notificarSistema, INSTRUCAO_ROTINA } = require('../src/routineRunner');
const prompt = require('../src/ui/prompt');
const { runOnce } = require('../src/agent');
const fileTools = require('../src/tools/fileTools');

const BIN = path.join(__dirname, '..', 'bin', 'gemini-code.js');

function loja() {
  const dir = fs.mkdtempSync(path.join(HOME_FALSO, 'rotinas-'));
  return createRoutineStore({ dataPath: path.join(dir, 'routines.json'), executionsPath: path.join(dir, 'executions.json') });
}
const gatilho = { type: 'interval', intervalMs: 60000, timezone: 'UTC' };
const criar = (store, action) => store.create({ name: 'Resumo diário', trigger: gatilho, action: { type: 'agente', ...action } });

test('validação: padrão só leitura, [] = nenhuma, ferramenta desconhecida e limites recusados', () => {
  const store = loja();
  const r = criar(store, { prompt: 'resuma os TODO‮ do projeto' });
  assert.deepEqual(r.action.ferramentas, [...FERRAMENTAS_ROTINA_PADRAO]);
  assert.ok(!r.action.ferramentas.includes('run_shell') && !r.action.ferramentas.includes('write_file'));
  assert.equal(r.action.prompt, 'resuma os TODO do projeto', 'controle de direção sai do pedido guardado');
  assert.equal(r.action.maxPassos, 20);
  assert.equal(r.action.notificar, false);
  assert.equal(r.category, 'agente');
  assert.deepEqual(criar(store, { prompt: 'x', ferramentas: [] }).action.ferramentas, []);
  assert.deepEqual(criar(store, { prompt: 'x', ferramentas: ['read_file', 'read_file', 'mcp__git__log'] }).action.ferramentas, ['read_file', 'mcp__git__log']);
  assert.throws(() => criar(store, { prompt: 'x', ferramentas: ['apagar_tudo'] }), /Ferramenta desconhecida: apagar_tudo/);
  assert.throws(() => criar(store, { prompt: 'x', ferramentas: 'read_file' }), /lista de nomes/);
  assert.throws(() => criar(store, { prompt: '   ' }), /pedido/);
  assert.throws(() => criar(store, { prompt: 'x'.repeat(8001) }), /8000/);
  assert.throws(() => criar(store, { prompt: 'x', maxPassos: 0 }), /entre 1 e 60/);
  assert.throws(() => criar(store, { prompt: 'x', maxPassos: 61 }), /entre 1 e 60/);
});

test('execução: o agente recebe pedido, ferramentas, passos e a instrução de tarefa agendada; resposta vira artefato', async () => {
  const store = loja();
  const r = criar(store, { prompt: 'liste os arquivos', ferramentas: ['list_dir'], maxPassos: 7 });
  const chamadas = [];
  const runner = createRoutineRunner({ store, agente: {
    runOnceFn: async (pedido, opcoes) => { chamadas.push({ pedido, opcoes }); return { text: 'Há 3 arquivos.\nDetalhes...' }; },
  } });
  const exec = await runner.execute(r.id, { source: 'teste' });
  assert.equal(exec.status, 'concluida');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].pedido, 'liste os arquivos');
  assert.deepEqual(chamadas[0].opcoes.allowedTools, ['list_dir']);
  assert.equal(chamadas[0].opcoes.maxSteps, 7);
  assert.equal(chamadas[0].opcoes.extraSystemInstruction, INSTRUCAO_ROTINA);
  assert.deepEqual(chamadas[0].opcoes.history, []);
  assert.equal(exec.result.resposta, 'Há 3 arquivos.\nDetalhes...');
  const artefato = require('../src/artifacts').readArtifact(exec.result.artefato);
  assert.match(artefato.content, /## Pedido\n\nliste os arquivos/);
  assert.match(artefato.content, /Há 3 arquivos/);
  assert.equal(store.get(r.id).lastResult.ok, true);
});

test('falha do agente: registrada, sem repetir (cada tentativa gasta tokens e refaz ações)', async () => {
  const store = loja();
  const r = criar(store, { prompt: 'x' });
  let vezes = 0;
  const runner = createRoutineRunner({ store, baseRetryMs: 1, agente: { runOnceFn: async () => { vezes++; throw new Error('cota estourada'); } } });
  const exec = await runner.execute(r.id);
  assert.equal(exec.status, 'falhou');
  assert.equal(vezes, 1);
  assert.match(exec.error, /O agente falhou: cota estourada/);
});

test('sem ninguém olhando: toda pergunta vira "não" na hora, e volta ao normal depois', async () => {
  const store = loja();
  const r = criar(store, { prompt: 'x' });
  let respostaDuranteRotina = null;
  const saida = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (t) => { saida.push(String(t)); return true; };
  try {
    const runner = createRoutineRunner({ store, agente: { runOnceFn: async () => { respostaDuranteRotina = await prompt.ask('Apagar tudo? (s/n) '); return { text: 'ok' }; } } });
    await runner.execute(r.id);
  } finally { process.stdout.write = original; }
  assert.equal(respostaDuranteRotina, '');
  assert.match(saida.join(''), /rotina agendada: ninguém para responder/);
  // a suspensão foi desfeita: uma pergunta agora iria ao terminal (aqui só confere que não resolve na hora)
  const corrida = await Promise.race([prompt.ask('?'), new Promise((ok) => setTimeout(() => ok('pendente'), 50))]);
  assert.equal(corrida, 'pendente');
  prompt.closeShared();
});

test('de ponta a ponta: sem sandbox, o run_shell pedido pelo modelo numa rotina é recusado e o comando não roda', async () => {
  const store = loja();
  const marca = path.join(HOME_FALSO, 'rodou.txt');
  const r = criar(store, { prompt: 'crie o arquivo', ferramentas: ['run_shell'] });
  fs.mkdirSync(path.join(HOME_FALSO, '.gemini-code'), { recursive: true });
  fs.writeFileSync(path.join(HOME_FALSO, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: 99, confirmShell: true, shellSandbox: 'off' }));
  let passo = 0;
  let resultadoDaFerramenta = null;
  const chamada = { name: 'run_shell', args: { command: `echo x > ${JSON.stringify(marca)}` }, id: 'c1' };
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    const runner = createRoutineRunner({ store, agente: {
      runOnceFn: (pedido, opcoes) => runOnce(pedido, { ...opcoes, deps: {
        buildSystemInstruction: () => 's',
        chatWithTools: async ({ history }) => {
          if (passo++ === 0) return { functionCalls: () => [chamada], text: () => '', rawParts: () => [{ functionCall: chamada }] };
          resultadoDaFerramenta = JSON.stringify(history.at(-1));
          return { functionCalls: () => [], text: () => 'não consegui: precisava de confirmação' };
        },
      } }),
    } });
    const exec = await runner.execute(r.id);
    assert.equal(exec.status, 'concluida');
  } finally { process.stdout.write = original; }
  assert.equal(fs.existsSync(marca), false, 'o comando não pode ter rodado');
  assert.match(resultadoDaFerramenta, /Comando cancelado/, 'a confirmação foi respondida "não" sozinha');
});

test('o modelo não grava o routines.json (senão agendaria a si mesmo)', async () => {
  const destino = path.join(HOME_FALSO, '.gemini-code', 'routines.json');
  const r = await fileTools.execute('write_file', { path: destino, content: '{"version":1,"routines":[]}' });
  assert.match(r, /^Bloqueado/);
});

test('notificação: comando certo por sistema, texto sempre como argumento', async () => {
  const vistos = [];
  const exec = (cmd, args, opts, cb) => { vistos.push([cmd, args]); cb(null); };
  assert.equal(await notificarSistema('-titulo', 'olá‮', { execFileFn: exec, plataforma: 'android' }), 'enviada');
  assert.deepEqual(vistos[0], ['termux-notification', ['--title', 'titulo', '--content', 'olá']]);
  await notificarSistema('t', 'texto"; do shell script "rm', { execFileFn: exec, plataforma: 'darwin' });
  assert.equal(vistos[1][0], 'osascript');
  assert.ok(!vistos[1][1].slice(0, 6).some((a) => a.includes('rm')), 'o texto não entra no código AppleScript');
  assert.equal(vistos[1][1].at(-1), 'texto"; do shell script "rm');
  await notificarSistema('t', 'c', { execFileFn: exec, plataforma: 'linux' });
  assert.deepEqual(vistos[2], ['notify-send', ['--', 't', 'c']]);
  assert.equal(await notificarSistema('t', 'c', { execFileFn: exec, plataforma: 'win32' }), 'indisponível');
  assert.equal(await notificarSistema('t', 'c', { execFileFn: (c, a, o, cb) => cb(new Error('ENOENT')), plataforma: 'linux' }), 'indisponível');
});

test('notificar: a rotina avisa com o resultado (e avisa também quando falha)', async () => {
  const store = loja();
  const avisos = [];
  const notificarFn = async (t, c) => { avisos.push([t, c]); return 'enviada'; };
  const ok = criar(store, { prompt: 'x', notificar: true });
  const runner = createRoutineRunner({ store, agente: { runOnceFn: async () => ({ text: 'tudo certo' }), notificarFn } });
  assert.equal((await runner.execute(ok.id)).result.notificacao, 'enviada');
  const ruim = criar(store, { prompt: 'y', notificar: true });
  const runner2 = createRoutineRunner({ store, agente: { runOnceFn: async () => { throw new Error('sem rede'); }, notificarFn } });
  await runner2.execute(ruim.id);
  assert.deepEqual(avisos[0], ['gemini-code: Resumo diário', 'tudo certo']);
  assert.match(avisos[1][0], /falhou/);
  assert.match(avisos[1][1], /sem rede/);
});

test('CLI: routines create --prompt cria rascunho de agente; logs filtram o texto do modelo', () => {
  const env = { ...process.env, HOME: HOME_FALSO, USERPROFILE: HOME_FALSO };
  const criado = spawnSync(process.execPath, [BIN, 'routines', 'create', '--name', 'Resumo', '--prompt', 'resuma o README', '--ferramentas', 'read_file,list_dir', '--passos', '5', '--notificar', '--cron', '0 8 * * 1-5'], { env, encoding: 'utf8' });
  assert.equal(criado.status, 0, criado.stderr);
  assert.match(criado.stdout, /rascunho/);
  assert.match(criado.stdout, /Ferramentas do agente nesta rotina: read_file, list_dir/);
  const routines = JSON.parse(fs.readFileSync(path.join(HOME_FALSO, '.gemini-code', 'routines.json'), 'utf8')).routines;
  const r = routines.find((x) => x.name === 'Resumo');
  assert.deepEqual(r.action, { type: 'agente', prompt: 'resuma o README', ferramentas: ['read_file', 'list_dir'], maxPassos: 5, notificar: true });

  // resposta do modelo com sequência de terminal no histórico
  const execs = { version: 1, executions: [{ id: 'e1', routineId: r.id, routineName: 'Resumo', status: 'concluida', startedAt: 'agora', result: { ok: true, resposta: 'oi \u001b]52;c;Y3VybA==\u0007 fim' } }] };
  fs.writeFileSync(path.join(HOME_FALSO, '.gemini-code', 'routine-executions.json'), JSON.stringify(execs));
  const logs = spawnSync(process.execPath, [BIN, 'routines', 'logs'], { env, encoding: 'utf8' });
  assert.equal(logs.status, 0, logs.stderr);
  assert.ok(!logs.stdout.includes('\u001b'), JSON.stringify(logs.stdout));
  assert.match(logs.stdout, /oi .*fim/);

  const semAcao = spawnSync(process.execPath, [BIN, 'routines', 'create', '--name', 'X', '--every', '5m'], { env, encoding: 'utf8' });
  assert.match(semAcao.stdout, /--prompt/);
});
