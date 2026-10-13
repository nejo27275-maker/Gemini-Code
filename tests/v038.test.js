// tests/v038.test.js — melhorias da v0.3.8 (ver CORRECOES.md).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
// Isola ~/.gemini-code (backups, logs) numa pasta temporária — cada arquivo de
// teste roda em processo próprio, então mexer no HOME aqui não vaza.
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-v038-home-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');

const { cortarResultado } = require('../src/agent');
const fileTools = require('../src/tools/fileTools');
const searchTools = require('../src/tools/searchTools');
const { detectarComandos } = require('../src/tools/checkTools');
const { listarBackups, restaurarBackup, backupBeforeWrite } = require('../src/tools/backup');
const decisionLog = require('../src/decisionLog');

const temp = (p = 'gemini-code-v038-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ---- truncamento head+tail ----
test('run_shell: resultado longo mantém o INÍCIO e o FIM (o erro costuma estar no fim)', () => {
  const texto = 'INICIO' + 'x'.repeat(30000) + 'ERRO-FINAL';
  const r = cortarResultado('run_shell', texto);
  assert.ok(r.startsWith('INICIO'));
  assert.ok(r.endsWith('ERRO-FINAL'));
  assert.match(r, /caracteres do meio omitidos/);
  assert.ok(r.length < 20600);
});

test('run_checks também mantém o fim; outras ferramentas seguem cortando só pelo início', () => {
  assert.ok(cortarResultado('run_checks', 'a'.repeat(25000) + 'FIM').endsWith('FIM'));
  const r = cortarResultado('read_file', 'a'.repeat(25000) + 'FIM');
  assert.ok(!r.endsWith('FIM'), 'ferramentas comuns não ganham o tratamento head+tail');
  assert.match(r, /resultado truncado: mostrando 20000 de 25003 caracteres/);
});

test('resultado curto passa intacto', () => {
  assert.equal(cortarResultado('run_shell', 'ok'), 'ok');
});

// ---- fileTools ----
test('read_file e edit_file sem path devolvem erro claro (não TypeError)', async () => {
  assert.match(await fileTools.execute('read_file', {}), /precisa de "path"/);
  assert.match(await fileTools.execute('edit_file', { old_text: 'a', new_text: 'b' }), /precisa de "path"/);
});

test('mensagem de truncamento aponta para search_files (grep_files não existe)', async () => {
  const p = path.join(temp(), 'grande.txt');
  fs.writeFileSync(p, 'a'.repeat(250 * 1024));
  const r = await fileTools.execute('read_file', { path: p });
  assert.match(r, /search_files/);
  assert.doesNotMatch(r, /grep_files/);
});

test('edit_file explica o problema quando o arquivo é CRLF e o old_text multilinha usa \\n', async () => {
  const p = path.join(temp(), 'crlf.txt');
  fs.writeFileSync(p, 'linha1\r\nlinha2\r\n');
  const r = await fileTools.execute('edit_file', { path: p, old_text: 'linha1\nlinha2', new_text: 'x' });
  assert.match(r, /CRLF/);
  assert.equal(fs.readFileSync(p, 'utf8'), 'linha1\r\nlinha2\r\n');
});

test('list_dir: pastas primeiro, ordenado, e com teto de itens', async () => {
  const d = temp();
  fs.mkdirSync(path.join(d, 'zeta'));
  fs.writeFileSync(path.join(d, 'a.txt'), '');
  fs.writeFileSync(path.join(d, 'b.txt'), '');
  assert.equal(await fileTools.execute('list_dir', { path: d }), 'zeta/\na.txt\nb.txt');

  const grande = temp();
  for (let i = 0; i < 520; i++) fs.writeFileSync(path.join(grande, `f${String(i).padStart(4, '0')}.txt`), '');
  const r = await fileTools.execute('list_dir', { path: grande });
  assert.match(r, /mostrando 500 de 520 itens/);
});

// ---- searchTools ----
test('search_files: pastas com ponto só entram com include_hidden, e .env* nunca', async () => {
  const d = temp();
  fs.mkdirSync(path.join(d, '.github'));
  fs.writeFileSync(path.join(d, '.github', 'ci.yml'), 'palavra-secreta-ci\n');
  fs.writeFileSync(path.join(d, '.env'), 'palavra-secreta-ci=1\n');
  fs.writeFileSync(path.join(d, 'visivel.txt'), 'nada\n');

  assert.match(await searchTools.execute('search_files', { pattern: 'palavra-secreta-ci', path: d }), /Nenhuma ocorrência/);
  const r = await searchTools.execute('search_files', { pattern: 'palavra-secreta-ci', path: d, include_hidden: true });
  assert.match(r, /ci\.yml/);
  assert.doesNotMatch(r, /\.env/);
});

// ---- checkTools ----
test('Makefile sem alvo "test" não gera "make test" (falso alarme)', () => {
  const d = temp();
  fs.writeFileSync(path.join(d, 'Makefile'), 'build:\n\techo oi\n');
  assert.deepEqual(detectarComandos(d), []);
  fs.writeFileSync(path.join(d, 'Makefile'), 'build:\n\techo oi\n\ntest:\n\techo ok\n');
  assert.deepEqual(detectarComandos(d).map((c) => c.label), ['make test']);
});

// ---- backups: listar e restaurar ----
test('restaurarBackup volta o conteúdo antigo e guarda o atual como novo backup', () => {
  const p = path.join(temp(), 'doc.txt');
  fs.writeFileSync(p, 'v1');
  backupBeforeWrite(p);            // guarda v1
  fs.writeFileSync(p, 'v2');
  assert.equal(listarBackups(p).length, 1);

  const r = restaurarBackup(p, 1);
  assert.equal(fs.readFileSync(p, 'utf8'), 'v1');
  assert.ok(r.backupDoAtual, 'o v2 deveria ter virado backup');
  assert.equal(fs.readFileSync(r.backupDoAtual, 'utf8'), 'v2');
  assert.equal(listarBackups(p).length, 2);
});

test('restaurarBackup recusa número inválido e arquivo sem backup', () => {
  const p = path.join(temp(), 'sem.txt');
  fs.writeFileSync(p, 'x');
  assert.throws(() => restaurarBackup(p), /Nenhum backup/);
  backupBeforeWrite(p);
  assert.throws(() => restaurarBackup(p, 9), /não existe/);
  assert.throws(() => restaurarBackup(p, 0), /não existe/);
});

// ---- decisionLog: rotação ----
test('actions.log passa a ser rotacionado quando fica grande', () => {
  fs.mkdirSync(path.dirname(decisionLog.LOG_PATH), { recursive: true });
  fs.writeFileSync(decisionLog.LOG_PATH, 'x'.repeat(decisionLog.MAX_LOG_BYTES + 10));
  decisionLog.logAcao({ tool: 'teste', args: {}, resultado: 'ok' });
  assert.ok(fs.existsSync(decisionLog.LOG_PATH + '.1'), 'deveria ter criado actions.log.1');
  assert.ok(fs.statSync(decisionLog.LOG_PATH).size < 1000, 'o log novo deveria começar vazio + 1 linha');
});

// ---- v0.3.9: run_checks pede confirmação 1x por sessão ----
test('run_checks cancelado quando o usuário responde n, e liberado (uma vez) com s', async () => {
  const ui = require('../src/ui/prompt');
  const checkTools = require('../src/tools/checkTools');
  const cfgMod = require('../src/config');
  const d = temp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'echo passou-ok' } }));
  const askOriginal = ui.ask;
  let perguntas = 0;
  let resposta = 'n';
  // checkTools já capturou `ask` na importação; troca via o módulo de prompt não pega,
  // então simulamos a leitura direto no readline compartilhado.
  const rl = ui.getShared();
  const questionOriginal = rl.question.bind(rl);
  rl.question = (q, cb) => { perguntas++; cb(resposta); };
  try {
    checkTools.sessao.confirmado = false;
    const negado = await checkTools.execute('run_checks', { cwd: d });
    assert.match(negado, /cancelado pelo usuário/);
    assert.equal(perguntas, 1);

    resposta = 's';
    const ok = await checkTools.execute('run_checks', { cwd: d });
    assert.match(ok, /passou-ok/);
    await checkTools.execute('run_checks', { cwd: d });
    assert.equal(perguntas, 2, 'depois de confirmar, não pergunta de novo na sessão');
  } finally {
    rl.question = questionOriginal;
    rl.close();
    checkTools.sessao.confirmado = true;
    void askOriginal; void cfgMod;
  }
});

// ---- v0.3.10 ----
test('backups no mesmo milissegundo não se sobrescrevem e a ordem continua cronológica', () => {
  const p = path.join(temp(), 'colisao.txt');
  const RealDate = Date;
  global.Date = class extends RealDate { toISOString() { return '2026-10-10T00:00:00.000Z'; } };
  try {
    fs.writeFileSync(p, 'a'); backupBeforeWrite(p);
    fs.writeFileSync(p, 'b'); backupBeforeWrite(p);
    fs.writeFileSync(p, 'c'); backupBeforeWrite(p);
  } finally { global.Date = RealDate; }
  const lista = listarBackups(p);
  assert.equal(lista.length, 3);
  assert.deepEqual(lista.map((x) => fs.readFileSync(x.caminho, 'utf8')), ['c', 'b', 'a']); // mais recente primeiro
});

test('saveConfig não vaza a apiKey destrancada nem congela os padrões em disco', () => {
  const config = require('../src/config');
  const security = require('../src/security');
  config.saveConfig({ apiKey: 'AIzaSECRET-v0310' });
  security.lock('senha-dono');
  assert.ok(security.unlock('senha-dono'));
  security.setGuestPassphrase('senha-dono', 'senha-convidado');
  const emDisco = JSON.parse(fs.readFileSync(config.CONFIG_PATH, 'utf8'));
  assert.ok(!emDisco.apiKey, 'a chave não pode voltar para o disco em texto puro');
  assert.ok(emDisco.apiKeyLocked);
  assert.equal('model' in emDisco, false, 'padrões não devem ser congelados no arquivo');
  assert.equal(config.loadConfig().apiKey, 'AIzaSECRET-v0310', 'a sessão destrancada continua funcionando');
  security.clearSession();
});

test('agenda: arquivo corrompido vai para quarentena em vez de ser apagado; data inexistente é recusada', () => {
  const agenda = require('../src/agenda');
  fs.mkdirSync(path.dirname(agenda.AGENDA_PATH), { recursive: true });
  fs.writeFileSync(agenda.AGENDA_PATH, '{"eventos": [ {"data":"2026-10-1');   // escrita cortada
  const ev = agenda.adicionarEvento('dentista', { data: '2026-11-03' });
  assert.equal(ev.data, '2026-11-03');
  const irmaos = fs.readdirSync(path.dirname(agenda.AGENDA_PATH)).filter((n) => n.startsWith('agenda.json.corrompido-'));
  assert.equal(irmaos.length, 1);
  assert.match(fs.readFileSync(path.join(path.dirname(agenda.AGENDA_PATH), irmaos[0]), 'utf8'), /dentista|2026-10-1/);
  assert.throws(() => agenda.adicionarEvento('x', { data: '2026-02-31' }), /inexistente/);
});

test('skills: front matter com CRLF e BOM é lido; read_skill sem path/inexistente dá erro claro', async () => {
  const d = temp();
  fs.mkdirSync(path.join(d, 'minha'));
  fs.writeFileSync(path.join(d, 'minha', 'SKILL.md'), '\uFEFF---\r\nname: minha\r\ndescription: faz coisa\r\n---\r\nCorpo\r\n');
  const loader = require('../src/skills/loader');
  const [s] = loader.listSkills([d]);
  assert.equal(s.name, 'minha');
  assert.equal(s.description, 'faz coisa');
  assert.equal(loader.readSkill(s.path), 'Corpo');
  assert.match(await loader.execute('read_skill', {}), /precisa de "path"/);
  assert.match(await loader.execute('read_skill', { path: '/nao/existe/SKILL.md' }), /não encontrada/);
});

// ---- v0.3.11: subagentes ----
test('subagente: contexto isolado, ferramentas restritas, sem delegate_task e relatório rotulado', async () => {
  const sub = require('../src/subagent');
  let recebido;
  const runOnceFn = async (prompt, opts) => { recebido = { prompt, opts }; return { text: 'achei em src/a.js:10' }; };
  const r = await sub.execute('delegate_task', { task: 'onde fica o login?', context: 'projeto X' }, { runOnceFn });
  assert.match(r, /^\[relatório do subagente explorador\]\nachei em src\/a\.js:10/);
  assert.deepEqual(recebido.opts.history, []);
  assert.deepEqual(recebido.opts.allowedTools, ['read_file', 'list_dir', 'search_files', 'read_skill']);
  assert.ok(!recebido.opts.allowedTools.includes('delegate_task'));
  assert.match(recebido.prompt, /onde fica o login\?[\s\S]*Contexto:\nprojeto X/);
  assert.match(recebido.opts.extraSystemInstruction, /EXPLORADOR/);
  assert.equal(recebido.opts.maxSteps, 25);
});

test('subagente executor ganha escrita/shell, mas nunca passa das ferramentas do pai', async () => {
  const sub = require('../src/subagent');
  let tools;
  const runOnceFn = async (_p, o) => { tools = o.allowedTools; return { text: 'ok' }; };
  await sub.execute('delegate_task', { task: 't', type: 'executor' }, { runOnceFn });
  assert.ok(['write_file', 'edit_file', 'run_shell', 'run_checks'].every((t) => tools.includes(t)));
  await sub.execute('delegate_task', { task: 't', type: 'executor' }, { runOnceFn, allowedPai: ['read_file', 'run_shell'] });
  assert.deepEqual(tools.sort(), ['read_file', 'run_shell']);
  const r = await sub.execute('delegate_task', { task: 't', type: 'executor' }, { runOnceFn, allowedPai: ['mcp__x__y'] });
  assert.match(r, /nenhuma ferramenta/);
});

test('subagente: valida argumentos, recusa recursão e trata falha e relatório gigante', async () => {
  const sub = require('../src/subagent');
  assert.match(await sub.execute('delegate_task', {}, {}), /precisa de "task"/);
  assert.match(await sub.execute('delegate_task', { task: 'x', type: 'deus' }, {}), /tipo de subagente desconhecido/);
  // recursão: o runOnce do subagente tenta delegar de novo
  const interno = await sub.execute('delegate_task', { task: 'pai' }, {
    runOnceFn: async () => ({ text: await sub.execute('delegate_task', { task: 'neto' }, { runOnceFn: async () => ({ text: 'x' }) }) }),
  });
  assert.match(interno, /não pode criar outro subagente/);
  assert.match(await sub.execute('delegate_task', { task: 'x' }, { runOnceFn: async () => { throw new Error('API caiu'); } }), /Erro no subagente explorador: API caiu/);
  const longo = await sub.execute('delegate_task', { task: 'x' }, { runOnceFn: async () => ({ text: 'a'.repeat(9000) }) });
  assert.match(longo, /relatório do subagente truncado: 6000 de 9000/);
  assert.match(await sub.execute('delegate_task', { task: 'x' }, { runOnceFn: async () => ({ text: '  ' }) }), /sem escrever um relatório/);
});

test('agente: 2 subagentes somente leitura na mesma resposta rodam em paralelo; com executor, em sequência', async () => {
  const { runOnce } = require('../src/agent');
  const resp = (calls) => ({ functionCalls: () => calls, text: () => '', rawParts: () => calls.map((c) => ({ functionCall: c })) });
  const fim = { functionCalls: () => [], text: () => 'pronto' };
  const montar = (chamadas) => {
    let n = 0; let ativos = 0; let pico = 0;
    return {
      medir: () => pico,
      deps: {
        loadConfig: () => ({}), getAllDeclarations: async () => [], buildSystemInstruction: () => 's',
        chatWithTools: async () => (n++ === 0 ? resp(chamadas) : fim),
        execute: async () => { ativos++; pico = Math.max(pico, ativos); await new Promise((r) => setTimeout(r, 30)); ativos--; return 'ok'; },
      },
    };
  };
  const leitura = [
    { name: 'delegate_task', args: { task: 'a' }, id: '1' },
    { name: 'delegate_task', args: { task: 'b', type: 'revisor' }, id: '2' },
  ];
  const p = montar(leitura);
  await runOnce('x', { deps: p.deps });
  assert.equal(p.medir(), 2, 'deveriam ter rodado ao mesmo tempo');

  const comExecutor = [leitura[0], { name: 'delegate_task', args: { task: 'c', type: 'executor' }, id: '3' }];
  const q = montar(comExecutor);
  const { history } = await runOnce('x', { deps: q.deps });
  assert.equal(q.medir(), 1, 'executor força execução em sequência');
  const respostas = history.find((m) => m.parts.some((x) => x.functionResponse)).parts.map((x) => x.functionResponse.id);
  assert.deepEqual(respostas, ['1', '3'], 'a ordem das respostas é preservada');
});

test('runOnce respeita maxSteps', async () => {
  const { runOnce } = require('../src/agent');
  const chamada = { name: 'read_file', args: {}, id: 'k' };
  const deps = {
    loadConfig: () => ({}), getAllDeclarations: async () => [], buildSystemInstruction: () => 's',
    chatWithTools: async () => ({ functionCalls: () => [chamada], text: () => '', rawParts: () => [{ functionCall: chamada }] }),
    execute: async () => 'x',
  };
  const { text } = await runOnce('x', { deps, maxSteps: 3 });
  assert.match(text, /número máximo de passos/);
});
