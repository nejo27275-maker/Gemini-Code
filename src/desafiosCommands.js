// src/desafiosCommands.js (v0.47.0) — "gemini-code desafio ..." (src/desafios.js)
'use strict';

const desafios = require('./desafios');

const L = (nivel, texto) => ({ nivel, texto });

const AJUDA = [
  'Desafios (30 dias de caminhada, 21 dias sem açúcar, 1 post por dia...):',
  '  gemini-code desafio criar "30 dias de caminhada" [--dias 30] [--hora 07:00] [--redes bluesky,mastodon] [--hashtag desafio30dias]',
  '  gemini-code desafio feito [NOME] [--nota "5 km"] [--postar]   marca o dia de hoje (e posta o progresso, perguntando antes)',
  '  gemini-code desafio lista | ver [NOME] | desmarcar [NOME] | parar NOME',
  '  gemini-code desafio aliado                                    um aliado que acompanha e comemora com você',
];

function lerFlags(itens) {
  const flags = { _: [] };
  for (let i = 0; i < itens.length; i++) {
    const it = String(itens[i]);
    if (it.startsWith('--') && it.length > 2) {
      const prox = itens[i + 1];
      flags[it.slice(2)] = prox !== undefined && !String(prox).startsWith('--') ? String(itens[++i]) : true;
    } else flags._.push(it);
  }
  return flags;
}
const texto = (v) => (typeof v === 'string' ? v : undefined);
const sim = (r) => ['s', 'sim', 'y', 'yes'].includes(String(r || '').trim().toLowerCase());

function resumoDe(d, hoje) {
  const p = desafios.progresso(d, hoje);
  const estado = !d.ativo ? 'parado' : p.terminou ? 'terminou' : !p.comecou ? `começa em ${d.inicio}` : p.hojeFeito ? 'hoje: feito ✓' : 'hoje: falta';
  return { p, linha: `${d.id} | ${d.nome} | dia ${p.diaAtual}/${d.dias} | ${desafios.barra(p.porcentagem, 10)} | sequência ${p.sequencia} (melhor ${p.melhorSequencia}) | ${estado}` };
}

/**
 * @param {string[]} args depois de "desafio"
 * @param {{ store?, rotinas?, redesStore?, cliente?, ask?, aliados?, mostrar? }} deps
 */
async function executar(args, deps = {}) {
  const [sub = 'lista', ...resto] = args;
  const store = deps.store || desafios.createDesafiosStore();
  const ask = deps.ask || ((p) => require('./ui/prompt').ask(p));
  const mostrar = deps.mostrar || ((t) => console.log(require('./ui/textoSeguro').paraTerminal(t)));
  const ok = (...linhas) => ({ linhas, codigo: 0 });
  const falha = (t) => ({ linhas: [L('erro', t)], codigo: 1 });
  const f = lerFlags(resto);
  const hoje = store.hoje();
  try {
    switch (sub) {
      case 'ajuda': case 'help': case '--help': case '-h':
        return ok(...AJUDA.map((t) => L('texto', t)));

      case 'criar': case 'novo': {
        const nome = f._.join(' ').trim();
        if (!nome) return falha(AJUDA[1].trim());
        const d = store.criar({ nome, dias: f.dias === undefined ? 30 : f.dias, hora: texto(f.hora), redes: texto(f.redes), hashtag: texto(f.hashtag) });
        const linhas = [L('ok', `Desafio criado [${d.id}]: ${d.nome} — ${d.dias} dias, de ${d.inicio} a ${desafios.somarDias(d.inicio, d.dias - 1)}.`)];
        if (d.hora) {
          const routines = require('./routines');
          const rotinas = deps.rotinas || routines.createRoutineStore();
          const id = desafios.criarLembrete(d, { rotinas, timezone: texto(f.timezone) || routines.DEFAULT_TIMEZONE });
          store.ligarRotina(d.id, id);
          linhas.push(L('dim', `Lembrete todo dia às ${d.hora} até o fim do desafio (o agendador precisa estar rodando: gemini-code routines service).`));
        }
        linhas.push(L('dim', 'Marque cada dia com: gemini-code desafio feito'));
        return ok(...linhas);
      }

      case 'feito': case 'fiz': case 'marcar': {
        const r = store.feito(f._.join(' ').trim(), { nota: texto(f.nota) });
        const linhas = [
          L('ok', `✓ ${r.desafio.nome}: dia ${r.progresso.diaAtual}/${r.desafio.dias} marcado. Sequência: ${r.progresso.sequencia} dia(s) seguido(s).`),
          L('texto', desafios.barra(r.progresso.porcentagem)),
        ];
        if (r.progresso.feitos === r.desafio.dias) linhas.push(L('ok', '🏆 Desafio completo! Todos os dias feitos.'));
        const postar = f.postar === true || (r.desafio.redes.length && f.postar !== 'nao');
        if (!postar) return ok(...linhas);
        const redes = require('./redes');
        const redesStore = deps.redesStore || redes.createRedesStore();
        const alvo = r.desafio.redes.length ? r.desafio.redes : redesStore.contas().filter((c) => c.conectada).map((c) => c.rede);
        if (!alvo.length) { linhas.push(L('dim', 'Para postar o progresso, conecte uma rede: gemini-code redes conectar bluesky (ou use: gemini-code redes compartilhar "..." --em whatsapp)')); return ok(...linhas); }
        const plano = redes.planejar({ texto: desafios.textoDoDia(r.desafio, r.progresso, r.nota), redes: alvo }, { store: redesStore });
        mostrar(redes.textoDoPlano(plano));
        const prontas = plano.itens.filter((i) => i.ok);
        if (!prontas.length) { linhas.push(L('aviso', 'Nenhuma rede pronta para postar (veja os ✗ acima).')); return ok(...linhas); }
        if (f.sim !== true && !sim(await ask(`Postar o progresso em ${prontas.map((i) => i.nome).join(', ')}? (s/n) `))) { linhas.push(L('dim', 'Não postado.')); return ok(...linhas); }
        const res = await redes.publicar(plano, { store: redesStore, ...(deps.cliente ? { cliente: deps.cliente } : {}) });
        for (const x of res) linhas.push(x.ok ? L('ok', `✓ ${x.nome}: postado${x.url ? ` — ${x.url}` : ''}`) : L('erro', `✗ ${x.nome}: ${x.erro}`));
        return ok(...linhas);
      }

      case 'desmarcar': {
        return store.desmarcar(f._.join(' ').trim()) ? ok(L('ok', 'Hoje desmarcado.')) : falha('Hoje não estava marcado.');
      }

      case 'lista': case 'listar': {
        const lista = store.lista();
        if (!lista.length) return ok(L('dim', 'Nenhum desafio ainda. Ex.: gemini-code desafio criar "30 dias de caminhada" --hora 07:00'));
        return ok(...lista.map((d) => { const { p, linha } = resumoDe(d, hoje); return L(!d.ativo || p.terminou ? 'dim' : p.hojeFeito ? 'ok' : 'texto', linha); }));
      }

      case 'ver': {
        const d = store.achar(f._.join(' ').trim());
        if (!d) return falha('Desafio não encontrado. Veja os seus com: gemini-code desafio lista');
        const { p } = resumoDe(d, hoje);
        return ok(
          L('texto', `${d.nome} [${d.id}] — ${d.inicio} a ${p.fim}${d.hora ? ` · lembrete às ${d.hora}` : ''}${d.redes.length ? ` · posta em ${d.redes.join(', ')}` : ''}`),
          L('texto', desafios.barra(p.porcentagem)),
          L('texto', `Feitos: ${p.feitos}/${d.dias} · sequência: ${p.sequencia} · melhor: ${p.melhorSequencia}`),
          ...desafios.calendario(d, hoje).split('\n').map((t) => L('texto', t)),
          L('dim', '✓ feito  · perdido  ○ por vir'),
        );
      }

      case 'parar': case 'cancelar': {
        if (!f._.length) return falha('Uso: gemini-code desafio parar NOME (veja com: desafio lista)');
        const d = store.parar(f._.join(' ').trim());
        if (d.rotinaId) {
          const rotinas = deps.rotinas || require('./routines').createRoutineStore();
          try { rotinas.pause(d.rotinaId); rotinas.remove(d.rotinaId); } catch { /* já removida */ }
        }
        return ok(L('ok', `Desafio "${d.nome}" parado${d.rotinaId ? ' (e o lembrete dele)' : ''}.`));
      }

      case 'aliado': {
        const aliados = deps.aliados || require('./personalAgents').defaultStore;
        if (aliados.existe('desafios')) return ok(L('dim', 'O aliado "desafios" já existe. Converse com: gemini-code aliados chat desafios'));
        aliados.criar({
          name: 'desafios', description: 'acompanha seus desafios: metas do dia, lembrete, sequência e post do progresso',
          instructions: desafios.INSTRUCOES_ALIADO, tools: 'desafios', memory: 'confirmar',
          starters: ['Quero começar um desafio de 30 dias de leitura', 'Como estou no meu desafio?', 'Fiz hoje! Posta meu progresso'],
        });
        return ok(L('ok', 'Aliado "desafios" criado. Converse com: gemini-code aliados chat desafios'));
      }

      default:
        return { linhas: [L('erro', `Subcomando desconhecido: ${sub}`), ...AJUDA.map((t) => L('texto', t))], codigo: 1 };
    }
  } catch (e) {
    return falha(`Erro: ${e.message}`);
  }
}

module.exports = { executar, AJUDA };
