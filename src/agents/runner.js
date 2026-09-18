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
const readline = require('readline');
const chalk = require('chalk');
const { runOnce } = require('../agent');

function interpolate(template, ctx) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] ?? '');
}

async function runWorkflowData(workflow) {
  const ctx = {};
  const results = [];

  for (const step of workflow.steps) {
    const prompt = interpolate(step.prompt, ctx);
    console.log(`\n=== Passo: ${step.id} ===`);
    const { text } = await runOnce(prompt);
    ctx[step.id] = text;
    results.push({ id: step.id, output: text });
    console.log(text);
  }

  return { name: workflow.name, results };
}

/** Mantido por compatibilidade: sempre espera um workflow (com "steps"). */
async function runWorkflow(workflowPath) {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  return runWorkflowData(workflow);
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let history = [];

  const ask = () => rl.question(chalk.cyan('você> '), async (line) => {
    if (!line.trim()) return ask();
    try {
      const { text, history: newHistory } = await runOnce(line, {
        history,
        modelName: persona.model,
        extraSystemInstruction: persona.systemInstructionExtra,
        allowedTools: persona.allowedTools,
      });
      history = newHistory;
      console.log(chalk.green(`\n${persona.name || 'agente'}> `) + text + '\n');
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
async function runAgentFile(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(data.steps)) {
    const result = await runWorkflowData(data);
    return { type: 'workflow', result };
  }
  await runPersonaChat(data);
  return { type: 'persona' };
}

module.exports = { runWorkflow, runWorkflowData, runPersonaChat, runAgentFile };
