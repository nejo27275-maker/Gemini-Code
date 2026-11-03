// src/tools/desafioTools.js (v0.47.0) — a ferramenta "desafio" do agente (src/desafios.js)
// Sob demanda (aliados "desafios", "redes" e "central", ou ferramentasExtras). Ver e marcar o dia não pergunta (é o
// que a pessoa contou); criar um desafio com lembrete agenda uma notificação diária — pergunta antes. Postar o
// progresso é com a ferramenta "redes" (que pergunta de novo).
'use strict';

let deps = {
  ask: (q) => require('../ui/prompt').ask(q),
  store: () => require('../desafios').createDesafiosStore(),
  rotinas: () => require('../routines').createRoutineStore(),
};

const declarations = [
  {
    name: 'desafio',
    description:
      'Desafios pessoais do usuário ("30 dias de caminhada", "21 dias sem açúcar"): "lista" (todos, com progresso e ' +
      'sequência), "criar" (nome, dias, hora do lembrete diário — o usuário confirma), "feito" (marca HOJE quando a pessoa ' +
      'contar que fez; nota opcional) e "progresso" (um desafio: dias feitos, sequência, calendário e o texto pronto para ' +
      'postar). Para publicar o progresso, use a ferramenta redes com o texto devolvido.',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['lista', 'criar', 'feito', 'progresso'] },
        desafio: { type: 'string', description: 'feito/progresso: nome ou id (opcional se só houver um ativo)' },
        nome: { type: 'string', description: 'criar: nome do desafio' },
        dias: { type: 'integer', description: 'criar: duração em dias (padrão 30)' },
        hora: { type: 'string', description: 'criar: hora do lembrete diário, ex.: 07:00 (opcional)' },
        hashtag: { type: 'string', description: 'criar: hashtag para os posts, sem # (opcional)' },
        nota: { type: 'string', description: 'feito: o que a pessoa fez hoje, ex.: "5 km"' },
      },
      required: ['acao'],
    },
  },
];

const sim = (r) => ['s', 'sim', 'y', 'yes'].includes(String(r || '').trim().toLowerCase());

async function execute(name, args = {}) {
  if (name !== 'desafio') throw new Error(`Ferramenta de desafios desconhecida: ${name}`);
  const a = args && typeof args === 'object' ? args : {};
  const d = require('../desafios');
  try {
    const store = deps.store();
    const hoje = store.hoje();
    switch (a.acao) {
      case 'lista': {
        const lista = store.lista().filter((x) => x.ativo);
        if (!lista.length) return 'Nenhum desafio ativo.';
        return lista.map((x) => {
          const p = d.progresso(x, hoje);
          return `${x.id} | ${x.nome} | dia ${p.diaAtual}/${x.dias} | ${p.feitos} feitos (${p.porcentagem}%) | sequência ${p.sequencia} | hoje ${p.hojeFeito ? 'feito' : 'falta'}${p.terminou ? ' | terminou' : ''}`;
        }).join('\n');
      }
      case 'criar': {
        const { paraExibir } = require('../ui/textoSeguro');
        const nome = typeof a.nome === 'string' ? a.nome : '';
        const resp = await deps.ask(`\n[gemini-code] Criar o desafio "${paraExibir(nome.slice(0, 80))}" (${Number(a.dias) || 30} dias${a.hora ? `, lembrete todo dia às ${paraExibir(String(a.hora))}` : ''})? (s/n) `);
        if (!sim(resp)) return 'O usuário não quis criar o desafio.';
        const x = store.criar({ nome, dias: a.dias === undefined ? 30 : a.dias, hora: a.hora, hashtag: a.hashtag });
        if (x.hora) {
          const routines = require('../routines');
          store.ligarRotina(x.id, d.criarLembrete(x, { rotinas: deps.rotinas(), timezone: routines.DEFAULT_TIMEZONE }));
        }
        return `Desafio criado [${x.id}]: ${x.nome}, ${x.dias} dias (${x.inicio} a ${d.somarDias(x.inicio, x.dias - 1)})${x.hora ? `, lembrete às ${x.hora}` : ''}.`;
      }
      case 'feito': {
        const r = store.feito(a.desafio, { nota: a.nota });
        return `Marcado: ${r.desafio.nome}, dia ${r.progresso.diaAtual}/${r.desafio.dias}. Sequência: ${r.progresso.sequencia}. ` +
          `${r.progresso.feitos === r.desafio.dias ? 'DESAFIO COMPLETO! ' : ''}Texto para postar (se a pessoa quiser): ${d.textoDoDia(r.desafio, r.progresso, r.nota)}`;
      }
      case 'progresso': {
        const x = store.achar(a.desafio);
        if (!x) return 'Erro: desafio não encontrado (veja com acao "lista").';
        const p = d.progresso(x, hoje);
        return [
          `${x.nome} — ${x.inicio} a ${p.fim}: ${p.feitos}/${x.dias} feitos (${p.porcentagem}%), sequência ${p.sequencia}, melhor ${p.melhorSequencia}.`,
          d.calendario(x, hoje), '✓ feito  · perdido  ○ por vir',
          `Texto para postar: ${d.textoDoDia(x, p)}`,
        ].join('\n');
      }
      default:
        return 'Erro: desafio precisa de "acao": lista, criar, feito ou progresso.';
    }
  } catch (e) {
    return `Erro: ${e.message}`;
  }
}

function _testar(novas = {}) { deps = { ...deps, ...novas }; }

module.exports = { declarations, execute, _testar };
