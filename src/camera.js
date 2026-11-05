// src/camera.js (v0.46.0) — câmera do celular (Termux:API) ou webcam do PC (ffmpeg/fswebcam)
//   foto      tira uma foto e salva (arquivo novo)
//   analisar  foto + pergunta ao modelo que enxerga imagem (src/imagem.js descrever)
//   vigiar    câmera de segurança: uma foto a cada N segundos; quando muda mais que a sensibilidade, guarda a foto
//             e avisa por notificação. A comparação é local, pelo ImageMagick (sem IA, sem custo, sem internet).
// Tudo por argumento (execFile). O agente só usa a câmera pela ferramenta "camera", que pergunta SEMPRE antes.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function rodar(arquivo, args, { timeoutMs = 60000, execFileFn = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileFn(arquivo, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error(String(stderr || err.message).trim().slice(0, 300) || err.message), { code: err.code, saida: String(stdout || ''), erroTexto: String(stderr || '') }));
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function existeNoPath(nome, env = process.env) {
  return String(env.PATH || '').split(path.delimiter).filter((d) => path.isAbsolute(d)).some((d) => {
    try { fs.accessSync(path.join(d, nome), fs.constants.X_OK); return true; } catch { return false; }
  });
}

/** Como tirar foto aqui: { cmd, args(saida), nome } ou null. */
function comoFotografar({ plataforma = process.platform, camera = 0, temComando = existeNoPath, dispositivo, existe = fs.existsSync } = {}) {
  const id = Number.isInteger(Number(camera)) ? String(Number(camera)) : '0';
  if (plataforma === 'android' || temComando('termux-camera-photo')) {
    return { nome: 'Termux:API', cmd: 'termux-camera-photo', args: (saida) => ['-c', id, saida] };
  }
  if (plataforma === 'linux') {
    const dev = dispositivo || `/dev/video${id}`;
    if (!existe(dev)) return null; // sem webcam: a mensagem clara, e não o erro do ffmpeg

    if (temComando('ffmpeg')) return { nome: 'ffmpeg', cmd: 'ffmpeg', args: (saida) => ['-hide_banner', '-loglevel', 'error', '-f', 'v4l2', '-i', dev, '-frames:v', '1', '-n', saida] };
    if (temComando('fswebcam')) return { nome: 'fswebcam', cmd: 'fswebcam', args: (saida) => ['-d', dev, '--no-banner', '-r', '1280x720', saida] };
  }
  if (plataforma === 'darwin' && temComando('imagesnap')) return { nome: 'imagesnap', cmd: 'imagesnap', args: (saida) => ['-q', saida] };
  return null;
}

const DICA_SEM_CAMERA = 'Nenhuma câmera disponível. No celular: instale o app Termux:API e rode "pkg install termux-api". ' +
  'No Linux: ffmpeg (ou fswebcam) e uma webcam em /dev/video0. No macOS: brew install imagesnap.';

async function foto({ saida, camera = 0, cwd = process.cwd(), plataforma, temComando, execFileFn } = {}) {
  const como = comoFotografar({ plataforma, camera, temComando });
  if (!como) throw new Error(DICA_SEM_CAMERA);
  const { destinoNovo } = require('./imagem');
  const destino = destinoNovo({ saida, base: path.join(cwd, `foto-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jpg`), sufixo: '', ext: '.jpg', cwd });
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    await rodar(como.cmd, como.args(destino), { execFileFn });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(DICA_SEM_CAMERA, { cause: e });
    throw new Error(`a câmera (${como.nome}) falhou: ${e.message}`, { cause: e });
  }
  if (!fs.existsSync(destino) || fs.statSync(destino).size === 0) {
    throw new Error(`a câmera (${como.nome}) não gravou a foto. No celular, confira se o Termux:API tem permissão de câmera.`);
  }
  return destino;
}

async function analisar(pergunta, { camera, cwd, manterFoto = false, descrever = (a, p) => require('./imagem').descrever(a, p), ...resto } = {}) {
  const dir = manterFoto ? (cwd || process.cwd()) : fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-camera-'));
  const arquivo = await foto({ camera, cwd: dir, ...resto });
  try {
    return { arquivo: manterFoto ? arquivo : null, resposta: await descrever(arquivo, pergunta || 'O que aparece nesta foto?') };
  } finally {
    if (!manterFoto) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Fração (0 a 1) da imagem que mudou entre duas fotos: as duas viram miniaturas cinzas de 160x120 e o
 * ImageMagick conta os pixels diferentes (com tolerância, para luz e ruído da câmera não contarem).
 */
async function diferenca(a, b, { magick = require('./imagem').acharMagick(), tolerancia = 15 } = {}) {
  if (!magick) throw new Error('o modo vigia precisa do ImageMagick para comparar as fotos (Termux: pkg install imagemagick).');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-vigia-'));
  try {
    const mini = async (orig, nome) => {
      const destino = path.join(tmp, nome);
      const coder = require('./imagem').CODER[path.extname(orig).toLowerCase()] || 'jpeg';
      await rodar(magick, [`${coder}:${orig}`, '-auto-orient', '-resize', '160x120!', '-colorspace', 'Gray', '-blur', '0x1', `png:${destino}`]);
      return destino;
    };
    const [ma, mb] = [await mini(a, 'a.png'), await mini(b, 'b.png')];
    const compare = magick.endsWith('magick') ? [magick, ['compare']] : [path.join(path.dirname(magick), 'compare'), []];
    let texto;
    try {
      texto = (await rodar(compare[0], [...compare[1], '-metric', 'AE', '-fuzz', `${tolerancia}%`, ma, mb, 'null:'])).stderr;
    } catch (e) {
      // compare sai com código 1 quando as imagens são diferentes — o número vem no stderr do mesmo jeito
      if (e.code !== 1) throw e;
      texto = e.erroTexto;
    }
    const n = Number(String(texto).trim().split(/\s+/)[0]);
    if (!Number.isFinite(n)) throw new Error(`não consegui comparar as fotos (${String(texto).trim().slice(0, 120)})`);
    return Math.min(1, n / (160 * 120));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Vigia: fotografa a cada `intervaloS` segundos; mudança acima de `sensibilidade` (% da imagem) guarda a foto em
 * `pasta` e chama `aoDetectar`. Para com `deveParar()` (Ctrl+C no terminal) ou depois de `maxFotos`.
 */
/** v0.46.1: intervalo (s) e sensibilidade (%) que o vigia usa de verdade — a mesma conta para a mensagem e o laço. */
function parametrosVigia({ intervaloS, sensibilidade } = {}) {
  const i = Number(intervaloS);
  const s = Number(sensibilidade);
  return {
    intervalo: Number.isFinite(i) && i > 0 ? Math.max(5, i) : 30,
    sensibilidadePct: Number.isFinite(s) && s > 0 ? Math.min(100, Math.max(0.5, s)) : 5,
  };
}

async function vigiar({
  intervaloS = 30, sensibilidade = 5, pasta = 'vigia', camera = 0, cwd = process.cwd(), maxFotos = Infinity,
  aoDetectar = async () => {}, log = () => {}, deveParar = () => false, dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  fotoFn = foto, diferencaFn = diferenca,
} = {}) {
  const { intervalo, sensibilidadePct } = parametrosVigia({ intervaloS, sensibilidade });
  const limite = sensibilidadePct / 100;
  const dirVigia = path.resolve(cwd, pasta);
  const trabalho = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-vigia-fotos-'));
  let anterior = null;
  let fotos = 0;
  let deteccoes = 0;
  try {
    while (!deveParar() && fotos < maxFotos) {
      const atual = await fotoFn({ camera, cwd: trabalho, saida: path.join(trabalho, `f${fotos % 2}.jpg`) });
      fotos++;
      if (anterior) {
        const mudou = await diferencaFn(anterior, atual);
        log(`foto ${fotos}: ${(mudou * 100).toFixed(1)}% diferente`);
        if (mudou >= limite) {
          deteccoes++;
          fs.mkdirSync(dirVigia, { recursive: true }); // só quando há o que guardar (sem câmera, nada de pasta vazia)
          const guardada = path.join(dirVigia, `movimento-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jpg`);
          fs.copyFileSync(atual, guardada);
          await aoDetectar({ arquivo: guardada, mudou });
        }
        fs.rmSync(anterior, { force: true });
      }
      // a próxima foto vai para o outro nome (f0/f1): a "anterior" é sempre a última tirada
      const proxima = path.join(trabalho, `ultima-${fotos}.jpg`);
      fs.renameSync(atual, proxima);
      anterior = proxima;
      if (!deveParar() && fotos < maxFotos) await dormir(intervalo * 1000);
    }
  } finally {
    fs.rmSync(trabalho, { recursive: true, force: true });
  }
  return { fotos, deteccoes, pasta: dirVigia };
}

module.exports = { comoFotografar, foto, analisar, diferenca, vigiar, parametrosVigia, DICA_SEM_CAMERA };
