// src/tools/midiaTools.js (v0.46.0) — ferramentas "camera" e "video" do agente (src/camera.js, src/video.js)
// Sob demanda (src/tools/index.js): entram num aliado com o preset "midia" ou com ferramentasExtras.
// camera: pergunta SEMPRE antes de tirar a foto (privacidade), mesmo com confirmações desligadas; numa rotina, recusa.
// video: gerar com IA pergunta (cota, confirmarMidia); melhorar/slideshow são locais (ffmpeg) e só perguntam se a
// saída ficar fora da pasta do projeto, como o write_file.
'use strict';

const path = require('path');

let deps = {
  ask: (q) => require('../ui/prompt').ask(q),
  loadConfig: () => require('../config').loadConfig(),
  camera: () => require('../camera'),
  video: () => require('../video'),
};

const declarations = [
  {
    name: 'camera',
    description:
      'Tira uma foto com a câmera do celular (Termux:API) ou a webcam do PC e responde a pergunta sobre ela (ex.: "o ' +
      'que tem na geladeira?", "leia o rótulo"). O usuário confirma toda vez. A foto só fica salva com guardar=true.',
    parameters: {
      type: 'object',
      properties: {
        pergunta: { type: 'string', description: 'O que olhar na foto' },
        camera: { type: 'integer', description: '0 = traseira (padrão), 1 = frontal' },
        guardar: { type: 'boolean', description: 'true para manter a foto na pasta atual' },
      },
    },
  },
  {
    name: 'video',
    description:
      'Vídeos: "melhorar" (menos ruído, mais nitidez e cor; estabilizar opcional — local, ffmpeg), "slideshow" (fotos + ' +
      'música opcional -> vídeo 1280x720 — local) e "gerar" (descrição -> vídeo com IA, Veo; só se a conta tiver acesso). ' +
      'Nunca sobrescreve: cria um arquivo novo.',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['melhorar', 'slideshow', 'gerar'] },
        arquivo: { type: 'string', description: 'melhorar: o vídeo' },
        fotos: { type: 'array', items: { type: 'string' }, description: 'slideshow: as fotos, na ordem' },
        segundos: { type: 'number', description: 'slideshow: segundos por foto (padrão 3)' },
        musica: { type: 'string', description: 'slideshow: arquivo de áudio (opcional)' },
        estabilizar: { type: 'boolean', description: 'melhorar: tira a tremedeira' },
        prompt: { type: 'string', description: 'gerar: o que mostrar no vídeo' },
        saida: { type: 'string', description: 'arquivo .mp4 novo (opcional)' },
      },
      required: ['acao'],
    },
  },
];

const sim = (r) => ['s', 'y', 'sim'].includes(String(r || '').trim().toLowerCase());

async function executeCamera(a) {
  const { paraExibir } = require('../ui/textoSeguro');
  const qual = Number(a.camera) === 1 ? 'frontal' : 'traseira';
  const pergunta = typeof a.pergunta === 'string' && a.pergunta.trim() ? a.pergunta.trim().slice(0, 1000) : 'O que aparece nesta foto?';
  const resp = await deps.ask(`\n[gemini-code] O agente quer tirar uma foto com a câmera ${qual}${a.guardar ? ' e guardar' : ''}` +
    ` para responder: "${paraExibir(pergunta)}". Permitir? (s/n) `);
  if (!sim(resp)) return 'O usuário não autorizou usar a câmera.';
  const r = await deps.camera().analisar(pergunta, { camera: Number(a.camera) === 1 ? 1 : 0, manterFoto: a.guardar === true });
  return `${r.arquivo ? `[foto guardada em ${path.relative(process.cwd(), r.arquivo) || r.arquivo}]\n` : ''}${r.resposta}`;
}

async function executeVideo(a) {
  const { paraExibir } = require('../ui/textoSeguro');
  const { confirmarForaDaArea, foraDoProjetoParaConvidado } = require('./protectedPaths');
  const v = deps.video();
  const acao = String(a.acao || '');
  if (!['melhorar', 'slideshow', 'gerar'].includes(acao)) return 'Erro: video precisa de "acao": melhorar, slideshow ou gerar.';
  if (a.saida !== undefined && a.saida !== null && (typeof a.saida !== 'string' || !a.saida.trim())) return 'Erro: "saida" precisa ser o caminho de um arquivo .mp4.';
  // v0.46.1: as entradas passam pela mesma trava de convidado (cowork) da ferramenta "imagem"
  const entradas = [a.arquivo, ...(Array.isArray(a.fotos) ? a.fotos : []), a.musica].filter((e) => typeof e === 'string' && e);
  for (const e of entradas) {
    const fora = foraDoProjetoParaConvidado(e);
    if (fora) return fora;
  }
  const previsto = path.resolve(a.saida || (acao === 'melhorar' && typeof a.arquivo === 'string' ? a.arquivo : path.join(process.cwd(), 'video.mp4')));
  const recusa = await confirmarForaDaArea([previsto]);
  if (recusa) return recusa;
  if (acao === 'gerar') {
    if (typeof a.prompt !== 'string' || !a.prompt.trim()) return 'Erro: "gerar" precisa de "prompt".';
    let cfg = {};
    try { cfg = deps.loadConfig() || {}; } catch { /* pergunta */ }
    if (cfg.confirmarMidia !== false && !sim(await deps.ask(`\n[gemini-code] Gerar um vídeo com IA (Veo; usa a cota da sua chave e pode demorar minutos): "${paraExibir(a.prompt.slice(0, 300))}"? (s/n) `))) {
      return 'Cancelado pelo usuário.';
    }
    const r = await v.gerar(a.prompt);
    return `Vídeo criado com IA: ${r.arquivo}`;
  }
  if (acao === 'melhorar') {
    const r = await v.melhorar(a.arquivo, { saida: a.saida, estabilizar: a.estabilizar === true });
    return `Vídeo melhorado: ${path.relative(process.cwd(), r.arquivo) || r.arquivo}`;
  }
  const r = await v.slideshow(a.fotos, { segundos: a.segundos, musica: a.musica, saida: a.saida });
  return `Slideshow criado: ${path.relative(process.cwd(), r.arquivo) || r.arquivo} (${r.fotos} fotos, ${String(r.segundos).replace('.', ',')} s cada)`;
}

async function execute(name, args = {}) {
  const a = args && typeof args === 'object' ? args : {};
  try {
    if (name === 'camera') return await executeCamera(a);
    if (name === 'video') return await executeVideo(a);
  } catch (e) {
    return `Erro: ${e.message}`;
  }
  throw new Error(`Ferramenta de mídia desconhecida: ${name}`);
}

function _testar(novas = {}) { deps = { ...deps, ...novas }; }

module.exports = { declarations, execute, _testar };
