'use strict';
// v0.52.0: o treinador de futebol (src/futebol.js) — a biblioteca, o treino por categoria, a semana (periodização
// tática), a carga (sRPE, ACWR, monotonia), a prancheta (SVG e PNG de verdade), a ferramenta, o comando e o aliado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-futebol-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-futebol-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/futebol');

test.after(() => { for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'gemini-code.js');

test('biblioteca: todo exercício completo e coerente; todo tema tem exercício principal para quem já pode', () => {
  const ids = new Set();
  for (const e of f.BIBLIOTECA) {
    assert.ok(!ids.has(e.id), `id repetido: ${e.id}`);
    ids.add(e.id);
    assert.ok(Object.keys(f.FASES).includes(e.fase), `${e.id}: fase`);
    assert.ok(e.nome && e.descricao.length > 40, `${e.id}: descrição`);
    assert.ok(e.temas.length && e.temas.every((t) => t === '*' || f.TEMAS[t]), `${e.id}: temas conhecidos`);
    assert.ok(e.idade >= 5 && e.idade <= 18 && e.grupo >= 2 && e.grupo <= 30, `${e.id}: idade/grupo`);
    assert.ok(e.espaco.length === 2 && e.espaco.every((m) => m >= 5 && m <= 110), `${e.id}: espaço`);
    assert.ok(e.pse >= 1 && e.pse <= 10, `${e.id}: PSE`);
    if (e.fase !== 'final') assert.ok(e.pontos.length >= 3, `${e.id}: pontos de correção`);
  }
  for (const tema of Object.keys(f.TEMAS)) {
    assert.ok(f.BIBLIOTECA.some((e) => e.fase === 'principal' && e.temas.includes(tema) && e.idade <= 14), `tema ${tema} sem exercício principal`);
  }
  for (const fase of Object.keys(f.FASES)) assert.ok(f.BIBLIOTECA.some((e) => e.fase === fase && e.idade <= 5), `${fase}: nada para os pequenos`);
});

test('treino: o tempo fecha, cada bloco tem um exercício diferente, e o tema puxa os exercícios certos', () => {
  for (const tema of Object.keys(f.TEMAS)) {
    for (const categoria of Object.keys(f.CATEGORIAS)) {
      for (const jogadores of [6, 12, 18, 26]) {
        const p = f.planejarTreino({ tema, categoria, jogadores });
        assert.equal(p.blocos.reduce((s, b) => s + b.minutos, 0), p.duracao, `${tema}/${categoria}/${jogadores}`);
        assert.ok(p.blocos.every((b) => b.minutos >= 4), 'nenhum bloco ridículo');
        assert.equal(new Set(p.blocos.map((b) => b.exercicio.id)).size, p.blocos.length, 'sem exercício repetido');
        assert.ok(p.blocos.every((b) => b.exercicio.idade <= f.CATEGORIAS[categoria].idade || f.CATEGORIAS[categoria].idade < 9), 'respeita a idade');
      }
    }
  }
  const pressao = f.planejarTreino({ tema: 'pressão pós-perda', categoria: 'sub-15', jogadores: 16, duracao: 75 });
  assert.equal(pressao.tema, 'pressao');
  assert.equal(pressao.blocos[1].exercicio.id, 'reacao-5s', 'o exercício que é DESSE tema vem primeiro');
  assert.equal(pressao.duracao, 75);
  assert.equal(f.planejarTreino({ tema: 'saida-de-bola', categoria: 'sub-17' }).blocos[1].exercicio.id, 'saida-6x4');
  assert.equal(f.planejarTreino({ tema: 'escanteio' }).tema, 'bola-parada');
  assert.throws(() => f.planejarTreino({ tema: 'futevôlei' }), /tema desconhecido/);
  assert.throws(() => f.planejarTreino({ jogadores: 1 }), /de 2 a 40/);
  assert.throws(() => f.planejarTreino({ categoria: 'sub-99x' }), /categoria desconhecida/);
  // sub-11 só tem um exercício principal de posse: ele ganha o tempo dos dois blocos, em duas etapas (não repete)
  const sub11 = f.planejarTreino({ tema: 'posse', categoria: 'sub-11', jogadores: 12 });
  assert.deepEqual(sub11.blocos.map((b) => b.fase), ['aquecimento', 'principal', 'jogo', 'final']);
  assert.equal(sub11.blocos[1].exercicio.id, 'jogo-4-golzinhos');
  assert.equal(sub11.blocos[1].minutos, Math.round(60 * 0.3) + Math.round(60 * 0.22));
  assert.match(f.textoDoTreino(sub11), /\*\*Em duas etapas:\*\* metade do tempo como descrito; na outra metade, com a progressão/);
});

test('treino de criança: brincar de jogar — sem bloco analítico, jogo maior, tempo curto, e o tema avançado avisado', () => {
  const p = f.planejarTreino({ tema: 'pressao-alta', categoria: 'sub-7', jogadores: 10 });
  assert.equal(p.duracao, 45);
  assert.deepEqual(p.blocos.map((b) => b.fase), ['aquecimento', 'principal', 'jogo', 'final']);
  assert.ok(p.blocos.every((b) => b.exercicio.idade <= 7));
  assert.equal(p.blocos[2].exercicio.id, 'festival-3x3');
  assert.match(p.lembretes.join(' '), /brincar de jogar/);
  assert.match(p.lembretes.join(' '), /é avançado para sub-7/);
  assert.equal(f.lerCategoria('12'), 'sub-13', 'idade vira categoria');
  assert.equal(f.lerCategoria('U15'), 'sub-15');
  assert.equal(f.lerCategoria('várzea'), 'adulto');
  const texto = f.textoDoTreino(f.planejarTreino({ tema: 'finalizacao', categoria: 'sub-11', jogadores: 14 }));
  assert.match(texto, /^## Treino de finalização — sub-11/);
  assert.match(texto, /\*\*Pontos de correção:\*\*/);
  assert.match(texto, /na dúvida, fora/, 'a regra de segurança está sempre no plano');
});

test('organização: o grupo se divide e o campo cresce com o grupo', () => {
  const rondo = f.BIBLIOTECA.find((e) => e.id === 'rondo-4x1');
  assert.deepEqual(f.organizar(rondo, 15).grupos, 3);
  assert.match(f.organizar(rondo, 15).texto, /^3 grupos de 5, cada um em 10x10 m$/);
  assert.match(f.organizar(rondo, 17).texto, /3 grupos de 5 \(2 jogadores entram como curinga ou revezam\)/);
  const jogo = f.BIBLIOTECA.find((e) => e.id === 'posicao-4x4-3'); // 11 jogadores em 30x25
  assert.deepEqual(jogo.espaco, [30, 25]);
  assert.deepEqual(f.organizar(jogo, 8).campo, [25, 20], 'menos gente, campo menor');
  assert.deepEqual(f.organizar(jogo, 14).campo, [35, 30], 'mais gente no mesmo grupo, campo maior');
  assert.equal(f.organizar(jogo, 22).texto, '2 grupos de 11, cada um em 30x25 m', 'o dobro: dois campos');
  assert.equal(f.organizar(f.BIBLIOTECA.find((e) => e.fase === 'final'), 20).texto, 'todos juntos');
  // os goleiros aquecem com o preparador: o aquecimento divide só os de linha
  const com2 = f.planejarTreino({ tema: 'pressao', categoria: 'sub-15', jogadores: 18, goleiros: 2 });
  assert.equal(com2.blocos[0].organizacao.texto, '2 grupos de 7 (2 jogadores entram como curinga ou revezam), cada um em 15x15 m; os 2 goleiros aquecem à parte');
  assert.match(f.planejarTreino({ tema: 'pressao', categoria: 'sub-15', jogadores: 15, goleiros: 1 }).blocos[0].organizacao.texto, /^2 grupos de 7, cada um em 15x15 m; o goleiro aquece à parte$/);
  assert.doesNotMatch(com2.blocos[1].organizacao.texto, /goleiro/, 'no exercício principal, todos juntos');
});

test('semana: MD-4 tensão, MD-3 duração, MD-2 velocidade, MD-1 ativação; depois do jogo, recuperação', () => {
  const s = f.planejarSemana({ jogo: 'domingo', dias: 'segunda,terça,quarta,quinta,sexta,sábado' });
  assert.deepEqual(s.plano.map((d) => [d.dia, d.md, d.foco]), [
    ['segunda', 'MD+1', 'recuperacao'], ['terca', 'MD+2', 'recuperacao'], ['quarta', 'MD-4', 'tensao'],
    ['quinta', 'MD-3', 'duracao'], ['sexta', 'MD-2', 'velocidade'], ['sabado', 'MD-1', 'ativacao'],
  ]);
  const amador = f.planejarSemana({ jogo: 'sab', dias: ['ter', 'qui'] });
  assert.deepEqual(amador.plano.map((d) => [d.md, d.foco]), [['MD-4', 'tensao'], ['MD-2', 'velocidade']]);
  assert.match(amador.avisos.join(' '), /Sem treino na véspera/);
  const base = f.planejarSemana({ jogo: 'sabado', dias: 'terca,quinta', categoria: 'sub-9' });
  assert.ok(base.plano.every((d) => d.foco === 'crianca'), 'criança não tem periodização de adulto');
  assert.throws(() => f.planejarSemana({ jogo: 'sabado', dias: 'sabado' }), /não pode ser também um dia de treino/);
  assert.throws(() => f.planejarSemana({ dias: 'feriado' }), /dia desconhecido/);
  assert.match(f.textoDaSemana(s), /^## Semana até o jogo de domingo — adulto/);
  assert.match(f.textoDaSemana(s), /### Quarta \(MD-4\): Tensão/);
  // semana com 2 jogos: entre eles é recuperar e ativar
  const dois = f.planejarSemana({ jogo: 'quarta e domingo', dias: 'seg ter qui sex sáb' });
  assert.deepEqual(dois.plano.map((d) => [d.dia, d.md, d.foco]), [
    ['segunda', 'MD+1', 'recuperacao'], ['terca', 'MD-1', 'ativacao'], ['quinta', 'MD+1', 'recuperacao'],
    ['sexta', 'MD-2', 'velocidade'], ['sabado', 'MD-1', 'ativacao'],
  ]);
  assert.match(f.textoDaSemana(dois), /^## Semana com jogos na quarta e no domingo — adulto/);
  assert.match(dois.avisos.join(' '), /Semana com 2 jogos/);
  assert.throws(() => f.planejarSemana({ jogo: 'quarta,domingo', dias: 'quarta' }), /o dia do jogo \(quarta\)/);
});

test('carga: PSE x minutos, aguda e crônica, ACWR e monotonia com números conferidos à mão', () => {
  // 4 semanas iguais (seg 7x90, ter 5x60, qui 8x80, sáb 9x95) e a última com o dobro na quinta
  const sessoes = [];
  const dia = (n) => new Date(Date.UTC(2026, 9, 12 + n)).toISOString().slice(0, 10); // 2026-10-12 é segunda
  for (let semana = 0; semana < 4; semana++) {
    sessoes.push({ data: dia(semana * 7), pse: 7, minutos: 90 }, { data: dia(semana * 7 + 1), pse: 5, minutos: 60 });
    sessoes.push({ data: dia(semana * 7 + 3), pse: 8, minutos: semana === 3 ? 160 : 80 }, { data: dia(semana * 7 + 5), pse: 9, minutos: 95 });
  }
  const c = f.calcularCarga(sessoes, { hoje: dia(27) });
  const semanaNormal = 7 * 90 + 5 * 60 + 8 * 80 + 9 * 95; // 2425
  assert.equal(c.aguda, semanaNormal + 8 * 80, 'última semana: 3065');
  assert.equal(c.cronica, Math.round((semanaNormal * 3 + semanaNormal + 640) / 4));
  assert.equal(c.acwr, Math.round((3065 / ((2425 * 4 + 640) / 4)) * 100) / 100);
  const media = 3065 / 7;
  const valores = [630, 300, 0, 1280, 0, 855, 0];
  const dp = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / 7);
  assert.equal(c.monotonia, Math.round((media / dp) * 100) / 100);
  assert.match(f.textoDaCarga(c), /ACWR \(aguda\/crônica\): \*\*1,1/);
  // aumento brusco: com 4 semanas de base, a última com o triplo
  const base = [];
  for (let semana = 0; semana < 4; semana++) {
    for (const d of [0, 1, 3, 5]) base.push({ data: dia(semana * 7 + d), pse: 7, minutos: semana === 3 ? 180 : 60 });
  }
  const pico = f.calcularCarga(base, { hoje: dia(27) });
  assert.ok(pico.acwr > 1.5 && pico.comBase);
  assert.match(pico.leitura.join(' '), /aumento brusco/);
  // sem 3 semanas de registros, o ACWR sai alto mas não vira alarme (a crônica ainda é pequena)
  const novo = f.calcularCarga([{ data: '2026-11-03', pse: 9, minutos: 120 }, { data: '2026-11-04', pse: 9, minutos: 120 }], { hoje: '2026-11-04' });
  assert.ok(novo.acwr > 1.5 && !novo.comBase);
  assert.match(novo.leitura.join(' '), /Menos de 3 semanas/);
  assert.doesNotMatch(novo.leitura.join(' '), /aumento brusco|faixa de progressão|carga baixa/);
  assert.match(f.textoDaCarga(novo), /ACWR \(aguda\/crônica\): \*\*4\*\* \(ainda sem base\)/);
  assert.throws(() => f.calcularCarga([{ pse: 11, minutos: 60 }]), /PSE vai de 0 a 10/);
  assert.throws(() => f.calcularCarga([{ data: '2026-02-30', pse: 5, minutos: 60 }]), /data inválida/);
  assert.throws(() => f.calcularCarga([]), /informe as sessões/);
  // datas como a gente digita (src/datas.js): 03/11/2026, "ontem"; nunca no futuro
  const br = f.calcularCarga([{ data: '03/11/2026', pse: 7, minutos: 90 }, { data: 'ontem', pse: 5, minutos: 60 }], { hoje: '04/11/2026' });
  assert.deepEqual(br.ultimos7.slice(0, 2), [0, 930], '"ontem" é o dia antes da referência');
  assert.throws(() => f.calcularCarga([{ data: '2026-11-05', pse: 5, minutos: 60 }], { hoje: '2026-11-04' }), /depois do dia de referência/);
  assert.throws(() => f.calcularCarga([{ data: '11/31/2026', pse: 5, minutos: 60 }], { hoje: '2026-12-04' }), /data inválida/, 'formato americano não vira outro dia');
  // "hoje" é o dia do relógio local: às 22h30 em São Paulo já é amanhã em UTC, e a sessão de hoje caía em "ontem"
  // (no fuso de São Paulo, a suíte roda este teste e pega a conta em UTC)
  const agora = new Date(2026, 10, 4, 22, 30);
  const noite = f.calcularCarga([{ data: '2026-11-04', pse: 5, minutos: 60 }, { data: 'hoje', pse: 4, minutos: 30 }], { agora });
  assert.deepEqual(noite.ultimos7.slice(0, 2), [420, 0], 'as duas sessões de hoje contam em hoje');
  assert.throws(() => f.calcularCarga([{ data: '2026-11-05', pse: 5, minutos: 60 }], { agora }), /depois do dia de referência/, 'amanhã (local) ainda é futuro');
  assert.match(f.textoDaCarga(noite), /não preveem lesão/);
});

test('prancheta: posições de qualquer formação, nomes escapados no SVG, setas validadas', () => {
  const p433 = f.posicoes('4-3-3');
  assert.equal(p433.length, 11);
  assert.deepEqual(p433[0], { x: 50, y: 92, linha: 0 });
  assert.deepEqual(p433.filter((q) => q.linha === 1).map((q) => q.x), [20, 40, 60, 80]);
  assert.equal(f.posicoes('2-3-1').length, 7, 'society');
  assert.equal(f.posicoes('2-2').length, 5, 'futsal');
  for (const ruim of ['4-4-3', '11', '4-a-3', '7-3', '']) assert.throws(() => f.lerFormacao(ruim || 'x'), /formação|jogadores|linha/, ruim);
  const svg = f.svgDaPrancheta({ formacao: '4-2-3-1', nomes: ['<script>alert(1)</script>', 'Zé & Cia'], titulo: 'Final "x"' });
  assert.ok(svg.startsWith('<svg') && !svg.includes('<script>'), 'nome com HTML vira texto');
  assert.match(svg, />&lt;script&gt;alert\(1\)&lt;…</, 'escapado e cortado em 18, com reticências');
  assert.match(svg, /Zé &amp; Cia/);
  assert.match(svg, />Final &quot;x&quot;</);
  const longo = f.lerPrancheta({
    formacao: '4-3-3', titulo: 'Final do campeonato estadual sub-17 de 2026',
    nomes: ['Bruno Henriques 👍🏽👍', `${String.fromCodePoint(0x202e)}ovad`, 'Ana Beatriz', 'x', 'y', 'Bruno Henriques'],
  });
  assert.equal(longo.titulo, 'Final do campeonato estadual sub-17 de…', 'o título tem até 40 (não o limite dos nomes)');
  assert.equal(longo.nomes[0], 'Bruno Henriques', 'sem emoji: a fonte do PNG não tem e saía um buraco');
  assert.equal(longo.nomes[1], 'ovad', 'sem o caractere que inverte o texto');
  assert.equal(longo.nomes[2], 'Ana Beatr…', 'na linha de 4, até 10 letras');
  assert.equal(longo.nomes[5], 'Bruno Henr…', 'no meio-campo de 3, até 11: o nome não encosta no do lado');
  assert.deepEqual([longo.tamanhos[0], longo.tamanhos[1], longo.tamanhos[5]], [17, 15, 17]);
  const cinco = f.lerPrancheta({ formacao: '3-5-2', nomes: ['𝐀'.repeat(20), 'a', 'b', 'c', 'Guilherme Arana'] });
  assert.equal(cinco.nomes[0], `${'𝐀'.repeat(17)}…`, 'corta por caractere, nunca no meio de um par UTF-16');
  assert.equal(cinco.nomes[4], 'Guilher…', 'linha de 5: fonte menor e nome mais curto');
  assert.equal(f.lerPrancheta({ formacao: '4-4-2', nomes: 'Ana, Bia ,,Cris' }).nomes.join('|'), 'Ana|Bia||Cris', 'texto separado por vírgula');
  assert.throws(() => f.lerPrancheta({ formacao: '4-3-3', setas: [{ de: 20, ate: [50, 50] }] }), /seta 1/);
  assert.throws(() => f.lerPrancheta({ formacao: '4-3-3', setas: [{ de: 9, ate: [50, 150] }] }), /seta 1/);
  const args = f.argsDaPrancheta({ formacao: '4-3-3', nomes: ['50% @casa'] }, '/tmp/x.png');
  assert.ok(args.includes('50%% @casa'), 'o texto vai escapado para o ImageMagick');
  assert.equal(args.at(-1), 'png:/tmp/x.png');
});

const imagem = require('../src/imagem');
const magick = imagem.acharMagick();
const exigirMidia = process.env.GEMINI_CODE_EXIGIR_MIDIA === '1';
test('prancheta de verdade: PNG e SVG novos (nunca sobrescreve), com os jogadores no lugar', { skip: !magick && !exigirMidia && 'sem ImageMagick', timeout: 60000 }, async () => {
  const r = await f.desenharPrancheta({ formacao: '4-3-3', nomes: ['Goleiro', 'Lateral', 'Zagueiro'], titulo: 'Time titular', setas: [{ de: 11, ate: [80, 8] }] }, { cwd: PROJ });
  assert.match(path.basename(r.png), /^prancheta-4-3-3\.png$/);
  assert.match(path.basename(r.svg), /^prancheta-4-3-3\.svg$/);
  const [w, h] = spawnSync(magick, [r.png, '-format', '%w %h', 'info:'], { encoding: 'utf8' }).stdout.trim().split(' ').map(Number);
  assert.deepEqual([w, h], [680, 1000]);
  // o goleiro (amarelo) embaixo, no meio
  const px = spawnSync(magick, [r.png, '-format', '%[fx:round(255*p{340,935}.r)] %[fx:round(255*p{340,935}.g)]', 'info:'], { encoding: 'utf8' }).stdout.trim().split(' ').map(Number);
  assert.ok(px[0] > 200 && px[1] > 130, `cor do goleiro: ${px}`);
  const r2 = await f.desenharPrancheta({ formacao: '4-3-3' }, { cwd: PROJ });
  assert.match(path.basename(r2.png), /^prancheta-4-3-3-2\.png$/, 'nunca sobrescreve');
  const s = await f.desenharPrancheta({ formacao: '3-5-2' }, { cwd: PROJ, magick: null });
  assert.equal(s.png, null, 'sem ImageMagick: só o SVG');
  assert.ok(fs.readFileSync(s.svg, 'utf8').startsWith('<svg'));
});

test('ferramenta "futebol": sob demanda (só no aliado ou com ferramentasExtras), as ações, e a prancheta aparece no site', async () => {
  const tools = require('../src/tools');
  assert.ok(tools.nomesSobDemanda().includes('futebol'));
  assert.ok(!(await tools.getAllDeclarations()).some((d) => d.name === 'futebol'), 'o chat comum não vê');
  assert.ok((await tools.getAllDeclarations(['futebol'])).some((d) => d.name === 'futebol'));
  const ft = require('../src/tools/futebolTools');
  assert.match(await ft.execute('futebol', { acao: 'treino', tema: 'transicao', categoria: 'sub-17', jogadores: 20 }), /^## Treino de transição ofensiva/);
  assert.match(await ft.execute('futebol', { acao: 'semana', jogo: 'sabado', dias: ['terca', 'quinta'] }), /MD-4/);
  assert.match(await ft.execute('futebol', { acao: 'carga', sessoes: [{ data: '2026-11-03', pse: 7, minutos: 90 }], hoje: '2026-11-04' }), /630 UA/);
  assert.match(await ft.execute('futebol', { acao: 'exercicios', tema: 'goleiro' }), /Goleiro: posicionamento/);
  assert.match(await ft.execute('futebol', { acao: 'pular' }), /precisa de "acao"/);
  assert.match(await ft.execute('futebol', { acao: 'treino', tema: 'xadrez' }), /^Erro: tema desconhecido/);
  if (magick) {
    const avisadas = [];
    const parar = require('../src/midiaGerada').observar((p) => avisadas.push(path.basename(p)));
    const antes = process.cwd();
    process.chdir(PROJ);
    try {
      assert.match(await ft.execute('futebol', { acao: 'prancheta', formacao: '4-4-2', nomes: ['A', 'B'] }), /^Prancheta salva: prancheta-4-4-2\.png/);
      assert.deepEqual(avisadas, ['prancheta-4-4-2.png'], 'o modo site mostra a prancheta');
    } finally { process.chdir(antes); parar(); }
  }
});

test('aliado "treinador": criado com as instruções, o preset e os iniciadores; o preset existe e é válido', async () => {
  const pa = require('../src/personalAgents');
  assert.deepEqual(pa.PRESETS.futebol, ['futebol', 'video', 'imagem', 'desafio', 'web_fetch']);
  const store = pa.createPersonalAgentStore({ dir: path.join(HOME, 'aliados') });
  const cmd = require('../src/futebolCommands');
  const r = await cmd.executar(['aliado'], { aliados: store });
  assert.equal(r.codigo, 0);
  const a = store.carregar('treinador');
  assert.match(a.instructions, /treinador de futebol de elite/);
  assert.match(a.instructions, /sem fingir ser nenhuma pessoa real/);
  assert.match(a.instructions, /na dúvida, fora/);
  assert.ok(a.instructions.length <= pa.LIMITES.instrucoes);
  assert.deepEqual(a.tools, pa.PRESETS.futebol);
  assert.equal(a.memory, 'confirmar', 'lembrar do time pede confirmação');
  assert.ok(a.starters.length >= 4);
  assert.match((await cmd.executar(['aliado'], { aliados: store })).linhas[0].texto, /já existe/);
});

test('comando do terminal: treino, semana, carga, prancheta e opção errada', () => {
  const env = { ...process.env, HOME, USERPROFILE: HOME };
  const rodar = (args) => spawnSync(process.execPath, [CLI, 'futebol', ...args], { encoding: 'utf8', env, cwd: PROJ });
  const t = rodar(['treino', '--tema', 'posse', '--categoria', 'sub-13', '--jogadores', '14']);
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /Treino de posse de bola/);
  assert.match(rodar(['semana', '--jogo', 'domingo', '--dias', 'quarta,sexta']).stdout, /MD-4/);
  const c = rodar(['carga', '--sessao', '2026-11-03:7:90', '--hoje', '2026-11-04']);
  assert.match(c.stdout, /630 UA/);
  assert.match(rodar(['carga', '--sessao', '02/11/2026:7:90', '--sessao', 'ontem:5:60', '--hoje', '04/11/2026']).stdout, /930 UA/);
  const ruim = rodar(['treino', '--temaa', 'posse']);
  assert.equal(ruim.status, 1);
  assert.match(ruim.stdout + ruim.stderr, /opção desconhecida: --temaa/);
  assert.equal(rodar(['carga', '--sessao', 'ontem']).status, 1);
  assert.match(rodar([]).stdout, /gemini-code futebol treino/);
});
