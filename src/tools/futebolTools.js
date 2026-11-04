// src/tools/futebolTools.js (v0.52.0) — a ferramenta "futebol" do treinador (src/futebol.js). Sob demanda: entra no
// aliado "treinador" (preset "futebol") ou com ferramentasExtras. Nada aqui gasta cota nem mexe em aparelho; a
// prancheta cria arquivos novos (nunca sobrescreve) na pasta do projeto e avisa o modo site (src/midiaGerada.js).
'use strict';

const path = require('path');

let deps = {
  futebol: () => require('../futebol'),
};

const ACOES = ['treino', 'semana', 'carga', 'prancheta', 'exercicios'];

const declarations = [
  {
    name: 'futebol',
    description:
      'Treinador de futebol: "treino" monta a sessão (tema, categoria, nº de jogadores e goleiros, minutos) com exercícios de ' +
      'verdade, organização, regras, pontos de correção e progressão; "semana" faz o microciclo até o jogo (periodização tática: ' +
      'MD-4 tensão, MD-3 duração, MD-2 velocidade, MD-1 ativação, recuperação depois do jogo); "carga" calcula a carga ' +
      '(PSE x minutos), o ACWR e a monotonia de sessões informadas; "prancheta" desenha a formação (ex.: 4-3-3) com os nomes e ' +
      'setas das jogadas (PNG e SVG); "exercicios" lista a biblioteca por tema. Ajuste o resultado ao contexto da pessoa.',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ACOES },
        tema: { type: 'string', description: 'treino/exercicios: posse, saida, pressao, pressao-alta, transicao, defesa, finalizacao, cruzamento, bola-parada, tecnica, velocidade, goleiro' },
        categoria: { type: 'string', description: 'sub-7, sub-9, sub-11, sub-13, sub-15, sub-17, sub-20, adulto, veterano (ou a idade)' },
        jogadores: { type: 'integer', description: 'treino: quantos jogadores (2 a 40)' },
        goleiros: { type: 'integer', description: 'treino: quantos goleiros' },
        duracao: { type: 'integer', description: 'treino: minutos (20 a 150)' },
        jogo: { type: 'string', description: 'semana: o dia do jogo (segunda...domingo); semana com 2 jogos: "quarta,domingo"' },
        dias: { type: 'array', items: { type: 'string' }, description: 'semana: os dias de treino' },
        sessoes: {
          type: 'array',
          description: 'carga: as sessões',
          items: { type: 'object', properties: { data: { type: 'string', description: '2026-11-04 ou 04/11/2026 (ou "ontem")' }, pse: { type: 'number', description: 'percepção de esforço 0 a 10' }, minutos: { type: 'number' } }, required: ['pse', 'minutos'] },
        },
        hoje: { type: 'string', description: 'carga: o dia de referência, ex. 2026-11-04 (padrão: hoje)' },
        formacao: { type: 'string', description: 'prancheta: ex. 4-3-3, 4-2-3-1, 3-5-2, society 2-3-1, futsal 2-2' },
        nomes: { type: 'array', items: { type: 'string' }, description: 'prancheta: nomes na ordem (goleiro, depois de trás para a frente, da esquerda para a direita)' },
        titulo: { type: 'string', description: 'prancheta: título' },
        setas: {
          type: 'array',
          description: 'prancheta: movimentos (de: número do jogador, 1 = goleiro; ate: [x, y] de 0 a 100, com o ataque para cima)',
          items: { type: 'object', properties: { de: { type: 'integer' }, ate: { type: 'array', items: { type: 'number' } } }, required: ['de', 'ate'] },
        },
        saida: { type: 'string', description: 'prancheta: arquivo novo (.png)' },
      },
      required: ['acao'],
    },
  },
];

async function execute(name, args = {}) {
  if (name !== 'futebol') throw new Error(`Ferramenta desconhecida: ${name}`);
  const a = args && typeof args === 'object' ? args : {};
  const f = deps.futebol();
  const acao = String(a.acao || '');
  try {
    if (acao === 'treino') return f.textoDoTreino(f.planejarTreino(a));
    if (acao === 'semana') return f.textoDaSemana(f.planejarSemana(a));
    if (acao === 'carga') return f.textoDaCarga(f.calcularCarga(a.sessoes, { hoje: a.hoje }));
    if (acao === 'exercicios') {
      const tema = a.tema ? f.lerTema(a.tema) : null;
      const lista = f.BIBLIOTECA.filter((e) => !tema || e.temas.includes(tema) || e.temas.includes('*'));
      return lista.map((e) => `- **${e.nome}** (${e.fase}, a partir de ${e.idade} anos, ${e.grupo} por grupo): ${e.descricao}`).join('\n');
    }
    if (acao === 'prancheta') {
      if (a.saida !== undefined && (typeof a.saida !== 'string' || !a.saida.trim())) return 'Erro: "saida" precisa ser o caminho de um arquivo novo.';
      const { confirmarForaDaArea, foraDoProjetoParaConvidado } = require('./protectedPaths');
      if (a.saida) {
        const fora = foraDoProjetoParaConvidado(a.saida);
        if (fora) return fora;
        const recusa = await confirmarForaDaArea([path.resolve(a.saida)]);
        if (recusa) return recusa;
      }
      const r = await f.desenharPrancheta(a, { saida: a.saida });
      const rel = (x) => path.relative(process.cwd(), x) || x;
      if (r.png) require('../midiaGerada').registrar(r.png);
      return r.png
        ? `Prancheta salva: ${rel(r.png)} (e ${rel(r.svg)}, para editar ou imprimir)`
        : `Prancheta salva: ${rel(r.svg)} (SVG; para o PNG, instale o ImageMagick — Termux: pkg install imagemagick)`;
    }
    return `Erro: futebol precisa de "acao": ${ACOES.join(', ')}.`;
  } catch (e) {
    return `Erro: ${e.message}`;
  }
}

function _testar(novas = {}) { deps = { ...deps, ...novas }; }

module.exports = { declarations, execute, _testar, ACOES };
