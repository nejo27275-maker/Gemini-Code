'use strict';
// v0.46.0: câmera (foto, analisar, vigiar) e vídeo (melhorar, slideshow, gerar) + as ferramentas sob demanda.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-midia-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-midia-proj-'));
const antes = process.cwd();
process.chdir(PROJ);

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const camera = require('../src/camera');
const video = require('../src/video');
const midia = require('../src/tools/midiaTools');
const tools = require('../src/tools');

const magick = require('../src/imagem').acharMagick();
const ffmpeg = video.acharFfmpeg();

test.after(() => { process.chdir(antes); for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

test('câmera: como fotografar em cada sistema; sem câmera a mensagem diz o que instalar', async () => {
  const termux = camera.comoFotografar({ plataforma: 'android', camera: 1, temComando: () => false });
  assert.deepEqual([termux.cmd, ...termux.args('/x/f.jpg')], ['termux-camera-photo', '-c', '1', '/x/f.jpg']);
  const pc = camera.comoFotografar({ plataforma: 'linux', temComando: (n) => n === 'ffmpeg', existe: () => true });
  assert.deepEqual(pc.args('/x/f.jpg').slice(-6), ['-i', '/dev/video0', '-frames:v', '1', '-n', '/x/f.jpg']);
  assert.equal(camera.comoFotografar({ plataforma: 'linux', temComando: (n) => n === 'ffmpeg', existe: () => false }), null, 'sem /dev/video0');
  await assert.rejects(() => camera.foto({ plataforma: 'win32', temComando: () => false }), /Nenhuma câmera disponível/);
  const enoent = (cmd, args, o, cb) => cb(Object.assign(new Error('spawn termux-camera-photo ENOENT'), { code: 'ENOENT' }), '', '');
  await assert.rejects(() => camera.foto({ plataforma: 'android', temComando: () => false, execFileFn: enoent }), /pkg install termux-api/);
});

test('câmera: foto cria arquivo novo; analisar apaga a foto temporária depois de perguntar', async () => {
  const fotografa = (cmd, args, o, cb) => { fs.writeFileSync(args[args.length - 1], 'jpg'); cb(null, '', ''); };
  const f = await camera.foto({ plataforma: 'android', temComando: () => false, execFileFn: fotografa, saida: 'f.jpg' });
  assert.equal(f, path.join(PROJ, 'f.jpg'));
  const f2 = await camera.foto({ plataforma: 'android', temComando: () => false, execFileFn: fotografa, saida: 'f.jpg' });
  assert.equal(f2, path.join(PROJ, 'f-2.jpg'), 'nunca sobrescreve');
  let vista = null;
  const r = await camera.analisar('tem leite?', { plataforma: 'android', temComando: () => false, execFileFn: fotografa, descrever: async (arq, p) => { vista = arq; return `sim (${p})`; } });
  assert.equal(r.resposta, 'sim (tem leite?)');
  assert.equal(r.arquivo, null);
  assert.equal(fs.existsSync(vista), false, 'a foto temporária some');
});

test('vigia: compara de verdade (ImageMagick) e guarda só o que mudou', { skip: !magick && 'sem ImageMagick' }, async () => {
  // JPEG, como sai da câmera
  const a = path.join(PROJ, 'a.jpg');
  const b = path.join(PROJ, 'b.jpg');
  const c = path.join(PROJ, 'c.jpg');
  execFileSync(magick, ['-size', '200x150', 'xc:gray50', `jpeg:${a}`]);
  execFileSync(magick, ['-size', '200x150', 'xc:gray50', `jpeg:${b}`]);
  execFileSync(magick, ['-size', '200x150', 'xc:gray50', '-fill', 'white', '-draw', 'rectangle 0,0 120,150', `jpeg:${c}`]);
  assert.equal(await camera.diferenca(a, b), 0);
  assert.ok(await camera.diferenca(a, c) > 0.5);
  const sequencia = [a, b, c, c];
  let i = 0;
  const detectados = [];
  const r = await camera.vigiar({
    intervaloS: 5, sensibilidade: 10, pasta: 'vigia', maxFotos: 4, dormir: async () => {},
    fotoFn: async ({ saida }) => { fs.copyFileSync(sequencia[i++], saida); return saida; },
    aoDetectar: async (d) => detectados.push(d),
  });
  assert.equal(r.fotos, 4);
  assert.equal(r.deteccoes, 1, 'só a troca b -> c');
  assert.ok(fs.existsSync(detectados[0].arquivo));
  assert.equal(fs.readdirSync(path.join(PROJ, 'vigia')).length, 1);
});

test('vídeo: lista do concat escapa aspas; filtros; entradas conferidas', () => {
  assert.equal(video.listaConcat(["/x/it's.jpg", '/x/b.jpg'], 2), "file '/x/it'\\''s.jpg'\nduration 2\nfile '/x/b.jpg'\nduration 2\nfile '/x/b.jpg'\n");
  assert.equal(video.filtrosMelhorar(), 'hqdn3d=1.5:1.5:6:6,unsharp=5:5:0.6:5:5:0.0,eq=contrast=1.04:saturation=1.08');
  assert.match(video.filtrosMelhorar({ estabilizar: true }), /^deshake,/);
  return Promise.all([
    assert.rejects(() => video.melhorar('/etc/passwd', { ffmpeg: '/bin/true' }), /formato não suportado/),
    assert.rejects(() => video.slideshow([], { ffmpeg: '/bin/true' }), /informe as fotos/),
    assert.rejects(() => video.melhorar('x.mp4', { ffmpeg: null }), /pkg install ffmpeg/),
    assert.rejects(() => video.melhorar(path.join(config.HOME_DIR, 'config.json.mp4'), { ffmpeg: '/bin/true' }), /não encontrei|protegido/),
  ]);
});

test('vídeo com ffmpeg de verdade: melhorar e slideshow com música, sem sobrescrever', { skip: !ffmpeg && 'sem ffmpeg' }, async () => {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', '-c:v', 'libx264', path.join(PROJ, 'v.mp4')]);
  const m = await video.melhorar('v.mp4');
  assert.equal(m.arquivo, path.join(PROJ, 'v-melhorado.mp4'));
  assert.ok(fs.statSync(m.arquivo).size > 0);
  const fotos = ['r', 'g'].map((c) => { const f = path.join(PROJ, `${c}.png`); execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c === 'r' ? 'red' : 'green'}:s=200x100`, '-frames:v', '1', f]); return f; });
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', path.join(PROJ, 'm.mp3')]);
  const s = await video.slideshow(fotos, { segundos: 1, musica: 'm.mp3' });
  assert.equal(s.arquivo, path.join(PROJ, 'slideshow.mp4'));
  const s2 = await video.slideshow(fotos, {});
  assert.equal(s2.arquivo, path.join(PROJ, 'slideshow-2.mp4'));
});

test('ferramentas: câmera pergunta SEMPRE (e não fotografa sem o sim); vídeo com IA pergunta; local não', async () => {
  const perguntas = [];
  let respostas = ['n'];
  const usos = [];
  midia._testar({
    ask: async (q) => { perguntas.push(q); return respostas.shift() || ''; },
    loadConfig: () => ({ confirmarMidia: false }),
    camera: () => ({ analisar: async (p, o) => { usos.push(['camera', p, o]); return { arquivo: null, resposta: 'uma geladeira' }; } }),
    video: () => ({ gerar: async (p) => { usos.push(['gerar', p]); return { arquivo: 'videos/v.mp4' }; }, melhorar: async () => ({ arquivo: path.join(PROJ, 'x-melhorado.mp4') }), slideshow: async () => ({ arquivo: path.join(PROJ, 's.mp4'), fotos: 2, segundos: 1.5 }) }),
  });
  assert.equal(await midia.execute('camera', { pergunta: 'tem leite?' }), 'O usuário não autorizou usar a câmera.');
  assert.match(perguntas[0], /tirar uma foto com a câmera traseira para responder: "tem leite\?"/);
  assert.equal(usos.length, 0);
  respostas = ['s'];
  assert.equal(await midia.execute('camera', { pergunta: 'tem leite?', camera: 1 }), 'uma geladeira');
  assert.match(perguntas[1], /câmera frontal/);
  // confirmarMidia:false não desliga a pergunta da câmera — só a do custo da IA
  assert.equal(await midia.execute('video', { acao: 'gerar', prompt: 'um pôr do sol' }), 'Vídeo criado com IA: videos/v.mp4');
  assert.equal(perguntas.length, 2);
  assert.match(await midia.execute('video', { acao: 'melhorar', arquivo: 'x.mp4' }), /^Vídeo melhorado: x-melhorado\.mp4$/);
  assert.match(await midia.execute('video', { acao: 'slideshow', fotos: ['a.jpg', 'b.jpg'] }), /2 fotos, 1,5 s cada/);
  assert.match(await midia.execute('video', { acao: 'cortar' }), /precisa de "acao"/);
  // fora do chat comum
  const nomes = (await tools.getAllDeclarations(undefined)).map((d) => d.name);
  assert.ok(!nomes.includes('camera') && !nomes.includes('video') && nomes.includes('imagem'));
});
