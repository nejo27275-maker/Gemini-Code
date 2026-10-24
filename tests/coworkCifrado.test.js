'use strict';
// v0.43.0: canal cifrado do cowork (src/cowork/canalSeguro.js), proteções da conexão (src/cowork/server.js
// criarConexao/admitir), cliente (src/cowork/client.js criarConexaoCliente), limitador (src/limitador.js) e
// limites da API de rotinas. Os ataques são simulados com uma "rede" em memória que entrega e registra cada
// quadro, como um atacante na mesma Wi-Fi veria — sem WebSocket de verdade (o ws não está instalado aqui).
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-cowork-cifrado-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const canal = require('../src/cowork/canalSeguro');
const server = require('../src/cowork/server');
const client = require('../src/cowork/client');
const { criarLimitador } = require('../src/limitador');
const { createRoutineApiServer, LIMITES_HTTP } = require('../src/routineApi');
const { createRoutineStore } = require('../src/routines');
const { createRoutineRunner } = require('../src/routineRunner');

const TOKEN = crypto.randomBytes(16).toString('hex');
const OUTRO_TOKEN = crypto.randomBytes(16).toString('hex');
const ida = (o) => JSON.parse(JSON.stringify(o)); // como na rede: só o que vira JSON passa

function apertoDeMao(tokenServidor = TOKEN, tokenCliente = TOKEN) {
  const s = canal.servidor(tokenServidor);
  const c = canal.cliente(tokenCliente);
  const auth = c.receberHello(ida(s.hello));
  const ok = s.receberAuth(ida(auth));
  c.confirmar(ida(ok));
  return { s, c, quadros: [s.hello, auth, ok] };
}

// ---------------------------------------------------------------------------
// Protocolo
// ---------------------------------------------------------------------------

test('aperto de mão: os dois lados se autenticam e trocam mensagens cifradas nas duas direções', () => {
  const { s, c } = apertoDeMao();
  assert.equal(s.pronto, true);
  assert.equal(c.pronto, true);
  const tarefa = ida(c.selar({ type: 'task', prompt: 'liste os arquivos' }));
  assert.deepEqual(Object.keys(tarefa).sort(), ['c', 'n', 'type']);
  assert.deepEqual(s.abrir(tarefa), { type: 'task', prompt: 'liste os arquivos' });
  assert.deepEqual(c.abrir(ida(s.selar({ type: 'result', text: 'ação ✓ 日本' }))), { type: 'result', text: 'ação ✓ 日本' });
});

test('o token nunca aparece na rede, nem em hex, base64 ou dentro das provas', () => {
  const { quadros, c } = apertoDeMao();
  const rede = JSON.stringify([...quadros, c.selar({ type: 'task', prompt: 'x' })]);
  for (const forma of [TOKEN, Buffer.from(TOKEN).toString('base64'), Buffer.from(TOKEN, 'hex').toString('base64')]) {
    assert.ok(!rede.includes(forma), `vazou: ${forma}`);
  }
});

test('token errado: o servidor recusa e não deriva chave nenhuma', () => {
  const s = canal.servidor(TOKEN);
  const c = canal.cliente(OUTRO_TOKEN);
  assert.throws(() => s.receberAuth(ida(c.receberHello(ida(s.hello)))), (e) => e.codigo === 'token');
  assert.equal(s.pronto, false);
  assert.throws(() => s.selar({ type: 'result' }), /não autenticado/);
});

test('alguém no meio troca a chave pública do hello: a prova não bate e o servidor recusa', () => {
  const s = canal.servidor(TOKEN);
  const c = canal.cliente(TOKEN);
  const atacante = crypto.generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x;
  const helloTrocado = { ...ida(s.hello), pub: Buffer.from(atacante, 'base64url').toString('base64') };
  assert.throws(() => s.receberAuth(ida(c.receberHello(helloTrocado))), (e) => e.codigo === 'token');
});

test('PC falso (não conhece o token) não engana o celular: a confirmação dele é recusada', () => {
  const c = canal.cliente(TOKEN);
  const falso = canal.servidor(OUTRO_TOKEN);
  c.receberHello(ida(falso.hello));
  const provaInventada = { type: 'auth_ok', prova: crypto.randomBytes(32).toString('base64') };
  assert.throws(() => c.confirmar(provaInventada), (e) => e.codigo === 'impostor');
  assert.equal(c.pronto, false);
  assert.throws(() => c.selar({ type: 'task', prompt: 'segredo' }), /não autenticado/, 'nenhuma tarefa sai para o impostor');
});

test('autenticação gravada e reenviada para outra sessão é recusada (nonce novo a cada conexão)', () => {
  const s1 = canal.servidor(TOKEN);
  const gravada = ida(canal.cliente(TOKEN).receberHello(ida(s1.hello)));
  assert.ok(s1.receberAuth(gravada));
  const s2 = canal.servidor(TOKEN);
  assert.throws(() => s2.receberAuth(gravada), (e) => e.codigo === 'token');
});

test('mensagem repetida, pulada, adulterada, refletida ou de outra sessão derruba a leitura', () => {
  const { s, c } = apertoDeMao();
  const m0 = ida(c.selar({ type: 'task', prompt: 'a' }));
  const m1 = ida(c.selar({ type: 'task', prompt: 'b' }));
  const m2 = ida(c.selar({ type: 'task', prompt: 'c' }));
  assert.throws(() => s.abrir(m1), /fora de ordem/, 'pular a 0');
  assert.deepEqual(s.abrir(m0).prompt, 'a');
  assert.throws(() => s.abrir(m0), /fora de ordem/, 'repetir a 0');
  const adulterada = { ...m1, c: Buffer.from(m1.c, 'base64').map((b, i) => (i === 3 ? b ^ 1 : b)).toString('base64') };
  assert.throws(() => s.abrir(adulterada), /adulterada/);
  assert.equal(s.abrir(m1).prompt, 'b', 'a original ainda passa depois da adulterada ser recusada');
  // Refletir para o servidor uma mensagem que ele mesmo mandou (outra direção = outra chave).
  const doServidor = ida(s.selar({ type: 'result', text: 'x' }));
  const refletida = { ...doServidor, n: 2 };
  assert.throws(() => s.abrir(refletida), /adulterada/);
  // Outra sessão, mesmo token: chaves diferentes (por conexão).
  const outra = apertoDeMao();
  assert.throws(() => outra.s.abrir(ida(m2)), /fora de ordem|adulterada/);
  assert.throws(() => outra.s.abrir({ ...ida(m2), n: 0 }), /adulterada/);
});

test('versão antiga (token aberto) e chaves públicas inválidas são recusadas com mensagem clara', () => {
  const s = canal.servidor(TOKEN);
  assert.throws(() => s.receberAuth({ type: 'auth', token: TOKEN }), (e) => e.codigo === 'versao' && /Atualize o gemini-code do celular/.test(e.message));
  const c = canal.cliente(TOKEN);
  assert.throws(() => c.receberHello({ ...ida(s.hello), v: 3 }), (e) => e.codigo === 'versao');
  const zeros = Buffer.alloc(32).toString('base64');
  assert.throws(() => canal.cliente(TOKEN).receberHello({ ...ida(s.hello), pub: zeros }), (e) => e.codigo === 'protocolo');
  assert.throws(() => canal.cliente(TOKEN).receberHello({ ...ida(s.hello), nonce: 'curto' }), (e) => e.codigo === 'protocolo');
  assert.throws(() => canal.servidor('fraco'), /Token do cowork fraco/);
  assert.throws(() => canal.cliente(''), /Token do cowork fraco/);
});

// ---------------------------------------------------------------------------
// Conexões ligadas por uma "rede" em memória
// ---------------------------------------------------------------------------

function rede({ tokenServidor = TOKEN, tokenCliente = TOKEN, runOnceFn, falhas = null, ip = '10.0.0.7', prazoMs, maxPorMinuto } = {}) {
  const quadros = [];
  const eventos = { fechamentoServidor: null, fechouCliente: false, autenticado: false, tokenInvalido: false, logs: [], erros: [], respostas: 0 };
  const fila = [];
  let srv = null;
  let cli = null;
  srv = server.criarConexao({
    token: tokenServidor, ip, falhas, runOnceFn, ...(prazoMs ? { prazoMs } : {}), ...(maxPorMinuto ? { maxPorMinuto } : {}),
    enviar: (o) => { const q = JSON.stringify(o); quadros.push(q); fila.push(() => cli.aoReceber(q)); },
    fechar: (codigo, motivo) => { eventos.fechamentoServidor = { codigo, motivo }; },
  });
  cli = client.criarConexaoCliente({
    token: tokenCliente,
    enviar: (o) => { const q = JSON.stringify(o); quadros.push(q); fila.push(() => srv.aoReceber(q)); },
    fechar: () => { eventos.fechouCliente = true; },
    acoes: {
      log: (t) => eventos.logs.push(t), errorLog: (t) => eventos.erros.push(t),
      onAutenticado: () => { eventos.autenticado = true; }, onTokenInvalido: () => { eventos.tokenInvalido = true; },
      onPromptAgain: () => { eventos.respostas++; },
    },
  });
  const entregar = async () => { while (fila.length) await fila.shift()(); };
  return { srv, cli, quadros, eventos, entregar, injetarNoServidor: (q) => srv.aoReceber(q) };
}

test('ponta a ponta: tarefa vai e volta cifrada; nem o token nem o texto da tarefa aparecem na rede', async () => {
  const recebidos = [];
  const r = rede({ runOnceFn: async (prompt, { history }) => { recebidos.push(prompt); return { text: 'resposta-confidencial', history: [...history, 1] }; } });
  await r.entregar();
  assert.equal(r.eventos.autenticado, true);
  r.cli.enviarTarefa('tarefa-secreta: leia ~/.ssh');
  await r.entregar();
  assert.deepEqual(recebidos, ['tarefa-secreta: leia ~/.ssh']);
  assert.ok(r.eventos.logs.some((l) => l.includes('resposta-confidencial')));
  assert.equal(r.eventos.respostas, 1);
  const naRede = r.quadros.join('\n');
  for (const segredo of [TOKEN, 'tarefa-secreta', 'resposta-confidencial', 'rodando']) assert.ok(!naRede.includes(segredo), `apareceu na rede: ${segredo}`);
  assert.equal(r.srv.estado.history.length, 1);
});

test('token errado: o celular avisa e sai; o servidor fecha e conta a falha do IP; depois de 5, o IP é barrado', async () => {
  const falhas = criarLimitador({ max: server.FALHAS_POR_IP, janelaMs: server.JANELA_FALHAS_MS });
  for (let i = 0; i < server.FALHAS_POR_IP; i++) {
    assert.equal(server.admitir({ ip: '10.0.0.66', falhas, conexoesAbertas: 0 }).ok, true);
    const r = rede({ tokenCliente: OUTRO_TOKEN, falhas, ip: '10.0.0.66' });
    await r.entregar();
    assert.equal(r.eventos.tokenInvalido, true);
    assert.equal(r.eventos.autenticado, false);
    assert.equal(r.eventos.fechamentoServidor.codigo, 4401);
    assert.ok(r.eventos.erros.some((e) => /Token inválido/.test(e)));
  }
  const barrado = server.admitir({ ip: '10.0.0.66', falhas, conexoesAbertas: 0 });
  assert.deepEqual([barrado.ok, barrado.status], [false, 429]);
  assert.match(barrado.motivo, /tente de novo em 15 min/);
  assert.equal(server.admitir({ ip: '10.0.0.8', falhas, conexoesAbertas: 0 }).ok, true, 'outro IP continua entrando');
  assert.deepEqual(server.admitir({ ip: '10.0.0.8', falhas, conexoesAbertas: server.MAX_CONEXOES }).status, 503);
});

test('quem não autentica no prazo é desconectado', async () => {
  const r = rede({ prazoMs: 30 });
  // o cliente nunca recebe o hello (nada é entregue): fica parado, como um ataque que só abre conexões
  await new Promise((ok) => setTimeout(ok, 80));
  assert.equal(r.eventos.fechamentoServidor.codigo, 4408);
  assert.match(r.quadros.at(-1), /Tempo para autenticar esgotado/);
});

test('depois de autenticar, texto aberto injetado por terceiros derruba a conexão (nada é executado)', async () => {
  let executou = false;
  const r = rede({ runOnceFn: async () => { executou = true; return { text: '', history: [] }; } });
  await r.entregar();
  await r.injetarNoServidor(JSON.stringify({ type: 'task', prompt: 'rm -rf ~' }));
  assert.equal(executou, false);
  assert.equal(r.eventos.fechamentoServidor.codigo, 4400);
});

test('lixo antes da autenticação fecha na hora e conta como tentativa do IP; inundação de mensagens também', async () => {
  const falhas = criarLimitador({ max: 2, janelaMs: 60000 });
  const lixo = rede({ falhas, ip: '10.0.0.99' });
  await lixo.injetarNoServidor('{{{ não é json');
  assert.equal(lixo.eventos.fechamentoServidor.codigo, 4400);
  await rede({ falhas, ip: '10.0.0.99' }).injetarNoServidor(JSON.stringify({ type: 'auth', v: 2, nonce: 'x', pub: 'y', prova: 'z' }));
  assert.equal(falhas.bloqueado('10.0.0.99'), true, 'varredura com lixo também acaba barrada');

  const r = rede({ maxPorMinuto: 4, runOnceFn: async (p, { history }) => ({ text: 'ok', history }) });
  await r.entregar(); // 1ª mensagem do cliente: a autenticação
  for (let i = 0; i < 3; i++) { r.cli.enviarTarefa(`t${i}`); await r.entregar(); }
  assert.equal(r.eventos.fechamentoServidor, null, '4 mensagens no minuto: dentro do limite');
  r.cli.enviarTarefa('t3');
  await r.entregar();
  assert.equal(r.eventos.fechamentoServidor.codigo, 4429);
});

test('uma tarefa por vez: a segunda, enquanto a primeira roda, recebe "ocupado"', async () => {
  let liberar;
  const r = rede({ runOnceFn: () => new Promise((ok) => { liberar = () => ok({ text: 'feito', history: [] }); }) });
  await r.entregar();
  r.cli.enviarTarefa('primeira');
  const primeira = r.entregar();
  await new Promise((ok) => setImmediate(ok));
  r.cli.enviarTarefa('segunda');
  const segunda = r.entregar();
  await new Promise((ok) => setImmediate(ok));
  liberar();
  await Promise.all([primeira, segunda]);
  await r.entregar();
  assert.ok(r.eventos.erros.some((e) => /ainda está rodando a tarefa anterior/.test(e)));
  assert.ok(r.eventos.logs.some((l) => l.includes('feito')));
});

test('PC falso na rede: o celular não manda nenhuma tarefa e encerra', async () => {
  const quadros = [];
  let fechou = false;
  const erros = [];
  const cli = client.criarConexaoCliente({
    token: TOKEN, enviar: (o) => quadros.push(o), fechar: () => { fechou = true; },
    acoes: { errorLog: (t) => erros.push(t), onAutenticado: () => assert.fail('não pode autenticar') },
  });
  const falso = canal.servidor(OUTRO_TOKEN);
  cli.aoReceber(JSON.stringify(falso.hello));
  cli.aoReceber(JSON.stringify({ type: 'auth_ok', prova: crypto.randomBytes(32).toString('base64') }));
  cli.enviarTarefa('não pode sair');
  assert.equal(fechou, true);
  assert.equal(quadros.length, 1, 'só a autenticação (que não revela o token) saiu');
  assert.match(erros.join('\n'), /impostor/);
});

test('novo-token: troca o token (0600) e o antigo deixa de autenticar', async () => {
  const antigo = server.getOrCreateToken();
  const novo = server.novoToken();
  assert.notEqual(novo, antigo);
  assert.equal(server.getOrCreateToken(), novo);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(HOME_FALSO, '.gemini-code', 'cowork-token.txt')).mode & 0o777, 0o600);
  const r = rede({ tokenServidor: novo, tokenCliente: antigo });
  await r.entregar();
  assert.equal(r.eventos.tokenInvalido, true);
});

// ---------------------------------------------------------------------------
// Limitador e API de rotinas
// ---------------------------------------------------------------------------

test('limitador: janela, bloqueio, tempo restante e memória limitada sob muitos IPs', () => {
  let t = 0;
  const l = criarLimitador({ max: 2, janelaMs: 1000, maxChaves: 3, agora: () => t });
  assert.deepEqual([l.registrar('a'), l.registrar('a'), l.registrar('a')], [true, true, false]);
  assert.equal(l.bloqueado('a'), true);
  t = 400;
  assert.equal(l.restanteMs('a'), 600);
  t = 1000;
  assert.equal(l.bloqueado('a'), false, 'janela venceu');
  assert.equal(l.registrar('a'), true);
  for (let i = 0; i < 50; i++) l.registrar(`ip-${i}`);
  assert.ok(l.tamanho <= 3, `guardou ${l.tamanho} chaves`);
  assert.throws(() => criarLimitador({ max: 0, janelaMs: 1 }), /positivos/);
});

test('API de rotinas: prazos contra conexão lenta e IP barrado depois de tokens errados, mesmo acertando depois', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-api-limites-'));
  const store = createRoutineStore({ dataPath: path.join(dir, 'r.json'), executionsPath: path.join(dir, 'e.json') });
  const token = 'b'.repeat(64);
  const api = createRoutineApiServer({ store, runner: createRoutineRunner({ store, maxRetries: 0 }), token, maxFalhasAuth: 3 });
  for (const [k, v] of Object.entries(LIMITES_HTTP)) assert.equal(api[k], v, k);
  await new Promise((ok) => api.listen(0, '127.0.0.1', ok));
  t.after(() => new Promise((ok) => api.close(ok)));
  const url = `http://127.0.0.1:${api.address().port}/api/routines`;
  for (let i = 0; i < 3; i++) assert.equal((await fetch(url, { headers: { authorization: 'Bearer chute' } })).status, 401);
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, 'auth_blocked');
  assert.equal((await fetch(url.replace('/api/routines', '/health'))).status, 200, '/health continua no ar');
});
