'use strict';
// v0.52.0: criar imagem com a API do Gemini — o pedido de verdade (formato da rede no imageConfig, a chave no
// cabeçalho), o erro de cota explicado, "sempre" nesta execução, e a imagem criada avisada ao modo site.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-criarimagem-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
delete process.env.GEMINI_API_KEY;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-criarimagem-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
fs.mkdirSync(path.join(HOME, '.gemini-code'), { recursive: true });
// chave fictícia montada em pedaços: o security scan do próprio projeto acusaria o formato de uma chave real
const CHAVE = ['AIza', 'ChaveDeTeste1234567890abcdefghijklm'].join('');
fs.writeFileSync(path.join(HOME, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: 99, apiKey: CHAVE }));
test.after(() => { for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

/** Troca o fetch global por um falso que guarda os pedidos. */
function fetchFalso(t, responder) {
  const pedidos = [];
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    pedidos.push({ url: String(url), init, corpo: init.body ? JSON.parse(init.body) : null });
    const { status = 200, json } = responder(pedidos.at(-1));
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = original; });
  return pedidos;
}
const imagemOk = { candidates: [{ content: { parts: [{ text: 'aqui está' }, { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] };

test('o pedido de verdade: modelo de imagem, chave no cabeçalho (nunca na URL), formato da rede no imageConfig', async (t) => {
  const pedidos = fetchFalso(t, () => ({ json: imagemOk }));
  const gemini = require('../src/gemini');
  const img = await gemini.generateImage({ prompt: 'um café aconchegante', aspecto: '9:16' });
  assert.equal(img.mimeType, 'image/png');
  const p = pedidos[0];
  assert.match(p.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash-image:generateContent$/);
  assert.ok(!p.url.includes('AIza'), 'a chave não vai na URL');
  assert.equal(p.init.headers['x-goog-api-key'], CHAVE);
  assert.deepEqual(p.corpo.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '9:16' } });
  assert.deepEqual(p.corpo.contents[0].parts.at(-1), { text: 'um café aconchegante' });
  await gemini.generateImage({ prompt: 'sem formato' });
  assert.deepEqual(pedidos[1].corpo.generationConfig, { responseModalities: ['TEXT', 'IMAGE'] }, 'sem formato, o modelo escolhe');
});

test('imagem.gerar: formato da rede vira a proporção certa; formato desconhecido é recusado antes de gastar cota', async () => {
  const imagem = require('../src/imagem');
  const pedidos = [];
  const generateImage = async (o) => { pedidos.push(o); return { mimeType: 'image/png', data: PNG.toString('base64') }; };
  const casos = [['feed', '4:5'], ['stories', '9:16'], ['reels', '9:16'], ['quadrado', '1:1'], ['youtube', '16:9'], ['3:2', '3:2'], ['original', undefined], [undefined, undefined]];
  for (const [formato, esperado] of casos) {
    const r = await imagem.gerar('um pôr do sol', { formato, cwd: PROJ, generateImage });
    assert.equal(pedidos.at(-1).aspecto, esperado, String(formato));
    assert.ok(fs.readFileSync(r.arquivo).equals(PNG));
  }
  const antes = pedidos.length;
  await assert.rejects(() => imagem.gerar('x', { formato: 'banner', cwd: PROJ, generateImage }), /formato "banner" desconhecido/);
  assert.equal(pedidos.length, antes, 'não chamou a API');
});

test('cota de imagem zerada (limit: 0): a mensagem fala do modelo de IMAGEM e do comando certo', async (t) => {
  fetchFalso(t, () => ({ status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-2.5-flash-image' } } }));
  const gemini = require('../src/gemini');
  await assert.rejects(() => gemini.generateImage({ prompt: 'x' }), (e) => {
    assert.match(e.message, /modelo de imagem gemini-2\.5-flash-image não tem cota liberada/);
    assert.match(e.message, /gemini-code config set-image-model/);
    assert.doesNotMatch(e.message, /config set-model NOME/, 'não manda trocar o modelo do chat');
    return true;
  });
  const cc = require('../src/configCommands');
  const salvos = [];
  assert.match(cc.aplicar('set-image-model', ['gemini-3-pro-image-preview'], (x) => salvos.push(x)), /Modelo de imagem: gemini-3-pro-image-preview/);
  assert.deepEqual(salvos, [{ imageModel: 'gemini-3-pro-image-preview' }]);
  assert.match(cc.aplicar('set-image-model', ['../../x y'], () => {}), /^Uso:/);
});

test('ferramenta "imagem": gerar pergunta (cota), "sempre" libera nesta execução, o formato chega, e a imagem é avisada ao modo site', async () => {
  const imagemTools = require('../src/tools/imagemTools');
  const midiaGerada = require('../src/midiaGerada');
  imagemTools._resetarSessao();
  const perguntas = [];
  const respostas = ['sempre'];
  const pedidos = [];
  imagemTools._testar({
    ask: async (q) => { perguntas.push(q); return respostas.shift() || 'n'; },
    loadConfig: () => ({}),
    imagem: () => ({ ...require('../src/imagem'), gerar: async (p, o) => { pedidos.push(o); const f = path.join(PROJ, `gerada-${pedidos.length}.png`); fs.writeFileSync(f, PNG); return { arquivo: f, modo: 'ia' }; } }),
  });
  const avisadas = [];
  const parar = midiaGerada.observar((f) => avisadas.push(path.basename(f)));
  const antes = process.cwd();
  process.chdir(PROJ);
  try {
    const r1 = await imagemTools.execute('imagem', { acao: 'gerar', prompt: 'um gato astronauta', formato: 'stories' });
    assert.match(r1, /^Imagem criada \(com IA\): gerada-1\.png/);
    assert.match(perguntas[0], /\(s\/n\/sempre\) $/);
    assert.equal(pedidos[0].formato, 'stories');
    const r2 = await imagemTools.execute('imagem', { acao: 'gerar', prompt: 'outro gato' });
    assert.match(r2, /gerada-2\.png/);
    assert.equal(perguntas.length, 1, '"sempre": a segunda não perguntou');
    assert.deepEqual(avisadas, ['gerada-1.png', 'gerada-2.png'], 'o modo site recebe a imagem criada');
    imagemTools._resetarSessao();
    assert.equal(await imagemTools.execute('imagem', { acao: 'gerar', prompt: 'mais um' }), 'Cancelado pelo usuário.', 'sem "sempre", "não" cancela');
  } finally {
    process.chdir(antes);
    parar();
    imagemTools._resetarSessao();
  }
});
