// src/compras.js (v0.46.0) — lista de compras do mês (e a ponte para o iFood)
// Guarda os itens com a frequência (mensal, quinzenal, semanal), separa por seção do mercado, estima o gasto do mês
// pelos últimos preços e compara com o orçamento. Para comprar pelo iFood, monta a lista, copia para a área de
// transferência e abre o iFood — o PEDIDO E O PAGAMENTO a pessoa faz no app.
// Por que não compra sozinho: o iFood não tem uma forma oficial (API) para alguém de fora fazer pedidos, automatizar o
// app com a sua senha e o seu cartão iria contra os termos dele, e pagamento é o tipo de coisa que o gemini-code
// nunca faz sem você: se um texto de página convencesse o modelo, ele não pode gastar o seu dinheiro.
'use strict';

const crypto = require('crypto');
const path = require('path');
const { lerJson, escreverJson } = require('./jsonStore');

const VERSAO = 1;
const MAX_ITENS = 500;
const FREQUENCIAS = Object.freeze({ mensal: 1, quinzenal: 2, semanal: 4 });
const IFOOD = 'https://www.ifood.com.br/';

// Seção do mercado pelo nome (a primeira que casar vence). Dá para corrigir com --categoria.
const SECOES = [
  ['hortifrúti', /\b(banana|maca|maçã|laranja|limao|limão|tomate|cebola|alho|batata|cenoura|alface|couve|abacate|mamao|mamão|uva|melancia|abobrinha|pimentao|pimentão|verdura|fruta|legume|ovo|ovos)\b/],
  ['açougue e frios', /\b(carne|frango|peito|coxa|picanha|patinho|alcatra|linguica|linguiça|bacon|presunto|mortadela|salsicha|peixe|tilapia|tilápia|carne moida|moída|hamburguer|hambúrguer)\b/],
  ['laticínios', /\b(leite|queijo|iogurte|manteiga|margarina|requeijao|requeijão|creme de leite|nata)\b/],
  ['padaria', /\b(pao|pão|bolo|torrada|biscoito|bolacha|rosca)\b/],
  ['bebidas', /\b(agua|água|refrigerante|suco|cerveja|vinho|cafe|café|cha|chá|achocolatado)\b/],
  ['limpeza', /\b(detergente|sabao|sabão|amaciante|desinfetante|agua sanitaria|água sanitária|esponja|multiuso|limpador|alvejante|saco de lixo)\b/],
  ['higiene', /\b(sabonete|shampoo|xampu|condicionador|creme dental|pasta de dente|escova|papel higienico|papel higiênico|desodorante|absorvente|fralda|algodao|algodão)\b/],
  ['mercearia', /\b(arroz|feijao|feijão|macarrao|macarrão|oleo|óleo|azeite|acucar|açúcar|sal|farinha|fuba|fubá|milho|molho|extrato|sardinha|atum|aveia|granola|tempero|vinagre|cereal|enlatado)\b/],
];

// sem acento: o \b das regex do JavaScript não entende "ç"/"ã" como letra ("maçã" nunca casaria)
function semAcentoMinusculo(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function secaoDe(nome) {
  const n = semAcentoMinusculo(nome);
  const achada = SECOES.find(([, re]) => re.test(n));
  return achada ? achada[0] : 'outros';
}

const real = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

// v0.46.1: valores vindos do modelo/linha de comando. Antes um objeto virava o item "[object Object]" e a frequência
// "constructor" passava (FREQUENCIAS["constructor"] é uma função, "verdadeira").
const ehFrequencia = (f) => typeof f === 'string' && Object.prototype.hasOwnProperty.call(FREQUENCIAS, f.trim().toLowerCase());
const PRECISA_ITEM = 'Informe o item (o nome ou o id; veja com: compras lista).';
function textoCurto(v, max) {
  if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return '';
  const { semControlesInvisiveis } = require('./ui/textoSeguro');
  return semControlesInvisiveis(String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
}

function lerValor(v) {
  const n = Number(String(v ?? '').replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!(n > 0 && n < 100000)) throw new Error(`Valor inválido: "${v}" (use 25,90).`);
  return Math.round(n * 100) / 100;
}

function createComprasStore({ arquivo, clock = () => new Date() } = {}) {
  const caminho = arquivo || path.join(require('./config').HOME_DIR, 'compras.json');
  const vazio = () => ({ version: VERSAO, orcamento: null, itens: [] });
  const ler = () => lerJson(caminho, (d) => d && d.version === VERSAO && Array.isArray(d.itens), vazio);
  const gravar = (d) => escreverJson(caminho, d, { mode: 0o600 });

  function achar(d, ref) {
    const r = semAcentoMinusculo(textoCurto(ref, 200));
    if (!r) throw new Error(PRECISA_ITEM);
    return d.itens.find((i) => i.id === r) || d.itens.find((i) => semAcentoMinusculo(i.nome) === r) || d.itens.find((i) => semAcentoMinusculo(i.nome).includes(r)) || null;
  }

  function adicionar(nome, { quantidade, frequencia, categoria, preco, onde } = {}) {
    const n = typeof nome === 'string' ? textoCurto(nome, 101) : '';
    if (!n || n.length > 100) throw new Error('Informe o item (até 100 caracteres), ex.: "arroz 5kg".');
    if (frequencia !== undefined && frequencia !== null && frequencia !== '' && !ehFrequencia(frequencia)) {
      throw new Error(`Frequência inválida: ${typeof frequencia === 'string' ? `"${frequencia.slice(0, 40)}"` : 'precisa ser um texto'}. Use: ${Object.keys(FREQUENCIAS).join(', ')}.`);
    }
    const freq = ehFrequencia(frequencia) ? frequencia.trim().toLowerCase() : 'mensal';
    const qtd = quantidade === undefined || quantidade === null ? 1 : Number(String(quantidade).replace(',', '.'));
    if (!(qtd > 0 && qtd <= 1000)) throw new Error('Quantidade inválida (use um número, ex.: 2).');
    const d = ler();
    const igual = achar(d, n);
    if (igual && semAcentoMinusculo(igual.nome) === semAcentoMinusculo(n)) throw new Error(`"${n}" já está na lista (mude com: compras quantidade/preço).`);
    if (d.itens.length >= MAX_ITENS) throw new Error(`No máximo ${MAX_ITENS} itens.`);
    const item = {
      id: crypto.randomBytes(3).toString('hex'), nome: n, quantidade: qtd, frequencia: freq,
      categoria: textoCurto(categoria, 40).toLowerCase() || secaoDe(n), precos: [],
    };
    if (preco !== undefined && preco !== null && preco !== '') item.precos.push({ data: clock().toISOString(), valor: lerValor(preco), ...(textoCurto(onde, 40) ? { onde: textoCurto(onde, 40) } : {}) });
    d.itens.push(item);
    gravar(d);
    return item;
  }

  function remover(ref) {
    const d = ler();
    const item = achar(d, ref);
    if (!item) return null;
    d.itens = d.itens.filter((i) => i.id !== item.id);
    gravar(d);
    return item;
  }

  function preco(ref, valor, { onde } = {}) {
    const d = ler();
    const item = achar(d, ref);
    if (!item) throw new Error(`Não achei "${ref}" na lista.`);
    item.precos.push({ data: clock().toISOString(), valor: lerValor(valor), ...(textoCurto(onde, 40) ? { onde: textoCurto(onde, 40) } : {}) });
    item.precos = item.precos.slice(-24);
    gravar(d);
    return item;
  }

  function mudar(ref, { quantidade, frequencia, categoria } = {}) {
    const d = ler();
    const item = achar(d, ref);
    if (!item) throw new Error(`Não achei "${ref}" na lista.`);
    if (quantidade !== undefined && quantidade !== null) {
      const q = Number(String(quantidade).replace(',', '.'));
      if (!(q > 0 && q <= 1000)) throw new Error('Quantidade inválida (use um número, ex.: 2).');
      item.quantidade = q;
    }
    if (frequencia !== undefined && frequencia !== null && frequencia !== '') {
      if (!ehFrequencia(frequencia)) throw new Error(`Frequência inválida. Use: ${Object.keys(FREQUENCIAS).join(', ')}.`);
      item.frequencia = frequencia.trim().toLowerCase();
    }
    if (categoria !== undefined && textoCurto(categoria, 40)) item.categoria = textoCurto(categoria, 40).toLowerCase();
    gravar(d);
    return item;
  }

  function orcamento(valor) {
    const d = ler();
    if (valor !== undefined) { d.orcamento = valor === null ? null : lerValor(valor); gravar(d); }
    return d.orcamento;
  }

  return { caminho, adicionar, remover, preco, mudar, orcamento, itens: () => ler().itens };
}

/** A compra do mês: quantidade x frequência, por seção, com o gasto estimado pelos últimos preços. */
function listaDoMes(store) {
  const itens = store.itens();
  const linhas = itens.map((i) => {
    const qtd = i.quantidade * (ehFrequencia(i.frequencia) ? FREQUENCIAS[i.frequencia.trim().toLowerCase()] : 1);
    const ultimo = i.precos.length ? i.precos[i.precos.length - 1].valor : null;
    return { ...i, qtdMes: Math.round(qtd * 100) / 100, ultimoPreco: ultimo, custo: ultimo === null ? null : Math.round(ultimo * qtd * 100) / 100 };
  });
  const porSecao = {};
  for (const l of linhas) (porSecao[l.categoria] = porSecao[l.categoria] || []).push(l);
  const total = linhas.reduce((s, l) => s + (l.custo || 0), 0);
  return { porSecao, total: Math.round(total * 100) / 100, semPreco: linhas.filter((l) => l.custo === null).length, orcamento: store.orcamento() };
}

const fmtQtd = (q) => (Number.isInteger(q) ? String(q) : String(q).replace('.', ','));

/** Texto pronto para colar (WhatsApp, iFood, bloco de notas). */
function textoDaLista(mes, { comPrecos = true } = {}) {
  const secoes = Object.keys(mes.porSecao).sort((a, b) => (a === 'outros') - (b === 'outros') || a.localeCompare(b));
  const linhas = ['🛒 Compras do mês'];
  for (const s of secoes) {
    linhas.push('', `*${s[0].toUpperCase()}${s.slice(1)}*`);
    for (const l of mes.porSecao[s]) linhas.push(`- ${fmtQtd(l.qtdMes)}x ${l.nome}${comPrecos && l.custo !== null ? ` (~${real(l.custo)})` : ''}`);
  }
  if (comPrecos) {
    linhas.push('', `Estimativa: ${real(mes.total)}${mes.semPreco ? ` (+ ${mes.semPreco} item(ns) sem preço)` : ''}`);
    if (mes.orcamento) linhas.push(`Orçamento: ${real(mes.orcamento)} — ${mes.total <= mes.orcamento ? `sobra ${real(mes.orcamento - mes.total)}` : `PASSA ${real(mes.total - mes.orcamento)}`}`);
  }
  return linhas.join('\n');
}

module.exports = { FREQUENCIAS, IFOOD, SECOES, secaoDe, lerValor, real, createComprasStore, listaDoMes, textoDaLista };
