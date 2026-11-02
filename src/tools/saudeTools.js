// src/tools/saudeTools.js (v0.46.0) — ferramentas do aliado de saúde (src/saude.js)
// Ficam "sob demanda" (src/tools/index.js): só existem quando a lista de ferramentas as cita — o aliado criado por
// "gemini-code saude aliado" (preset "saude") — ou quando o usuário as liga em ferramentasExtras. O chat comum não
// as vê: dado de saúde não entra numa conversa qualquer.
'use strict';

const chalk = require('../terminalColors');

let criarStore = () => require('../saude').createSaudeStore();

const declarations = [
  {
    name: 'saude_registrar',
    description:
      'Anota no diário de saúde do usuário algo que ELE contou ou mediu: pressão ("13x8", "130/80"), glicemia ' +
      '("98 jejum"), peso (kg), temperatura (°C), saturação (%), batimentos (bpm), sintoma, remédio tomado ou nota. ' +
      'Devolve a comparação com as faixas de referência. Nunca invente valores.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['pressao', 'glicemia', 'peso', 'temperatura', 'saturacao', 'batimentos', 'sintoma', 'remedio', 'nota'] },
        valor: { type: 'string', description: 'O valor ou o texto, como o usuário disse (ex.: "13 por 8", "98 jejum", "dor de cabeça desde ontem")' },
        quando: { type: 'string', description: 'Data/hora, se não foi agora (ex.: "2026-11-02 08:00")' },
        nota: { type: 'string', description: 'Observação curta (ex.: "depois do almoço")' },
      },
      required: ['tipo', 'valor'],
    },
  },
  {
    name: 'saude_consultar',
    description: 'Resumo do diário de saúde do usuário (últimas medições, médias, sintomas, remédios, alertas) para comentar tendências ou preparar a consulta.',
    parameters: {
      type: 'object',
      properties: { dias: { type: 'integer', description: 'Período em dias (padrão 30, máximo 365)' } },
    },
  },
];

async function execute(name, args = {}) {
  const saude = require('../saude');
  const a = args && typeof args === 'object' ? args : {};
  const store = criarStore();
  if (name === 'saude_consultar') {
    const dias = Math.min(365, Math.max(1, Math.floor(Number(a.dias)) || 30));
    return saude.resumo(store, { dias });
  }
  if (name !== 'saude_registrar') throw new Error(`Ferramenta de saúde desconhecida: ${name}`);
  let r;
  try {
    r = store.anotar(a.tipo, a.valor, { quando: a.quando || undefined, nota: a.nota });
  } catch (e) {
    return `Erro: ${e.message}`;
  }
  const { paraTerminal } = require('../ui/textoSeguro');
  console.log(chalk.dim(`(saúde: anotado ${paraTerminal(saude.NOMES[r.registro.tipo])} ${paraTerminal(saude.valorCurto(r.registro))})`));
  const c = r.classificacao;
  return `Anotado: ${saude.NOMES[r.registro.tipo]} ${saude.valorCurto(r.registro)} [${r.registro.id}].` +
    (c ? ` Referência: ${c.texto}${c.nivel === 'urgente' ? ` Emergência: ${saude.EMERGENCIA}.` : ''}` : '');
}

// Só para testes: troca o armazenamento.
function _testar({ store } = {}) { if (store) criarStore = () => store; }

module.exports = { declarations, execute, NOMES: declarations.map((d) => d.name), _testar };
