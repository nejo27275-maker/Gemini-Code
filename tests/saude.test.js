'use strict';
// v0.46.0: assistente de saúde — leitura dos valores, faixas de referência, triagem de emergência, privacidade,
// remédios com lembrete, página para a consulta e o aliado (ferramentas só para ele).
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-saude-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const saude = require('../src/saude');
const comandos = require('../src/saudeCommands');
const tools = require('../src/tools');
const { createRoutineStore } = require('../src/routines');

const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-saude-proj-'));
const novaLoja = () => saude.createSaudeStore({ arquivo: path.join(fs.mkdtempSync(path.join(HOME, 's-')), 'saude.json') });
const nivel = (tipo, valor) => saude.classificar({ tipo, ...saude.interpretar(tipo, valor) }).nivel;

test.after(() => { for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

test('leitura: "13 por 8", "12,5x8", "130/80 72", glicemia com momento, aliases e erros claros', () => {
  assert.deepEqual(saude.interpretar('pressao', '13 por 8').valores, { sistolica: 130, diastolica: 80 });
  assert.deepEqual(saude.interpretar('pressão', '12,5x8').valores, { sistolica: 125, diastolica: 80 });
  assert.deepEqual(saude.interpretar('pa', '130/80 72').valores, { sistolica: 130, diastolica: 80, pulso: 72 });
  assert.deepEqual(saude.interpretar('glicose', '98 em jejum').valores, { mgdl: 98, momento: 'jejum' });
  assert.deepEqual(saude.interpretar('glicemia', '150 pos').valores, { mgdl: 150, momento: 'pos' });
  assert.deepEqual(saude.interpretar('febre', '37,9').valores, { c: 37.9 });
  assert.deepEqual(saude.interpretar('tomei', 'losartana 50mg').valores, { nome: 'losartana 50mg' });
  assert.throws(() => saude.interpretar('pressao', '8 por 13'), /fora do possível/);
  assert.throws(() => saude.interpretar('pressao', 'alta'), /use "13x8"/);
  assert.throws(() => saude.interpretar('temperatura', '50'), /fora do possível/);
  assert.throws(() => saude.interpretar('colesterol', '200'), /Tipo desconhecido/);
});

test('faixas de referência nos limites (SBC 2020, SBD, OMS)', () => {
  assert.equal(nivel('pressao', '129/84'), 'ok');
  assert.equal(nivel('pressao', '130/80'), 'atencao');
  assert.equal(nivel('pressao', '120/85'), 'atencao', 'a categoria é a do número mais alto');
  assert.equal(nivel('pressao', '140/80'), 'alto');
  assert.equal(nivel('pressao', '179/109'), 'alto');
  assert.equal(nivel('pressao', '180/100'), 'urgente');
  assert.equal(nivel('pressao', '150/120'), 'urgente');
  assert.equal(nivel('pressao', '85/55'), 'atencao');
  assert.equal(nivel('glicemia', '53'), 'urgente');
  assert.equal(nivel('glicemia', '69'), 'alto');
  assert.equal(nivel('glicemia', '99 jejum'), 'ok');
  assert.equal(nivel('glicemia', '100 jejum'), 'atencao');
  assert.equal(nivel('glicemia', '126 jejum'), 'alto');
  assert.equal(nivel('glicemia', '139 pos'), 'ok');
  assert.equal(nivel('glicemia', '140 pos'), 'atencao');
  assert.equal(nivel('glicemia', '300'), 'urgente');
  assert.equal(nivel('saturacao', '95'), 'ok');
  assert.equal(nivel('saturacao', '94'), 'atencao');
  assert.equal(nivel('saturacao', '91'), 'alto');
  assert.equal(nivel('saturacao', '89'), 'urgente');
  assert.equal(nivel('temperatura', '37,7'), 'ok');
  assert.equal(nivel('temperatura', '37,8'), 'atencao');
  assert.equal(nivel('temperatura', '39'), 'alto');
  assert.equal(nivel('temperatura', '40'), 'urgente');
  assert.equal(nivel('temperatura', '34,9'), 'urgente');
  assert.equal(nivel('batimentos', '100'), 'ok');
  assert.equal(nivel('batimentos', '101'), 'atencao');
  assert.equal(nivel('batimentos', '131'), 'urgente');
  assert.equal(nivel('batimentos', '39'), 'urgente');
  assert.equal(saude.classificar({ tipo: 'peso', valores: { kg: 70 } }, { alturaM: 1.75 }).texto, 'IMC 22,9 (peso adequado, pela tabela da OMS).');
  assert.equal(saude.classificar({ tipo: 'peso', valores: { kg: 70 } }, {}), null, 'sem altura não há IMC');
});

test('triagem: sinais de emergência com ou sem acento; frases comuns não disparam', () => {
  const sinais = (t) => saude.sinaisDeAlerta(t).map((s) => s.sinal);
  assert.deepEqual(sinais('Estou com DOR NO PEITO'), ['dor ou aperto no peito']);
  assert.deepEqual(sinais('meu pai está com a boca torta e a fala enrolada'), ['sinais de AVC (derrame)']);
  assert.deepEqual(sinais('não consigo respirar direito'), ['falta de ar']);
  assert.match(saude.sinaisDeAlerta('tenho vontade de me matar')[0].orientacao, /188/);
  assert.match(saude.sinaisDeAlerta('minha filha tomou uma caixa de remédios')[0].orientacao, /0800 722 6001/);
  assert.match(saude.sinaisDeAlerta('ele engoliu produto de limpeza')[0].orientacao, /não provoque vômito/);
  assert.deepEqual(sinais('desmaiei e tive convulsão'), ['desmaio ou perda de consciência', 'convulsão']);
  for (const comum of ['dor nas costas', 'tomei o remédio da pressão', 'comprei peito de frango', 'fiquei sem ar condicionado', 'dor de cabeça leve', '']) {
    assert.deepEqual(sinais(comum), [], comum);
  }
  const aviso = saude.avisoDeEmergencia(saude.sinaisDeAlerta('dor no peito'));
  assert.match(aviso, /^ATENÇÃO — isto pode ser uma emergência:\n {2}• dor ou aperto no peito: .*192/);
  assert.equal(saude.avisoDeEmergencia([]), '');
});

test('diário: grava com permissão 0600, apaga, filtra por período e tipo; data no futuro é recusada', () => {
  let agora = new Date('2026-11-02T12:00:00Z');
  const store = saude.createSaudeStore({ arquivo: path.join(fs.mkdtempSync(path.join(HOME, 'd-')), 'saude.json'), clock: () => agora });
  const a = store.anotar('pressao', '13x8', { quando: '2026-10-01T08:00:00Z', nota: 'depois do café' });
  store.anotar('glicemia', '90 jejum');
  assert.equal(a.classificacao.nivel, 'atencao');
  assert.equal(fs.statSync(store.caminho).mode & 0o777, 0o600);
  assert.equal(store.registros({ dias: 7 }).length, 1, 'a de outubro fica fora dos últimos 7 dias');
  assert.equal(store.registros({ tipo: 'pressao' })[0].nota, 'depois do café');
  assert.throws(() => store.anotar('peso', '70', { quando: '2026-11-03T12:00:00Z' }), /futuro/);
  assert.equal(store.apagar(a.registro.id), true);
  assert.equal(store.apagar('nao-existe'), false);
  assert.equal(store.perfil({ alturaM: '170' }).alturaM, 1.7);
  assert.throws(() => store.perfil({ alturaM: '9' }), /Altura inválida/);
  agora = new Date('2026-11-02T12:00:00Z');
});

test('página para a consulta: dados escapados, sem script nem nada de fora, com os telefones de emergência', () => {
  const store = novaLoja();
  store.anotar('pressao', '14x9');
  store.anotar('pressao', '13x8');
  store.anotar('sintoma', '<script>alert(1)</script> dor de cabeça');
  store.adicionarRemedio({ nome: 'Losartana <b>', dose: '50mg', horarios: ['08:00'] });
  const html = saude.paginaHtml(store, { dias: 30 });
  assert.ok(!/<script/i.test(html), 'nenhum script');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; dor de cabeça/);
  assert.match(html, /Losartana &lt;b&gt;/);
  assert.ok(!/(src|href)="https?:/i.test(html), 'nada carregado de fora');
  assert.match(html, /SAMU 192/);
  assert.match(html, /<svg viewBox/, 'gráfico da pressão');
  assert.match(saude.resumo(store), /Pressão: última 130\/80 mmHg .* Média 135\/85, maior 140\/90, menor 130\/80 \(2 medições\)\./);
});

test('privacidade: read_file, search_files e imagem não alcançam a pasta de saúde; o modelo não grava nela', async () => {
  const store = saude.createSaudeStore();
  store.anotar('pressao', '12x8');
  const { isSecret, isProtected } = require('../src/tools/protectedPaths');
  assert.equal(isSecret(config.SAUDE_PATH), true);
  assert.equal(isProtected(path.join(config.SAUDE_DIR, 'qualquer.json')), true);
  assert.match(await tools.execute('read_file', { path: config.SAUDE_PATH }), /^Bloqueado/);
  const busca = await tools.execute('search_files', { pattern: 'sistolica', path: config.HOME_DIR, include_hidden: true });
  assert.match(busca, /^Nenhuma ocorrência/);
  assert.match(await tools.execute('write_file', { path: path.join(config.SAUDE_DIR, 'x.json'), content: '{}' }), /^Bloqueado/);
});

test('ferramentas saude_*: fora do chat comum; entram com a lista do aliado ou com ferramentasExtras', async () => {
  config.saveConfig({ ferramentasExtras: [] });
  const nomes = async (lista) => (await tools.getAllDeclarations(lista)).map((d) => d.name);
  assert.ok(!(await nomes(undefined)).includes('saude_registrar'), 'chat comum não vê');
  assert.deepEqual(await nomes(['saude_registrar', 'saude_consultar']), ['saude_registrar', 'saude_consultar']);
  await assert.rejects(() => tools.execute('saude_consultar', {}), /não está ligada nesta conversa/);
  const r = await tools.execute('saude_registrar', { tipo: 'pressao', valor: '19 por 12' }, ['saude_registrar']);
  assert.match(r, /^Anotado: Pressão 190\/120 mmHg .*crise hipertensiva.*Emergência: SAMU 192/);
  config.saveConfig({ ferramentasExtras: ['saude_consultar'] });
  assert.ok((await nomes(undefined)).includes('saude_consultar'));
  assert.match(await tools.execute('saude_consultar', { dias: 7 }), /^Saúde — últimos 7 dias/);
  config.saveConfig({ ferramentasExtras: [] });
});

test('aliado de saúde: a triagem acontece antes da IA; aliado sem saúde não faz triagem', () => {
  const personalAgents = require('../src/personalAgents');
  const aliados = personalAgents.createPersonalAgentStore({ dir: fs.mkdtempSync(path.join(HOME, 'aliados-')) });
  const linhas = [];
  return comandos.executar(['aliado'], { aliados }).then((r) => {
    linhas.push(...r.linhas);
    const agente = aliados.obter('saude');
    assert.deepEqual(agente.tools, ['saude_registrar', 'saude_consultar', 'web_fetch']);
    const t = personalAgents.prepararTurno(aliados, agente, 'estou com dor no peito forte');
    assert.match(t.alerta, /ATENÇÃO/);
    assert.match(t.opcoes.extraSystemInstruction, /ALERTA: .*dor ou aperto no peito/);
    assert.equal(personalAgents.prepararTurno(aliados, agente, 'minha pressão deu 12 por 8').alerta, '');
    aliados.criar({ name: 'outro', instructions: 'x', tools: 'pesquisa' });
    assert.equal(personalAgents.prepararTurno(aliados, aliados.obter('outro'), 'dor no peito').alerta, '', 'só o aliado de saúde');
  });
});

test('remédios: lembretes ativos no horário; remover tira os lembretes; página escrita fora das áreas protegidas', async () => {
  const store = novaLoja();
  const rotinas = createRoutineStore({ dataPath: path.join(HOME, 'r.json'), executionsPath: path.join(HOME, 'e.json') });
  let r = await comandos.executar(['remedio', 'add', 'Losartana', '--horarios', '8h,20:30', '--dose', '50mg'], { store, rotinas, timezone: 'UTC' });
  assert.equal(r.codigo, 0, JSON.stringify(r.linhas));
  const lista = rotinas.list();
  assert.deepEqual(lista.map((x) => [x.status, x.trigger.expression, x.action.texto]).sort(), [['ativa', '0 8 * * *', 'Losartana 50mg'], ['ativa', '30 20 * * *', 'Losartana 50mg']]);
  const rem = store.remedios()[0];
  r = await comandos.executar(['remedio', 'remover', rem.id], { store, rotinas });
  assert.equal(r.codigo, 0);
  assert.equal(rotinas.list().length, 0);
  assert.match((await comandos.executar(['remedio', 'add', 'X', '--horarios', '25:00'], { store, rotinas })).linhas[0].texto, /Horário inválido/);
  r = await comandos.executar(['pagina', '--saida', 'relatorio.html'], { store, cwd: PROJ });
  assert.equal(r.codigo, 0);
  assert.equal(fs.statSync(path.join(PROJ, 'relatorio.html')).mode & 0o777, 0o600);
  r = await comandos.executar(['pagina', '--saida', path.join(config.SAUDE_DIR, 'x.html')], { store, cwd: PROJ });
  assert.match(r.linhas[0].texto, /protegido/);
  r = await comandos.executar(['triagem', 'estou', 'com', 'falta', 'de', 'ar'], { store });
  assert.match(r.linhas[0].texto, /ATENÇÃO/);
});
