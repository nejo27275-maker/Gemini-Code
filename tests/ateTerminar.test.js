'use strict';
// v0.52.0: modo até terminar (src/agent.js) — o agente continua sozinho até marcar a tarefa como concluída (ou dizer
// que precisa da pessoa), com tetos, sem marcas no texto (nem no meio do streaming), e o "Parar" ainda vale.
const test = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../src/agent');

const { runOnce } = agent;
const deps = (chatWithTools, extra = {}) => ({
  loadConfig: () => ({ model: 'modelo-fake' }),
  getAllDeclarations: async () => [{ name: 'ferramenta_fake' }],
  buildSystemInstruction: () => 'sistema',
  chatWithTools,
  ...extra,
});
const texto = (t) => ({ functionCalls: () => [], text: () => t });
const chamada = (nome) => ({ functionCalls: () => [{ name: nome, args: {}, id: `c-${nome}` }], text: () => '', rawParts: () => [{ functionCall: { name: nome, args: {}, id: `c-${nome}` } }] });

test('marcas: tiradas do texto (com ou sem acento), a última vale; o resto do texto fica igual', () => {
  assert.deepEqual(agent.marcaDoFim('Pronto: testes passando.\n\n[TAREFA CONCLUÍDA]'), { limpo: 'Pronto: testes passando.', marca: 'concluida' });
  assert.deepEqual(agent.marcaDoFim('Falta a senha do Wi-Fi. [preciso de voce]'), { limpo: 'Falta a senha do Wi-Fi.', marca: 'precisa' });
  assert.deepEqual(agent.marcaDoFim('[ TAREFA  CONCLUIDA ]'), { limpo: '', marca: 'concluida' });
  assert.deepEqual(agent.marcaDoFim('Veja o item [1] e [nota].'), { limpo: 'Veja o item [1] e [nota].', marca: null });
});

test('streaming: a marca some mesmo cortada entre pedaços; colchetes comuns passam', () => {
  const casos = [
    [['Feito! [TAR', 'EFA CONC', 'LUÍDA]'], 'Feito! '],
    [['ok [PRECISO', ' DE VOCÊ', ']'], 'ok '],
    [['lista [1] e [', '2]'], 'lista [1] e [2]'],
    [['termina em [TAREFA'], 'termina em [TAREFA'], // nunca virou marca: aparece no fim
    [['[x', 'y]'], '[xy]'],
  ];
  for (const [pedacos, esperado] of casos) {
    const saida = [];
    const f = agent.filtrarMarcas((t) => saida.push(t));
    for (const p of pedacos) f.escrever(p);
    f.fim();
    assert.equal(saida.join(''), esperado, JSON.stringify(pedacos));
  }
});

test('até terminar: parou sem marcar → continua sozinho; marcou → para, sem a marca no texto nem no histórico', async () => {
  const respostas = [texto('Comecei: li os arquivos.'), chamada('run_shell'), texto('Corrigi o bug.\n[TAREFA CONCLUÍDA]')];
  const vistos = [];
  const sistemas = [];
  const continuacoes = [];
  const chatWithTools = async ({ history, systemInstruction }) => { vistos.push(history.at(-1)); sistemas.push(systemInstruction); return respostas.shift(); };
  const r = await runOnce('corrija o bug', { ateTerminar: true, onContinuar: (n) => continuacoes.push(n), deps: deps(chatWithTools, { execute: async () => 'ok' }) });
  assert.equal(r.text, 'Corrigi o bug.');
  assert.equal(r.fim, 'concluida');
  assert.deepEqual(continuacoes, [1]);
  assert.match(sistemas[0], /MODO ATÉ TERMINAR/);
  assert.equal(vistos[1].parts[0].text, agent.CONTINUAR_ATE_TERMINAR, 'o loop mandou continuar');
  const falasDoModelo = r.history.filter((m) => m.role === 'model').flatMap((m) => m.parts.map((x) => x.text || ''));
  assert.ok(!falasDoModelo.join(' ').includes('[TAREFA CONCLUÍDA]'), 'a marca não fica nas falas do modelo no histórico');
  assert.equal(falasDoModelo.at(-1), 'Corrigi o bug.');
  assert.equal(respostas.length, 0);
});

test('até terminar: "preciso de você" para e avisa; desligado, nada muda (o 1º texto já fecha)', async () => {
  const r = await runOnce('configure o roteador', { ateTerminar: true, deps: deps(async () => texto('Preciso da senha do roteador. [PRECISO DE VOCÊ]')) });
  assert.deepEqual([r.text, r.fim], ['Preciso da senha do roteador.', 'precisa']);
  let n = 0;
  const sistemas = [];
  const d = await runOnce('oi', { deps: deps(async ({ systemInstruction }) => { n++; sistemas.push(systemInstruction); return texto('Comecei.'); }) });
  assert.deepEqual([d.text, n, d.fim], ['Comecei.', 1, undefined]);
  assert.doesNotMatch(sistemas[0], /MODO ATÉ TERMINAR/);
});

test('até terminar: tetos — a mesma resposta duas vezes para; continuações demais param com aviso', async () => {
  let n = 0;
  const r = await runOnce('x', { ateTerminar: true, deps: deps(async () => { n++; return texto('Estou pensando.'); }) });
  assert.equal(n, 2, 'a 2ª igual já para');
  assert.equal(r.fim, 'repetiu');
  assert.match(r.text, /mesma resposta duas vezes/);
  let k = 0;
  const t = await runOnce('y', { ateTerminar: true, deps: deps(async () => texto(`passo ${++k}`)) });
  assert.equal(k, agent.MAX_CONTINUACOES_ATE_TERMINAR + 1);
  assert.equal(t.fim, 'teto');
  assert.match(t.text, /parei depois de 25 continuações/);
  // vazia duas vezes também é "sem avançar" (antes gastava as 25 continuações)
  let v = 0;
  const vazio = await runOnce('z', { ateTerminar: true, deps: deps(async () => { v++; return texto(''); }) });
  assert.deepEqual([v, vazio.fim], [2, 'repetiu']);
  assert.match(vazio.text, /respondeu vazio duas vezes/);
  // a mesma frase depois de usar uma ferramenta é avanço, não repetição
  const seq = [texto('Rodando os testes.'), chamada('run_checks'), texto('Rodando os testes.'), texto('Tudo verde. [TAREFA CONCLUÍDA]')];
  const avancou = await runOnce('w', { ateTerminar: true, deps: deps(async () => seq.shift(), { execute: async () => 'ok' }) });
  assert.deepEqual([avancou.fim, avancou.text, seq.length], ['concluida', 'Tudo verde.', 0]);
});

test('até terminar: o limite de passos é maior (e ainda existe); o "Parar" da pessoa continua valendo', async () => {
  assert.equal(agent.PASSOS_ATE_TERMINAR, 400);
  let passos = 0;
  const r = await runOnce('loop', { ateTerminar: true, maxSteps: 5, deps: deps(async () => { passos++; return chamada(`f${passos}`); }, { execute: async () => `resultado ${passos}` }) });
  assert.equal(passos, 5);
  assert.equal(r.fim, 'passos');
  const ctrl = new AbortController();
  let vezes = 0;
  const p = await runOnce('longa', {
    ateTerminar: true, signal: ctrl.signal,
    deps: deps(async () => { vezes++; if (vezes === 2) ctrl.abort(); return texto(`parte ${vezes}`); }),
  });
  assert.equal(p.interrompido, true, 'parou quando a pessoa mandou');
  assert.ok(vezes <= 2);
});

test('até terminar: no streaming, a marca não aparece e as continuações viram parágrafos', async () => {
  const respostas = [['Parte um.'], ['Parte dois. [TAREFA', ' CONCLUÍDA]']];
  const tela = [];
  const chatWithTools = async ({ onText }) => {
    const pedacos = respostas.shift();
    for (const p of pedacos) onText(p);
    return texto(pedacos.join(''));
  };
  const r = await runOnce('faça', { ateTerminar: true, onText: (t) => tela.push(t), deps: deps(chatWithTools) });
  assert.equal(tela.join(''), 'Parte um.\n\nParte dois. ');
  assert.equal(r.text, 'Parte dois.');
});

test('subagente não fica "continuando" sozinho (o modo é do pedido da pessoa)', async () => {
  const subagent = require('../src/subagent');
  const antes = subagent.profundidadeAtual;
  subagent.profundidadeAtual = () => 1;
  try {
    let n = 0;
    const r = await runOnce('explore', { ateTerminar: true, deps: deps(async () => { n++; return texto('achei'); }) });
    assert.deepEqual([n, r.text], [1, 'achei']);
  } finally { subagent.profundidadeAtual = antes; }
});

test('terminal: "run --ate-terminar" e o comando de config', () => {
  const profiles = require('../src/agentProfiles');
  assert.equal(profiles.parseRunArgs(['--ate-terminar', 'faça', 'tudo']).ateTerminar, true);
  assert.equal(profiles.parseRunArgs(['faça']).ateTerminar, false);
  const salvos = [];
  const cc = require('../src/configCommands');
  assert.match(cc.aplicar('set-ate-terminar', ['on'], (x) => salvos.push(x)), /ligado por padrão/);
  assert.deepEqual(salvos, [{ modoAteTerminar: true }]);
  assert.match(cc.aplicar('set-ate-terminar', ['talvez'], () => {}), /^Uso:/);
});

// ---------------------------------------------------------------------------
// O chat do terminal de verdade (pseudo-terminal), com um modelo falso que para no meio da tarefa
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'gemini-code.js');
const temScript = (() => {
  if (process.platform !== 'linux') return false;
  try { execFileSync('script', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
// eslint-disable-next-line no-control-regex -- tirar as cores e os controles do terminal da tela é o objetivo
const LIMPAR = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

test('terminal de verdade: /ate-terminar liga, o agente continua sozinho até terminar e a marca não aparece', { skip: !temScript && 'sem o "script" (util-linux)', timeout: 60000 }, async (t) => {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const msgs = JSON.parse(corpo || '{}').messages || [];
      const sistema = String((msgs[0] && msgs[0].content) || '');
      const ultima = String((msgs[msgs.length - 1] || {}).content || '');
      pedidos.push({ ateTerminar: sistema.includes('MODO ATÉ TERMINAR'), ultima: ultima.slice(0, 40) });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const pedacos = ultima.startsWith('[modo até terminar]') ? ['pronto, tudo feito [TAREFA', ' CONCLUÍDA]'] : ['comecei a tarefa'];
      for (const p of pedacos) ev({ choices: [{ delta: { content: p } }] });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-ate-home-'));
  const projeto = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-ate-proj-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(projeto, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(home, '.gemini-code'));
  fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({
    configVersion: 99, provider: 'openai', openaiBaseUrl: `http://127.0.0.1:${srv.address().port}/v1`, openaiApiKey: 'sk-teste',
    openaiModel: 'modelo-falso', autoGit: false, confiancaProjeto: 'sempre', shellSandbox: 'off',
  }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, TERM: 'xterm-256color', COLUMNS: '160', LINES: '40' };
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_CODE_OPENAI_KEY', 'GEMINI_CODE_OPENAI_URL', 'NO_COLOR']) delete env[k];
  const p = spawn('script', ['-qfec', `'${process.execPath}' '${CLI}' chat`, '/dev/null'], { cwd: projeto, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let tela = '';
  p.stdout.on('data', (d) => { tela += String(d).replace(LIMPAR, ''); });
  t.after(() => p.kill('SIGKILL'));
  const esperar = async (re, ms) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (re.test(tela)) return; await dormir(30); }
    assert.fail(`não apareceu ${re}. Tela:\n${tela.slice(-1500)}`);
  };
  await esperar(/você> /, 20000);
  p.stdin.write('/ate-terminar\r');
  await esperar(/Modo até terminar LIGADO[\s\S]*você \[até terminar\]> /, 10000);
  p.stdin.write('faz a tarefa\r');
  await esperar(/pronto, tudo feito[\s\S]*você \[até terminar\]> /, 20000);
  assert.match(tela, /comecei a tarefa/);
  assert.match(tela, /modo até terminar: ainda não terminou — continuando, 1\/25/);
  assert.doesNotMatch(tela, /TAREFA\s*CONCLU/, 'a marca não aparece na tela');
  assert.deepEqual(pedidos.map((x) => x.ateTerminar), [true, true]);
  assert.match(pedidos[1].ultima, /^\[modo até terminar\]/);
});
