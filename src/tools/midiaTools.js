// src/tools/midiaTools.js (v0.46.0) — ferramentas "camera" e "video" do agente (src/camera.js, src/video.js)
// Sob demanda (src/tools/index.js): entram num aliado com o preset "midia" ou com ferramentasExtras.
// camera: pergunta SEMPRE antes de tirar a foto (privacidade), mesmo com confirmações desligadas; numa rotina, recusa.
// video: gerar com IA pergunta (cota, confirmarMidia); o resto é local (ffmpeg) e só pergunta se a saída ficar fora
// da pasta do projeto, como o write_file. v0.50.0: editar como um editor profissional (src/videoEdicao.js): cortar,
// formato de cada rede, cor, textos, legenda, música com a voz por cima, volume das redes, marca d'água; juntar
// clipes; capa; áudio; info.
'use strict';

const path = require('path');

let deps = {
  ask: (q) => require('../ui/prompt').ask(q),
  loadConfig: () => require('../config').loadConfig(),
  camera: () => require('../camera'),
  video: () => require('../video'),
  videoEdicao: () => require('../videoEdicao'),
};

const ACOES_VIDEO = ['editar', 'juntar', 'capa', 'audio', 'info', 'melhorar', 'slideshow', 'gerar'];

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
      'Edita vídeos como um editor profissional, no aparelho (ffmpeg, sem IA, sem custo). "editar": numa passada só — ' +
      'cortar, velocidade, estabilizar, melhorar, cor pronta, formato de cada rede (reels 9:16 com fundo desfocado, feed ' +
      '4:5, quadrado, youtube 16:9), legenda .srt queimada, textos na tela, fade, marca d\'água, música de fundo que abaixa ' +
      'quando alguém fala e o áudio no volume das redes. "juntar": vários clipes num só (transição suave opcional). ' +
      '"capa": a imagem para a capa do post. "audio": só o som em .mp3. "info": duração e tamanho. Também "melhorar", ' +
      '"slideshow" (fotos + música) e "gerar" (com IA, Veo; só se a conta tiver acesso). Nunca sobrescreve: cria um ' +
      'arquivo novo. Tempos: segundos (75) ou mm:ss (1:15).',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ACOES_VIDEO },
        arquivo: { type: 'string', description: 'editar/capa/audio/info/melhorar: o vídeo' },
        arquivos: { type: 'array', items: { type: 'string' }, description: 'juntar: os vídeos, na ordem' },
        cortar: { type: 'string', description: 'editar: trecho a manter, INICIO-FIM (ex.: "0:05-0:35")' },
        formato: { type: 'string', enum: ['reels', 'feed', 'quadrado', 'youtube', 'original'], description: 'editar/juntar: reels = Reels/TikTok/Shorts/Stories (9:16)' },
        enquadrar: { type: 'string', enum: ['fundo-desfocado', 'preencher', 'barras'], description: 'como caber no formato (padrão: fundo-desfocado; juntar: barras)' },
        cor: { type: 'string', enum: ['natural', 'vivo', 'quente', 'frio', 'cinema', 'pb', 'vintage', 'dramatico', 'nenhuma'] },
        brilho: { type: 'number', description: 'editar: -1 a 1 (0 = igual)' },
        contraste: { type: 'number', description: 'editar: 0 a 3 (1 = igual)' },
        saturacao: { type: 'number', description: 'editar: 0 a 3 (1 = igual; 0 = preto e branco)' },
        velocidade: { type: 'number', description: 'editar: 0.25 a 4 (2 = duas vezes mais rápido)' },
        estabilizar: { type: 'boolean', description: 'editar/melhorar: tira a tremedeira' },
        melhorar: { type: 'boolean', description: 'editar: menos ruído e mais nitidez' },
        fade: { type: 'number', description: 'editar: segundos de fade no começo e no fim' },
        normalizar: { type: 'boolean', description: 'editar/juntar: áudio no volume das redes, -14 LUFS (padrão: true)' },
        qualidade: { type: 'string', enum: ['alta', 'normal', 'leve'], description: 'leve: menor, para WhatsApp (até 720p)' },
        textos: {
          type: 'array',
          description: 'editar: textos na tela (tempos do vídeo FINAL)',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string' },
              inicio: { type: 'number', description: 'segundo em que aparece (padrão: o vídeo todo)' },
              fim: { type: 'number', description: 'segundo em que some' },
              posicao: { type: 'string', enum: ['topo', 'centro', 'baixo'] },
              tamanho: { type: 'string', enum: ['pequeno', 'medio', 'grande'] },
              fundo: { type: 'boolean', description: 'faixa escura atrás do texto' },
            },
            required: ['texto'],
          },
        },
        legenda: { type: 'string', description: 'editar: arquivo .srt/.vtt/.ass com os tempos do vídeo ORIGINAL (o corte e a velocidade são aplicados nela)' },
        musica: { type: 'string', description: 'editar/slideshow: arquivo de áudio' },
        volume_musica: { type: 'number', description: 'editar: 0.02 a 1 (padrão 0.25)' },
        abaixar_musica: { type: 'boolean', description: 'editar: a música abaixa quando alguém fala (padrão: true)' },
        marca_dagua: { type: 'string', description: 'editar: logo (.png)' },
        posicao_marca: { type: 'string', enum: ['canto-inferior-direito', 'canto-inferior-esquerdo', 'canto-superior-direito', 'canto-superior-esquerdo', 'centro'] },
        transicao: { type: 'string', enum: ['nenhuma', 'suave'], description: 'juntar: suave = fade entre os clipes' },
        tempo: { type: 'string', description: 'capa: o instante (ex.: "0:12"); sem ele, escolhe a melhor imagem do começo' },
        fotos: { type: 'array', items: { type: 'string' }, description: 'slideshow: as fotos, na ordem' },
        segundos: { type: 'number', description: 'slideshow: segundos por foto (padrão 3)' },
        prompt: { type: 'string', description: 'gerar: o que mostrar no vídeo' },
        saida: { type: 'string', description: 'arquivo novo (opcional): .mp4; capa .jpg; audio .mp3 ou .m4a' },
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
  if (!ACOES_VIDEO.includes(acao)) return `Erro: video precisa de "acao": ${ACOES_VIDEO.join(', ')}.`;
  if (a.saida !== undefined && a.saida !== null && (typeof a.saida !== 'string' || !a.saida.trim())) return 'Erro: "saida" precisa ser o caminho de um arquivo novo.';
  // v0.46.1: as entradas passam pela mesma trava de convidado (cowork) da ferramenta "imagem"
  const entradas = [a.arquivo, ...(Array.isArray(a.fotos) ? a.fotos : []), ...(Array.isArray(a.arquivos) ? a.arquivos : []), a.musica, a.legenda, a.marca_dagua]
    .filter((e) => typeof e === 'string' && e);
  for (const e of entradas) {
    const fora = foraDoProjetoParaConvidado(e);
    if (fora) return fora;
  }
  const rel = (f) => path.relative(process.cwd(), f) || f;
  if (acao === 'info') {
    const i = await deps.videoEdicao().info(a.arquivo);
    if (!i.largura) return `Erro: não achei imagem em ${a.arquivo} (é só áudio?).`;
    const dur = i.duracao ? `${Math.floor(i.duracao / 60)}:${String(Math.round(i.duracao % 60)).padStart(2, '0')}` : 'duração desconhecida';
    return `${rel(i.arquivo)}: ${dur}, ${i.largura}x${i.altura}${i.fps ? `, ${i.fps} fps` : ''}, ${i.temAudio ? 'com áudio' : 'sem áudio'}${i.rotacao ? `, gravado girado ${i.rotacao}°` : ''}.`;
  }
  const base = acao === 'juntar' ? path.join(process.cwd(), 'juntado.mp4') : (typeof a.arquivo === 'string' && a.arquivo ? a.arquivo : path.join(process.cwd(), 'video.mp4'));
  const recusa = await confirmarForaDaArea([path.resolve(a.saida || base)]);
  if (recusa) return recusa;
  const ve = deps.videoEdicao();
  if (acao === 'editar') {
    const r = await ve.editar(a.arquivo, a, { saida: a.saida });
    return `Vídeo editado: ${rel(r.arquivo)} (${ve.descreverResultado(r)})`;
  }
  if (acao === 'juntar') {
    const r = await ve.juntar(a.arquivos, { transicao: a.transicao || 'nenhuma', formato: a.formato, enquadrar: a.enquadrar || 'barras', normalizar: a.normalizar !== false, qualidade: a.qualidade || 'normal', saida: a.saida });
    return `Vídeos juntados: ${rel(r.arquivo)} (${r.clipes} clipes, ${ve.descreverResultado(r)}${r.transicao === 'suave' ? ', com transição suave' : ''})`;
  }
  if (acao === 'capa') {
    const r = await ve.capa(a.arquivo, { tempo: a.tempo, saida: a.saida });
    return `Capa salva: ${rel(r.arquivo)} (imagem de ${String(r.tempo).replace('.', ',')} s)`;
  }
  if (acao === 'audio') {
    const r = await ve.extrairAudio(a.arquivo, { saida: a.saida });
    return `Áudio salvo: ${rel(r.arquivo)}`;
  }
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
