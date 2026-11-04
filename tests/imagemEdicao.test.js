'use strict';
// v0.50.0: editar fotos como um editor profissional, sem IA (src/imagemEdicao.js): a receita, os argumentos do
// ImageMagick e, com o ImageMagick de verdade, formato, texto, marca d'água, lote, EXIF, foto girada; a ferramenta
// "imagem" (ação "ajustar") e o comando do terminal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-imagemedicao-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-imagemedicao-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const ie = require('../src/imagemEdicao');
const imagem = require('../src/imagem');
const imagemTools = require('../src/tools/imagemTools');

const magick = imagem.acharMagick();
// no CI o ImageMagick é instalado: lá estes testes não podem ser pulados em silêncio
const exigirMidia = process.env.GEMINI_CODE_EXIGIR_MIDIA === '1';
const pular = magick || exigirMidia ? false : 'sem ImageMagick';
const CLI = path.join(__dirname, '..', 'bin', 'gemini-code.js');
test.after(() => { for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

const p = (n) => path.join(PROJ, n);
const im = (...args) => execFileSync(magick, args, { encoding: 'utf8' });
const tamanho = (f) => im(f, '-format', '%w %h', 'info:').trim().split(' ').map(Number);
/**
 * Um bloco EXIF mínimo de verdade (APP1, TIFF big-endian, IFD0 com só a tag Orientation) logo depois do cabeçalho
 * do JPEG — como o celular grava uma foto tirada de lado. (O "-orient" do ImageMagick 6 não grava isso num JPEG.)
 */
function comOrientacao(jpeg, valor) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, valor, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const corpo = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (corpo.length + 2) >> 8, (corpo.length + 2) & 0xff]), corpo]);
  // depois do APP0 (JFIF), se houver
  const fimApp0 = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, fimApp0), app1, jpeg.subarray(fimApp0)]);
}

function foto(nome, { w = 1600, h = 1000, comentario = null, orientacao = null } = {}) {
  assert.ok(magick, 'ImageMagick não encontrado (GEMINI_CODE_EXIGIR_MIDIA=1)');
  im('-size', `${w}x${h}`, 'gradient:red-blue', ...(comentario ? ['-set', 'comment', comentario] : []), `jpeg:${p(nome)}`);
  if (orientacao) fs.writeFileSync(p(nome), comOrientacao(fs.readFileSync(p(nome)), orientacao));
  return p(nome);
}

// ---------------------------------------------------------------------------
// Peças puras
// ---------------------------------------------------------------------------
test('texto para o ImageMagick: % e \\ viram literais e um "@" no começo não lê arquivo', () => {
  assert.equal(ie.textoMagick('50% OFF'), '50%% OFF');
  assert.equal(ie.textoMagick('%[fx:1+1] %w'), '%%[fx:1+1] %%w');
  assert.equal(ie.textoMagick('a\\b'), 'a\\\\b');
  assert.equal(ie.textoMagick('@/etc/passwd'), '\\@/etc/passwd');
  assert.equal(ie.textoMagick('siga @loja'), 'siga @loja', '@ no meio é texto normal');
});

test('texto para o ImageMagick (v0.50.1): 500 textos sorteados saem exatamente iguais no -print de verdade', { skip: pular }, () => {
  // o -print interpreta o texto como o -annotate: nada de ler arquivo (@), expandir %w/%[fx:...] nem comer a barra
  const PEDACOS = ['%', '%w', '%[fx:1+1]', '@', '@/etc/hostname', '\\', '\\n', "'", '"', '$(id)', '[', ']', ':', ';', 'a', 'ç', '😀', ' ', '&', '|'];
  let semente = 3;
  const r = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const textos = Array.from({ length: 500 }, () => Array.from({ length: 1 + Math.floor(r() * 6) }, () => PEDACOS[Math.floor(r() * PEDACOS.length)]).join('').trim()).filter(Boolean);
  for (let i = 0; i < textos.length; i += 100) {
    const lote = textos.slice(i, i + 100);
    const args = ['-size', '1x1', 'xc:white'];
    for (const t of lote) args.push('-print', ie.textoMagick(t), '-print', '\u0001');
    const saida = execFileSync(magick, [...args, 'null:'], { encoding: 'utf8' }).split('\u0001');
    lote.forEach((t, k) => assert.equal(saida[k], t, `texto ${JSON.stringify(t)}`));
  }
});

test('receita: padrões, apelidos e erros explicados', () => {
  const x = ie.normalizarReceita({});
  assert.equal(x.tirarLocalizacao, true, 'por padrão a localização sai');
  assert.equal(x.enquadrar, 'fundo-desfocado');
  assert.equal(ie.normalizarReceita({ manter_localizacao: true }).tirarLocalizacao, false);
  assert.equal(ie.normalizarReceita({ formato: 'reels' }).formato, 'stories');
  assert.equal(ie.normalizarReceita({ formato: 'capa' }).formato, 'youtube');
  assert.throws(() => ie.normalizarReceita({ formato: 'banner' }), /formato desconhecido/);
  assert.throws(() => ie.normalizarReceita({ cor: 'roxo' }), /cor desconhecida/);
  assert.throws(() => ie.normalizarReceita({ brilho: 5 }), /entre -1 e 1/);
  assert.throws(() => ie.normalizarReceita({ textos: [''] }), /texto 1 está vazio/);
  assert.throws(() => ie.normalizarReceita({ textos: Array.from({ length: 11 }, () => 'a') }), /no máximo 10/);
  assert.throws(() => ie.normalizarReceita({ marca_dagua: 'nao-existe.png' }, { cwd: PROJ }));
});

test('argumentos: formato explícito em todo arquivo, endireita antes de tirar o EXIF, texto escapado e em argumento próprio', () => {
  const x = ie.normalizarReceita({ formato: 'feed', cor: 'pb', textos: [{ texto: '50% @casa', posicao: 'baixo', fundo: true }] });
  x.marca = '/m/logo.png'; x.posicaoMarca = 'canto-inferior-direito'; x.tamanhoMarca = 0.2; x.opacidadeMarca = 0.8;
  const r = ie.montarArgs('/f/foto.jpeg', '/f/foto-editada.jpg', x, { w: 1600, h: 1000, fonte: '/fonte.ttf', alturaMarca: 90 });
  assert.equal(r.args[0], 'jpeg:/f/foto.jpeg');
  assert.equal(r.args[r.args.length - 1], 'jpeg:/f/foto-editada.jpg');
  assert.ok(r.args.includes('png:/m/logo.png'), "a marca d'água também com formato explícito");
  assert.ok(r.args.indexOf('-auto-orient') < r.args.indexOf('-strip'), 'endireita antes de tirar o EXIF');
  assert.ok(r.args.includes('-blur') && r.args.includes('-composite'), 'fundo desfocado');
  assert.deepEqual([r.largura, r.altura], [1080, 1350]);
  assert.ok(r.args.includes('50%% @casa'), 'o texto vai escapado, num argumento só');
  assert.equal(r.args.filter((a) => a === '-annotate').length, 2, 'contorno e depois o preenchimento');
  const y = Number(r.args[r.args.indexOf('-annotate') + 1].split('+')[2]);
  assert.ok(y >= 90, `o texto de baixo sobe acima da marca d'água (y=${y})`);
  const leve = ie.montarArgs('/f/a.png', '/f/b.png', ie.normalizarReceita({ qualidade: 'leve' }), { w: 4000, h: 3000 });
  assert.ok(leve.args.includes('1600x1600>'));
  assert.deepEqual([leve.largura, leve.altura], [1600, 1200]);
});

// ---------------------------------------------------------------------------
// Com o ImageMagick de verdade
// ---------------------------------------------------------------------------
test('ajustar de verdade: feed com fundo desfocado, cor, textos com @ e %, marca d\'água; nunca sobrescreve', { skip: pular, timeout: 120000 }, async () => {
  const f = foto('praia.jpg');
  im('-size', '300x120', 'xc:orange', `png:${p('logo.png')}`);
  const receita = { formato: 'feed', cor: 'vivo', melhorar: true, textos: [{ texto: '50% OFF %w @/etc/hostname \\ fim', posicao: 'topo', tamanho: 'grande', fundo: true }, 'Siga @loja'], marca_dagua: p('logo.png') };
  const r = await ie.ajustar(f, receita, { cwd: PROJ });
  assert.equal(r.arquivos.length, 1);
  assert.match(r.arquivos[0].arquivo, /praia-editada\.jpg$/);
  assert.deepEqual(tamanho(r.arquivos[0].arquivo), [1080, 1350]);
  assert.equal(fs.readFileSync(r.arquivos[0].arquivo).subarray(0, 3).toString('hex'), 'ffd8ff');
  assert.deepEqual(r.passos.slice(0, 3), ['melhorada (luz, cor e nitidez)', 'cor "vivo"', 'formato feed do Instagram (4:5, 1080x1350) com fundo desfocado']);
  const r2 = await ie.ajustar(f, { formato: 'quadrado' }, { cwd: PROJ });
  assert.match(r2.arquivos[0].arquivo, /praia-editada-2\.jpg$/, 'nunca sobrescreve');
  assert.deepEqual(tamanho(r2.arquivos[0].arquivo), [1080, 1080]);
});

test('ajustar de verdade: tira os metadados por padrão (e mantém se pedir); foto girada pelo EXIF sai em pé', { skip: pular, timeout: 120000 }, async () => {
  const f = foto('com-exif.jpg', { w: 400, h: 200, comentario: 'GPS -23.55,-46.63', orientacao: 6 });
  assert.match(im(f, '-format', '%c', 'info:'), /GPS/);
  assert.equal(im(f, '-format', '%[orientation]', 'info:').trim(), 'RightTop', 'a foto de teste está mesmo girada');
  const limpa = (await ie.ajustar(f, {}, { cwd: PROJ })).arquivos[0];
  assert.equal(im(limpa.arquivo, '-format', '%c', 'info:').trim(), '', 'os metadados saíram');
  assert.deepEqual(tamanho(limpa.arquivo), [200, 400], 'a foto girada pelo EXIF saiu em pé');
  assert.deepEqual([limpa.largura, limpa.altura], [200, 400]);
  const mantida = (await ie.ajustar(f, { manter_localizacao: true }, { cwd: PROJ })).arquivos[0];
  assert.match(im(mantida.arquivo, '-format', '%c', 'info:'), /GPS/);
});

test('ajustar de verdade: várias fotos de uma vez; "saida" com várias é recusada', { skip: pular, timeout: 120000 }, async () => {
  const a = foto('a.jpg', { w: 800, h: 600 });
  const b = foto('b.jpg', { w: 600, h: 800 });
  const r = await ie.ajustar([a, b], { formato: 'stories', enquadrar: 'barras', cor: 'pb' }, { cwd: PROJ });
  assert.deepEqual(r.arquivos.map((x) => path.basename(x.arquivo)), ['a-editada.jpg', 'b-editada.jpg']);
  for (const x of r.arquivos) assert.deepEqual(tamanho(x.arquivo), [1080, 1920]);
  await assert.rejects(() => ie.ajustar([a, b], {}, { cwd: PROJ, saida: p('x.jpg') }), /não use "saida"/);
});

test('ferramenta "imagem": ajustar sem IA e sem perguntar; a lista de ações inclui "ajustar"', { skip: pular, timeout: 120000 }, async () => {
  const perguntas = [];
  imagemTools._testar({ ask: async (q) => { perguntas.push(q); return 'n'; } });
  const f = foto('loja.jpg', { w: 900, h: 900 });
  const antes = process.cwd();
  process.chdir(PROJ);
  try {
    const r = await imagemTools.execute('imagem', { acao: 'ajustar', arquivo: 'loja.jpg', formato: 'youtube', textos: [{ texto: 'Novidade', posicao: 'centro', tamanho: 'grande' }] });
    assert.match(r, /^Foto editada \(sem IA\): loja-editada\.jpg \(1280x720; formato capa do YouTube/);
    assert.deepEqual(perguntas, [], 'sem IA: não pergunta nada (dentro do projeto)');
    assert.match(await imagemTools.execute('imagem', { acao: 'pintar' }), /precisa de "acao": ajustar, gerar, editar, melhorar, descrever/);
    assert.match(await imagemTools.execute('imagem', { acao: 'ajustar', arquivo: f, cor: 'roxo' }), /^Erro: cor desconhecida/);
  } finally { process.chdir(antes); }
});

// ---------------------------------------------------------------------------
// v0.51.0: cores de foto de iPhone (Display P3) e GIF animado
// ---------------------------------------------------------------------------
const perfilCor = require('../src/perfilCor');
/** O que o sRGB mostra para uma cor em Display P3 (as contas de cor, sem o ImageMagick). */
function p3ParaSrgb(rgb) {
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const cod = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const mP3 = perfilCor.matrizes(perfilCor.DISPLAY_P3).m;
  const mS = perfilCor.matrizes(perfilCor.SRGB).m;
  const [[a, b, c], [d, e, f], [g, h, i]] = mS;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det], [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det], [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]];
  const linear = rgb.map((v) => lin(v / 255));
  const xyz = mP3.map((l) => l.reduce((s, v, k) => s + v * linear[k], 0));
  return inv.map((l) => l.reduce((s, v, k) => s + v * xyz[k], 0)).map((v) => Math.round(255 * cod(Math.min(1, Math.max(0, v)))));
}
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} (esperado ${b} ± ${tol})`);
const pixel = (f) => im(f, '-format', '%[fx:round(255*p{2,2}.r)] %[fx:round(255*p{2,2}.g)] %[fx:round(255*p{2,2}.b)]', 'info:').trim().split(' ').map(Number);
const descricaoIcc = (f) => spawnSync(magick, [f, '-format', '%[icc:description]', 'info:'], { encoding: 'utf8' }).stdout.trim();

test('de verdade (v0.51.0): foto de iPhone (Display P3) sai em sRGB com as cores certas — antes o -strip as desbotava', { skip: pular, timeout: 120000 }, async (t) => {
  if (!(await ie.temLcms(magick))) { t.skip('este ImageMagick não tem o lcms'); return; }
  const icc = p('p3.icc');
  fs.writeFileSync(icc, perfilCor.perfilRgb(perfilCor.DISPLAY_P3));
  const cor = [200, 60, 40];
  im('-size', '64x48', `xc:rgb(${cor.join(',')})`, '-set', 'comment', 'GPS -23.55,-46.63', '-profile', icc, `png:${p('iphone.png')}`);
  assert.equal(descricaoIcc(p('iphone.png')), 'Display P3 (gemini-code)', 'a foto de teste está em Display P3');
  const esperado = p3ParaSrgb(cor);
  assert.ok(esperado[0] - cor[0] >= 12, `em sRGB o vermelho é bem mais forte (${esperado}): por isso sem converter desbota`);
  // e numa pasta temporária com caracteres que o ImageMagick poderia interpretar (o perfil sRGB vai para lá)
  const estranha = p("tmp it's: a, [b]; c=d % ação");
  fs.mkdirSync(estranha, { recursive: true });
  const antes = process.env.TMPDIR;
  process.env.TMPDIR = estranha;
  let r;
  try { r = await ie.ajustar(p('iphone.png'), {}, { cwd: PROJ }); } finally { if (antes === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = antes; }
  const saida = r.arquivos[0].arquivo;
  assert.equal(descricaoIcc(saida), '', 'sem perfil nenhum (lido como sRGB, o padrão)');
  assert.equal(im(saida, '-format', '%c', 'info:').trim(), '', 'a localização saiu');
  pixel(saida).forEach((v, k) => perto(v, esperado[k], 3, `canal ${'RGB'[k]}`));
  assert.match(r.passos.join(' '), /cores convertidas de Display P3 \(gemini-code\) para sRGB/);
  assert.deepEqual(fs.readdirSync(estranha), [], 'o perfil temporário foi apagado');
  // mantendo a localização: a foto fica com o perfil sRGB (as cores continuam as convertidas)
  const mantida = (await ie.ajustar(p('iphone.png'), { manter_localizacao: true }, { cwd: PROJ })).arquivos[0].arquivo;
  assert.equal(descricaoIcc(mantida), 'sRGB (gemini-code)');
  pixel(mantida).forEach((v, k) => perto(v, esperado[k], 3, `mantida, canal ${'RGB'[k]}`));
  // uma foto que já é sRGB não é mexida
  fs.writeFileSync(p('srgb.icc'), perfilCor.perfilSrgb());
  im('-size', '64x48', `xc:rgb(${cor.join(',')})`, '-profile', p('srgb.icc'), `png:${p('android.png')}`);
  const r2 = await ie.ajustar(p('android.png'), {}, { cwd: PROJ });
  assert.deepEqual(pixel(r2.arquivos[0].arquivo), cor);
  assert.doesNotMatch(r2.passos.join(' '), /convertidas/);
});

test('sem o lcms (v0.51.0): a localização sai e o perfil de cor fica — as cores continuam certas', { skip: pular, timeout: 60000 }, () => {
  const x = ie.normalizarReceita({});
  const r = ie.montarArgs('/f/a.jpg', '/f/b.jpg', x, { w: 10, h: 10, manterPerfil: true, perfil: 'Display P3' });
  assert.ok(!r.args.includes('-strip'));
  assert.deepEqual(r.args.slice(r.args.indexOf('+profile'), r.args.indexOf('+profile') + 4), ['+profile', '!icc,*', '+set', 'comment']);
  assert.match(r.passos.join(' '), /perfil de cor \(Display P3\) ficou/);
  // de verdade: com esses argumentos, sai o comentário e o EXIF; o perfil fica
  const icc = p('p3b.icc');
  fs.writeFileSync(icc, perfilCor.perfilRgb(perfilCor.DISPLAY_P3));
  const f = p('p3-exif.jpg');
  im('-size', '40x20', 'xc:rgb(200,60,40)', '-set', 'comment', 'GPS -23.55,-46.63', '-profile', icc, `jpeg:${f}`);
  fs.writeFileSync(f, comOrientacao(fs.readFileSync(f), 6));
  const plano = ie.montarArgs(f, p('p3-exif-saida.jpg'), x, { w: 20, h: 40, manterPerfil: true, perfil: 'Display P3' });
  execFileSync(magick, plano.args);
  const out = p('p3-exif-saida.jpg');
  assert.equal(descricaoIcc(out), 'Display P3 (gemini-code)');
  assert.equal(im(out, '-format', '%c', 'info:').trim(), '');
  assert.doesNotMatch(fs.readFileSync(out).toString('latin1'), /Exif\0\0/, 'o EXIF saiu');
});

test('de verdade (v0.51.0): GIF animado vira uma foto só, com as medidas certas (antes: "10 2010 20" e vários arquivos)', { skip: pular, timeout: 60000 }, async () => {
  im('-size', '200x100', 'xc:red', '-size', '200x100', 'xc:blue', '-loop', '0', `gif:${p('anim.gif')}`);
  assert.deepEqual(await ie.medidas(magick, p('anim.gif')), { w: 200, h: 100, perfil: '' });
  const r = await ie.ajustar(p('anim.gif'), { textos: ['Oi'] }, { cwd: PROJ });
  assert.match(r.arquivos[0].arquivo, /anim-editada\.png$/);
  assert.deepEqual(tamanho(r.arquivos[0].arquivo), [200, 100]);
  assert.deepEqual(fs.readdirSync(PROJ).filter((n) => /^anim-editada/.test(n)), ['anim-editada.png'], 'um arquivo só');
});

test('comando do terminal: imagem ajustar recusa opção errada', { skip: pular, timeout: 60000 }, () => {
  const f = foto('cli.jpg', { w: 300, h: 300 });
  const r = spawnSync(process.execPath, [CLI, 'imagem', 'ajustar', f, '--corr', 'vivo'], { encoding: 'utf8', env: { ...process.env, HOME, USERPROFILE: HOME }, cwd: PROJ });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /opção desconhecida: --corr/);
  const ok = spawnSync(process.execPath, [CLI, 'imagem', 'ajustar', f, '--formato', 'quadrado', '--texto', 'Oi'], { encoding: 'utf8', env: { ...process.env, HOME, USERPROFILE: HOME }, cwd: PROJ });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Foto editada \(sem IA\): .*cli-editada\.jpg \(1080x1080\)/);
});
