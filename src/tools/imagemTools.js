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
};

const declarations = [
  {
    name: 'imagem',
    description:
      'Imagens: "gerar" (descrição -> imagem nova, com IA), "editar" (foto + instrução -> foto nova, com IA), ' +
      '"melhorar" (foto mais nítida/clara: sem IA pelo ImageMagick quando houver, ou com IA) e "descrever" ' +
      '(responde uma pergunta sobre uma imagem do disco, ex.: um print de erro). Formatos: png, jpg, webp, gif. ' +
      'Nunca sobrescreve: cria um arquivo novo e diz o caminho.',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['gerar', 'editar', 'melhorar', 'descrever'] },
        prompt: { type: 'string', description: 'gerar: o que desenhar; editar: o que mudar; descrever: a pergunta' },
        arquivo: { type: 'string', description: 'editar/melhorar/descrever: caminho da imagem' },
        saida: { type: 'string', description: 'caminho do arquivo novo (opcional)' },
        modo: { type: 'string', enum: ['auto', 'local', 'ia'], description: 'melhorar: local (ImageMagick, grátis), ia (Gemini) ou auto' },
        ampliar: { type: 'integer', description: 'melhorar local: aumenta a resolução 2, 3 ou 4 vezes' },
      },
      required: ['acao'],
    },
  },
];

async function confirmar(pergunta) {
  let cfg = {};
  try { cfg = deps.loadConfig() || {}; } catch { /* config ilegível: pergunta */ }
  if (cfg.confirmarMidia === false) return true;
  const r = String(await deps.ask(pergunta)).trim().toLowerCase();
  return r === 's' || r === 'y' || r === 'sim';
}

async function execute(name, args = {}) {
  if (name !== 'imagem') throw new Error(`Ferramenta de imagem desconhecida: ${name}`);
  const a = args && typeof args === 'object' ? args : {};
  const acao = String(a.acao || '').trim();
  const { paraExibir } = require('../ui/textoSeguro');
  const { foraDoProjetoParaConvidado, confirmarForaDaArea } = require('./protectedPaths');
  const im = deps.imagem();
  if (!['gerar', 'editar', 'melhorar', 'descrever'].includes(acao)) return 'Erro: imagem precisa de "acao": gerar, editar, melhorar ou descrever.';
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
    if (acao === 'gerar') r = await im.gerar(a.prompt, { saida: a.saida });
    else if (acao === 'editar') r = await im.editar(a.arquivo, a.prompt, { saida: a.saida });
    else r = await im.melhorar(a.arquivo, { modo: usaIa ? 'ia' : 'local', saida: a.saida, ampliar: a.ampliar });
    return `Imagem criada (${r.modo === 'ia' ? 'com IA' : 'sem IA, pelo ImageMagick'}): ${path.relative(process.cwd(), r.arquivo) || r.arquivo}`;
  } catch (e) {
    return `Erro: ${e.message}`;
  }
}

function _testar(novas = {}) { deps = { ...deps, ...novas }; }

module.exports = { declarations, execute, _testar };
