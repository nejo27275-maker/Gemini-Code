// src/tools/imagemTools.js (v0.46.0) — a ferramenta "imagem" do agente (src/imagem.js)
// gerar/editar/melhorar com IA gastam a cota da chave do usuário: perguntam antes (confirmarMidia, ligado por
// padrão). melhorar sem IA (ImageMagick) e descrever não perguntam. A saída é sempre um arquivo novo; fora da pasta
// do projeto, pergunta como o write_file.
'use strict';

const path = require('path');

let deps = {
  ask: (q) => require('../ui/prompt').ask(q),
  loadConfig: () => require('../config').loadConfig(),
  imagem: () => require('../imagem'),
  imagemEdicao: () => require('../imagemEdicao'),
};

const ACOES = ['ajustar', 'gerar', 'editar', 'melhorar', 'descrever'];

const declarations = [
  {
    name: 'imagem',
    description:
      'Imagens: "ajustar" (edição profissional SEM IA, no aparelho, pelo ImageMagick: formato de cada rede — feed 4:5, ' +
      'quadrado, stories 9:16, capa do YouTube — com fundo desfocado; cor pronta; brilho, contraste, saturação, ' +
      'nitidez; textos; marca d\'água; tamanho leve para WhatsApp; tira a localização (EXIF) por padrão; uma foto ou ' +
      'várias de uma vez), "gerar" (descrição -> imagem nova, com IA), "editar" (foto + instrução livre -> foto nova, ' +
      'com IA, ex.: "tire o fundo"), "melhorar" (mais nítida/clara: sem IA quando houver ImageMagick, ou com IA) e ' +
      '"descrever" (responde uma pergunta sobre uma imagem do disco). Formatos: png, jpg, webp, gif. Nunca ' +
      'sobrescreve: cria um arquivo novo e diz o caminho.',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ACOES },
        prompt: { type: 'string', description: 'gerar: o que desenhar; editar: o que mudar; descrever: a pergunta' },
        arquivo: { type: 'string', description: 'ajustar/editar/melhorar/descrever: caminho da imagem' },
        fotos: { type: 'array', items: { type: 'string' }, description: 'ajustar: várias fotos com a mesma receita (lote)' },
        formato: { type: 'string', enum: ['feed', 'quadrado', 'stories', 'youtube', 'original'], description: 'ajustar e gerar: feed = Instagram 4:5; stories = 9:16; youtube = capa 16:9; quadrado = 1:1' },
        enquadrar: { type: 'string', enum: ['fundo-desfocado', 'preencher', 'barras'], description: 'ajustar: como caber no formato (padrão: fundo-desfocado)' },
        cor: { type: 'string', enum: ['natural', 'vivo', 'quente', 'frio', 'cinema', 'pb', 'vintage', 'dramatico', 'nenhuma'] },
        brilho: { type: 'number', description: 'ajustar: -1 a 1 (0 = igual)' },
        contraste: { type: 'number', description: 'ajustar: 0 a 3 (1 = igual)' },
        saturacao: { type: 'number', description: 'ajustar: 0 a 3 (1 = igual; 0 = preto e branco)' },
        nitidez: { type: 'number', description: 'ajustar: 0 a 3' },
        melhorar: { type: 'boolean', description: 'ajustar: corrige luz, cor e nitidez automaticamente' },
        textos: {
          type: 'array',
          description: 'ajustar: textos na foto',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string' },
              posicao: { type: 'string', enum: ['topo', 'centro', 'baixo'] },
              tamanho: { type: 'string', enum: ['pequeno', 'medio', 'grande'] },
              fundo: { type: 'boolean', description: 'faixa escura atrás do texto' },
            },
            required: ['texto'],
          },
        },
        marca_dagua: { type: 'string', description: 'ajustar: logo (.png)' },
        posicao_marca: { type: 'string', enum: ['canto-inferior-direito', 'canto-inferior-esquerdo', 'canto-superior-direito', 'canto-superior-esquerdo', 'centro'] },
        qualidade: { type: 'string', enum: ['alta', 'normal', 'leve'], description: 'ajustar: leve = menor, para WhatsApp' },
        manter_localizacao: { type: 'boolean', description: 'ajustar: true mantém o EXIF (local da foto, câmera); padrão: tira' },
        saida: { type: 'string', description: 'caminho do arquivo novo (opcional; não vale com várias fotos)' },
        modo: { type: 'string', enum: ['auto', 'local', 'ia'], description: 'melhorar: local (ImageMagick, grátis), ia (Gemini) ou auto' },
        ampliar: { type: 'integer', description: 'melhorar local: aumenta a resolução 2, 3 ou 4 vezes' },
      },
      required: ['acao'],
    },
  },
];

// v0.52.0: "sempre" libera criar/editar com IA até o programa fechar (antes contava como "não"); numa rotina, a
// pergunta já volta "não" sozinha (src/ui/prompt.js), então "sempre" nunca vem de lá.
let iaLiberadaNestaExecucao = false;
async function confirmar(pergunta) {
  let cfg = {};
  try { cfg = deps.loadConfig() || {}; } catch { /* config ilegível: pergunta */ }
  if (cfg.confirmarMidia === false || iaLiberadaNestaExecucao) return true;
  const r = String(await deps.ask(`${pergunta.replace(/\(s\/n\) $/, '')}(s/n/sempre) `)).trim().toLowerCase();
  if (r === 'sempre' || r === 'always') { iaLiberadaNestaExecucao = true; return true; }
  return r === 's' || r === 'y' || r === 'sim';
}

async function execute(name, args = {}) {
  if (name !== 'imagem') throw new Error(`Ferramenta de imagem desconhecida: ${name}`);
  const a = args && typeof args === 'object' ? args : {};
  const acao = String(a.acao || '').trim();
  const { paraExibir } = require('../ui/textoSeguro');
  const { foraDoProjetoParaConvidado, confirmarForaDaArea } = require('./protectedPaths');
  const im = deps.imagem();
  if (!ACOES.includes(acao)) return `Erro: imagem precisa de "acao": ${ACOES.join(', ')}.`;
  if (acao === 'ajustar') {
    // v0.50.0: edição profissional sem IA (src/imagemEdicao.js) — não gasta cota, então não pergunta; fora do projeto, sim
    const fotos = Array.isArray(a.fotos) && a.fotos.length ? a.fotos : [a.arquivo];
    if (!fotos.every((f) => typeof f === 'string' && f.trim())) return 'Erro: "ajustar" precisa de "arquivo" (ou "fotos", para várias).';
    for (const f of [...fotos, a.marca_dagua].filter((e) => typeof e === 'string' && e)) {
      const fora = foraDoProjetoParaConvidado(f);
      if (fora) return fora;
    }
    try {
      const recusa = await confirmarForaDaArea([path.resolve(a.saida || fotos[0])]);
      if (recusa) return recusa;
      const r = await deps.imagemEdicao().ajustar(fotos, a, { saida: a.saida });
      require('../midiaGerada').registrar(r.arquivos.map((x) => x.arquivo)); // v0.51.0: o modo site mostra na página
      const rel = (f) => path.relative(process.cwd(), f) || f;
      const tam = `${r.arquivos[0].largura}x${r.arquivos[0].altura}`;
      const feito = r.passos.length ? `; ${r.passos.join(', ')}` : '';
      return r.arquivos.length === 1
        ? `Foto editada (sem IA): ${rel(r.arquivos[0].arquivo)} (${tam}${feito})`
        : `${r.arquivos.length} fotos editadas (sem IA): ${r.arquivos.map((x) => rel(x.arquivo)).join(', ')} (${tam}${feito})`;
    } catch (e) {
      return `Erro: ${e.message}`;
    }
  }
  if (acao !== 'gerar') {
    if (typeof a.arquivo !== 'string' || !a.arquivo.trim()) return `Erro: "${acao}" precisa de "arquivo" (caminho da imagem).`;
    const fora = foraDoProjetoParaConvidado(a.arquivo);
    if (fora) return fora;
  }
  try {
    if (acao === 'descrever') return `[imagem ${a.arquivo}]\n${await im.descrever(a.arquivo, a.prompt)}`;

    const usaIa = acao !== 'melhorar' || a.modo === 'ia' || ((a.modo || 'auto') === 'auto' && !im.acharMagick());
    if (acao === 'melhorar' && a.modo === 'local' && !im.acharMagick()) {
      return 'Erro: para melhorar sem IA, o ImageMagick precisa estar instalado (Termux: pkg install imagemagick). Ou use modo "ia".';
    }
    if ((acao === 'gerar' || acao === 'editar') && (typeof a.prompt !== 'string' || !a.prompt.trim())) {
      return `Erro: "${acao}" precisa de "prompt" (${acao === 'gerar' ? 'o que desenhar' : 'o que mudar'}).`;
    }
    // onde o arquivo novo vai ficar: fora do projeto pergunta (como o write_file)
    const previsto = path.resolve(a.saida || (acao === 'gerar' ? path.join(process.cwd(), 'imagem.png') : a.arquivo));
    const recusa = await confirmarForaDaArea([previsto]);
    if (recusa) return recusa;
    if (usaIa) {
      const oQue = acao === 'gerar' ? `Gerar uma imagem com IA: "${paraExibir(String(a.prompt).slice(0, 300))}"`
        : acao === 'editar' ? `Editar ${paraExibir(a.arquivo)} com IA: "${paraExibir(String(a.prompt).slice(0, 300))}"`
          : `Melhorar ${paraExibir(a.arquivo)} com IA`;
      if (!(await confirmar(`\n[gemini-code] ${oQue} (usa a cota da sua chave)? (s/n) `))) return 'Cancelado pelo usuário.';
    }
    let r;
    if (acao === 'gerar') r = await im.gerar(a.prompt, { saida: a.saida, formato: a.formato });
    else if (acao === 'editar') r = await im.editar(a.arquivo, a.prompt, { saida: a.saida });
    else r = await im.melhorar(a.arquivo, { modo: usaIa ? 'ia' : 'local', saida: a.saida, ampliar: a.ampliar });
    require('../midiaGerada').registrar(r.arquivo);
    return `Imagem criada (${r.modo === 'ia' ? 'com IA' : 'sem IA, pelo ImageMagick'}): ${path.relative(process.cwd(), r.arquivo) || r.arquivo}`;
  } catch (e) {
    return `Erro: ${e.message}`;
  }
}

function _resetarSessao() { iaLiberadaNestaExecucao = false; }
function _testar(novas = {}) { deps = { ...deps, ...novas }; }

module.exports = { declarations, execute, _testar, _resetarSessao };
