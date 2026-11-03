// src/saudeCommands.js (v0.46.0) — "gemini-code saude ..." (src/saude.js)
// Devolve { linhas: [{ nivel, texto }], codigo } para o bin imprimir; testável sem terminal.
'use strict';

const fs = require('fs');
const path = require('path');
const saude = require('./saude');

const L = (nivel, texto) => ({ nivel, texto });

const AJUDA = [
  'Assistente de saúde (não é médico; não diagnostica nem receita):',
  '  gemini-code saude anotar pressao 13x8          (também: glicemia 98 jejum | peso 72,5 | temperatura 37,9 |',
  '                                                   saturacao 97 | batimentos 80 | sintoma "texto" | nota "texto")',
  '  gemini-code saude tomei "losartana"            marca um remédio como tomado agora',
  '  gemini-code saude resumo [--dias 30]           últimas medições, médias e alertas',
  '  gemini-code saude lista [--dias 30] [--tipo pressao] | apagar ID',
  '  gemini-code saude pagina [--dias 90] [--saida arquivo.html] [--abrir]   página para levar à consulta',
  '  gemini-code saude remedio add "Losartana" --horarios 08:00,20:00 [--dose 50mg]   lembrete no horário',
  '  gemini-code saude remedio lista | remover ID',
  '  gemini-code saude altura 1,70                  (para o IMC)',
  '  gemini-code saude triagem "texto"              confere sinais de emergência no que você escreveu',
  '  gemini-code saude aliado                       cria o aliado "saude" (conversa; só ele lê o diário)',
  `Emergência: ${saude.EMERGENCIA}`,
];

// v0.46.1: um "--opção" sem valor no fim entrava no texto anotado ("sintoma tosse --nota" virava "tosse --nota");
// agora vira uma opção ligada (true), que quem usa confere.
function lerFlags(itens) {
  const flags = { _: [] };
  for (let i = 0; i < itens.length; i++) {
    const it = String(itens[i]);
    if (it === '--abrir') flags.abrir = true;
    else if (it.startsWith('--') && it.length > 2) {
      const prox = itens[i + 1];
      flags[it.slice(2)] = prox !== undefined && !String(prox).startsWith('--') ? String(itens[++i]) : true;
    } else flags._.push(it);
  }
  return flags;
}

const nivelDe = (c) => (!c ? 'ok' : c.nivel === 'urgente' || c.nivel === 'alto' ? 'erro' : c.nivel === 'atencao' ? 'aviso' : 'ok');

function criarRemedio({ nome, dose, horarios }, { store, rotinas, timezone }) {
  const lista = String(horarios || '').split(/[,;\s]+/).filter(Boolean).map(saude.lerHorario);
  if (!lista.length) throw new Error('Informe os horários: --horarios 08:00,20:00');
  if (lista.length > 8) throw new Error('No máximo 8 horários por remédio.');
  const unicos = [...new Set(lista)].sort();
  const ids = [];
  try {
    for (const h of unicos) {
      const [hh, mm] = h.split(':').map(Number);
      const r = rotinas.create({
        name: `Remédio: ${String(nome).slice(0, 80)} ${h}`, category: 'saude', priority: 'alta',
        trigger: { type: 'cron', expression: `${mm} ${hh} * * *`, timezone },
        action: { type: 'lembrete', titulo: 'Hora do remédio', texto: `${nome}${dose ? ` ${dose}` : ''}` },
      });
      ids.push(r.id);
      rotinas.activate(r.id);
    }
  } catch (e) {
    for (const id of ids) { try { rotinas.pause(id); rotinas.remove(id); } catch { /* melhor esforço */ } }
    throw e;
  }
  return store.adicionarRemedio({ nome, dose, horarios: unicos, rotinas: ids });
}

/**
 * @param {string[]} args depois de "saude"
 * @param {{ store?, rotinas?, aliados?, abrirFn?, agora?, cwd? }} deps
 */
async function executar(args, deps = {}) {
  const [sub = 'ajuda', ...resto] = args;
  const store = deps.store || saude.createSaudeStore();
  const ok = (...linhas) => ({ linhas, codigo: 0 });
  const falha = (texto) => ({ linhas: [L('erro', texto)], codigo: 1 });
  try {
    switch (sub) {
      case 'ajuda': case 'help': case '--help':
        return ok(...AJUDA.map((t) => L('texto', t)));

      case 'anotar': case 'add': case 'registrar': case 'tomei': {
        const f = lerFlags(resto);
        const [tipo, ...valor] = sub === 'tomei' ? ['remedio', ...f._] : f._;
        if (!tipo || !valor.length) return falha('Uso: gemini-code saude anotar TIPO VALOR   ex.: saude anotar pressao 13x8');
        const r = store.anotar(tipo, valor.join(' '), { quando: f.quando, nota: f.nota });
        const linhas = [L('ok', `Anotado: ${saude.NOMES[r.registro.tipo]} ${saude.valorCurto(r.registro)} [${r.registro.id}]`)];
        if (r.classificacao) linhas.push(L(nivelDe(r.classificacao), r.classificacao.texto));
        if (r.classificacao && r.classificacao.nivel === 'urgente') linhas.push(L('erro', `Emergência: ${saude.EMERGENCIA}`));
        return ok(...linhas);
      }

      case 'resumo': {
        const f = lerFlags(resto);
        const dias = saude.diasDe(f.dias, { max: 3650 });
        return ok(...saude.resumo(store, { dias }).split('\n').map((t) => L('texto', t)));
      }

      case 'lista': case 'listar': {
        const f = lerFlags(resto);
        const dias = saude.diasDe(f.dias, { max: 3650 });
        let tipo;
        if (f.tipo !== undefined) {
          const t = String(f.tipo).trim().toLowerCase();
          tipo = Object.prototype.hasOwnProperty.call(saude.ALIASES, t) ? saude.ALIASES[t] : t;
          if (!saude.TIPOS.includes(tipo)) return falha(`Tipo desconhecido: "${t}". Use: ${saude.TIPOS.join(', ')}.`);
        }
        const regs = store.registros({ dias, tipo }).slice(-200);
        if (!regs.length) return ok(L('dim', 'Nada anotado no período.'));
        const perfil = store.perfil();
        return ok(...regs.map((r) => {
          const c = saude.classificar(r, perfil);
          return L(nivelDe(c), `${r.id} | ${new Date(r.quando).toLocaleString('pt-BR')} | ${saude.NOMES[r.tipo]} | ${saude.valorCurto(r)}${r.nota ? ` (${r.nota})` : ''}`);
        }));
      }

      case 'apagar': case 'remover': {
        const id = resto[0];
        if (!id) return falha('Uso: gemini-code saude apagar ID (veja os ids com: saude lista)');
        return store.apagar(id) ? ok(L('ok', `Registro ${id} apagado.`)) : falha(`Não achei o registro ${id}.`);
      }

      case 'altura': {
        if (!resto[0]) return ok(L('texto', `Altura: ${store.perfil().alturaM ? `${saude.br(store.perfil().alturaM.toFixed(2))} m` : '(não informada)'}`));
        const p = store.perfil({ alturaM: resto[0] });
        return ok(L('ok', `Altura salva: ${saude.br(p.alturaM.toFixed(2))} m (o IMC aparece junto com o peso).`));
      }

      case 'pagina': case 'site': case 'relatorio': {
        const f = lerFlags(resto);
        const dias = saude.diasDe(f.dias, { padrao: 90, max: 3650 });
        const agora = deps.agora || new Date();
        if (f.saida === true) return falha('Uso: gemini-code saude pagina [--saida arquivo.html] [--dias 90] [--abrir]');
        const nome = f.saida || `saude-${agora.toISOString().slice(0, 10)}.html`;
        if (nome.startsWith('-')) return falha(`Nome de arquivo inválido: "${nome}" (não pode começar com "-").`);
        const destino = path.resolve(deps.cwd || process.cwd(), nome);
        if (path.extname(destino).toLowerCase() !== '.html') return falha('A página precisa terminar em .html');
        const { isProtected, isSecret } = require('./tools/protectedPaths');
        if (isProtected(destino) || isSecret(destino)) return falha('Esse caminho é protegido; escolha outro lugar para a página.');
        fs.writeFileSync(destino, saude.paginaHtml(store, { dias, agora }), { mode: 0o600 });
        // v0.46.1: regravando um arquivo que já existia, o "mode" acima não vale — a página tem dados de saúde
        try { fs.chmodSync(destino, 0o600); } catch { /* Windows */ }
        const linhas = [L('ok', `Página gerada: ${destino}`), L('dim', 'Abra no navegador (ou imprima para levar à consulta). Ela tem dados de saúde: cuidado ao compartilhar.')];
        if (f.abrir) {
          const abriu = await (deps.abrirFn || require('./abrir').abrir)(destino);
          if (!abriu) linhas.push(L('aviso', 'Não consegui abrir sozinho; abra o arquivo no navegador.'));
        }
        return ok(...linhas);
      }

      case 'triagem': {
        const texto = resto.join(' ').trim();
        if (!texto) return falha('Uso: gemini-code saude triagem "o que você está sentindo"');
        const alertas = saude.sinaisDeAlerta(texto);
        if (alertas.length) return ok(...saude.avisoDeEmergencia(alertas).split('\n').map((t) => L('erro', t)));
        return ok(L('texto', 'Nenhum sinal de emergência nas palavras usadas — isso não descarta um problema. Se piorar, ou se você estiver preocupado, procure atendimento.'), L('dim', `Emergência: ${saude.EMERGENCIA}`));
      }

      case 'remedio': case 'remedios': {
        const [acao = 'lista', ...r2] = resto;
        const rotinas = deps.rotinas || require('./routines').createRoutineStore();
        if (acao === 'lista' || acao === 'listar') {
          const rems = store.remedios();
          if (!rems.length) return ok(L('dim', 'Nenhum remédio cadastrado. Ex.: saude remedio add "Losartana" --horarios 08:00,20:00 --dose 50mg'));
          return ok(...rems.map((r) => L('texto', `${r.id} | ${r.nome}${r.dose ? ` ${r.dose}` : ''} | ${r.horarios.join(', ')}`)));
        }
        if (acao === 'add' || acao === 'adicionar') {
          const f = lerFlags(r2);
          const nome = f._.join(' ').trim();
          if (!nome || typeof f.horarios !== 'string') return falha('Uso: gemini-code saude remedio add "Nome" --horarios 08:00,20:00 [--dose 50mg]');
          const texto = (v) => (typeof v === 'string' ? v : undefined);
          const rem = criarRemedio({ nome, dose: texto(f.dose), horarios: f.horarios }, { store, rotinas, timezone: texto(f.timezone) || deps.timezone || require('./routines').DEFAULT_TIMEZONE });
          return ok(
            L('ok', `Remédio salvo [${rem.id}]: ${rem.nome}${rem.dose ? ` ${rem.dose}` : ''} — lembretes às ${rem.horarios.join(', ')}.`),
            L('dim', 'Os lembretes chegam como notificação enquanto o agendador estiver rodando: gemini-code routines service'),
            L('dim', 'Marque quando tomar: gemini-code saude tomei "' + rem.nome + '"'),
          );
        }
        if (acao === 'remover' || acao === 'apagar') {
          const id = r2[0];
          if (!id) return falha('Uso: gemini-code saude remedio remover ID (veja os ids com: saude remedio lista)');
          const rem = store.remedios().find((r) => r.id === id);
          if (!rem) return falha(`Não achei o remédio ${id} (veja os ids com: saude remedio lista).`);
          for (const rid of rem.rotinas || []) { try { rotinas.pause(rid); rotinas.remove(rid); } catch { /* já removida */ } }
          store.removerRemedio(id);
          return ok(L('ok', `Remédio ${rem.nome} removido (e os lembretes dele).`));
        }
        return falha('Uso: gemini-code saude remedio add|lista|remover');
      }

      case 'aliado': {
        const aliados = deps.aliados || require('./personalAgents').defaultStore;
        if (aliados.existe('saude')) return ok(L('dim', 'O aliado "saude" já existe. Converse com: gemini-code aliados chat saude'));
        aliados.criar({
          name: 'saude', description: 'assistente de saúde pessoal (não é médico)',
          instructions: saude.INSTRUCOES_ALIADO, tools: 'saude', memory: 'confirmar',
          starters: ['Minha pressão deu 13 por 8, está boa?', 'Como foi minha glicemia este mês?', 'Me ajuda a preparar perguntas para a consulta'],
        });
        return ok(L('ok', 'Aliado "saude" criado. Converse com: gemini-code aliados chat saude'), L('dim', 'Só ele lê o diário de saúde; o chat comum não vê esses dados.'));
      }

      default:
        return { linhas: [L('erro', `Subcomando desconhecido: ${sub}`), ...AJUDA.map((t) => L('texto', t))], codigo: 1 };
    }
  } catch (e) {
    return falha(`Erro: ${e.message}`);
  }
}

module.exports = { executar, AJUDA, criarRemedio };
