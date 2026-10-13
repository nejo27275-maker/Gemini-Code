// src/subagent.js
// v0.3.11 — SUBAGENTES. O agente principal pode delegar uma tarefa isolada
// (explorar o projeto, revisar código, executar uma subtarefa) para um
// subagente que tem:
//   - contexto PRÓPRIO: não vê a conversa do pai, então o trabalho pesado
//     (ler 30 arquivos, buscar em tudo) não enche o contexto principal;
//   - ferramentas RESTRITAS por tipo (a maioria é só leitura);
//   - limite de passos próprio;
//   - devolve só um relatório curto (limitado a MAX_RELATORIO caracteres).
// Um subagente NUNCA cria outro subagente (delegate_task não está em nenhuma
// lista de ferramentas dos tipos, e há um guarda de profundidade).
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const MAX_RELATORIO = 6000;
const MAX_PROFUNDIDADE = 1;
const contexto = new AsyncLocalStorage(); // { profundidade }

const SO_LEITURA = ['read_file', 'list_dir', 'search_files', 'read_skill'];

const TIPOS = {
  explorador: {
    descricao: 'lê e pesquisa (só leitura): entender código, achar onde algo é feito, resumir arquivos',
    tools: SO_LEITURA,
    maxSteps: 25,
    somenteLeitura: true,
    instrucao:
      'Você é um subagente EXPLORADOR (somente leitura). Investigue com list_dir, search_files e read_file ' +
      '(use start_line/end_line em arquivos grandes) e responda à pergunta com precisão.',
  },
  revisor: {
    descricao: 'revisa código (só leitura): bugs reais, riscos de segurança, casos de borda',
    tools: SO_LEITURA,
    maxSteps: 25,
    somenteLeitura: true,
    instrucao:
      'Você é um subagente REVISOR de código sênior (somente leitura). Procure bugs reais, riscos de ' +
      'segurança e casos de borda; ignore estilo e preferências. Para cada achado dê arquivo:linha, o ' +
      'problema e a correção sugerida. Se não achar nada relevante, diga isso claramente.',
  },
  // Alias em inglês alinhados aos papéis públicos de agentes de programação.
  // Cada alias recebe allowlist explícita e continua proibido de delegar novamente.
  explore: {
    descricao: 'explores a codebase in read-only mode',
    tools: SO_LEITURA, maxSteps: 25, somenteLeitura: true,
    instrucao: 'You are an EXPLORE subagent (read-only). Inspect files and search the repository; do not edit or run commands. Return evidence with paths and line numbers when possible.',
  },
  plan: {
    descricao: 'creates an implementation plan without touching files',
    tools: SO_LEITURA, maxSteps: 25, somenteLeitura: true,
    instrucao: 'You are a PLAN subagent (read-only). Return ordered steps, dependencies, risks, acceptance tests and completion criteria. Do not modify files or claim implementation.',
  },
  reviewer: {
    descricao: 'reviews code in read-only mode',
    tools: SO_LEITURA, maxSteps: 25, somenteLeitura: true,
    instrucao: 'You are a REVIEWER subagent (read-only). Prioritize reproducible defects and security risks, cite file/line, impact, scenario and proposed fix. Separate facts from assumptions.',
  },
  coder: {
    descricao: 'implements an isolated coding task, runs checks, and reports changed files',
    tools: [...SO_LEITURA, 'write_file', 'edit_file', 'run_shell', 'run_checks'],
    maxSteps: 40, somenteLeitura: false,
    instrucao: 'You are a CODER subagent. Keep scope limited, inspect before changing, run relevant checks, correct failures when safe, and list modified files.',
  },
  executor: {
    descricao: 'faz uma subtarefa de ponta a ponta: lê, edita arquivos, roda comandos e testes',
    tools: [...SO_LEITURA, 'write_file', 'edit_file', 'run_shell', 'run_checks'],
    maxSteps: 40,
    somenteLeitura: false,
    instrucao:
      'Você é um subagente EXECUTOR. Faça a subtarefa pedida por completo, mexendo só no que ela exige. ' +
      'Depois de editar código, rode run_checks e corrija o que falhar. Liste no relatório cada arquivo alterado.',
  },
};

const BASE_INSTRUCAO =
  '\n\nVocê foi chamado por outro agente e NÃO enxerga a conversa dele — só a tarefa abaixo. ' +
  'Não faça perguntas ao usuário: se algo estiver ambíguo, escolha a interpretação mais razoável e diga qual. ' +
  'Termine SEMPRE com um relatório final curto e objetivo (o que encontrou/fez, com caminhos de arquivo e ' +
  'números de linha quando for útil). Esse relatório é tudo que o agente principal vai receber.';

const declarations = [
  {
    name: 'delegate_task',
    description:
      'Delega uma tarefa a um SUBAGENTE com contexto próprio (ele não vê esta conversa) e recebe só o relatório ' +
      'final. Use para investigações que exigem ler/buscar em muitos arquivos, revisões de código ou subtarefas ' +
      'independentes, sem encher o seu contexto. Escreva a tarefa completa e autossuficiente (o que fazer, onde ' +
      'olhar, que formato de resposta quer). Tipos: ' +
      Object.entries(TIPOS).map(([n, t]) => `"${n}" = ${t.descricao}`).join('; ') +
      '. Vários explorador/revisor numa mesma resposta rodam em paralelo.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'A tarefa, completa e autossuficiente' },
        type: { type: 'string', enum: Object.keys(TIPOS), description: 'Tipo de subagente (padrão: explorador)' },
        context: { type: 'string', description: 'Contexto extra que o subagente precisa (opcional)' },
      },
      required: ['task'],
    },
  },
];

/** True se a chamada é de um subagente que só lê (seguro de rodar em paralelo). */
function ehSomenteLeitura(args) {
  const tipo = TIPOS[(args && args.type) || 'explorador'];
  return !!(tipo && tipo.somenteLeitura);
}

function profundidadeAtual() {
  const s = contexto.getStore();
  return s ? s.profundidade : 0;
}

function cortarRelatorio(texto) {
  if (texto.length <= MAX_RELATORIO) return texto;
  return texto.slice(0, MAX_RELATORIO) + `\n[... relatório do subagente truncado: ${MAX_RELATORIO} de ${texto.length} caracteres]`;
}

/**
 * @param {object} args  { task, type?, context? }
 * @param {object} opts  { allowedPai?: string[] (ferramentas do agente pai — o subagente nunca passa disso),
 *                         runOnceFn?: (para teste) }
 */
async function execute(name, args = {}, opts = {}) {
  if (name !== 'delegate_task') throw new Error(`Ferramenta de subagente desconhecida: ${name}`);

  if (typeof args.task !== 'string' || !args.task.trim()) {
    return 'Erro: delegate_task precisa de "task" (texto não vazio).';
  }
  const nomeTipo = args.type || 'explorador';
  const tipo = TIPOS[nomeTipo];
  if (!tipo) return `Erro: tipo de subagente desconhecido: "${nomeTipo}". Use: ${Object.keys(TIPOS).join(', ')}.`;
  if (profundidadeAtual() >= MAX_PROFUNDIDADE) {
    return 'Erro: um subagente não pode criar outro subagente. Faça o trabalho você mesmo.';
  }

  // O subagente nunca recebe mais ferramentas do que o pai tem.
  const pai = opts.allowedPai;
  const tools = pai && pai.length ? tipo.tools.filter((t) => pai.includes(t)) : tipo.tools.slice();
  if (!tools.length) {
    return `Erro: nenhuma ferramenta do tipo "${nomeTipo}" está liberada para este agente.`;
  }

  const runOnceFn = opts.runOnceFn || require('./agent').runOnce; // lazy: evita ciclo agent <-> tools
  const prompt = args.context && String(args.context).trim()
    ? `${args.task.trim()}\n\nContexto:\n${String(args.context).trim()}`
    : args.task.trim();

  const resumoTarefa = args.task.trim().replace(/\s+/g, ' ').slice(0, 80);
  console.log(`\n  ↳ subagente ${nomeTipo}: ${resumoTarefa}`);

  let resultado;
  try {
    resultado = await contexto.run({ profundidade: profundidadeAtual() + 1 }, () =>
      runOnceFn(prompt, {
        history: [],                       // contexto isolado
        extraSystemInstruction: tipo.instrucao + BASE_INSTRUCAO,
        allowedTools: tools,               // sempre explícito (lista vazia = tudo, então nunca vazia)
        maxSteps: tipo.maxSteps,
        logPrefix: '    ',
      })
    );
  } catch (err) {
    return `Erro no subagente ${nomeTipo}: ${err.message}`;
  }

  const texto = (resultado && resultado.text ? String(resultado.text) : '').trim();
  console.log(`  ↳ subagente ${nomeTipo} terminou`);
  return `[relatório do subagente ${nomeTipo}]\n${cortarRelatorio(texto || '(o subagente terminou sem escrever um relatório)')}`;
}

module.exports = { declarations, execute, TIPOS, ehSomenteLeitura, MAX_RELATORIO, MAX_PROFUNDIDADE };
