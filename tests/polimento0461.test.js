'use strict';
// v0.46.1: o que o estresse das novidades da 0.46.0 achou — datas que o Date "adivinhava", valores que viravam
// "NaN"/"[object Object]" no diário e na lista de compras, opções sem valor que viravam nome de arquivo, a espera do
// Veo que girava 10 min num erro, e mensagens/pastas que não batiam com o que acontecia.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-0461-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-0461-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const saude = require('../src/saude');
const saudeCmd = require('../src/saudeCommands');
const compras = require('../src/compras');
const comprasCmd = require('../src/comprasCommands');
const camera = require('../src/camera');
const criador = require('../src/criador');
const media = require('../src/tools/mediaTools');

const CLI = path.join(__dirname, '..', 'bin', 'gemini-code.js');
// fictícia, montada em partes (o scan de segredos do projeto não confunde com uma chave de verdade)
const CHAVE_FICTICIA = ['AIza', 'teste', '0461'].join('-');
const AGORA = new Date(2026, 10, 2, 15, 30); // 2 de novembro de 2026, 15:30 no relógio local

test.after(() => { for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

function cli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: PROJ, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, HOME, USERPROFILE: HOME, GEMINI_API_KEY: '', NO_COLOR: '1', GEMINI_CODE_FORCE_NO_TERMUX_API: '1' },
  });
}

test('saúde, "quando": formatos claros; 02/11/2026 é 2 de NOVEMBRO; nada de adivinhar', () => {
  const q = (t) => saude.lerQuando(t, AGORA);
  assert.deepEqual(q('2026-11-02 08:00'), new Date(2026, 10, 2, 8, 0));
  assert.deepEqual(q('02/11/2026'), new Date(2026, 10, 2), 'antes virava 11 de fevereiro');
  assert.deepEqual(q('02/11/2026 08:00'), new Date(2026, 10, 2, 8, 0));
  assert.deepEqual(q('02/11 8h'), new Date(2026, 10, 2, 8, 0));
  assert.deepEqual(q('1/11/26 20h30'), new Date(2026, 10, 1, 20, 30));
  assert.deepEqual(q('ontem 20h30'), new Date(2026, 10, 1, 20, 30));
  assert.deepEqual(q('Ontem às 7h'), new Date(2026, 10, 1, 7, 0));
  assert.deepEqual(q('anteontem'), new Date(2026, 9, 31, 15, 30));
  assert.deepEqual(q('hoje 9h'), new Date(2026, 10, 2, 9, 0));
  // com fuso a hora é absoluta (um dia antes, para não cair "no futuro" em nenhum fuso de quem roda o teste)
  assert.equal(q('2026-11-01T08:00:00Z').toISOString(), '2026-11-01T08:00:00.000Z');
  assert.equal(q('2026-11-01 08:00-03:00').toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(q('2026-11-01T08:00:00.123+0530').toISOString(), '2026-11-01T02:30:00.000Z');
  for (const ruim of ['-1', '0', '1.5', 'x 1', '2026-02-31', '31/02/2026', '13x8', '25/13', 'ontem 25h', '0001-01-01', -1, 1.5, {}, [], true, '']) {
    assert.throws(() => q(ruim), /Data inválida/, `deveria recusar ${JSON.stringify(ruim)}`);
  }
  assert.throws(() => q('2026-11-03'), /futuro/);
  assert.throws(() => q('hoje 18h'), /futuro/);
  // no armazenamento: o número -1 virava 31/12/1969
  const store = saude.createSaudeStore({ arquivo: path.join(HOME, 's1.json'), clock: () => AGORA });
  assert.throws(() => store.anotar('pressao', '13x8', { quando: -1 }), /Data inválida/);
  const r = store.anotar('pressao', '13x8', { quando: '02/11/2026 08:00' });
  assert.equal(r.registro.quando, new Date(2026, 10, 2, 8, 0).toISOString());
});

test('saúde, valores: só texto/número de verdade; sinal de menos conta; "pos-140" não é negativo', () => {
  assert.throws(() => saude.interpretar(undefined, '13x8'), /Informe o tipo/);
  assert.throws(() => saude.interpretar({}, '13x8'), /Informe o tipo/);
  for (const ruim of [NaN, Infinity, {}, [], true]) assert.throws(() => saude.interpretar('sintoma', ruim), /precisa ser um texto/);
  assert.deepEqual(saude.interpretar('glicemia', 98).valores, { mgdl: 98, momento: 'aleatoria' }, 'número de verdade vale');
  assert.throws(() => saude.interpretar('peso', '-1'), /fora do possível: -1 kg/, 'antes virava 1 kg');
  assert.throws(() => saude.interpretar('temperatura', ' -37,5'), /fora do possível/);
  assert.equal(saude.interpretar('glicemia', 'pos-140').valores.mgdl, 140);
  assert.equal(saude.interpretar('glicemia', '98 constructor').valores.momento, 'aleatoria', 'chave do Object.prototype não é momento');
  assert.throws(() => saude.interpretar('constructor', '1'), /Tipo desconhecido/);
  const store = saude.createSaudeStore({ arquivo: path.join(HOME, 's2.json'), clock: () => AGORA });
  const r = store.anotar('nota', 'dormi mal', { nota: { a: 1 } });
  assert.equal(r.registro.nota, undefined, 'nota que não é texto não vira "[object Object]"');
  assert.equal(store.anotar('nota', 'ok', { nota: 'x\u0085y' }).registro.nota, 'xy');
});

test('saúde, período: inválido, zero, negativo ou "--dias" sem número = padrão; 1 dia no singular', () => {
  assert.equal(saude.diasDe(undefined), 30);
  for (const v of ['-5', '0', 'abc', true, null, {}, -1, NaN]) assert.equal(saude.diasDe(v), 30, String(v));
  assert.equal(saude.diasDe('7'), 7);
  assert.equal(saude.diasDe(5000), 365);
  assert.equal(saude.diasDe(5000, { max: 3650 }), 3650);
  assert.equal(saude.diasDe('x', { padrao: 90 }), 90);
  const store = saude.createSaudeStore({ arquivo: path.join(HOME, 's3.json'), clock: () => AGORA });
  assert.match(saude.resumo(store, { dias: 1 }), /^Saúde — último dia/);
  assert.match(saude.resumo(store, { dias: 30 }), /^Saúde — últimos 30 dias/);
});

test('saúde, linha de comando: opção sem valor não entra no texto; página e remédio com mensagens certas', async () => {
  const store = saude.createSaudeStore({ arquivo: path.join(HOME, 's4.json'), clock: () => AGORA });
  const rotinas = { create: () => ({ id: 'r1' }), activate: () => {}, pause: () => {}, remove: () => {} };
  const run = (args) => saudeCmd.executar(args, { store, rotinas, agora: AGORA, cwd: PROJ });
  let r = await run(['anotar', 'sintoma', 'tosse', 'seca', '--nota']);
  assert.equal(r.codigo, 0);
  assert.equal(store.registros()[0].valores.texto, 'tosse seca', 'antes virava "tosse seca --nota"');
  r = await run(['pagina', '--saida']);
  assert.equal(r.codigo, 1);
  assert.match(r.linhas[0].texto, /^Uso: gemini-code saude pagina/);
  r = await run(['pagina', '--saida', '-x.html']);
  assert.match(r.linhas[0].texto, /não pode começar com "-"/);
  // regravar a página deixa o arquivo só para o dono (tem dados de saúde)
  const pagina = path.join(PROJ, 'saude-teste.html');
  fs.writeFileSync(pagina, 'antigo', { mode: 0o644 });
  r = await run(['pagina', '--saida', 'saude-teste.html']);
  assert.equal(r.codigo, 0);
  if (process.platform !== 'win32') assert.equal(fs.statSync(pagina).mode & 0o777, 0o600);
  r = await run(['remedio', 'remover', 'zzz']);
  assert.match(r.linhas[0].texto, /Não achei o remédio zzz/);
  r = await run(['remedio', 'add', 'Losartana', '--horarios']);
  assert.match(r.linhas[0].texto, /^Uso: gemini-code saude remedio add/);
  r = await run(['remedio', 'add', 'Losartana', '--horarios', '08:00', '--dose']);
  assert.equal(r.codigo, 0);
  assert.equal(store.remedios()[0].dose, '', '"--dose" sem valor não vira a dose "true"');
  r = await run(['lista', '--tipo', 'constructor']);
  assert.match(r.linhas[0].texto, /Tipo desconhecido/);
});

test('compras: item e frequência validados ("[object Object]", "constructor", "__proto__"); falta de item é dita', () => {
  const store = compras.createComprasStore({ arquivo: path.join(HOME, 'c1.json') });
  for (const ruim of [{}, [], 5, true, null, undefined, '   ']) assert.throws(() => store.adicionar(ruim), /Informe o item/);
  for (const f of ['constructor', '__proto__', 'toString', 'diaria', {}, ['mensal']]) {
    assert.throws(() => store.adicionar('arroz', { frequencia: f }), /Frequência inválida/, String(f));
  }
  const i = store.adicionar('feijão', { frequencia: ' Semanal ', quantidade: null, onde: { x: 1 }, preco: '8,50' });
  assert.equal(i.frequencia, 'semanal');
  assert.equal(i.quantidade, 1);
  assert.equal(i.precos[0].onde, undefined, 'onde que não é texto é ignorado');
  for (const ref of [undefined, null, '', {}, []]) assert.throws(() => store.remover(ref), /Informe o item/);
  assert.throws(() => store.mudar(undefined, { quantidade: 2 }), /Informe o item/);
  assert.throws(() => store.mudar('feijão', { frequencia: 'constructor' }), /Frequência inválida/);
  assert.equal(store.mudar('feijao', { frequencia: 'MENSAL' }).frequencia, 'mensal');
  // dado antigo com frequência estranha não vira NaN na conta do mês
  const bruto = JSON.parse(fs.readFileSync(store.caminho, 'utf8'));
  bruto.itens[0].frequencia = 'constructor';
  fs.writeFileSync(store.caminho, JSON.stringify(bruto));
  const mes = compras.listaDoMes(store);
  assert.ok(Number.isFinite(mes.total), `total ${mes.total}`);
});

test('compras, linha de comando: "--opção" sem valor não vira nome de arquivo nem de item; exportar seguro', async () => {
  const store = compras.createComprasStore({ arquivo: path.join(HOME, 'c2.json') });
  const run = (args) => comprasCmd.executar(args, { store, cwd: PROJ });
  let r = await run(['exportar', 'lista.txt']);
  assert.match(r.linhas[0].texto, /lista está vazia/);
  r = await run(['add', 'arroz', '--qtd']);
  assert.match(r.linhas[0].texto, /Quantidade inválida/, 'antes criava o item "arroz --qtd"');
  r = await run(['add', 'arroz', '5kg', '--qtd', '2']);
  assert.equal(r.codigo, 0);
  r = await run(['exportar', '--help']);
  assert.equal(r.codigo, 0);
  assert.ok(!fs.existsSync(path.join(PROJ, '--help')), 'antes criava o arquivo "--help"');
  r = await run(['exportar', '--saida', '-1']);
  assert.match(r.linhas[0].texto, /não pode começar com "-"/);
  r = await run(['exportar', 'lista.txt']);
  assert.equal(r.codigo, 0);
  r = await run(['exportar', 'lista.txt']);
  assert.match(r.linhas[0].texto, /Já existe .*nada foi sobrescrito/);
  r = await run(['exportar', '--saida', path.join(config.HOME_DIR, 'hooks.json')]);
  assert.match(r.linhas[0].texto, /protegido/);
  r = await run(['qtd', 'arroz']);
  assert.match(r.linhas[0].texto, /^Uso: gemini-code compras qtd/, 'antes dizia "informe o item"');
  r = await run(['preco', 'arroz']);
  assert.match(r.linhas[0].texto, /^Uso: gemini-code compras preco/);
  r = await run(['--help']);
  assert.match(r.linhas[0].texto, /Compras do mês/);
});

function respostaFalsa(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

async function comFetch(fn, corpo) {
  const original = global.fetch;
  global.fetch = fn;
  try { return await corpo(); } finally { global.fetch = original; }
}

test('Veo: operação com erro, 4xx e falhas seguidas param com o motivo (antes: 10 min girando)', async () => {
  config.saveConfig({ apiKey: CHAVE_FICTICIA });
  const dormir = async () => {};
  await comFetch(async () => respostaFalsa(200, { done: true, error: { message: 'cota esgotada' } }), () => (
    assert.rejects(() => media.pollOperation('operations/x', { dormir }), /A geração falhou: cota esgotada/)
  ));
  let n = 0;
  await comFetch(async () => { n++; return respostaFalsa(403, { error: { message: 'sem permissão' } }); }, () => (
    assert.rejects(() => media.pollOperation('operations/x', { dormir }), /HTTP 403\): sem permissão/)
  ));
  assert.equal(n, 1, '4xx não repete');
  n = 0;
  await comFetch(async () => { n++; return respostaFalsa(503, {}); }, () => (
    assert.rejects(() => media.pollOperation('operations/x', { dormir }), /HTTP 503/)
  ));
  assert.equal(n, 5, '5xx tenta 5 vezes');
  n = 0;
  await comFetch(async () => { n++; throw new Error('rede caiu'); }, () => (
    assert.rejects(() => media.pollOperation('operations/x', { dormir }), /rede caiu/)
  ));
  n = 0;
  const pronto = await comFetch(async () => { n++; return n === 1 ? respostaFalsa(500, {}) : respostaFalsa(200, n < 3 ? { done: false } : { done: true, response: { ok: 1 } }); },
    () => media.pollOperation('operations/x', { dormir }));
  assert.deepEqual(pronto.response, { ok: 1 });
  // página de erro em HTML no início: mensagem clara, sem SyntaxError cru
  await comFetch(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }), () => (
    assert.rejects(() => media.makeVideo('um gato', path.join(PROJ, 'videos-a'), { dormir }), /status 502/)
  ));
  assert.ok(!fs.existsSync(path.join(PROJ, 'videos-a')), 'sem vídeo, sem pasta vazia');
});

test('Veo: o filtro de segurança do Google diz o motivo (antes: "Resposta sem vídeo")', async () => {
  config.saveConfig({ apiKey: CHAVE_FICTICIA });
  const fetchFalso = async (url) => (String(url).endsWith(':predictLongRunning')
    ? respostaFalsa(200, { name: 'operations/abc' })
    : respostaFalsa(200, { done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['Contém pessoa famosa.'] } } }));
  await comFetch(fetchFalso, () => (
    assert.rejects(() => media.makeVideo('x', path.join(PROJ, 'videos-b'), { dormir: async () => {} }), /filtro de segurança: Contém pessoa famosa\./)
  ));
  assert.ok(!fs.existsSync(path.join(PROJ, 'videos-b')));
  await comFetch(async () => respostaFalsa(200, {}), () => (
    assert.rejects(() => media.makeVideo('x', path.join(PROJ, 'videos-c')), /não devolveu a operação/)
  ));
});

test('câmera-vigia: a mensagem e o laço usam os mesmos valores; sem câmera não sobra pasta', async () => {
  assert.deepEqual(camera.parametrosVigia({ intervaloS: '0' }), { intervalo: 30, sensibilidadePct: 5 }, 'antes a mensagem dizia "0 s"');
  assert.deepEqual(camera.parametrosVigia({ intervaloS: 2, sensibilidade: 0.1 }), { intervalo: 5, sensibilidadePct: 0.5 });
  assert.deepEqual(camera.parametrosVigia({ intervaloS: '60', sensibilidade: 500 }), { intervalo: 60, sensibilidadePct: 100 });
  await assert.rejects(() => camera.vigiar({ cwd: PROJ, pasta: 'vigia-x', fotoFn: async () => { throw new Error('sem câmera'); } }), /sem câmera/);
  assert.ok(!fs.existsSync(path.join(PROJ, 'vigia-x')));
});

test('criar servir: pasta que não existe ou arquivo dá mensagem clara (antes: ENOENT ... lstat)', () => {
  assert.throws(() => criador.servidor(path.join(PROJ, 'nao-existe')), /pasta não encontrada/);
  fs.writeFileSync(path.join(PROJ, 'arq.txt'), 'x');
  assert.throws(() => criador.servidor(path.join(PROJ, 'arq.txt')), /não é uma pasta/);
});

test('linha de comando: uso por falta de argumento sai com 1; --modo inválido não cai na IA; tv confere antes do adb', () => {
  fs.writeFileSync(path.join(PROJ, 'foto.jpg'), 'x');
  let r = cli(['imagem', 'melhorar', 'foto.jpg', '--modo', 'xyz']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--modo: auto, local \(ImageMagick\) ou ia/);
  assert.doesNotMatch(r.stderr + r.stdout, /API key/, 'antes ia para a IA e pedia a chave');
  r = cli(['tv', 'xyz']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^Uso: gemini-code tv/);
  assert.doesNotMatch(r.stdout + r.stderr, /adb não encontrado/, 'antes procurava o adb antes de olhar o subcomando');
  r = cli(['criar', 'servir']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /criar servir PASTA/);
  r = cli(['video', 'slideshow']);
  assert.equal(r.status, 1);
  r = cli(['camera']);
  assert.equal(r.status, 0, 'sem subcomando é pedir ajuda');
  r = cli(['video', 'gerar', 'um gato']);
  assert.equal(r.status, 1);
  assert.ok(!fs.existsSync(path.join(PROJ, 'videos')), 'sem chave, não sobra a pasta "videos"');
});

test('criar servir: pasta com acento redireciona (antes 500) e "/%2Fimg" não leva a outro host', async () => {
  const raiz = fs.mkdtempSync(path.join(PROJ, 'site-'));
  fs.mkdirSync(path.join(raiz, 'fotos-ç'));
  fs.writeFileSync(path.join(raiz, 'fotos-ç', 'index.html'), 'oi');
  fs.mkdirSync(path.join(raiz, 'img'));
  const srv = criador.servidor(raiz);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    let r = await fetch(`${base}/fotos-%C3%A7`, { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/fotos-%C3%A7/');
    r = await fetch(`${base}/fotos-%C3%A7/`);
    assert.equal(await r.text(), 'oi');
    r = await fetch(`${base}/%2Fimg`, { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/img/', 'antes: "//img/" (outro host para o navegador)');
  } finally { srv.close(); }
});

test('ferramenta video: "saida" que não é texto vira erro claro; convidado não usa arquivo de fora do projeto', async () => {
  const midia = require('../src/tools/midiaTools');
  const security = require('../src/security');
  let chamou = false;
  midia._testar({ video: () => ({ melhorar: async () => { chamou = true; return { arquivo: path.join(PROJ, 'v-melhorado.mp4') }; } }), ask: async () => 'n', loadConfig: () => ({}) });
  assert.match(await midia.execute('video', { acao: 'melhorar', arquivo: 'v.mp4', saida: {} }), /"saida" precisa ser/);
  assert.equal(chamou, false);
  config.saveConfig({ apiKeyLocked: security.encriptar('CHAVE-FICTICIA', 'dono'), apiKeyLockedGuest: security.encriptar('CHAVE-FICTICIA', 'convidado'), apiKey: '' });
  try {
    assert.equal(security.unlock('convidado'), true);
    assert.match(await midia.execute('video', { acao: 'slideshow', fotos: ['a.jpg', path.join(os.homedir(), 'foto-privada.jpg')] }), /convidado só lê arquivos dentro do projeto/);
    assert.match(await midia.execute('video', { acao: 'melhorar', arquivo: '/etc/x.mp4' }), /convidado/);
  } finally { security.clearSession(); config.saveConfig({ apiKeyLocked: undefined, apiKeyLockedGuest: undefined }); }
  assert.equal(chamou, false);
});
