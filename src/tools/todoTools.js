// src/tools/todoTools.js
// Lista de tarefas do agente (padrão de agentes como Claude Code/Codex): em trabalho com vários passos,
// o modelo escreve o plano como checklist e vai atualizando — o usuário vê onde está e o modelo não se perde.
// Fica só na memória do processo (não grava nada em disco, não executa nada).
'use strict';

const STATUS = ['pending', 'in_progress', 'completed'];
const MARCA = { pending: '[ ]', in_progress: '[~]', completed: '[x]' };

let lista = [];

const declarations = [{
  name: 'todo_write',
  description:
    'Cria ou atualiza a lista de tarefas da sessão. Use em trabalho com 3 ou mais passos: escreva o plano, marque UMA tarefa como ' +
    'in_progress por vez e marque completed assim que terminar cada uma. Envie sempre a lista COMPLETA (ela substitui a anterior).',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'O que fazer (curto, no imperativo)' },
            status: { type: 'string', enum: STATUS },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
}];

function render(itens = lista) {
  if (!itens.length) return '(lista de tarefas vazia)';
  const feitas = itens.filter((t) => t.status === 'completed').length;
  return `Tarefas (${feitas}/${itens.length}):\n` + itens.map((t) => `${MARCA[t.status]} ${t.content}`).join('\n');
}

function execute(name, args) {
  if (name !== 'todo_write') throw new Error(`Ferramenta de tarefas desconhecida: ${name}`);
  const todos = args && args.todos;
  if (!Array.isArray(todos)) return 'Erro: todo_write precisa de "todos" (lista de { content, status }).';
  if (todos.length > 30) return 'Erro: no máximo 30 tarefas por lista — agrupe os passos pequenos.';
  const limpa = [];
  for (const t of todos) {
    const content = t && typeof t.content === 'string' ? t.content.trim().replace(/\s+/g, ' ') : '';
    if (!content) return 'Erro: toda tarefa precisa de "content" com texto.';
    if (!t || !STATUS.includes(t.status)) return `Erro: status inválido em "${content}". Use: ${STATUS.join(', ')}.`;
    limpa.push({ content: content.slice(0, 200), status: t.status });
  }
  const andando = limpa.filter((t) => t.status === 'in_progress').length;
  if (andando > 1) return `Erro: só pode haver UMA tarefa in_progress por vez (veio ${andando}). Termine uma antes de começar outra.`;
  lista = limpa;
  return render();
}

function estado() { return lista.map((t) => ({ ...t })); }
function limpar() { lista = []; }

module.exports = { declarations, execute, render, estado, limpar };
