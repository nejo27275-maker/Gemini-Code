'use strict';
// v0.47.0: desafios pessoais (src/desafios.js, src/desafiosCommands.js, src/tools/desafioTools.js) e o lembrete
// com data final (a rotina se encerra sozinha depois do último dia).
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-desafios-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const desafios = require('../src/desafios');
const cmd = require('../src/desafiosCommands');
const tool = require('../src/tools/desafioTools');
const routines = require('../src/routines');
const { executeLembrete, createRoutineRunner } = require('../src/routineRunner');

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

let n = 0;
const novoStore = (dia) => desafios.createDesafiosStore({ arquivo: path.join(HOME, `d${++n}.json`), clock: () => dia });

test('progresso: dia atual, sequência (hoje ou até ontem), melhor sequência, calendário e fim', () => {
  let agora = new Date(2026, 10, 1, 9, 0);
  const store = desafios.createDesafiosStore({ arquivo: path.join(HOME, 'p.json'), clock: () => agora });
  const d = store.criar({ nome: 'Caminhada', dias: 10 });
  assert.equal(d.inicio, '2026-11-01');
  for (const dia of [1, 2, 3, 5, 6]) { agora = new Date(2026, 10, dia, 20, 0); store.feito('caminhada'); }
  agora = new Date(2026, 10, 7, 8, 0); // dia 7, ainda não feito: a sequência que vale é até ontem (5, 6)
  let p = desafios.progresso(store.achar('caminhada'), store.hoje());
  assert.deepEqual([p.diaAtual, p.feitos, p.sequencia, p.melhorSequencia, p.porcentagem, p.hojeFeito, p.terminou], [7, 5, 2, 3, 50, false, false]);
  assert.equal(desafios.calendario(store.achar('caminhada'), store.hoje()), '  1  ✓ ✓ ✓ · ✓ ✓ ○ ○ ○ ○');
  agora = new Date(2026, 10, 12, 8, 0);
  p = desafios.progresso(store.achar('caminhada'), store.hoje());
  assert.equal(p.terminou, true);
  assert.equal(p.sequencia, 0);
  assert.equal(desafios.barra(50, 10), '[█████░░░░░] 50%');
});

test('marcar: não marca o futuro nem fora do período; nota limpa; textos do dia', () => {
  const store = novoStore(new Date(2026, 10, 3, 10, 0));
  const d = store.criar({ nome: '21 dias sem açúcar', dias: 21, hashtag: '#semAcucar' });
  assert.equal(d.hashtag, 'semAcucar');
  assert.throws(() => store.feito(d.id, { dia: '2026-11-04' }), /ainda não chegou/);
  assert.throws(() => store.feito(d.id, { dia: '2026-11-02' }), /começou em 2026-11-03/);
  assert.throws(() => store.feito('nao-existe'), /Não achei o desafio/);
  const r = store.feito('', { nota: 'tomei \u001b[2Jcafé sem açúcar' });
  assert.equal(r.nota, 'tomei [2Jcafé sem açúcar', 'controles saem da nota');
  assert.equal(desafios.textoDoDia(r.desafio, r.progresso, r.nota), 'Dia 1/21 do desafio "21 dias sem açúcar" ✅ — tomei [2Jcafé sem açúcar #semAcucar');
  assert.equal(store.desmarcar(d.id), true);
  assert.equal(store.desmarcar(d.id), false);
});

test('criar: validação (nome, dias, hora, rede, hashtag, repetido)', () => {
  const store = novoStore(new Date(2026, 10, 3));
  assert.throws(() => store.criar({ nome: '  ' }), /Dê um nome/);
  for (const dias of [0, 367, 1.5, 'abc']) assert.throws(() => store.criar({ nome: 'x', dias }), /"dias" vai de 1 a 366/);
  assert.throws(() => store.criar({ nome: 'x', hora: '25:00' }), /Horário inválido/);
  assert.throws(() => store.criar({ nome: 'x', redes: 'orkut' }), /não publica por API/);
  assert.throws(() => store.criar({ nome: 'x', hashtag: 'com espaço' }), /hashtag/);
  store.criar({ nome: 'Leitura' });
  assert.throws(() => store.criar({ nome: 'leitura' }), /Já existe um desafio ativo/);
  assert.equal(store.feito('').desafio.nome, 'Leitura', 'com um só ativo, "feito" sem nome marca esse');
  store.criar({ nome: 'Corrida' });
  assert.throws(() => store.feito(''), /Qual desafio\? Ativos: .*Leitura.*Corrida/);
});

test('lembrete do desafio: rotina diária com data final; depois do último dia não notifica e se encerra', async () => {
  const d = { id: 'x', nome: 'Caminhada', dias: 30, inicio: '2026-11-01', hora: '07:30' };
  const criadas = [];
  const rotinasFalsas = { create: (r) => { criadas.push(r); return { id: 'r1' }; }, activate: () => {} };
  assert.equal(desafios.criarLembrete(d, { rotinas: rotinasFalsas, timezone: 'America/Sao_Paulo' }), 'r1');
  assert.deepEqual(criadas[0].trigger, { type: 'cron', expression: '30 7 * * *', timezone: 'America/Sao_Paulo' });
  assert.equal(criadas[0].action.ate, '2026-11-30');
  assert.deepEqual(routines.validarAcao(criadas[0].action), criadas[0].action);
  assert.throws(() => routines.validarAcao({ type: 'lembrete', texto: 'x', ate: '30/11/2026' }), /AAAA-MM-DD/);
  let notificou = 0;
  const notificarFn = async () => { notificou++; return 'enviada'; };
  const r1 = await executeLembrete({ action: criadas[0].action }, { notificarFn, log: () => {}, agora: () => new Date(2026, 10, 30, 7, 30) });
  assert.equal(r1.ok, true);
  assert.equal(notificou, 1, 'no último dia ainda lembra');
  const r2 = await executeLembrete({ action: criadas[0].action }, { notificarFn, log: () => {}, agora: () => new Date(2026, 11, 1, 7, 30) });
  assert.equal(r2.encerrar, true);
  assert.equal(notificou, 1, 'depois do fim, não notifica');
  // no executor: a rotina vira "concluida", sem próxima execução
  const store = routines.createRoutineStore({ dataPath: path.join(HOME, 'rot.json'), executionsPath: path.join(HOME, 'exec.json') });
  const rot = store.create({ name: 'Desafio acabado', trigger: { type: 'cron', expression: '30 7 * * *' }, action: { type: 'lembrete', texto: 'x', ate: '2020-01-01' } });
  store.activate(rot.id);
  const runner = createRoutineRunner({ store, lembrete: { notificarFn, log: () => {} } });
  await runner.execute(rot.id);
  const depois = store.get(rot.id);
  assert.equal(depois.status, routines.STATUSES.COMPLETED);
  assert.equal(depois.nextRunAt, null);
  assert.equal(notificou, 1);
});

test('linha de comando: criar com lembrete, marcar e postar o progresso (pergunta antes), ver, parar', async () => {
  const store = novoStore(new Date(2026, 10, 3, 9, 0));
  const criadas = [];
  const removidas = [];
  const rotinas = { create: (r) => { criadas.push(r); return { id: 'rot-9' }; }, activate: () => {}, pause: () => {}, remove: (id) => removidas.push(id) };
  let r = await cmd.executar(['criar', '30', 'dias', 'de', 'leitura', '--hora', '21h', '--redes', 'bluesky', '--hashtag', 'leio30'], { store, rotinas });
  assert.equal(r.codigo, 0, JSON.stringify(r.linhas));
  assert.match(r.linhas[1].texto, /Lembrete todo dia às 21:00/);
  assert.equal(criadas[0].action.ate, '2026-12-02');
  const publicados = [];
  const redesStore = { contas: () => [], conta: () => ({ usuario: 'x', senha: 'y' }), conferirLimites: () => {}, registrar: () => {} };
  const cliente = { publicar: { bluesky: async (c, p) => { publicados.push(p.texto); return { url: 'https://bsky.app/profile/x/post/1' }; } } };
  const mostrados = [];
  r = await cmd.executar(['feito', '--nota', '20 páginas'], { store, redesStore, cliente, ask: async () => 's', mostrar: (t) => mostrados.push(t) });
  assert.equal(r.codigo, 0, JSON.stringify(r.linhas));
  assert.deepEqual(publicados, ['Dia 1/30 do desafio "30 dias de leitura" ✅ — 20 páginas #leio30']);
  assert.match(mostrados[0], /--- post ---/);
  assert.match(r.linhas.map((l) => l.texto).join('\n'), /✓ Bluesky: postado — https:\/\/bsky\.app/);
  r = await cmd.executar(['ver', 'leitura'], { store });
  assert.match(r.linhas.map((l) => l.texto).join('\n'), /Feitos: 1\/30 · sequência: 1/);
  r = await cmd.executar(['parar', 'leitura'], { store, rotinas });
  assert.match(r.linhas[0].texto, /parado \(e o lembrete dele\)/);
  assert.deepEqual(removidas, ['rot-9']);
  r = await cmd.executar(['xyz'], { store });
  assert.equal(r.codigo, 1);
});

test('ferramenta "desafio": marcar não pergunta; criar pergunta; devolve o texto pronto para postar', async () => {
  const store = novoStore(new Date(2026, 10, 3, 9, 0));
  const perguntas = [];
  let resposta = 'n';
  tool._testar({ store: () => store, ask: async (q) => { perguntas.push(q); return resposta; }, rotinas: () => ({ create: () => ({ id: 'r' }), activate: () => {} }) });
  assert.match(await tool.execute('desafio', { acao: 'criar', nome: 'Água 2L', dias: 7, hora: '09:00' }), /não quis criar/);
  assert.match(perguntas[0], /Criar o desafio "Água 2L" \(7 dias, lembrete todo dia às 09:00\)/);
  resposta = 's';
  assert.match(await tool.execute('desafio', { acao: 'criar', nome: 'Água 2L', dias: 7, hora: '09:00' }), /Desafio criado .*lembrete às 09:00/);
  const r = await tool.execute('desafio', { acao: 'feito', nota: 'bebi 2L' });
  assert.match(r, /Marcado: Água 2L, dia 1\/7\. Sequência: 1\. Texto para postar .*bebi 2L/);
  assert.equal(perguntas.length, 2, 'marcar o dia não pergunta');
  assert.match(await tool.execute('desafio', { acao: 'lista' }), /Água 2L \| dia 1\/7 \| 1 feitos \(14%\)/);
  assert.match(await tool.execute('desafio', { acao: 'progresso' }), /✓ ○ ○ ○ ○ ○ ○/);
  assert.match(await tool.execute('desafio', { acao: 'xyz' }), /precisa de "acao"/);
});

test('aliados: preset "desafios"; "central" junta computador, celular, sites, redes e desafios', async () => {
  const { PRESETS } = require('../src/personalAgents');
  assert.deepEqual([...PRESETS.desafios], ['desafio', 'redes', 'web_fetch']);
  assert.ok(PRESETS.central.includes('desafio'));
  const tools = require('../src/tools');
  assert.ok(!(await tools.getAllDeclarations()).some((d) => d.name === 'desafio'), 'o chat comum não vê');
});
