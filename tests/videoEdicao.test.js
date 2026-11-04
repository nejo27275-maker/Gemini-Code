'use strict';
// v0.50.0: editar vídeo como um editor profissional (src/videoEdicao.js): a receita, o plano do ffmpeg e, com o
// ffmpeg de verdade, editar, juntar, capa, áudio e info; a ferramenta "video" e o comando do terminal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-videoedicao-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-videoedicao-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const ve = require('../src/videoEdicao');
const video = require('../src/video');
const midia = require('../src/tools/midiaTools');

const ffmpeg = video.acharFfmpeg();
// no CI o ffmpeg é instalado: lá estes testes não podem ser pulados em silêncio
const exigirMidia = process.env.GEMINI_CODE_EXIGIR_MIDIA === '1';
const pular = ffmpeg || exigirMidia ? false : 'sem ffmpeg';
const CLI = path.join(__dirname, '..', 'bin', 'gemini-code.js');
test.after(() => { for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

const lavfi = (args, saida) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, saida]);
const p = (n) => path.join(PROJ, n);
let entradas = null;
/** Clipe 640x360 de 6 s com som, clipe 320x480 de 3 s sem som, música, logo e legenda (uma vez só). */
function arquivos() {
  if (entradas) return entradas;
  assert.ok(ffmpeg, 'ffmpeg não encontrado (GEMINI_CODE_EXIGIR_MIDIA=1)');
  lavfi(['-f', 'lavfi', '-i', 'testsrc2=duration=6:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], p('clipe.mp4'));
  lavfi(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x480:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'], p('mudo.mp4'));
  lavfi(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10'], p('musica.mp3'));
  lavfi(['-f', 'lavfi', '-i', 'color=c=orange:s=300x120', '-frames:v', '1'], p('logo.png'));
  fs.writeFileSync(p('falas.srt'), '1\n00:00:02,000 --> 00:00:04,000\nOlá: vírgula, "aspas" e 50%!\n\n2\n00:00:04,500 --> 00:00:05,800\nSegunda fala\n');
  entradas = { clipe: p('clipe.mp4'), mudo: p('mudo.mp4'), musica: p('musica.mp3'), logo: p('logo.png'), legenda: p('falas.srt') };
  return entradas;
}
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} (esperado ${b} ± ${tol})`);

// ---------------------------------------------------------------------------
// Peças puras
// ---------------------------------------------------------------------------
test('tempos e corte: segundos, mm:ss, hh:mm:ss; erros claros', () => {
  assert.equal(ve.lerTempo('75'), 75);
  assert.equal(ve.lerTempo('1:15'), 75);
  assert.equal(ve.lerTempo('01:02:03,5'), 3723.5);
  assert.equal(ve.lerTempo(12.5), 12.5);
  assert.throws(() => ve.lerTempo('1:75'), /até 59/);
  assert.throws(() => ve.lerTempo('abc'), /inválido/);
  assert.throws(() => ve.lerTempo(-1), /0 ou mais/);
  assert.deepEqual(ve.lerCorte('0:05-0:35'), { inicio: 5, fim: 35 });
  assert.deepEqual(ve.lerCorte('5 a 35'), { inicio: 5, fim: 35 });
  assert.deepEqual(ve.lerCorte('0:05 até 1:00'), { inicio: 5, fim: 60 });
  assert.throws(() => ve.lerCorte('0:35-0:05'), /depois do início/);
  assert.throws(() => ve.lerCorte('0:05'), /INICIO-FIM/);
});

test('velocidade: a cadeia de atempo fica entre 0,5 e 2 e multiplica até o fator', () => {
  for (const f of [0.25, 0.3, 0.75, 1.25, 2, 3.5, 4]) {
    const c = ve.cadeiaAtempo(f);
    assert.ok(c.every((x) => x >= 0.5 && x <= 2), `${f}: ${c}`);
    perto(c.reduce((a, b) => a * b, 1), f, 1e-6, `produto de ${f}`);
  }
});

test('escape dos dois níveis do filtergraph do ffmpeg (aspas, dois-pontos, vírgula, colchetes)', () => {
  assert.equal(ve.escaparValor("it's a: b, c [x]; d"), "it\\\\\\'s a\\\\: b\\, c \\[x\\]\\; d");
  assert.equal(ve.escaparValor('/tmp/pasta-segura/legenda.srt'), '/tmp/pasta-segura/legenda.srt');
});

test('receita: padrões e erros explicados (formato, cor, velocidade, corte, textos, arquivos)', () => {
  const x = ve.normalizarReceita({}, { cwd: PROJ });
  assert.equal(x.normalizar, true);
  assert.equal(x.enquadrar, 'fundo-desfocado');
  assert.equal(x.qualidade, 'normal');
  assert.equal(ve.normalizarReceita({ formato: 'tiktok' }).formato, 'reels', 'apelido');
  assert.equal(ve.normalizarReceita({ formato: '16:9' }).formato, 'youtube');
  assert.equal(ve.normalizarReceita({ formato: 'original' }).formato, undefined);
  assert.equal(ve.normalizarReceita({ fade: true }).fade, 0.5);
  assert.throws(() => ve.normalizarReceita({ formato: 'cinema' }), /formato desconhecido.*reels/);
  assert.throws(() => ve.normalizarReceita({ cor: 'azul' }), /cor desconhecida/);
  assert.throws(() => ve.normalizarReceita({ velocidade: 10 }), /entre 0.25 e 4/);
  assert.throws(() => ve.normalizarReceita({ inicio: 10, fim: 5 }), /depois do início/);
  assert.throws(() => ve.normalizarReceita({ textos: [{ texto: '  ' }] }), /texto 1 está vazio/);
  assert.throws(() => ve.normalizarReceita({ textos: [{ texto: 'a', posicao: 'lado' }] }), /posição do texto 1/);
  assert.throws(() => ve.normalizarReceita({ textos: Array.from({ length: 11 }, () => 'a') }), /no máximo 10/);
  fs.writeFileSync(path.join(PROJ, 'falas.txt'), 'x');
  assert.throws(() => ve.normalizarReceita({ legenda: 'falas.txt' }, { cwd: PROJ }), /formato não suportado/);
  assert.throws(() => ve.normalizarReceita({ musica: 'nao-existe.mp3' }, { cwd: PROJ }), /não encontrei/);
  assert.deepEqual(ve.normalizarReceita({ textos: 'Oferta' }).textos.map((t) => [t.texto, t.posicao, t.tamanho]), [['Oferta', 'baixo', 'medio']]);
});

test('plano do ffmpeg: cada parte da receita vira o filtro certo; texto do usuário nunca entra no filtro', () => {
  const inf = { duracao: 6, largura: 640, altura: 360, temAudio: true };
  const x = ve.normalizarReceita({ inicio: 1, fim: 5, velocidade: 2, formato: 'reels', cor: 'quente', fade: 0.4, textos: [{ texto: "50% OFF: 'hoje'", inicio: 0, fim: 1 }] });
  x.musica = '/m.mp3'; x.volumeMusica = 0.3; x.abaixarMusica = true;
  x.marca = '/l.png'; x.posicaoMarca = 'canto-inferior-direito'; x.tamanhoMarca = 0.2; x.opacidadeMarca = 0.8;
  const p = ve.montarEdicao(inf, x, { textosArquivos: [['/tmp/t/texto-0-0.txt']], legenda: '/tmp/t/legenda.srt', fonte: '/f/DejaVuSans-Bold.ttf', entradaMusica: 1, entradaMarca: 2 });
  assert.equal(p.duracao, 2, '(5 - 1) / 2');
  assert.deepEqual([p.largura, p.altura], [1080, 1920]);
  assert.match(p.filtro, /^\[0:v\]setpts=PTS\/2,colorbalance=/);
  assert.match(p.filtro, /split=2.*gblur=sigma=40.*overlay=\(W-w\)\/2:\(H-h\)\/2/, 'fundo desfocado');
  assert.match(p.filtro, /subtitles=filename=\/tmp\/t\/legenda\.srt:force_style=FontName=DejaVu Sans\\,FontSize=10/);
  assert.match(p.filtro, /drawtext=fontfile=\/f\/DejaVuSans-Bold\.ttf:textfile=\/tmp\/t\/texto-0-0\.txt:expansion=none:/);
  assert.match(p.filtro, /enable=between\(t\\,0\\,1\)/);
  assert.doesNotMatch(p.filtro, /50% OFF/, 'o texto vai por arquivo');
  assert.match(p.filtro, /fade=t=out:st=1\.6:d=0\.4/);
  assert.match(p.filtro, /\[2:v\]scale=216:-1,format=rgba,colorchannelmixer=aa=0\.8\[marca\];\[vpos\]\[marca\]overlay=W-w-32:H-h-32/);
  assert.match(p.filtro, /\[0:a\]atempo=2,aresample=48000\[voz\]/);
  assert.match(p.filtro, /sidechaincompress/, 'a música abaixa quando alguém fala');
  assert.match(p.filtro, /loudnorm=I=-14:TP=-1\.5:LRA=11,aresample=48000/);
  assert.equal(p.temAudio, true);
  const mudo = ve.montarEdicao({ duracao: 3, largura: 320, altura: 480, temAudio: false }, ve.normalizarReceita({}), {});
  assert.equal(mudo.temAudio, false);
  assert.doesNotMatch(mudo.filtro, /\[a\]/);
  assert.deepEqual([mudo.largura, mudo.altura], [320, 480]);
  assert.deepEqual(ve.tamanhoFinal({ largura: 1920, altura: 1080 }, ve.normalizarReceita({ qualidade: 'leve' })), { w: 1280, h: 720 }, 'leve: até 720p');
});

test('textos: na mesma posição e ao mesmo tempo ficam empilhados; em tempos diferentes, no mesmo lugar; legenda empurra o de baixo', () => {
  const arq = [['a'], ['b'], ['c']];
  const juntos = ve.normalizarReceita({ textos: [{ texto: 'a', posicao: 'topo' }, { texto: 'b', posicao: 'topo' }] }).textos;
  const [y1, y2] = ve.posicionarTextos(juntos, arq, 1080, 1920);
  assert.ok(y2 > y1 + 50, `empilhados: ${y1}, ${y2}`);
  const separados = ve.normalizarReceita({ textos: [{ texto: 'a', posicao: 'topo', inicio: 0, fim: 2 }, { texto: 'b', posicao: 'topo', inicio: 2, fim: 4 }] }).textos;
  const [s1, s2] = ve.posicionarTextos(separados, arq, 1080, 1920);
  assert.equal(s1, s2, 'tempos diferentes: mesmo lugar');
  const baixo = ve.normalizarReceita({ textos: ['x'] }).textos;
  assert.ok(ve.posicionarTextos(baixo, arq, 1080, 1920, { legenda: true })[0] < ve.posicionarTextos(baixo, arq, 1080, 1920)[0], 'com legenda, o texto de baixo sobe');
  assert.equal(ve.quebrarLinhas('uma frase bem comprida aqui', 10), 'uma frase\nbem\ncomprida\naqui');
});

test('legenda: os tempos seguem o corte e a velocidade (SRT, VTT e ASS); nunca ficam negativos', () => {
  const srt = '1\n00:00:05,000 --> 00:00:07,500\nOi\n\n2\n00:00:00,500 --> 00:00:01,000\nAntes do corte\n';
  const r = ve.ajustarLegenda(srt, '.srt', { inicio: 2, velocidade: 2 });
  assert.match(r, /00:00:01,500 --> 00:00:02,750/);
  assert.match(r, /00:00:00,000 --> 00:00:00,000/);
  assert.match(ve.ajustarLegenda('00:01:00.000 --> 00:01:02.000', '.vtt', { inicio: 30 }), /00:00:30\.000 --> 00:00:32\.000/);
  assert.match(ve.ajustarLegenda('Dialogue: 0,0:00:10.00,0:00:12.50,Default,,0,0,0,,Oi', '.ass', { inicio: 4 }), /0:00:06\.00,0:00:08\.50/);
  assert.equal(ve.ajustarLegenda(srt, '.srt', {}), srt, 'sem corte nem velocidade: igual');
});

test('info: lê duração, tamanho, áudio e a rotação do celular (troca largura e altura)', () => {
  const celular = 'Duration: 00:00:12.34, start: 0.000000, bitrate: 900 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080, 900 kb/s, 29.97 fps\n    Side data:\n      displaymatrix: rotation of -90.00 degrees\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo';
  assert.deepEqual(ve.lerInfo(celular), { duracao: 12.34, largura: 1080, altura: 1920, fps: 29.97, temAudio: true, rotacao: -90, hdr: null });
  const semAudio = ve.lerInfo('Duration: N/A, bitrate: N/A\n  Stream #0:0: Video: mjpeg, yuvj420p, 640x480, 25 fps');
  assert.equal(semAudio.duracao, null);
  assert.equal(semAudio.temAudio, false);
  assert.deepEqual([semAudio.largura, semAudio.altura], [640, 480]);
});

test('HDR (v0.50.1): reconhece HLG e PQ; com o zscale converte para SDR, sem ele avisa', () => {
  const linha = (curva) => `Duration: 00:00:02.00\n  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/${curva}, progressive), 1920x1080, 30 fps`;
  assert.equal(ve.lerInfo(linha('arib-std-b67')).hdr, 'hlg');
  assert.equal(ve.lerInfo(linha('smpte2084')).hdr, 'pq');
  assert.equal(ve.lerInfo('Stream #0:0: Video: h264, yuv420p(tv, bt709), 640x360, 30 fps').hdr, null);
  const inf = { duracao: 2, largura: 1920, altura: 1080, temAudio: false, hdr: 'hlg' };
  const com = ve.montarEdicao(inf, ve.normalizarReceita({}), { converterHdr: true });
  assert.match(com.filtro, /^\[0:v\]zscale=tin=arib-std-b67:pin=bt2020:min=bt2020nc:t=linear.*tonemap=tonemap=hable.*zscale=t=bt709:m=bt709:r=tv,format=yuv420p/);
  assert.match(com.passos.join(' '), /HDR \(HLG\) convertido para cores normais/);
  const pq = ve.montarEdicao({ ...inf, hdr: 'pq' }, ve.normalizarReceita({}), { converterHdr: true });
  assert.match(pq.filtro, /zscale=tin=smpte2084/);
  const sem = ve.montarEdicao(inf, ve.normalizarReceita({}), { converterHdr: false });
  assert.doesNotMatch(sem.filtro, /zscale/);
  assert.match(sem.passos.join(' '), /ATENÇÃO: o vídeo é HDR \(HLG\).*zscale/);
});

test('argv do ffmpeg: toda entrada com -protocol_whitelist file e "file:", -n, saída "file:", e o texto fora da linha de comando', async () => {
  const chamadas = [];
  const execFileFn = (cmd, args, o, cb) => {
    chamadas.push(args);
    if (args.includes('-filter_complex')) { fs.writeFileSync(args[args.length - 1].slice(5), 'x'); return cb(null, '', ''); }
    return cb(Object.assign(new Error('sem saída'), { code: 1 }), '', 'Duration: 00:00:06.00, start: 0\n  Stream #0:0: Video: h264, yuv420p, 640x360, 30 fps\n  Stream #0:1: Audio: aac, 48000 Hz');
  };
  const p = (n) => path.join(PROJ, n);
  for (const n of ['falso.mp4', 'falso.mp3', 'falso.png']) fs.writeFileSync(p(n), 'x');
  await ve.editar(p('falso.mp4'), { cortar: '1-4', musica: p('falso.mp3'), marca_dagua: p('falso.png'), textos: ['SEGREDO-NO-TEXTO'] }, { cwd: PROJ, ffmpeg: '/bin/ffmpeg-falso', execFileFn });
  const args = chamadas.find((a) => a.includes('-filter_complex'));
  args.forEach((a, i) => {
    if (a === '-i') {
      assert.deepEqual(args.slice(i - 2, i), ['-protocol_whitelist', 'file']);
      assert.match(args[i + 1], /^file:\//);
    }
  });
  assert.equal(args.filter((a) => a === '-i').length, 3);
  assert.ok(args.includes('-n'), 'nunca sobrescreve');
  assert.match(args[args.length - 1], /^file:.*falso-editado\.mp4$/);
  assert.ok(!args.join(' ').includes('SEGREDO-NO-TEXTO'));
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4), ['-ss', '1', '-t', '3']);
});

// ---------------------------------------------------------------------------
// Com o ffmpeg de verdade
// ---------------------------------------------------------------------------
test('editar de verdade: Reels com corte, velocidade, cor, textos, legenda, música, marca e fade — e no volume das redes', { skip: pular, timeout: 240000 }, async () => {
  const e = arquivos();
  const r = await ve.editar(e.clipe, {
    cortar: '0:01-0:05', velocidade: 1.25, formato: 'reels', cor: 'quente', melhorar: true, fade: 0.4,
    textos: [{ texto: "Promoção: 50% OFF %{pts} 'aspas' \\ fim", posicao: 'topo', tamanho: 'grande', fundo: true }, { texto: 'Siga para mais', inicio: 1, fim: 2.5 }],
    legenda: e.legenda, musica: e.musica, volume_musica: 0.3, marca_dagua: e.logo,
  }, { cwd: PROJ, saida: path.join(PROJ, 'reels.mp4') });
  const i = await ve.info(r.arquivo);
  assert.deepEqual([i.largura, i.altura], [1080, 1920]);
  perto(i.duracao, 3.2, 0.15, 'duração (4 s a 1,25x)');
  assert.equal(i.temAudio, true);
  const medida = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', r.arquivo, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const lufs = Number((/I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(medida.stderr) || [])[1]);
  perto(lufs, -14, 2, 'volume integrado (LUFS)');
  assert.match(ve.descreverResultado(r), /^1080x1920 — 0:03; cortado de 1 s a 5 s, velocidade 1,25x/);
  // nunca sobrescreve: a mesma saída vira -2
  const r2 = await ve.editar(e.clipe, { formato: 'quadrado' }, { cwd: PROJ, saida: path.join(PROJ, 'reels.mp4') });
  assert.match(r2.arquivo, /reels-2\.mp4$/);
});

test('editar de verdade: vídeo sem som ganha a música, na duração do vídeo', { skip: pular, timeout: 120000 }, async () => {
  const e = arquivos();
  const r = await ve.editar(e.mudo, { musica: e.musica, formato: 'feed', enquadrar: 'barras' }, { cwd: PROJ });
  const i = await ve.info(r.arquivo);
  assert.deepEqual([i.largura, i.altura], [1080, 1350]);
  assert.equal(i.temAudio, true);
  perto(i.duracao, 3, 0.2, 'a música (10 s) é cortada no fim do vídeo (3 s)');
});

test('juntar de verdade: tamanhos diferentes, um sem som, com transição suave', { skip: pular, timeout: 180000 }, async () => {
  const e = arquivos();
  const r = await ve.juntar([e.clipe, e.mudo, e.clipe], { transicao: 'suave', cwd: PROJ });
  const i = await ve.info(r.arquivo);
  assert.deepEqual([i.largura, i.altura], [640, 360], 'o tamanho do primeiro clipe');
  assert.equal(i.temAudio, true);
  perto(i.duracao, 6 + 3 + 6 - 2 * 0.6, 0.3, 'duração com as transições');
  const q = await ve.juntar([e.mudo, e.clipe], { formato: 'quadrado', cwd: PROJ });
  const iq = await ve.info(q.arquivo);
  assert.deepEqual([iq.largura, iq.altura], [1080, 1080]);
  perto(iq.duracao, 9, 0.3, 'sem transição: soma');
  await assert.rejects(() => ve.juntar([e.clipe], { cwd: PROJ }), /pelo menos 2/);
});

test('capa, áudio e info de verdade', { skip: pular, timeout: 120000 }, async () => {
  const e = arquivos();
  const c = await ve.capa(e.clipe, { cwd: PROJ });
  assert.equal(fs.readFileSync(c.arquivo).subarray(0, 3).toString('hex'), 'ffd8ff', 'é um JPEG');
  assert.match(c.arquivo, /clipe-capa\.jpg$/);
  await assert.rejects(() => ve.capa(e.clipe, { tempo: '0:30', cwd: PROJ }), /tem 6 s/);
  const a = await ve.extrairAudio(e.clipe, { cwd: PROJ });
  assert.match(a.arquivo, /clipe-audio\.mp3$/);
  assert.ok(fs.statSync(a.arquivo).size > 1000);
  await assert.rejects(() => ve.extrairAudio(e.mudo, { cwd: PROJ }), /não tem áudio/);
  const i = await ve.info(e.clipe);
  assert.deepEqual([i.largura, i.altura, i.temAudio], [640, 360, true]);
  perto(i.duracao, 6, 0.1, 'duração');
});

test('de verdade (v0.50.1): vídeo de celular gravado em pé (rotação no arquivo) sai em pé, sem distorcer', { skip: pular, timeout: 120000 }, async (t) => {
  const e = arquivos();
  const emPe = p('celular-em-pe.mp4');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-display_rotation', '90', '-i', e.clipe, '-c', 'copy', emPe], { encoding: 'utf8' });
  if (r.status !== 0) { t.skip(`este ffmpeg não tem -display_rotation: ${r.stderr.trim().slice(0, 120)}`); return; }
  const i = await ve.info(emPe);
  assert.deepEqual([i.largura, i.altura, i.rotacao], [360, 640, 90]);
  const o = await ve.info((await ve.editar(emPe, { textos: ['Em pé'] }, { cwd: PROJ })).arquivo);
  assert.deepEqual([o.largura, o.altura, o.rotacao], [360, 640, 0], 'girado de verdade, sem marca de rotação');
});

test('de verdade (v0.50.1): vídeo HDR (HLG, 10 bits) vira SDR BT.709 no editar, no juntar e na capa', { skip: pular, timeout: 240000 }, async (t) => {
  const e = arquivos();
  const enc = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout;
  if (!/\slibx265\s/.test(enc)) { t.skip('este ffmpeg não tem o libx265 para criar o vídeo HDR de teste'); return; }
  const hdr = p('hdr.mp4');
  lavfi(['-f', 'lavfi', '-i', 'testsrc2=duration=2:size=640x360:rate=30', '-vf', 'format=yuv420p10le', '-c:v', 'libx265', '-x265-params', 'log-level=error',
    '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc'], hdr);
  assert.equal((await ve.info(hdr)).hdr, 'hlg');
  const descrever = (f) => spawnSync(ffmpeg, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr.match(/Video: .*/)[0];
  const r = await ve.editar(hdr, { formato: 'quadrado' }, { cwd: PROJ });
  assert.match(r.passos.join(' '), /HDR \(HLG\) convertido/);
  assert.match(descrever(r.arquivo), /yuv420p\(tv, bt709/, 'saiu em 8 bits e marcado como BT.709');
  assert.equal((await ve.info(r.arquivo)).hdr, null);
  const j = await ve.juntar([hdr, e.clipe], { cwd: PROJ });
  assert.match(j.passos.join(' '), /clipes HDR convertidos/);
  assert.match(descrever(j.arquivo), /bt709/);
  assert.equal((await ve.capa(hdr, { cwd: PROJ })).hdrConvertido, true);
});

test('de verdade (v0.50.1): pasta temporária e arquivos com aspas, dois-pontos, vírgula e colchetes no caminho', { skip: pular || (process.platform === 'win32' && 'caminhos com dois-pontos não existem no Windows'), timeout: 120000 }, async () => {
  const e = arquivos();
  const estranha = p("tmp it's: a, [b]; c=d % ação");
  const pasta = p("Minhas fotos (1) – cópia, it's [x]");
  fs.mkdirSync(estranha, { recursive: true });
  fs.mkdirSync(pasta, { recursive: true });
  fs.copyFileSync(e.clipe, path.join(pasta, 'viagem: dia 1.mp4'));
  fs.writeFileSync(path.join(pasta, 'falas [pt].srt'), "1\n00:00:00,500 --> 00:00:02,000\nCom: vírgula, [colchete] e 'aspas'\n");
  const antes = process.env.TMPDIR;
  process.env.TMPDIR = estranha; // os arquivos de texto e de legenda vão para cá: o caminho entra no filtro (escaparValor)
  try {
    const r = await ve.editar(path.join(pasta, 'viagem: dia 1.mp4'), { textos: ['Texto: com, tudo [junto]; e % e \\ fim'], legenda: path.join(pasta, 'falas [pt].srt'), formato: 'quadrado' }, { cwd: pasta });
    assert.match(r.arquivo, /viagem: dia 1-editado\.mp4$/);
    assert.deepEqual([(await ve.info(r.arquivo)).largura], [1080]);
  } finally { if (antes === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = antes; }
  assert.deepEqual(fs.readdirSync(estranha), [], 'a pasta temporária ficou limpa');
});

test('ferramenta "video": editar, info e ação desconhecida', { skip: pular, timeout: 120000 }, async () => {
  const e = arquivos();
  const antes = process.cwd();
  process.chdir(PROJ);
  try {
    const r = await midia.execute('video', { acao: 'editar', arquivo: 'clipe.mp4', formato: 'quadrado', cor: 'pb', textos: [{ texto: 'Oi' }] });
    assert.match(r, /^Vídeo editado: clipe-editado(-\d+)?\.mp4 \(1080x1080 — 0:06; cor "pb", formato quadrado/);
    assert.match(await midia.execute('video', { acao: 'info', arquivo: e.clipe }), /0:06, 640x360, 30 fps, com áudio/);
    assert.match(await midia.execute('video', { acao: 'girar' }), /precisa de "acao": editar, juntar, capa, audio, info/);
    assert.match(await midia.execute('video', { acao: 'editar', arquivo: 'clipe.mp4', cor: 'azul' }), /^Erro: cor desconhecida/);
  } finally { process.chdir(antes); }
});

test('comando do terminal: opção errada é recusada; info mostra o resumo', { skip: pular, timeout: 120000 }, () => {
  const e = arquivos();
  const env = { ...process.env, HOME, USERPROFILE: HOME };
  const errado = spawnSync(process.execPath, [CLI, 'video', 'editar', e.clipe, '--formatoo', 'reels'], { encoding: 'utf8', env, cwd: PROJ });
  assert.equal(errado.status, 1);
  assert.match(errado.stderr, /opção desconhecida: --formatoo/);
  const info = spawnSync(process.execPath, [CLI, 'video', 'info', e.clipe], { encoding: 'utf8', env, cwd: PROJ });
  assert.equal(info.status, 0, info.stderr);
  assert.match(info.stdout, /duração 0:06 · 640x360 · 30 fps · com áudio/);
});
