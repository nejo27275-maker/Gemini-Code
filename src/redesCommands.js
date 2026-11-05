// src/redesCommands.js (v0.47.0) — "gemini-code redes ..." (src/redes.js)
// Conectar (segredos perguntados sem eco, nunca como argumento: o histórico do shell guardaria), testar, publicar
// (mostra o post e pergunta), compartilhar por link (sem conta), ler menções, agendar post e o aliado "redes".
'use strict';

const redes = require('./redes');

const L = (nivel, texto) => ({ nivel, texto });

const AJUDA = [
  'Redes sociais — pelas APIs oficiais, com tokens SEUS (nunca a sua senha):',
  '  gemini-code redes                                     o que está conectado e como conectar cada rede',
  '  gemini-code redes conectar bluesky                    pergunta o @ e a senha de APP (sem mostrar na tela)',
  '  gemini-code redes conectar mastodon --instancia https://mastodon.social',
  '  gemini-code redes conectar telegram --chat @meucanal',
  '  gemini-code redes conectar discord | facebook --pagina ID | instagram --conta ID | threads | x',
  '  gemini-code redes testar [REDE]                       confere as credenciais (só lê)',
  '  gemini-code redes postar "texto" --em bluesky,mastodon [--foto foto.jpg --alt "descrição"] [--foto-url https://...] [--sim]',
  '  gemini-code redes compartilhar "texto" --em whatsapp  abre o app com o texto pronto (também x, threads, linkedin, reddit...)',
  '  gemini-code redes notificacoes [--em bluesky] [--limite 20]   menções e respostas (Bluesky, Mastodon, Telegram)',
  '  gemini-code redes agendar "texto" --em bluesky --at "amanhã 9h"  (ou --cron "0 9 * * 1")',
  '  gemini-code redes desconectar REDE   ·   gemini-code redes aliado (um aliado que escreve e publica com você)',
  'Publicar sempre mostra o post e pergunta antes (--sim pula a pergunta). Seguir, curtir ou mandar mensagem em massa: não faz.',
];

// "--opção valor"; "--opção" sem valor (ou seguida de outra opção) vira true
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

const texto = (v) => (typeof v === 'string' ? v : undefined);
const listaDe = (v) => (typeof v === 'string' ? v.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean) : []);
const sim = (r) => ['s', 'sim', 'y', 'yes'].includes(String(r || '').trim().toLowerCase());
const temRede = (r) => Object.prototype.hasOwnProperty.call(redes.REDES, r);

function dataCurta(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * @param {string[]} args depois de "redes"
 * @param {{ store?, cliente?, perguntarSegredos?, ask?, abrir?, rotinas?, aliados?, mostrar?, agora? }} deps
 */
async function executar(args, deps = {}) {
  const [sub = 'status', ...resto] = args;
  const store = deps.store || redes.createRedesStore();
  const cliente = deps.cliente || redes.criarCliente();
  const prompt = () => require('./ui/prompt');
  const perguntarSegredos = deps.perguntarSegredos || ((p) => prompt().perguntarSegredos(p));
  const ask = deps.ask || ((p) => prompt().ask(p));
  const mostrar = deps.mostrar || ((t) => console.log(require('./ui/textoSeguro').paraTerminal(t)));
  const ok = (...linhas) => ({ linhas, codigo: 0 });
  const falha = (t) => ({ linhas: [L('erro', t)], codigo: 1 });
  const f = lerFlags(resto);
  try {
    switch (sub) {
      case 'ajuda': case 'help': case '--help': case '-h':
        return ok(...AJUDA.map((t) => L('texto', t)));

      case 'status': case 'lista': case 'listar': {
        const linhas = [L('texto', 'Com conta (publicam pela API oficial):')];
        for (const c of store.contas()) {
          linhas.push(c.conectada ? L('ok', `  ✓ ${c.nome}: ${c.conta}`) : L('dim', `  · ${c.nome}: gemini-code redes conectar ${c.rede}`));
        }
        linhas.push(L('texto', `Sem conta (abre o app com o texto pronto): ${Object.entries(redes.LINKS).map(([id]) => id).join(', ')}`));
        linhas.push(L('dim', 'Como usar: gemini-code redes ajuda'));
        return ok(...linhas);
      }

      case 'conectar': {
        const rede = String(f._[0] || '').toLowerCase();
        if (!temRede(rede)) return falha(`Uso: gemini-code redes conectar REDE — redes: ${Object.keys(redes.REDES).join(', ')}`);
        const def = redes.REDES[rede];
        const segredoNaLinha = def.campos.find((c) => c.segredo && f[c.id] !== undefined);
        if (segredoNaLinha) return falha(`Não passe "${segredoNaLinha.id}" na linha de comando (ficaria no histórico do shell): o gemini-code pergunta sem mostrar na tela.`);
        mostrar(`${def.nome}: ${def.como}`);
        const dados = {};
        for (const id of Object.keys(def.opcoes || {})) if (typeof f[id] === 'string') dados[id] = f[id];
        const perguntas = [];
        const ids = [];
        for (const c of def.campos) {
          if (!c.segredo && typeof f[c.id] === 'string') { dados[c.id] = f[c.id]; continue; }
          perguntas.push(c.segredo ? c.pergunta : { pergunta: c.pergunta, visivel: true });
          ids.push(c.id);
        }
        const respostas = perguntas.length ? await perguntarSegredos(perguntas) : [];
        const vazia = ids.find((id, i) => !respostas[i]);
        if (vazia) return falha(`Cancelado: faltou "${vazia}". Nada foi salvo.`);
        ids.forEach((id, i) => { dados[id] = respostas[i]; });
        const publico = store.conectar(rede, dados);
        const linhas = [L('ok', `${def.nome} salvo (${publico}) em ${store.caminho} — só para você (0600).`)];
        if (f['sem-testar'] === true) return ok(...linhas);
        try {
          linhas.push(L('ok', `Conferido: ${await cliente.verificar[rede](store.conta(rede))}`));
        } catch (e) {
          linhas.push(L('aviso', `O teste falhou: ${e.message}`), L('dim', `Confira e rode: gemini-code redes testar ${rede}   (ou: redes desconectar ${rede})`));
        }
        return ok(...linhas);
      }

      case 'testar': case 'verificar': {
        const quais = f._.length ? f._.map((r) => r.toLowerCase()) : store.contas().filter((c) => c.conectada).map((c) => c.rede);
        if (!quais.length) return falha('Nenhuma rede conectada. Veja como: gemini-code redes');
        const linhas = [];
        let falhou = false;
        for (const rede of quais) {
          if (!temRede(rede) || !store.conta(rede)) { linhas.push(L('erro', `${rede}: não conectado.`)); falhou = true; continue; }
          try { linhas.push(L('ok', `✓ ${redes.REDES[rede].nome}: ${await cliente.verificar[rede](store.conta(rede))}`)); } catch (e) { falhou = true; linhas.push(L('erro', `✗ ${e.message}`)); }
        }
        return { linhas, codigo: falhou ? 1 : 0 };
      }

      case 'desconectar': case 'remover': {
        const rede = String(f._[0] || '').toLowerCase();
        if (!temRede(rede)) return falha(`Uso: gemini-code redes desconectar REDE — redes: ${Object.keys(redes.REDES).join(', ')}`);
        return store.desconectar(rede)
          ? ok(L('ok', `${redes.REDES[rede].nome}: credenciais apagadas daqui.`), L('dim', 'Para cortar de vez, revogue também o token/senha de app no site da rede.'))
          : falha(`${redes.REDES[rede].nome} não estava conectado.`);
      }

      case 'postar': case 'publicar': {
        if (f.em === undefined || f.em === true) return falha('Uso: gemini-code redes postar "texto" --em bluesky,mastodon [--foto foto.jpg] [--sim]');
        const plano = redes.planejar({ texto: f._.join(' '), redes: listaDe(f.em), foto: texto(f.foto), fotoUrl: texto(f['foto-url']), alt: texto(f.alt) }, { store });
        mostrar(redes.textoDoPlano(plano));
        const prontas = plano.itens.filter((i) => i.ok);
        if (!prontas.length) return falha('Nada para publicar (veja os ✗ acima).');
        if (f.sim !== true && !sim(await ask(`Publicar em ${prontas.map((i) => i.nome).join(', ')}? (s/n) `))) return ok(L('dim', 'Nada publicado.'));
        const res = await redes.publicar(plano, { store, cliente });
        return {
          linhas: res.map((r) => (r.ok ? L('ok', `✓ ${r.nome}: publicado${r.url ? ` — ${r.url}` : ''}`) : L('erro', `✗ ${r.nome}: ${r.erro}`))),
          codigo: res.every((r) => r.ok) ? 0 : 1,
        };
      }

      case 'compartilhar': case 'link': {
        if (typeof f.em !== 'string') return falha(`Uso: gemini-code redes compartilhar "texto" --em ${Object.keys(redes.LINKS).join('|')}`);
        const l = redes.linkDeCompartilhar(f.em, f._.join(' '));
        const ab = deps.abrir || require('./abrir');
        const linhas = [];
        if (l.copiar) {
          const copiou = await ab.copiar(l.texto);
          linhas.push(copiou ? L('ok', `Texto copiado: cole no ${l.nome}.`) : L('aviso', `Não deu para copiar sozinho (no celular: pkg install termux-api). O texto:\n${l.texto}`));
        }
        const abriu = await ab.abrir(l.url);
        linhas.push(abriu ? L('ok', `Abrindo o ${l.nome}...`) : L('aviso', `Abra: ${l.url}`));
        linhas.push(L('dim', `Você confere e publica no ${l.nome} — o gemini-code não publica por você aqui.`));
        return ok(...linhas);
      }

      case 'notificacoes': case 'notificações': case 'mencoes': case 'menções': {
        const res = await redes.notificacoes({ redes: listaDe(f.em), limite: f.limite }, { store, cliente });
        if (!res.length) return ok(L('dim', 'Nenhuma rede conectada que leia notificações (Bluesky, Mastodon, Telegram).'));
        const linhas = [];
        for (const r of res) {
          linhas.push(L('texto', `== ${r.nome} ==`));
          if (r.erro) { linhas.push(L('erro', r.erro)); continue; }
          if (!r.itens.length) linhas.push(L('dim', '  (nada novo)'));
          for (const i of r.itens) linhas.push(L(i.tipo === 'menção' || i.tipo === 'resposta' ? 'ok' : 'texto', `  ${dataCurta(i.quando)} ${i.tipo} de ${i.autor}${i.texto ? `: ${i.texto.replace(/\s+/g, ' ').slice(0, 280)}` : ''}`));
        }
        return { linhas, codigo: res.some((r) => r.erro) ? 1 : 0 };
      }

      case 'agendar': {
        if (typeof f.em !== 'string' || (f.at === undefined && f.cron === undefined && f.every === undefined)) {
          return falha('Uso: gemini-code redes agendar "texto" --em bluesky,mastodon (--at "amanhã 9h" | --cron "0 9 * * 1" | --every 7d) [--foto foto.jpg]');
        }
        const routines = require('./routines');
        const plano = redes.planejar({ texto: f._.join(' '), redes: listaDe(f.em), foto: texto(f.foto), fotoUrl: texto(f['foto-url']), alt: texto(f.alt) }, { store, semLimites: true });
        mostrar(redes.textoDoPlano(plano));
        if (plano.itens.some((i) => !i.ok)) return falha('Corrija os ✗ acima antes de agendar.');
        const timezone = texto(f.timezone) || routines.DEFAULT_TIMEZONE;
        let trigger;
        if (f.at !== undefined) trigger = { type: 'once', runAt: require('./datas').lerDataHora(String(f.at), { futuro: 'obrigatorio', agora: deps.agora || new Date() }).toISOString(), timezone };
        else if (f.cron !== undefined) trigger = { type: 'cron', expression: String(f.cron), timezone };
        else trigger = { type: 'interval', intervalMs: routines.parseDuration(String(f.every)), timezone };
        if (f.sim !== true && !sim(await ask('Agendar? Na hora, o post sai SEM perguntar de novo (você está aprovando agora). (s/n) '))) return ok(L('dim', 'Nada agendado.'));
        const rotinas = deps.rotinas || routines.createRoutineStore();
        const r = rotinas.create({
          name: texto(f.nome) || `Post: ${(plano.texto || 'foto').slice(0, 40)}`,
          trigger,
          action: { type: 'rede', redes: plano.itens.map((i) => i.rede), texto: plano.texto, ...(plano.fotoArquivo ? { foto: plano.fotoArquivo } : {}), ...(plano.fotoUrl ? { fotoUrl: plano.fotoUrl } : {}), ...(plano.alt ? { alt: plano.alt } : {}) },
          category: 'redes',
        });
        rotinas.activate(r.id);
        const prox = rotinas.get(r.id);
        return ok(
          L('ok', `Post agendado [${r.id}]${prox && prox.nextRunAt ? ` para ${new Date(prox.nextRunAt).toLocaleString('pt-BR')}` : ''}.`),
          L('dim', 'O agendador precisa estar rodando: gemini-code routines service   ·   cancelar: gemini-code routines remove ID --yes'),
        );
      }

      case 'aliado': {
        const aliados = deps.aliados || require('./personalAgents').defaultStore;
        if (aliados.existe('redes')) return ok(L('dim', 'O aliado "redes" já existe. Converse com: gemini-code aliados chat redes'));
        aliados.criar({
          name: 'redes', description: 'escreve, adapta e publica nas suas redes sociais (sempre pergunta antes)',
          instructions: redes.INSTRUCOES_ALIADO, tools: 'redes', memory: 'confirmar',
          starters: ['Escreve um post sobre a promoção de sábado para o Bluesky e o Mastodon', 'O que me responderam esta semana?', 'Adapta este texto para o LinkedIn e para o X'],
        });
        return ok(L('ok', 'Aliado "redes" criado. Converse com: gemini-code aliados chat redes'), L('dim', 'Ele publica pela ferramenta "redes", que mostra o post e pergunta antes de sair.'));
      }

      default:
        return { linhas: [L('erro', `Subcomando desconhecido: ${sub}`), ...AJUDA.map((t) => L('texto', t))], codigo: 1 };
    }
  } catch (e) {
    return falha(`Erro: ${e.message}`);
  }
}

module.exports = { executar, AJUDA, lerFlags };
