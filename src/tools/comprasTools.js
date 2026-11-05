// src/tools/comprasTools.js (v0.46.0) — a ferramenta "compras" do agente (src/compras.js)
// Sob demanda (aliado com o preset "compras" ou ferramentasExtras). Só mexe na lista local de compras: não compra,
// não paga e não abre nada — o pedido no iFood a pessoa faz no app ("gemini-code compras ifood" copia a lista).
'use strict';

let criarStore = () => require('../compras').createComprasStore();

const declarations = [
  {
    name: 'compras',
    description:
      'Lista de compras do mês do usuário: "adicionar" (item, quantidade, frequência mensal/quinzenal/semanal, preço), ' +
      '"remover", "quantidade", "preco" (registra o preço pago), "lista" e "mes" (a compra do mês por seção do mercado, ' +
      'com o gasto estimado e o orçamento). Não faz pedidos nem pagamentos: no fim, sugira "gemini-code compras ifood".',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['adicionar', 'remover', 'quantidade', 'preco', 'lista', 'mes'] },
        item: { type: 'string', description: 'Nome do item (ex.: "arroz 5kg") ou o id da lista' },
        quantidade: { type: 'number', description: 'Quantas unidades por compra' },
        frequencia: { type: 'string', enum: ['mensal', 'quinzenal', 'semanal'] },
        preco: { type: 'string', description: 'Preço pago, ex.: "25,90"' },
        onde: { type: 'string', description: 'Onde comprou (opcional)' },
      },
      required: ['acao'],
    },
  },
];

async function execute(name, args = {}) {
  if (name !== 'compras') throw new Error(`Ferramenta de compras desconhecida: ${name}`);
  const c = require('../compras');
  const a = args && typeof args === 'object' ? args : {};
  const store = criarStore();
  try {
    switch (a.acao) {
      case 'adicionar': {
        const i = store.adicionar(a.item, { quantidade: a.quantidade, frequencia: a.frequencia, preco: a.preco, onde: a.onde });
        return `Na lista: ${i.quantidade}x ${i.nome} (${i.frequencia}, ${i.categoria}) [${i.id}]`;
      }
      case 'remover': {
        const i = store.remover(a.item);
        return i ? `Tirei da lista: ${i.nome}` : `Erro: não achei "${a.item}" na lista.`;
      }
      case 'quantidade': {
        const i = store.mudar(a.item, { quantidade: a.quantidade, frequencia: a.frequencia });
        return `${i.nome}: ${i.quantidade} por compra (${i.frequencia}).`;
      }
      case 'preco': {
        const i = store.preco(a.item, a.preco, { onde: a.onde });
        return `${i.nome}: ${c.real(i.precos[i.precos.length - 1].valor)} registrado.`;
      }
      case 'lista': {
        const itens = store.itens();
        return itens.length ? itens.map((i) => `${i.id} | ${i.quantidade}x ${i.nome} | ${i.frequencia} | ${i.categoria}`).join('\n') : 'A lista está vazia.';
      }
      case 'mes': {
        const mes = c.listaDoMes(store);
        return Object.keys(mes.porSecao).length ? c.textoDaLista(mes) : 'A lista está vazia.';
      }
      default:
        return 'Erro: compras precisa de "acao": adicionar, remover, quantidade, preco, lista ou mes.';
    }
  } catch (e) {
    return `Erro: ${e.message}`;
  }
}

function _testar({ store } = {}) { if (store) criarStore = () => store; }

module.exports = { declarations, execute, _testar };
