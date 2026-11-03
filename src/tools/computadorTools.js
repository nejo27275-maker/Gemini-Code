// src/tools/computadorTools.js (v0.47.0) — a ferramenta "computador" do agente (src/computador.js)
// Sob demanda (aliado com o preset "computador"/"central" ou ferramentasExtras). Cada ação pergunta antes — o print
// também (a tela pode mostrar qualquer coisa, e o print vai para o modelo); só "janelas" não pergunta. Uma regra
// "permitir" escrita como o comando ("computador(tecla *)", "computador(clicar *)") dispensa a pergunta; "negar"
// bloqueia (conferido em src/agent.js). Numa rotina (ninguém olhando) ou para um convidado do cowork: recusa sempre.
'use strict';

let deps = {
  ask: (q) => require('../ui/prompt').ask(q),
  suspensas: () => require('../ui/prompt').perguntasSuspensas(),
  papel: () => { try { return require('../security').getSessionRole(); } catch { return null; } },
  computador: () => require('../computador'),
  loadConfig: () => require('../config').loadConfig(),
};

const ACOES = ['tela', 'janelas', 'clicar', 'mover', 'digitar', 'tecla', 'rolar', 'focar', 'abrir'];

const declarations = [
  {
    name: 'computador',
    description:
      'Usa o computador/notebook do usuário como uma pessoa (Linux, macOS, Windows): "tela" tira um print da tela inteira ' +
      '(depois use a ferramenta imagem, acao "descrever", para ver o que tem e onde clicar); "janelas" lista as janelas; ' +
      '"clicar"/"mover" em x,y (pixels); "digitar" escreve no campo em foco; "tecla" aperta uma tecla ou combinação ' +
      '(enter, esc, tab, ctrl+c, ctrl+v, alt+tab, super, cmd+space...); "rolar" a página; "focar" traz uma janela pelo ' +
      'título; "abrir" um site, arquivo/pasta ou app instalado. Para abrir um programa em qualquer sistema: tecla ' +
      '"super", digitar o nome, tecla "enter". O usuário confirma cada ação. Para sites, prefira a ferramenta browser.',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ACOES },
        x: { type: 'integer', description: 'clicar/mover: posição horizontal em pixels' },
        y: { type: 'integer', description: 'clicar/mover: posição vertical em pixels' },
        botao: { type: 'string', enum: ['esquerdo', 'direito', 'meio'], description: 'clicar: padrão esquerdo' },
        duplo: { type: 'boolean', description: 'clicar: clique duplo' },
        texto: { type: 'string', description: 'digitar: o texto' },
        tecla: { type: 'string', description: 'tecla: ex. enter, ctrl+c, alt+tab, super, ctrl+shift+t' },
        direcao: { type: 'string', enum: ['cima', 'baixo', 'esquerda', 'direita'], description: 'rolar: padrão baixo' },
        quantidade: { type: 'integer', description: 'rolar: quantas vezes (1 a 20, padrão 3)' },
        titulo: { type: 'string', description: 'focar: parte do título da janela (ou o nome do app, no Mac)' },
        alvo: { type: 'string', description: 'abrir: https://..., um arquivo/pasta, ou o nome de um app instalado' },
        arquivo: { type: 'string', description: 'tela: .png NOVO onde salvar (opcional)' },
      },
      required: ['acao'],
    },
  },
];

const sim = (r) => ['s', 'sim', 'y', 'yes'].includes(String(r || '').trim().toLowerCase());

async function execute(name, args = {}) {
  if (name !== 'computador') throw new Error(`Ferramenta de computador desconhecida: ${name}`);
  const a = args && typeof args === 'object' ? args : {};
  const acao = String(a.acao || '').trim();
  if (!ACOES.includes(acao)) return `Erro: computador precisa de "acao": ${ACOES.join(', ')}.`;
  if (deps.suspensas()) return 'Erro: numa rotina (ninguém olhando) o agente não mexe no computador.';
  if (deps.papel() === 'guest') return 'Bloqueado: a sessão de convidado não controla o computador do dono.';
  const c = deps.computador();
  if (acao !== 'janelas') {
    let cfg = {};
    try { cfg = deps.loadConfig() || {}; } catch { /* pergunta */ }
    const liberado = require('../permissions').permitido('computador', a, cfg);
    if (!liberado) {
      const { paraExibir } = require('../ui/textoSeguro');
      const resp = await deps.ask(`\n[gemini-code/computador] O agente quer ${paraExibir(c.descrever(acao, a))}.\nPermitir? (s/n) `);
      if (!sim(resp)) return 'O usuário não autorizou essa ação no computador.';
    }
  }
  const r = await c.executar(acao, a);
  return r.texto;
}

function _testar(novas = {}) { deps = { ...deps, ...novas }; }

module.exports = { declarations, execute, ACOES, _testar };
