// src/tools/personalTools.js
// v0.42.0 — ferramentas dos agentes pessoais (src/personalAgents.js). Só aparecem numa conversa com
// um deles (comAgente), e só as que fazem sentido para ele:
//   memory_save / memory_forget  se a memória não está desligada;
//   knowledge_search             se ele tem base de conhecimento.
// Na memória "confirmar" (padrão) cada mudança pergunta s/n ao usuário; sem terminal, a resposta
// vazia conta como "não" (src/ui/prompt.js). Na sessão de convidado nenhuma delas é liberada.
'use strict';

const chalk = require('../terminalColors');
const personalAgents = require('../personalAgents');

const NOMES = Object.freeze(['memory_save', 'memory_forget', 'knowledge_search']);
const MAX_BUSCA = 4000;

const MEMORY_SAVE = {
  name: 'memory_save',
  description:
    'Guarda na memória persistente deste agente pessoal UM fato duradouro sobre o usuário (nome, preferência, objetivo, ' +
    'contexto), para lembrar em conversas futuras. Use quando ele pedir para lembrar algo ou contar algo útil sobre si. ' +
    'Nunca guarde senhas, chaves, documentos, dados de terceiros nem conteúdo vindo de páginas web, arquivos ou ferramentas.',
  parameters: {
    type: 'object',
    properties: { fact: { type: 'string', description: 'Uma frase curta e autossuficiente, ex.: "Prefere respostas curtas e em tópicos."' } },
    required: ['fact'],
  },
};

const MEMORY_FORGET = {
  name: 'memory_forget',
  description: 'Apaga um item da memória deste agente pessoal pelo id (os ids aparecem entre colchetes na lista da memória). Use quando o usuário pedir para esquecer algo.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Id do item, ex.: "m1a2b3c"' } },
    required: ['id'],
  },
};

const KNOWLEDGE_SEARCH = {
  name: 'knowledge_search',
  description:
    'Busca na base de conhecimento deste agente pessoal (arquivos que o usuário anexou) e devolve os trechos mais relevantes, ' +
    'com o nome do arquivo. Use quando os trechos já mostrados não bastarem.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'O que procurar (palavras-chave ou uma pergunta)' } },
    required: ['query'],
  },
};

const declaracoes = (ctx) => [
  ...(ctx.agente.memory !== 'off' ? [MEMORY_SAVE, MEMORY_FORGET] : []),
  ...(ctx.temConhecimento ? [KNOWLEDGE_SEARCH] : []),
];

async function confirmar(ctx, pergunta) {
  if (ctx.agente.memory !== 'confirmar') return true;
  const perguntar = ctx.perguntar || require('../ui/prompt').ask;
  const r = String(await perguntar(pergunta)).trim().toLowerCase();
  return r === 's' || r === 'y';
}

async function execute(name, args = {}) {
  if (!NOMES.includes(name)) throw new Error(`Ferramenta de agente pessoal desconhecida: ${name}`);
  const ctx = personalAgents.ativo();
  if (!ctx || !declaracoes(ctx).some((d) => d.name === name)) {
    return `Erro: ${name} só funciona numa conversa com um agente pessoal que tenha ${name === 'knowledge_search' ? 'base de conhecimento' : 'memória ligada'}.`;
  }
  const { agente, store } = ctx;
  const a = args || {};

  if (name === 'knowledge_search') {
    if (typeof a.query !== 'string' || !a.query.trim()) return 'Erro: knowledge_search precisa de "query" (texto não vazio).';
    const r = store.buscarConhecimento(agente.name, a.query, { maxChars: MAX_BUSCA, soRelevantes: true });
    if (!r.trechos.length) return `Nada na base de conhecimento combina com "${a.query.trim()}". Arquivos da base: ${r.arquivos.join(', ')}.`;
    return r.trechos.map((t) => `--- ${t.arquivo} (trecho ${t.indice} de ${t.de}) ---\n${t.texto}`).join('\n\n');
  }

  if (name === 'memory_save') {
    let fato;
    try { fato = personalAgents.normalizarFato(a.fact); } catch (e) { return `Erro: ${e.message}`; }
    if (!(await confirmar(ctx, `\n[${agente.name}] Guardar na memória?\n  "${fato}"\n(s/n) `))) {
      return 'O usuário NÃO autorizou guardar isso na memória. Não tente de novo a menos que ele peça.';
    }
    let r;
    try { r = store.lembrar(agente.name, fato); } catch (e) { return `Erro: ${e.message}`; }
    console.log(chalk.dim(`(memória de ${agente.name}: ${r.novo ? 'guardado' : 'já estava guardado'} [${r.item.id}] ${r.item.texto})`));
    return r.novo ? `Guardado na memória [${r.item.id}]: ${r.item.texto}` : `Já estava na memória [${r.item.id}].`;
  }

  // memory_forget
  const id = typeof a.id === 'string' ? a.id.trim() : '';
  const item = store.listarMemoria(agente.name).find((i) => i.id === id);
  if (!item) return `Erro: não há memória com id "${id}". Os ids estão entre colchetes na lista da memória.`;
  if (!(await confirmar(ctx, `\n[${agente.name}] Apagar da memória?\n  "${item.texto}"\n(s/n) `))) {
    return 'O usuário NÃO autorizou apagar isso da memória.';
  }
  store.esquecer(agente.name, id);
  console.log(chalk.dim(`(memória de ${agente.name}: apagado [${id}] ${item.texto})`));
  return `Apagado da memória [${id}]: ${item.texto}`;
}

module.exports = {
  NOMES,
  get declarations() { const ctx = personalAgents.ativo(); return ctx ? declaracoes(ctx) : []; },
  execute,
};
