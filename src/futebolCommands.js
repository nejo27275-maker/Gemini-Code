// src/futebolCommands.js (v0.52.0) — "gemini-code futebol ..." (src/futebol.js), sem IA.
'use strict';

const futebol = require('./futebol');

const L = (nivel, texto) => ({ nivel, texto });

const AJUDA = [
  'Futebol — o treinador (sem IA, no aparelho):',
  '  gemini-code futebol treino --tema pressao --categoria sub-15 --jogadores 18 [--goleiros 2] [--duracao 75]',
  `     temas: ${Object.keys(futebol.TEMAS).join(', ')}`,
  '  gemini-code futebol semana --jogo sabado --dias segunda,terca,quinta,sexta [--categoria adulto]   (2 jogos: --jogo quarta,domingo)',
  '  gemini-code futebol carga --sessao 02/11:7:90 --sessao ontem:5:60 [--hoje 04/11/2026]   (data:PSE:minutos)',
  '  gemini-code futebol prancheta 4-3-3 [--nomes "Ana,Bia,..."] [--titulo "Final do campeonato"] [--saida time.png]',
  '  gemini-code futebol exercicios [--tema finalizacao]',
  '  gemini-code futebol aliado                    cria o aliado "treinador" (conversa: gemini-code aliados chat treinador)',
];

const COM_VALOR = new Set(['tema', 'categoria', 'jogadores', 'goleiros', 'duracao', 'jogo', 'dias', 'sessao', 'hoje', 'nomes', 'titulo', 'saida']);

/** Flags estritas: opção desconhecida é erro (não vira argumento sem querer). */
function lerFlags(itens) {
  const flags = { _: [], sessao: [] };
  for (let i = 0; i < itens.length; i++) {
    const it = String(itens[i]);
    if (!it.startsWith('--')) { flags._.push(it); continue; }
    const nome = it.slice(2);
    if (!COM_VALOR.has(nome)) throw new Error(`opção desconhecida: ${it}`);
    if (i + 1 >= itens.length) throw new Error(`falta o valor de ${it}`);
    const v = String(itens[++i]);
    if (nome === 'sessao') flags.sessao.push(v); else flags[nome] = v;
  }
  return flags;
}

const linhasDe = (texto) => String(texto).split('\n').map((t) => L('texto', t));

/**
 * @param {string[]} args depois de "futebol"
 * @param {{ aliados?, cwd?, magick? }} deps
 */
async function executar(args, deps = {}) {
  const [sub, ...resto] = args;
  const ok = (...linhas) => ({ linhas, codigo: 0 });
  const falha = (texto) => ({ linhas: [L('erro', texto)], codigo: 1 });
  if (!sub || ['ajuda', 'help', '--help'].includes(sub)) return { linhas: AJUDA.map((t) => L('texto', t)), codigo: 0 };
  try {
    const f = lerFlags(resto);
    switch (sub) {
      case 'treino': return ok(...linhasDe(futebol.textoDoTreino(futebol.planejarTreino(f))));
      case 'semana': return ok(...linhasDe(futebol.textoDaSemana(futebol.planejarSemana(f))));
      case 'carga': {
        if (!f.sessao.length) return falha('informe as sessões: --sessao DATA:PSE:MINUTOS (repita para cada uma), ex. --sessao 02/11:7:90.');
        const sessoes = f.sessao.map((s, i) => {
          // os dois últimos campos são a PSE e os minutos; o resto é a data (que pode ter ":" da hora)
          const m = /^(.*\S):(\d+(?:[.,]\d+)?):(\d+)$/.exec(s.trim());
          if (!m) throw new Error(`sessão ${i + 1} ("${s}"): use DATA:PSE:MINUTOS, ex. 2026-11-02:7:90 ou 02/11:7:90.`);
          return { data: m[1], pse: Number(m[2].replace(',', '.')), minutos: Number(m[3]) };
        });
        return ok(...linhasDe(futebol.textoDaCarga(futebol.calcularCarga(sessoes, { hoje: f.hoje }))));
      }
      case 'prancheta': {
        const r = await futebol.desenharPrancheta({ formacao: f._[0], nomes: f.nomes, titulo: f.titulo }, { saida: f.saida, cwd: deps.cwd, magick: deps.magick });
        return ok(L('ok', `Prancheta salva: ${r.png || r.svg}`), ...(r.png ? [L('dim', `(também em SVG: ${r.svg})`)] : [L('dim', 'Só SVG: para o PNG, instale o ImageMagick (Termux: pkg install imagemagick).')]));
      }
      case 'exercicios': {
        const tema = f.tema ? futebol.lerTema(f.tema) : null;
        const lista = futebol.BIBLIOTECA.filter((e) => !tema || e.temas.includes(tema) || e.temas.includes('*'));
        return ok(...lista.map((e) => L('texto', `${e.nome} — ${e.fase}, a partir de ${e.idade} anos, ${e.grupo} por grupo`)));
      }
      case 'aliado': {
        const aliados = deps.aliados || require('./personalAgents').defaultStore;
        if (aliados.existe('treinador')) return ok(L('dim', 'O aliado "treinador" já existe. Converse com: gemini-code aliados chat treinador (ou pelo site: gemini-code site --chat --aliado treinador)'));
        aliados.criar({
          name: 'treinador', description: 'treinador de futebol de elite: treinos, semana até o jogo, carga, prancheta e análise de vídeo',
          instructions: futebol.INSTRUCOES_TREINADOR, tools: 'futebol', memory: 'confirmar', starters: [...futebol.INICIADORES],
        });
        return ok(
          L('ok', 'Aliado "treinador" criado. Converse com: gemini-code aliados chat treinador'),
          L('dim', 'Pelo navegador: gemini-code site --chat --aliado treinador (mande o vídeo do jogo pelo clipe para ele cortar os lances).'),
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
