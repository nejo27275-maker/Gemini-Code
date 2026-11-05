'use strict';
// v0.46.0: imagens — gerar/editar/melhorar/descrever (src/imagem.js) e a ferramenta "imagem" do agente.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-imagem-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-imagem-proj-'));
const antes = process.cwd();
process.chdir(PROJ);

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const im = require('../src/imagem');
const imagemTools = require('../src/tools/imagemTools');

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const magick = im.acharMagick();
// no CI o ImageMagick é instalado: lá o teste de verdade não pode ser pulado em silêncio
const exigirMidia = process.env.GEMINI_CODE_EXIGIR_MIDIA === '1';

test.after(() => { process.chdir(antes); for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

test('ImageMagick: formato explícito na entrada e na saída; ampliar só quando pedido', () => {
  const a = im.argsMelhorar('/x/foto.jpg', '/x/foto-melhorada.png');
  assert.equal(a[0], 'jpeg:/x/foto.jpg');
  assert.equal(a[a.length - 1], 'png:/x/foto-melhorada.png');
  assert.ok(!a.includes('-resize'));
  assert.deepEqual(im.argsMelhorar('/x/a.png', '/x/b.png', { ampliar: 9 }).slice(1, 6), ['-auto-orient', '-filter', 'Lanczos', '-resize', '400%']);
  assert.throws(() => im.argsMelhorar('/x/a.svg', '/x/b.png'), /use \.png/);
});

test('melhorar sem IA (ImageMagick de verdade): arquivo novo, nunca sobrescreve; gif vira png', { skip: !magick && !exigirMidia && 'sem ImageMagick' }, async () => {
  assert.ok(magick, 'ImageMagick não encontrado (GEMINI_CODE_EXIGIR_MIDIA=1)');
  execFileSync(magick, ['-size', '80x60', 'plasma:fractal', 'jpeg:' + path.join(PROJ, 'foto.jpg')]);
  const r1 = await im.melhorar('foto.jpg', { modo: 'local' });
  assert.equal(r1.arquivo, path.join(PROJ, 'foto-melhorada.jpg'));
  const r2 = await im.melhorar('foto.jpg', { modo: 'local' });
  assert.equal(r2.arquivo, path.join(PROJ, 'foto-melhorada-2.jpg'));
  const r3 = await im.melhorar('foto.jpg', { modo: 'local', ampliar: 2, saida: 'grande.png' });
  // ImageMagick 7: "magick identify"; 6: "identify" ao lado do "convert"
  const identificar = (arq) => (magick.endsWith('magick')
    ? execFileSync(magick, ['identify', arq], { encoding: 'utf8' })
    : execFileSync(path.join(path.dirname(magick), 'identify'), [arq], { encoding: 'utf8' }));
  assert.match(identificar(r3.arquivo), /160x120/);
  execFileSync(magick, ['-size', '10x10', 'xc:red', 'gif:' + path.join(PROJ, 'anim.gif')]);
  assert.match((await im.melhorar('anim.gif', { modo: 'local' })).arquivo, /anim-melhorada\.png$/);
});

test('com IA: a foto vai junto com a instrução; extensão pelo tipo devolvido; modelo sem imagem = erro claro', async () => {
  fs.writeFileSync(path.join(PROJ, 'f.png'), PNG_1PX);
  const pedidos = [];
  const generateImage = async (o) => { pedidos.push(o); return { mimeType: 'image/jpeg', data: PNG_1PX.toString('base64') }; };
  const r = await im.editar('f.png', 'deixe em preto e branco', { generateImage });
  assert.equal(r.arquivo, path.join(PROJ, 'f-editada.jpg'));
  assert.equal(pedidos[0].prompt, 'deixe em preto e branco');
  assert.equal(pedidos[0].imagens[0].inlineData.mimeType, 'image/png');
  const m = await im.melhorar('f.png', { modo: 'ia', generateImage });
  assert.equal(m.arquivo, path.join(PROJ, 'f-melhorada.jpg'));
  assert.equal(pedidos[1].prompt, im.INSTRUCAO_MELHORAR);
  const g = await im.gerar('um gato de óculos', { generateImage, saida: 'gato' });
  assert.equal(g.arquivo, path.join(PROJ, 'gato.jpg'));
  await assert.rejects(() => im.gerar('', { generateImage }), /descreva/);
});

test('descrever: imagem + pergunta para o modelo do chat, sem ferramentas', async () => {
  fs.writeFileSync(path.join(PROJ, 'erro.png'), PNG_1PX);
  let pedido = null;
  const r = await im.descrever('erro.png', 'qual é o erro?', { chatWithTools: async (o) => { pedido = o; return { text: () => 'TypeError na linha 3' }; } });
  assert.equal(r, 'TypeError na linha 3');
  assert.deepEqual(pedido.tools, []);
  assert.equal(pedido.history[0].parts[0].inlineData.mimeType, 'image/png');
  assert.equal(pedido.history[0].parts[1].text, 'qual é o erro?');
});

test('travas: segredo e saúde não entram; saída nunca nas áreas protegidas', async () => {
  fs.mkdirSync(config.SAUDE_DIR, { recursive: true });
  fs.writeFileSync(path.join(config.SAUDE_DIR, 'exame.png'), PNG_1PX);
  await assert.rejects(() => im.descrever(path.join(config.SAUDE_DIR, 'exame.png'), 'x', { chatWithTools: async () => ({ text: () => '' }) }), /segredos/);
  assert.throws(() => im.destinoNovo({ saida: path.join(config.HOME_DIR, 'aliados', 'x.png'), ext: '.png' }), /protegido/);
});

test('ferramenta: IA pergunta antes (cota); sem IA e descrever não perguntam; recusa não gera nada', async () => {
  fs.writeFileSync(path.join(PROJ, 'g.png'), PNG_1PX);
  const perguntas = [];
  let respostas = ['n'];
  const chamadas = [];
  imagemTools._testar({
    ask: async (q) => { perguntas.push(q); return respostas.shift() || ''; },
    loadConfig: () => ({ confirmarMidia: true }),
    imagem: () => ({
      ...im,
      acharMagick: () => null,
      gerar: async (p) => { chamadas.push(['gerar', p]); return { arquivo: path.join(PROJ, 'nova.png'), modo: 'ia' }; },
      descrever: async () => 'uma imagem',
    }),
  });
  assert.equal(await imagemTools.execute('imagem', { acao: 'gerar', prompt: 'um gato' }), 'Cancelado pelo usuário.');
  assert.match(perguntas[0], /Gerar uma imagem com IA: "um gato" \(usa a cota da sua chave\)/);
  assert.equal(chamadas.length, 0);
  respostas = ['s'];
  assert.match(await imagemTools.execute('imagem', { acao: 'gerar', prompt: 'um gato' }), /^Imagem criada \(com IA\): nova\.png$/);
  assert.match(await imagemTools.execute('imagem', { acao: 'descrever', arquivo: 'g.png' }), /uma imagem/);
  assert.equal(perguntas.length, 2, 'descrever não pergunta');
  assert.match(await imagemTools.execute('imagem', { acao: 'melhorar', arquivo: 'g.png', modo: 'local' }), /ImageMagick precisa estar instalado/);
  assert.match(await imagemTools.execute('imagem', { acao: 'editar', arquivo: 'g.png' }), /precisa de "prompt"/);
  assert.match(await imagemTools.execute('imagem', { acao: 'pintar' }), /precisa de "acao"/);
});
