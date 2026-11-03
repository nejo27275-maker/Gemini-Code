// src/comprasCommands.js (v0.46.0) — "gemini-code compras ..." (src/compras.js)
'use strict';

const fs = require('fs');
const path = require('path');
const compras = require('./compras');

const L = (nivel, texto) => ({ nivel, texto });

const AJUDA = [
  'Compras do mês:',
  '  gemini-code compras add "arroz 5kg" [--qtd 2] [--freq mensal|quinzenal|semanal] [--categoria X] [--preco 25,90]',
  '  gemini-code compras lista | remover ITEM | qtd ITEM 3 | preco ITEM 26,50 [--onde mercado]',
  '  gemini-code compras mes                    a compra do mês por seção, com o gasto estimado',
  '  gemini-code compras orcamento 800          (ou "orcamento nenhum")',
  '  gemini-code compras ifood                  copia a lista e abre o iFood — o pedido e o pagamento você faz no app',
  '  gemini-code compras exportar [lista.txt]   texto para WhatsApp/bloco de notas',
];

// v0.46.1: um "--opção" sem valor no fim entrava no nome ("compras exportar --help" criava o arquivo "--help";
// "compras add arroz --qtd" criava o item "arroz --qtd"). Agora vira uma opção ligada (true).
function lerFlags(itens) {
  const flags = { _: [] };
  for (let i = 0; i < itens.length; i++) {
    const it = String(itens[i]);
    if (it.startsWith('--') && it.length > 2) {
      const prox = itens[i + 1];
      flags[it.slice(2)] = prox !== undefined && !String(prox).startsWith('--') ? String(itens[++i]) : true;
    } else {
      flags._.push(it);
    }
  }
  return flags;
}

async function executar(args, deps = {}) {
  const [sub = 'ajuda', ...resto] = args;
  const store = deps.store || compras.createComprasStore();
  const ok = (...linhas) => ({ linhas, codigo: 0 });
  const falha = (texto) => ({ linhas: [L('erro', texto)], codigo: 1 });
  const f = lerFlags(resto);
  const ref = f._.join(' ').trim();
  try {
    switch (sub) {
      case 'ajuda': case 'help': case '--help': case '-h': return ok(...AJUDA.map((t) => L('texto', t)));
      case 'add': case 'adicionar': {
        if (!ref) return falha('Uso: gemini-code compras add "arroz 5kg" [--qtd 2] [--freq mensal]');
        const i = store.adicionar(ref, { quantidade: f.qtd, frequencia: f.freq, categoria: f.categoria, preco: f.preco, onde: f.onde });
        return ok(L('ok', `Na lista: ${i.quantidade}x ${i.nome} (${i.frequencia}, ${i.categoria}) [${i.id}]`));
      }
      case 'lista': case 'listar': {
        const itens = store.itens();
        if (!itens.length) return ok(L('dim', 'Lista vazia. Ex.: gemini-code compras add "arroz 5kg" --qtd 2'));
        return ok(...itens.map((i) => L('texto', `${i.id} | ${i.quantidade}x ${i.nome} | ${i.frequencia} | ${i.categoria}${i.precos.length ? ` | ${compras.real(i.precos[i.precos.length - 1].valor)}` : ''}`)));
      }
      case 'remover': case 'tirar': {
        const i = store.remover(ref);
        return i ? ok(L('ok', `Tirei da lista: ${i.nome}`)) : falha(`Não achei "${ref}" na lista.`);
      }
      case 'qtd': case 'quantidade': {
        if (f._.length < 2) return falha('Uso: gemini-code compras qtd ITEM 3   (veja os itens com: compras lista)');
        const q = f._.pop();
        const i = store.mudar(f._.join(' '), { quantidade: q });
        return ok(L('ok', `${i.nome}: ${i.quantidade} por compra (${i.frequencia}).`));
      }
      case 'preco': case 'preço': {
        if (f._.length < 2) return falha('Uso: gemini-code compras preco ITEM 26,50 [--onde mercado]');
        const v = f._.pop();
        const i = store.preco(f._.join(' '), v, { onde: f.onde });
        return ok(L('ok', `${i.nome}: ${compras.real(i.precos[i.precos.length - 1].valor)}${f.onde ? ` (${f.onde})` : ''}`));
      }
      case 'orcamento': case 'orçamento': {
        if (!ref) { const o = store.orcamento(); return ok(L('texto', o ? `Orçamento do mês: ${compras.real(o)}` : 'Sem orçamento definido.')); }
        const o = store.orcamento(['nenhum', 'off', '0'].includes(ref.toLowerCase()) ? null : ref);
        return ok(L('ok', o ? `Orçamento do mês: ${compras.real(o)}` : 'Orçamento removido.'));
      }
      case 'mes': case 'mês': {
        const mes = compras.listaDoMes(store);
        if (!Object.keys(mes.porSecao).length) return ok(L('dim', 'Lista vazia. Ex.: gemini-code compras add "arroz 5kg" --qtd 2'));
        const linhas = compras.textoDaLista(mes).split('\n').map((t) => L(/PASSA/.test(t) ? 'erro' : /^\*/.test(t) ? 'ok' : 'texto', t.replace(/\*/g, '')));
        return ok(...linhas);
      }
      case 'exportar': {
        const mes = compras.listaDoMes(store);
        if (!Object.keys(mes.porSecao).length) return falha('A lista está vazia: adicione itens com "gemini-code compras add".');
        const texto = compras.textoDaLista(mes);
        const nome = typeof f.saida === 'string' ? f.saida : ref;
        if (f.saida === true) return falha('Uso: gemini-code compras exportar [lista.txt]   (ou --saida lista.txt)');
        if (!nome) return ok(...texto.split('\n').map((t) => L('texto', t)));
        if (nome.startsWith('-')) return falha(`Nome de arquivo inválido: "${nome}" (não pode começar com "-").`);
        const destino = path.resolve(deps.cwd || process.cwd(), nome);
        const { isProtected, isSecret } = require('./tools/protectedPaths');
        if (isProtected(destino) || isSecret(destino)) return falha('Esse caminho é protegido do gemini-code; escolha outro lugar.');
        try {
          fs.writeFileSync(destino, `${texto}\n`, { flag: 'wx' });
        } catch (e) {
          if (e.code === 'EEXIST') return falha(`Já existe ${destino}; escolha outro nome (nada foi sobrescrito).`);
          if (e.code === 'ENOENT') return falha(`A pasta de ${destino} não existe.`);
          throw e;
        }
        return ok(L('ok', `Lista salva em ${destino}`));
      }
      case 'ifood': {
        const mes = compras.listaDoMes(store);
        if (!Object.keys(mes.porSecao).length) return falha('A lista está vazia: adicione itens com "gemini-code compras add".');
        const texto = compras.textoDaLista(mes, { comPrecos: false });
        const abrir = deps.abrir || require('./abrir');
        const copiou = await abrir.copiar(texto);
        const abriu = await abrir.abrir(compras.IFOOD);
        return ok(
          ...texto.split('\n').map((t) => L('texto', t.replace(/\*/g, ''))),
          L(copiou ? 'ok' : 'aviso', copiou ? 'Lista copiada: no iFood, vá em Mercado e use a busca item por item.' : 'Não consegui copiar sozinho (no celular: pkg install termux-api). Copie a lista acima.'),
          L(abriu ? 'ok' : 'aviso', abriu ? `Abrindo ${compras.IFOOD}` : `Abra o iFood: ${compras.IFOOD}`),
          L('dim', 'O pedido e o pagamento você confirma no app do iFood — o gemini-code não guarda senha nem cartão e não fecha compra sozinho.'),
        );
      }
      default:
        return { linhas: [L('erro', `Subcomando desconhecido: ${sub}`), ...AJUDA.map((t) => L('texto', t))], codigo: 1 };
    }
  } catch (e) {
    return falha(`Erro: ${e.message}`);
  }
}

module.exports = { executar, AJUDA };
