// src/video.js (v0.46.0) — criar e melhorar vídeos
//   gerar      descrição -> vídeo com IA (Veo, src/tools/mediaTools.js; exige acesso liberado na conta)
//   melhorar   vídeo -> menos ruído, mais nitidez e cor (e, se pedir, estabilizado) — ffmpeg, local, sem custo
//   slideshow  fotos (+ música opcional) -> vídeo 1280x720 — ffmpeg, local
// Entradas com prefixo "file:" e -protocol_whitelist file: o ffmpeg não sai buscando endereço de rede escondido
// num arquivo (ex.: uma playlist HLS disfarçada de .mp4). Saída sempre num arquivo novo (-n: nunca sobrescreve).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const VIDEOS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.3gp', '.m4v']);
const FOTOS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const AUDIOS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus']);
const MAX_FOTOS = 300;
const TIMEOUT_MS = 30 * 60 * 1000; // vídeo longo no celular demora

function acharFfmpeg({ env = process.env } = {}) {
  for (const dir of String(env.PATH || '').split(path.delimiter).filter((d) => path.isAbsolute(d))) {
    const p = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* segue */ }
  }
  return null;
}

const SEM_FFMPEG = 'precisa do ffmpeg (Termux: pkg install ffmpeg; Debian/Ubuntu: sudo apt install ffmpeg; macOS: brew install ffmpeg).';

function conferirEntrada(arquivo, tipos, rotulo) {
  const { isSecret } = require('./tools/protectedPaths');
  const abs = path.resolve(String(arquivo || ''));
  if (!arquivo) throw new Error(`informe ${rotulo}.`);
  if (!tipos.has(path.extname(abs).toLowerCase())) throw new Error(`${rotulo}: formato não suportado (${path.extname(abs) || 'sem extensão'}); use ${[...tipos].join(', ')}.`);
  if (isSecret(abs)) throw new Error(`${rotulo}: esse arquivo é protegido do gemini-code.`);
  let st;
  try { st = fs.statSync(abs); } catch { throw new Error(`${rotulo}: não encontrei ${arquivo}.`); }
  if (!st.isFile() || st.size === 0) throw new Error(`${rotulo}: ${arquivo} não é um arquivo válido.`);
  return abs;
}

/** Caminho NOVO para a saída (nunca sobrescreve: -2, -3...), fora das áreas protegidas. v0.50.0: `ext` (.mp3, .m4a). */
function destinoVideo({ saida, base, sufixo, cwd = process.cwd(), ext = '.mp4' }) {
  const { isProtected, isSecret } = require('./tools/protectedPaths');
  let alvo = saida ? path.resolve(cwd, String(saida)) : `${base.replace(/\.[^./]+$/, '')}${sufixo}${ext}`;
  if (path.extname(alvo).toLowerCase() !== ext) alvo += ext;
  const raiz = alvo.slice(0, -ext.length);
  for (let i = 2; fs.existsSync(alvo); i++) alvo = `${raiz}-${i}${ext}`;
  if (isProtected(alvo) || isSecret(alvo) || isProtected(path.dirname(alvo))) throw new Error('esse caminho é protegido do gemini-code; escolha outro lugar.');
  return alvo;
}

function rodar(ffmpeg, args, { timeoutMs = TIMEOUT_MS, execFileFn = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileFn(ffmpeg, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const fim = String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 400);
        return reject(new Error(`o ffmpeg falhou: ${fim}`));
      }
      resolve();
    });
  });
}

const entrada = (abs) => ['-protocol_whitelist', 'file', '-i', `file:${abs}`];

/** Filtros do "melhorar": menos ruído, nitidez, um pouco de contraste/cor; estabilizar é opcional (deshake). */
function filtrosMelhorar({ estabilizar = false } = {}) {
  return [...(estabilizar ? ['deshake'] : []), 'hqdn3d=1.5:1.5:6:6', 'unsharp=5:5:0.6:5:5:0.0', 'eq=contrast=1.04:saturation=1.08'].join(',');
}

async function melhorar(arquivo, { saida, estabilizar = false, cwd, ffmpeg = acharFfmpeg(), execFileFn } = {}) {
  if (!ffmpeg) throw new Error(`melhorar vídeo ${SEM_FFMPEG}`);
  const abs = conferirEntrada(path.resolve(cwd || process.cwd(), String(arquivo || '')), VIDEOS, 'o vídeo');
  const destino = destinoVideo({ saida, base: abs, sufixo: '-melhorado', cwd });
  await rodar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', ...entrada(abs), '-vf', filtrosMelhorar({ estabilizar }),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', `file:${destino}`], { execFileFn });
  return { arquivo: destino };
}

/** Lista do concat do ffmpeg: aspas simples escapadas ('\'') — um nome com aspas não quebra a lista. */
function listaConcat(fotos, segundos) {
  const linha = (f) => `file '${f.replace(/'/g, "'\\''")}'`;
  const corpo = fotos.map((f) => `${linha(f)}\nduration ${segundos}`).join('\n');
  return `${corpo}\n${linha(fotos[fotos.length - 1])}\n`; // a última repetida: senão o concat ignora a duração dela
}

async function slideshow(fotos, { segundos = 3, musica, saida, cwd = process.cwd(), ffmpeg = acharFfmpeg(), execFileFn } = {}) {
  if (!ffmpeg) throw new Error(`fazer vídeo de fotos ${SEM_FFMPEG}`);
  const lista = (Array.isArray(fotos) ? fotos : []).map((f, i) => conferirEntrada(path.resolve(cwd, String(f)), FOTOS, `a foto ${i + 1}`));
  if (!lista.length) throw new Error('informe as fotos.');
  if (lista.length > MAX_FOTOS) throw new Error(`no máximo ${MAX_FOTOS} fotos por vídeo.`);
  const seg = Math.min(30, Math.max(0.5, Number(segundos) || 3));
  const audio = musica ? conferirEntrada(path.resolve(cwd, String(musica)), AUDIOS, 'a música') : null;
  const destino = destinoVideo({ saida: saida || 'slideshow.mp4', cwd });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-slideshow-'));
  try {
    const arqLista = path.join(tmp, 'lista.txt');
    fs.writeFileSync(arqLista, listaConcat(lista, seg));
    const escala = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p';
    await rodar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n',
      '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '0', '-i', `file:${arqLista}`,
      ...(audio ? entrada(audio) : []),
      '-vf', escala, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      ...(audio ? ['-c:a', 'aac', '-b:a', '160k', '-shortest'] : []),
      `file:${destino}`], { execFileFn });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { arquivo: destino, fotos: lista.length, segundos: seg };
}

/** Vídeo com IA (Veo). Exige o modelo liberado na conta; pode ter custo. */
async function gerar(prompt, { pasta = 'videos', cwd = process.cwd(), makeVideo = (p, d) => require('./tools/mediaTools').makeVideo(p, d) } = {}) {
  const p = String(prompt || '').trim();
  if (!p) throw new Error('descreva o vídeo que você quer.');
  const dir = path.resolve(cwd, pasta);
  const r = await makeVideo(p, dir);
  return { arquivo: r.outPath };
}

module.exports = {
  VIDEOS, FOTOS, AUDIOS, SEM_FFMPEG, acharFfmpeg, filtrosMelhorar, listaConcat, melhorar, slideshow, gerar, destinoVideo,
  conferirEntrada, rodar, entrada,
};
