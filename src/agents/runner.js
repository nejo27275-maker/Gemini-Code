// src/agents/runner.js
// "gemini-code agent run <arquivo.json>" aceita dois formatos de arquivo:
//
// 1) Workflow: uma lista de passos, cada um uma instrução pro agente.
//    A saída de um passo pode ser usada no prompt do próximo com
//    {{id_do_passo}}. Ver workflows/exemplos/design-e-publicar.json:
//    { "name": "...", "steps": [ { "id": "roteiro", "prompt": "..." }, ... ] }
//
// 2) Persona: configuração pronta de um agente (modelo, instrução extra de
//    sistema e ferramentas permitidas) que abre um chat interativo já
//    configurado. Ver agents/exemplos/revisor-de-codigo.json:
//    { "name": "...", "model": "...", "systemInstructionExtra": "...",
//      "allowedTools": ["read_file", ...] }
//
// Corrigido em set/2026: antes este arquivo só sabia rodar o formato 1 — um
// arquivo de persona (sem "steps"), como o próprio exemplo que vem no
// projeto, quebrava com "Cannot read properties of undefined (reading
// Symbol(Symbol.iterator))" em `for (const step of workflow.steps)`, mesmo
// sendo um recurso descrito no README e no --help. O formato é decidido pela
// presença (ou não) do array "steps".
'use strict';

const fs = require('fs');
const chalk = require('../terminalColors');
const { runOnce } = require('../agent');
const usage = require('../usage');
const { getShared: getSharedReadline, perguntarColando } = require('../ui/prompt');

// v0.18.0: {{var}} ou {{var|valor padrão}} (o padrão vale quando a variável não existe ou está vazia).
function interpolate(template, ctx) {
  return template.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (_, key, padrao) => {
    const v = ctx[key];
    return (v === undefined || v === null || v === '') && padrao !== undefined ? padrao : (v ?? '');
  });
}

// v0.19.0: condição de passo. "when" roda o passo se for verdadeira; "unless" roda se for FALSA.
//   string:  "{{achados}}"   -> verdadeira se, depois de interpolar, não for vazia, "false", "não", "nao", "no", "0"
//                               nem começar com "[falhou:" (passo opcional que falhou conta como falso)
//   objeto:  { "var": "achados", "contains": "bug" }   (sem diferenciar maiúsculas)
//            { "var": "modo", "equals": "rapido" }
//            { "var": "achados", "empty": true }        (verdadeira se vazia/falhou)
function avaliarCondicao(cond, ctx) {
  if (cond === undefined || cond === null) return true;
  const falso = (t) => { const x = String(t ?? '').trim().toLowerCase(); return !x || ['false', 'não', 'nao', 'no', '0'].includes(x) || x.startsWith('[falhou:'); };
  if (typeof cond === 'string') return !falso(interpolate(cond, ctx));
  if (typeof cond === 'object' && typeof cond.var === 'string') {
    const v = String(ctx[cond.var] ?? '');
    if ('contains' in cond) return v.toLowerCase().includes(String(cond.contains).toLowerCase());
    if ('equals' in cond) return v.trim().toLowerCase() === String(cond.equals).trim().toLowerCase();
    if ('empty' in cond) return falso(v) === Boolean(cond.empty);
    return !falso(v);
  }
  return true;
}

// v0.22.0: "each" — repete o passo para cada linha de uma lista (saída de um passo anterior). Limite duro de 10 itens:
// cada item é uma chamada de IA, e o orçamento ("maxTokens") é checado antes de cada uma.
const MAX_ITENS = 10;
// v0.25.1: "paralelo" só é aceito em passos com ferramentas SOMENTE de leitura (ou sem ferramentas): vários itens
// ao mesmo tempo não podem pedir confirmação no terminal nem gravar no mesmo arquivo.
const MAX_PARALELO = 3;
const FERRAMENTAS_LEITURA = ['read_file', 'list_dir', 'search_files', 'glob_files']; // v0.41.0: glob_files só lista nomes

function extrairItens(texto, max = MAX_ITENS) {
  const limite = Math.max(1, Math.min(MAX_ITENS, Number(max) || MAX_ITENS));
  const todos = String(texto ?? '').split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l && !l.toLowerCase().startsWith('[falhou:'));
  return { itens: todos.slice(0, limite), total: todos.length };
}

/**
 * v0.18.0: lê os prompts de um workflow e separa as variáveis que o USUÁRIO precisa informar
 * (obrigatórias: sem padrão) das opcionais (com {{var|padrão}}), e acha referências quebradas
 * a passos que só rodam DEPOIS (ou que não existem como variável).
 */
function analisarVariaveis(workflow) {
  const obrigatorias = new Set();
  const opcionais = new Map();
  const futuras = [];
  const ids = (workflow.steps || []).map((s) => String(s.id));
  const jaRodou = new Set();
  for (const step of workflow.steps || []) {
    const textos = [String(step.prompt || '')];
    if (typeof step.each === 'string') textos.push(step.each);
    for (const c of [step.when, step.unless]) {
      if (typeof c === 'string') textos.push(c);
      else if (c && typeof c === 'object' && typeof c.var === 'string') textos.push(`{{${c.var}}}`);
    }
    const re = /\{\{(\w+)(?:\|([^}]*))?\}\}/g;
    let m;
    while ((m = re.exec(textos.join('\n')))) {
      const [, nome, padrao] = m;
      if (step.each !== undefined && (nome === 'item' || nome === 'indice')) continue; // variáveis do próprio laço
      if (jaRodou.has(nome)) continue;
      if (ids.includes(nome)) { futuras.push(`${step.id} usa {{${nome}}} antes de ele rodar`); continue; }
      if (padrao !== undefined) opcionais.set(nome, padrao); else obrigatorias.add(nome);
    }
    jaRodou.add(String(step.id));
  }
  for (const n of opcionais.keys()) obrigatorias.delete(n); // tem padrão em algum lugar = não obriga
  return { obrigatorias: [...obrigatorias], opcionais: Object.fromEntries(opcionais), futuras };
}

// `deps.runOnce`, se passado, substitui o runOnce importado de '../agent'.
// Existe só para permitir testar runWorkflowData sem chamar a API do Gemini
// de verdade (ver tests/runner.test.js); em uso normal, ninguém passa
// `deps` e o comportamento é idêntico ao de antes.
async function runWorkflowData(workflow, deps = {}) {
  const runOnceFn = deps.runOnce || runOnce;
  // v0.20.0: deps.retomar = { ctx, results, desde } continua uma execução interrompida: os passos anteriores
  // NÃO rodam de novo (e não gastam IA); só os resultados deles voltam para o contexto.
  const retomar = deps.retomar && typeof deps.retomar === 'object' ? deps.retomar : null;
  const desde = retomar ? Math.max(0, Number(retomar.desde) || 0) : 0;
  const ctx = { ...(deps.vars || {}), ...(retomar && retomar.ctx ? retomar.ctx : {}) }; // v0.17.0: variáveis iniciais ({{var}}) vindas de run_workflow
  const results = retomar && Array.isArray(retomar.results) ? retomar.results.map((r) => ({ ...r })) : [];
  // Item 11 da revisão (set/2026): cada passo chamava runOnce(prompt) do
  // zero, sem histórico nenhum — o `{{id}}` só passa o TEXTO FINAL de um
  // passo anterior pro próximo, então o modelo nunca via o raciocínio ou as
  // ferramentas usadas nos passos de antes. Isso é o comportamento certo
  // pra maioria dos workflows (passos independentes, conectados só pelo
  // resultado), mas às vezes se quer literalmente uma continuação de
  // conversa. Agora, se o passo (ou o workflow inteiro) tiver
  // "keepHistory": true, o histórico acumulado é passado adiante.
  let history = [];
  // v0.21.0: custo por passo (tokens REAIS do Gemini, via src/usage.js) e orçamento opcional do workflow ("maxTokens").
  // Modelos locais (Ollama/code-ia) não informam tokens: contam 0 e nunca estouram o orçamento.
  const usoInicial = usage.total();
  const orcamento = Number.isInteger(workflow.maxTokens) && workflow.maxTokens > 0 ? workflow.maxTokens : 0;

  if (!Array.isArray(workflow.steps)) {
    throw new TypeError('runWorkflowData: workflow.steps precisa ser um array de passos');
  }

  for (const [indice, step] of workflow.steps.entries()) {
    if (indice < desde) continue;
    // v0.19.0: when/unless — passo pulado não gasta chamada de IA; a variável dele fica vazia.
    if (!avaliarCondicao(step.when, ctx) || (step.unless !== undefined && avaliarCondicao(step.unless, ctx))) {
      console.log(`\n=== Passo: ${step.id} (pulado: condição não atendida) ===`);
      ctx[step.id] = '';
      results.push({ id: step.id, output: '', pulado: true });
      continue;
    }
    // Orçamento: checado ANTES de cada passo que ia rodar. Estourou = para aqui; o erro leva o contexto e o índice,
    // então o progresso é salvo e o workflow pode ser retomado depois (/workflows retomar) com orçamento novo.
    if (orcamento && usage.total() - usoInicial >= orcamento) {
      const err = new Error(`orçamento de tokens do workflow estourado (${usage.total() - usoInicial}/${orcamento}) antes do passo "${step.id}"`);
      err.orcamento = true; err.step = step.id; err.results = results; err.ctx = ctx; err.indice = indice;
      throw err;
    }
    if (step.each !== undefined) {
      const { itens, total } = extrairItens(interpolate(String(step.each), ctx), step.maxItens);
      if (!itens.length) {
        console.log(`\n=== Passo: ${step.id} (pulado: lista vazia) ===`);
        ctx[step.id] = '';
        results.push({ id: step.id, output: '', pulado: true });
        continue;
      }
      const tokensPasso = usage.total();
      const tentativasItem = 1 + Math.max(0, Math.min(2, Number(step.retry) || 0));
      const opcoesItem = { history: [] };
      if (typeof step.model === 'string' && step.model.trim()) opcoesItem.modelName = step.model.trim();
      if (Array.isArray(step.tools)) opcoesItem.allowedTools = step.tools.map(String);
      console.log(`\n=== Passo: ${step.id} (${itens.length} itens${total > itens.length ? `, de ${total}: o resto foi ignorado pelo limite` : ''}) ===`);
      const partes = []; let falhasItens = 0; let inicio = 0;
      // v0.24.0: se a execução parou NO MEIO deste laço, os itens já feitos voltam e o passo continua do próximo
      // (só vale se a lista tem o mesmo tamanho de antes; senão recomeça do item 1, que é o jeito seguro).
      const pc = retomar && retomar.parcial && indice === desde ? retomar.parcial : null;
      if (pc && pc.id === step.id && pc.total === itens.length && Array.isArray(pc.partes) && pc.partes.length > 0 && pc.partes.length < itens.length) {
        partes.push(...pc.partes.map(String)); falhasItens = Number(pc.falhasItens) || 0; inicio = partes.length;
        console.log(`(retomando: ${inicio} de ${itens.length} itens já feitos, continuando do item ${inicio + 1})`);
      }
      const parcialAgora = () => ({ id: step.id, total: itens.length, partes: [...partes], falhasItens });
      // v0.25.1: "paralelo" (1 a 3) roda os itens em LOTES: o lote inteiro sai junto, o resultado volta na ordem da
      // lista. Com paralelo 1 (padrão) é exatamente o comportamento de antes. O orçamento é checado antes de cada
      // LOTE; se um item sem "optional" falhar, só os itens ANTES dele (em ordem) são guardados para retomar.
      const lote = Math.max(1, Math.min(MAX_PARALELO, Number(step.paralelo) || 1));
      const fazerItem = async (k) => {
        const item = itens[k];
        const promptItem = interpolate(step.prompt, { ...ctx, item, indice: String(k + 1) });
        let resp = null; let erroItem = null;
        for (let i = 0; i < tentativasItem && !resp; i++) {
          try { resp = await runOnceFn(promptItem, { ...opcoesItem }); } catch (e) { erroItem = e; }
        }
        return { resp, erroItem };
      };
      for (let k0 = inicio; k0 < itens.length; k0 += lote) {
        if (orcamento && usage.total() - usoInicial >= orcamento) {
          const err = new Error(`orçamento de tokens do workflow estourado (${usage.total() - usoInicial}/${orcamento}) no passo "${step.id}", item ${k0 + 1} de ${itens.length} (ao retomar, continua do item ${k0 + 1})`);
          err.orcamento = true; err.step = step.id; err.results = results; err.ctx = ctx; err.indice = indice; err.parcial = parcialAgora();
          throw err;
        }
        const ks = Array.from({ length: Math.min(lote, itens.length - k0) }, (_, j) => k0 + j);
        const feitos = await Promise.all(ks.map(fazerItem));
        for (const [j, { resp, erroItem }] of feitos.entries()) {
          const k = ks[j]; const item = itens[k];
          if (!resp) {
            if (!step.optional) {
              const err = new Error(`passo "${step.id}" falhou no item ${k + 1} de ${itens.length} ("${item.slice(0, 60)}"): ${erroItem.message}`);
              err.step = step.id; err.results = results; err.ctx = ctx; err.indice = indice; err.parcial = parcialAgora();
              throw err;
            }
            falhasItens++;
            partes.push(`--- ${k + 1}. ${item} ---\n[falhou: ${erroItem.message}]`);
            continue;
          }
          partes.push(`--- ${k + 1}. ${item} ---\n${resp.text}`);
        }
      }
      const junto = partes.join('\n\n');
      const gastosPasso = usage.total() - tokensPasso;
      ctx[step.id] = junto;
      if (gastosPasso > 0) console.log(chalk.dim(`(${gastosPasso.toLocaleString('pt-BR')} tokens neste passo)`));
      results.push({ id: step.id, output: junto, itens: itens.length, ...(falhasItens ? { falhasItens } : {}), ...(gastosPasso > 0 ? { tokens: gastosPasso } : {}) });
      console.log(junto);
      continue;
    }
    const tokensAntes = usage.total();
    const prompt = interpolate(step.prompt, ctx);
    const manterHistorico = step.keepHistory ?? workflow.keepHistory ?? false;
    // v0.18.0: opções por passo — retry (0 a 2 novas tentativas se der erro), optional (erro não derruba o
    // workflow: o passo vira "[falhou: ...]"), model (modelo só deste passo) e tools (lista de ferramentas
    // deste passo; só restringe, nunca amplia o que o agente que chamou já tinha).
    const tentativas = 1 + Math.max(0, Math.min(2, Number(step.retry) || 0));
    const opcoes = { history: manterHistorico ? history : [] };
    if (typeof step.model === 'string' && step.model.trim()) opcoes.modelName = step.model.trim();
    if (Array.isArray(step.tools)) opcoes.allowedTools = step.tools.map(String); // [] = passo SEM ferramentas
    console.log(`\n=== Passo: ${step.id} ===`);
    let resposta = null; let ultimoErro = null; let usadas = 0;
    for (let i = 0; i < tentativas && !resposta; i++) {
      usadas++;
      try { resposta = await runOnceFn(prompt, opcoes); } catch (e) {
        ultimoErro = e;
        if (i + 1 < tentativas) console.log(`(tentativa ${i + 1} falhou: ${e.message}; tentando de novo)`);
      }
    }
    const gastos = usage.total() - tokensAntes;
    if (!resposta) {
      if (!step.optional) {
        const err = new Error(`passo "${step.id}" falhou${usadas > 1 ? ` após ${usadas} tentativas` : ''}: ${ultimoErro.message}`);
        err.step = step.id; err.results = results; err.ctx = ctx; err.indice = indice;
        throw err;
      }
      const msg = `[falhou: ${ultimoErro.message}]`;
      ctx[step.id] = msg;
      results.push({ id: step.id, output: msg, falhou: true, tentativas: usadas, ...(gastos > 0 ? { tokens: gastos } : {}) });
      console.log(msg);
      continue;
    }
    const { text, history: novoHistorico } = resposta;
    if (manterHistorico) history = novoHistorico;
    ctx[step.id] = text;
    if (gastos > 0) console.log(chalk.dim(`(${gastos.toLocaleString('pt-BR')} tokens neste passo)`));
    results.push({ id: step.id, output: text, ...(usadas > 1 ? { tentativas: usadas } : {}), ...(gastos > 0 ? { tokens: gastos } : {}) });
    console.log(text);
  }

  return { name: workflow.name, results };
}

/** Mantido por compatibilidade: sempre espera um workflow (com "steps"). */
async function runWorkflow(workflowPath, deps = {}) {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  return runWorkflowData(workflow, deps);
}

/**
 * Abre um chat interativo usando a configuração de uma persona: modelo
 * próprio, instrução extra de sistema e (opcionalmente) uma lista de
 * ferramentas permitidas. Só sai com Ctrl+C, igual ao comando "chat".
 */
async function runPersonaChat(persona) {
  console.log(chalk.bold(`\ngemini-code — agente "${persona.name || 'sem nome'}". Ctrl+C para sair.`));
  if (persona.description) console.log(chalk.dim(persona.description));
  console.log('');

  // Item 8 da revisão: mesma interface compartilhada usada pelo chat comum
  // e pela confirmação de run_shell — evita duas readlines no mesmo stdin.
  const rl = getSharedReadline();
  let history = [];

  const ask = () => perguntarColando(rl, chalk.cyan('você> '), async (line) => {
    if (!line.trim()) return ask();
    try {
      process.stdout.write(chalk.green(`\n${persona.name || 'agente'}> `));
      let streamed = false;
      const { text, history: newHistory } = await runOnce(line, {
        history,
        modelName: persona.model,
        extraSystemInstruction: persona.systemInstructionExtra,
        allowedTools: persona.allowedTools,
        onText: (pedaco) => {
          streamed = true;
          process.stdout.write(pedaco);
        },
      });
      history = newHistory;
      if (!streamed) process.stdout.write(text);
      console.log('\n');
    } catch (err) {
      console.error(chalk.red('Erro: ' + err.message));
    }
    ask();
  });
  ask();
}

/**
 * Lê caminho/agente.json e decide o que fazer:
 * - tem array "steps" -> roda como workflow (passo a passo, sem interação)
 *                        e resolve com { type: 'workflow', result }
 * - senão             -> trata como persona, abre chat interativo e resolve
 *                        com { type: 'persona' } assim que o chat abre
 *                        (o processo continua rodando por causa do
 *                        readline, mesmo com a promise já resolvida)
 */
async function runAgentFile(filePath, deps = {}) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(data.steps)) {
    const result = await runWorkflowData(data, deps);
    return { type: 'workflow', result };
  }
  await runPersonaChat(data);
  return { type: 'persona' };
}

module.exports = { runWorkflow, runWorkflowData, runPersonaChat, runAgentFile, interpolate, analisarVariaveis, avaliarCondicao, extrairItens, MAX_ITENS, MAX_PARALELO, FERRAMENTAS_LEITURA };
