// src/futebol.js (v0.52.0) — o treinador de futebol: o que um treinador de elite faz, em peças puras e testáveis.
//   biblioteca   exercícios de verdade (rondos, jogo de posição, saída de bola, pressão pós-perda, transição,
//                defesa, finalização, cruzamento, bola parada, técnica, velocidade, goleiro), com regras, pontos de
//                correção, progressão e regressão, e para que idade servem;
//   treino       a sessão montada para a categoria, o número de jogadores, o tempo e o tema;
//   semana       o microciclo até o jogo (periodização tática: MD-4 tensão, MD-3 duração, MD-2 velocidade, MD-1 ativação);
//   carga        o controle de carga (sRPE de Foster: carga = PSE x minutos; aguda, crônica, ACWR, monotonia);
//   prancheta    a formação desenhada (posições calculadas de qualquer "4-3-3"), em SVG e em PNG (ImageMagick).
// O que vale: princípios do jogo nos 4 momentos (organização ofensiva e defensiva, transições) e na bola parada,
// especificidade (treinar como se joga), jogos reduzidos, e respeito à idade — criança brinca de jogar, sem trabalho
// físico pesado. Lesão, pancada na cabeça, calor forte: o médico/fisioterapeuta decide (regras fixas no plano).
'use strict';

// ---------------------------------------------------------------------------
// Temas, categorias e fases
// ---------------------------------------------------------------------------
const TEMAS = Object.freeze({
  posse: { nome: 'posse de bola e jogo de posição', regraJogo: 'gol só vale depois de 6 passes seguidos do time', pse: 6 },
  saida: { nome: 'saída de bola (construção desde o goleiro)', regraJogo: 'o goleiro sempre recomeça curto; passar a linha do meio conduzindo ou passando vale 1 ponto', pse: 6 },
  pressao: { nome: 'pressão pós-perda (reação à perda)', regraJogo: 'recuperar a bola em até 5 segundos depois de perder vale 1 ponto', pse: 8 },
  'pressao-alta': { nome: 'pressão alta organizada', regraJogo: 'roubar a bola no campo do adversário e finalizar em até 10 segundos vale gol em dobro', pse: 7 },
  transicao: { nome: 'transição ofensiva (contra-ataque)', regraJogo: 'gol em até 8 segundos depois de recuperar a bola vale 2', pse: 8 },
  defesa: { nome: 'organização defensiva (bloco compacto)', regraJogo: 'o time que defende ganha 1 ponto a cada roubada sem levar finalização', pse: 6 },
  finalizacao: { nome: 'finalização', regraJogo: 'chute de fora da área no alvo vale 1; gol vale 2', pse: 7 },
  cruzamento: { nome: 'jogo pelos lados e ataque à área', regraJogo: 'gol depois de cruzamento ou passe da linha de fundo vale 2', pse: 7 },
  'bola-parada': { nome: 'bolas paradas (escanteio e falta)', regraJogo: 'a cada 4 minutos, um escanteio para cada lado, com a jogada ensaiada', pse: 4 },
  tecnica: { nome: 'técnica (passe, domínio, condução e drible)', regraJogo: 'no máximo 2 toques (crianças: livre, mas cada drible bem feito vale palma)', pse: 5 },
  velocidade: { nome: 'velocidade e tomada de decisão', regraJogo: 'campo comprido e estreito, 4x4; ataque com no máximo 10 segundos', pse: 8 },
  goleiro: { nome: 'goleiro (posicionamento, 1x1 e saída)', regraJogo: 'chute só de dentro da área; o goleiro inicia todas as jogadas', pse: 6 },
});
const APELIDOS_TEMA = Object.freeze({
  'jogo-de-posicao': 'posse', posicao: 'posse', construcao: 'saida', 'saida-de-bola': 'saida', 'pressao-pos-perda': 'pressao', gegenpressing: 'pressao',
  'reacao-a-perda': 'pressao', 'contra-ataque': 'transicao', contragolpe: 'transicao', marcacao: 'defesa', 'bloco-baixo': 'defesa', chute: 'finalizacao',
  gol: 'finalizacao', lados: 'cruzamento', 'jogo-pelos-lados': 'cruzamento', escanteio: 'bola-parada', falta: 'bola-parada', fundamentos: 'tecnica',
  passe: 'tecnica', drible: 'tecnica', arranque: 'velocidade', goleiros: 'goleiro',
});
// idade de referência de cada categoria (o limite de cima) e a duração de treino que faz sentido
const CATEGORIAS = Object.freeze({
  'sub-7': { idade: 7, duracao: 45 }, 'sub-9': { idade: 9, duracao: 55 }, 'sub-11': { idade: 11, duracao: 60 },
  'sub-13': { idade: 13, duracao: 70 }, 'sub-15': { idade: 15, duracao: 80 }, 'sub-17': { idade: 17, duracao: 85 },
  'sub-20': { idade: 20, duracao: 90 }, adulto: { idade: 30, duracao: 90 }, veterano: { idade: 45, duracao: 75 },
});
const FASES = Object.freeze({ aquecimento: 'Aquecimento', principal: 'Exercício principal', jogo: 'Jogo condicionado', final: 'Volta à calma' });

// ---------------------------------------------------------------------------
// A biblioteca de exercícios
// grupo = jogadores por estação; espaco = [comprimento, largura] em metros para esse grupo; idade = idade mínima.
// ---------------------------------------------------------------------------
const EX = (o) => Object.freeze({ material: [], progressao: '', regressao: '', ...o });
const BIBLIOTECA = Object.freeze([
  // ---- aquecimento
  EX({
    id: 'ativacao-preventiva', nome: 'Ativação com bola + prevenção de lesão', fase: 'aquecimento', temas: ['*'], idade: 10, grupo: 2, espaco: [25, 15], pse: 3,
    descricao: 'Em duplas, passes em movimento pelo campo; entre os passes, corrida com abertura e fechamento de quadril, deslocamento lateral, saltos baixos com aterrissagem macia e acelerações curtas ao sinal (na linha dos programas de prevenção como o FIFA 11+).',
    regras: ['passe e desloque para uma nova linha', 'ao apito: arranque de 5 m e volte trotando'],
    pontos: ['joelho alinhado com o pé ao aterrissar (não deixar o joelho "entrar")', 'tronco firme', 'aumentar a intensidade aos poucos', 'comunicação: chamar o nome de quem recebe'],
    progressao: 'domínio orientado antes do passe e aceleração ao sinal visual', regressao: 'só passe e corrida leve', material: ['1 bola por dupla', 'cones'],
  }),
  EX({
    id: 'pega-pega-bola', nome: 'Pega-pega com bola', fase: 'aquecimento', temas: ['*'], idade: 5, grupo: 10, espaco: [20, 20], pse: 4,
    descricao: 'Cada criança conduz a própria bola dentro do quadrado; 2 pegadores sem bola tentam encostar em quem está conduzindo. Quem é pego troca de lugar com o pegador.',
    regras: ['a bola tem que estar perto do pé para não ser pego', 'quem chuta a bola para longe vira pegador'],
    pontos: ['bola colada no pé', 'cabeça levantada para ver os pegadores', 'mudar de direção com a sola e com a parte de fora do pé', 'elogiar quem arrisca o drible'],
    progressao: 'pegadores com bola (tem que conduzir e pegar)', regressao: 'quadrado maior, 1 pegador', material: ['1 bola por criança', '4 cones', 'coletes para os pegadores'],
  }),
  EX({
    id: 'rondo-4x1', nome: 'Rondo 4x1', fase: 'aquecimento', temas: ['posse', 'tecnica', 'pressao', 'saida'], idade: 8, grupo: 5, espaco: [10, 10], pse: 4,
    descricao: 'Quatro jogadores nos lados do quadrado mantêm a bola contra 1 no meio. Quem erra o passe (ou deixa a bola ser roubada) vai para o meio.',
    regras: ['no máximo 2 toques', '10 passes seguidos = 1 ponto para quem está fora', 'passe entre as pernas do defensor vale 2'],
    pontos: ['corpo aberto antes de receber (ver o próximo passe)', 'passe na perna boa do colega', 'dar linha de passe em diagonal ao lado de quem tem a bola', 'o do meio pressiona fechando um lado, não corre atrás da bola'],
    progressao: '1 toque, ou 5x2', regressao: 'toques livres e quadrado maior', material: ['1 bola', '4 cones', '1 colete'],
  }),
  EX({
    id: 'rondo-5x2', nome: 'Rondo 5x2 com troca de dupla', fase: 'aquecimento', temas: ['posse', 'pressao', 'tecnica'], idade: 11, grupo: 7, espaco: [14, 14], pse: 5,
    descricao: 'Cinco mantêm a posse contra 2 defensores. Quando a dupla rouba, quem errou e o colega que deu o passe entram no meio (a dupla treina a pressão em conjunto).',
    regras: ['2 toques', '8 passes = 1 ponto', 'a dupla rouba = troca imediata'],
    pontos: ['os dois de dentro pressionam juntos: um na bola, outro cortando o passe por dentro', 'fora: ocupar os espaços entre os defensores', 'passe com o pé de trás para tirar o defensor do lance'],
    progressao: 'tirar um jogador de fora (4x2)', regressao: 'quadrado maior', material: ['1 bola', '4 cones', '2 coletes'],
  }),
  EX({
    id: 'passe-quadrado', nome: 'Quadrado de passe (passe e siga)', fase: 'aquecimento', temas: ['tecnica', 'posse', 'saida'], idade: 8, grupo: 6, espaco: [12, 12], pse: 3,
    descricao: 'Jogadores nos 4 cones; passa para o cone da direita e segue a bola. Depois de 3 minutos, troca o sentido; depois, tabela com o cone seguinte antes de passar.',
    regras: ['domínio com o pé de trás, já saindo para o próximo passe', '2 bolas ao mesmo tempo quando o grupo dominar'],
    pontos: ['passe com a parte de dentro, pé de apoio apontando para o alvo', 'receber de lado (corpo aberto)', 'pedir a bola com a voz e com a mão', 'passe firme, rasteiro, no pé'],
    progressao: '2 bolas e 1 toque', regressao: 'distância menor e passe com a mão para as crianças pequenas', material: ['2 bolas', '4 cones'],
  }),
  // ---- exercício principal
  EX({
    id: 'posicao-4x4-3', nome: 'Jogo de posição 4x4 + 3 curingas', fase: 'principal', temas: ['posse', 'saida', 'pressao'], idade: 12, grupo: 11, espaco: [30, 25], pse: 6,
    descricao: 'Dois times de 4 dentro do retângulo e 3 curingas (um em cada lado do comprimento e um no meio) que jogam com quem tem a bola: 7x4 na posse.',
    regras: ['curingas com 2 toques e sem poder passar entre si', '8 passes seguidos = 1 ponto', 'perdeu a bola: o outro time vira o de 7'],
    pontos: ['superioridade: achar o homem livre entre as linhas do adversário', 'largura e profundidade: os curingas dos lados bem abertos', 'terceiro homem: passe para quem vai tocar para o livre', 'perfil do corpo aberto para jogar para a frente', 'quem perde a bola pressiona na hora (5 segundos)'],
    progressao: 'o ponto só vale se a bola passar pelo curinga do meio, ou 1 toque nos curingas', regressao: '5 curingas', material: ['1 bola + reservas nos cantos', 'coletes de 3 cores', '4 cones'],
  }),
  EX({
    id: 'saida-6x4', nome: 'Saída de bola 6 x 4 (goleiro + 4 defensores + volante)', fase: 'principal', temas: ['saida', 'pressao-alta', 'posse'], idade: 12, grupo: 10, espaco: [50, 45], pse: 6,
    descricao: 'Meio campo. A equipe de saída (goleiro, 2 zagueiros, 2 laterais e o volante) tem que passar a linha do meio por uma das 3 mini-traves. Os 4 atacantes pressionam; se roubarem, finalizam no gol.',
    regras: ['passar pela mini-trave conduzindo ou passando = 1 ponto', 'roubada + gol dos atacantes = 2 pontos', 'reinício sempre pelo goleiro'],
    pontos: ['goleiro como o 11º jogador: sempre uma opção atrás', 'zagueiros abrem até a linha da área, laterais altos e abertos', 'volante: entre os zagueiros ou de costas para o marcador, como pivô', 'atrair a pressão para soltar do outro lado', 'na dúvida, o passe longo para o atacante (não arriscar dentro da área)'],
    progressao: '6x5 (mais um atacante pressionando)', regressao: '6x3', material: ['bolas', 'gol oficial', '3 mini-traves', 'coletes'],
  }),
  EX({
    id: 'reacao-5s', nome: 'Reação à perda em 5 segundos (5x5 + 2 curingas)', fase: 'principal', temas: ['pressao', 'transicao', 'posse'], idade: 12, grupo: 12, espaco: [35, 30], pse: 8,
    descricao: '5x5 com 2 curingas para quem tem a bola. Quem perde a bola tem 5 segundos para recuperar; se recuperar, ganha 1 ponto. Se o adversário passar 5 segundos com a bola, ele é que ganha.',
    regras: ['o treinador conta os 5 segundos em voz alta', '6 passes do time com a bola = 1 ponto também'],
    pontos: ['o mais perto ataca a bola na hora, os outros fecham os passes curtos', 'pressionar de fora para dentro, direcionando para a linha lateral', 'em bloco: ninguém pressiona sozinho', 'se não der para recuperar, faça o adversário jogar para trás ou dar o chutão'],
    progressao: '3 segundos', regressao: '7 segundos e campo maior', material: ['bolas', '3 cores de colete', 'cones'],
  }),
  EX({
    id: 'jogo-4-golzinhos', nome: '4x4 com 4 golzinhos', fase: 'principal', temas: ['pressao', 'transicao', 'tecnica', 'posse'], idade: 9, grupo: 8, espaco: [30, 25], pse: 8,
    descricao: 'Cada time ataca 2 golzinhos e defende 2 (um em cada canto do lado dele). Sem goleiro. Muita troca de lado e muita decisão: ver qual golzinho está livre.',
    regras: ['gol só de dentro da metade do adversário', 'blocos de 3 minutos com 1 de descanso'],
    pontos: ['ver antes de receber qual lado está livre', 'virar o jogo rápido', 'ao perder, pressionar para o adversário não virar', 'comunicação: "vira!", "segura!"'],
    progressao: 'gol em até 3 toques depois da virada vale 2', regressao: 'golzinhos maiores', material: ['4 golzinhos (ou cones)', 'bolas', 'coletes'],
  }),
  EX({
    id: 'pressao-alta-gatilhos', nome: 'Pressão alta com gatilhos (8 x 6 + goleiro)', fase: 'principal', temas: ['pressao-alta', 'pressao', 'defesa'], idade: 14, grupo: 15, espaco: [55, 60], pse: 7,
    descricao: 'Meio campo. Seis jogadores e o goleiro tentam sair jogando até a linha do meio; os 8 pressionam e, ao roubar, finalizam. O time que pressiona só sobe quando aparece um gatilho.',
    regras: ['gatilhos: passe para o lateral, passe para trás, domínio ruim, jogador de costas', 'roubada no campo de ataque + finalização em 10 s = 2 pontos'],
    pontos: ['o centroavante corta o passe entre os zagueiros com a curva da corrida', 'meias encaixam nos volantes; o lateral sobe no lateral', 'nunca pressionar sem cobertura: a linha de trás sobe junto', 'distância entre as linhas de no máximo 10–15 m'],
    progressao: 'o time da saída ganha um curinga', regressao: '8 x 5', material: ['bolas', 'gol', 'coletes'],
  }),
  EX({
    id: 'transicao-3x2', nome: '3x2 com volta (transição)', fase: 'principal', temas: ['transicao', 'finalizacao', 'defesa'], idade: 10, grupo: 10, espaco: [40, 30], pse: 7,
    descricao: 'Três atacam dois defensores e o goleiro. Terminou a jogada (gol, defesa, bola fora), os dois defensores mais um que espera no meio saem em 3x2 para o outro gol.',
    regras: ['atacar em até 8 segundos', 'filas nos dois fundos'],
    pontos: ['quem conduz atrai o defensor antes de passar', 'passe no tempo certo, à frente do colega', 'um ataca o espaço nas costas do defensor', 'defensores: atrasar, fechar o meio e esperar a ajuda'],
    progressao: '3x2 que vira 2x1 voltando', regressao: '2x1', material: ['bolas', '2 gols', 'coletes'],
  }),
  EX({
    id: 'contra-ataque-8s', nome: 'Contra-ataque em 8 segundos (6x6 + goleiros)', fase: 'principal', temas: ['transicao', 'velocidade', 'pressao'], idade: 13, grupo: 14, espaco: [60, 45], pse: 8,
    descricao: '6x6 com goleiros. Recuperou a bola no próprio campo: gol em até 8 segundos vale 3. O time que perdeu treina a transição defensiva (voltar correndo por dentro).',
    regras: ['o treinador grita o tempo', 'gol normal vale 1'],
    pontos: ['primeiro passe para a frente, para quem está de frente para o gol', 'atacar o espaço vazio, não a bola', 'quem perdeu: o mais próximo atrasa, os outros voltam por dentro'],
    progressao: '6 segundos', regressao: '10 segundos', material: ['bolas', '2 gols', 'coletes'],
  }),
  EX({
    id: 'defesa-linha-4', nome: 'Linha de 4 + 2 volantes contra 6 atacantes', fase: 'principal', temas: ['defesa', 'pressao-alta', 'cruzamento'], idade: 13, grupo: 13, espaco: [45, 60], pse: 6,
    descricao: 'Meio campo. A linha de 4 e os 2 volantes defendem a área contra 6 atacantes que trocam a bola de um lado para o outro. Ao roubar, a defesa sai em 3 mini-traves no meio.',
    regras: ['atacantes: gol vale 1', 'defesa: sair pela mini-trave vale 1'],
    pontos: ['bola de um lado: a linha inteira desliza para aquele lado', 'distância de 8–12 m entre os de trás; cobertura atrás de quem pressiona', 'bola descoberta (sem pressão): a linha recua; bola coberta: a linha sobe', 'volantes protegem a frente da área, não deixam passe por dentro'],
    progressao: '6 x 7 (um atacante a mais)', regressao: '6 x 5', material: ['bolas', 'gol', '3 mini-traves', 'coletes'],
  }),
  EX({
    id: 'defesa-1x1', nome: '1x1 defensivo no corredor', fase: 'principal', temas: ['defesa', 'tecnica'], idade: 9, grupo: 2, espaco: [15, 10], pse: 7,
    descricao: 'Corredor de 15x10 m com um golzinho no fundo. O atacante tenta passar; o defensor tenta roubar ou levar para fora. Troca de papéis a cada jogada.',
    regras: ['10 segundos por jogada', 'roubada e passe numa mini-trave = ponto do defensor'],
    pontos: ['de lado, base baixa, braços soltos', 'diminuir a distância enquanto a bola viaja, frear antes de chegar', 'levar o atacante para o pé ruim ou para a lateral', 'bote só quando a bola se afastar do pé dele'],
    progressao: '1x1 com cobertura (2x2)', regressao: 'atacante só conduz, sem drible', material: ['bolas', 'golzinhos', 'cones'],
  }),
  EX({
    id: 'finalizacao-tabela', nome: 'Finalização em 2 toques depois de tabela', fase: 'principal', temas: ['finalizacao', 'tecnica'], idade: 9, grupo: 8, espaco: [30, 40], pse: 6,
    descricao: 'Fila na entrada da área; passa para o pivô na meia-lua, recebe a tabela, domina para o lado e chuta. Filas dos dois lados (pé direito e esquerdo). Goleiro ativo.',
    regras: ['no máximo 2 toques depois da tabela', 'quem chutou vira pivô'],
    pontos: ['o domínio já prepara o chute (para fora do corpo, na direção do gol)', 'olhar o goleiro antes de chutar', 'rasteiro e no canto oposto: o chute mais difícil de defender', 'acompanhar o rebote sempre'],
    progressao: 'defensor passivo que vira ativo', regressao: 'chute com a bola parada', material: ['muitas bolas', 'gol', 'cones'],
  }),
  EX({
    id: 'finalizacao-3x3-area', nome: '3x3 + goleiros na área (muitos chutes)', fase: 'principal', temas: ['finalizacao', 'goleiro', 'transicao'], idade: 9, grupo: 8, espaco: [30, 20], pse: 8,
    descricao: 'Campo curto com dois gols e goleiros: 3x3. Chute de qualquer lugar. Bola fora: o treinador repõe na hora, para muitos chutes e muitos rebotes.',
    regras: ['blocos de 2 minutos', 'gol de rebote vale 2'],
    pontos: ['chutar cedo: campo curto não tem tempo para firula', 'ler o goleiro: canto e altura', 'sempre um atacando o rebote', 'goleiro: posição básica e pés sempre ativos'],
    progressao: '2 toques', regressao: '4x4 em campo maior', material: ['muitas bolas', '2 gols', 'coletes'],
  }),
  EX({
    id: 'cruzamento-area', nome: 'Cruzamento e ataque à área', fase: 'principal', temas: ['cruzamento', 'finalizacao'], idade: 12, grupo: 8, espaco: [40, 50], pse: 6,
    descricao: 'Lateral e ponta combinam pelo lado (ultrapassagem ou tabela) e cruzam; 3 atacantes atacam o primeiro pau, o segundo pau e a marca do pênalti. Depois, com 2 defensores.',
    regras: ['alternar lado direito e esquerdo', 'cruzamento rasteiro para trás também vale'],
    pontos: ['o cruzamento é para o espaço, não para o jogador', 'atacantes chegam em velocidade, não esperam parados', 'um ataca a bola no primeiro pau, um no segundo, um fica no rebote', 'o cruzador olha antes de cruzar: quem chegou primeiro?'],
    progressao: '3 atacantes contra 3 defensores', regressao: 'sem defensores e com bola parada', material: ['bolas', 'gol', 'cones'],
  }),
  EX({
    id: 'escanteio-ofensivo', nome: 'Escanteio ofensivo: 3 jogadas ensaiadas', fase: 'principal', temas: ['bola-parada'], idade: 12, grupo: 11, espaco: [40, 45], pse: 4,
    descricao: 'Treinar 3 jogadas com sinal: (1) bola no primeiro pau com desvio; (2) bloqueio para o melhor cabeceador atacar o segundo pau; (3) curta com tabela e cruzamento de outro ângulo.',
    regras: ['cada jogada 4 vezes de cada lado', 'sinal com a mão ou com uma palavra antes da cobrança'],
    pontos: ['corrida começa junto com o batedor (nem antes, nem depois)', 'quem não cabeceia bem fica no rebote fora da área', 'sempre 2 + 1 atrás para o contra-ataque', 'o batedor treina a força e a curva antes'],
    progressao: 'com defesa ativa', regressao: 'sem defesa', material: ['bolas', 'gol', 'coletes'],
  }),
  EX({
    id: 'escanteio-defensivo', nome: 'Defesa de escanteio (zona + marcação)', fase: 'principal', temas: ['bola-parada', 'defesa', 'goleiro'], idade: 12, grupo: 11, espaco: [40, 45], pse: 4,
    descricao: 'Defesa mista: 4 jogadores em zona (primeiro pau, frente do gol, marca do pênalti, segundo pau) e o resto marcando os melhores cabeceadores; o goleiro manda na pequena área.',
    regras: ['cada cobrança: tirar a bola e sair em contra-ataque com 2 jogadores'],
    pontos: ['atacar a bola, não esperar ela chegar', 'tirar para fora e para o alto (nunca para o meio)', 'o goleiro fala alto: "goleiro!" ou "tira!"', 'depois do primeiro corte, a linha sobe junta'],
    progressao: 'atacantes com jogadas ensaiadas', regressao: 'cobrança com a mão', material: ['bolas', 'gol', 'coletes'],
  }),
  EX({
    id: 'conducao-portoes', nome: 'Condução e drible pelos portões', fase: 'principal', temas: ['tecnica', 'velocidade'], idade: 5, grupo: 10, espaco: [25, 20], pse: 5,
    descricao: 'Vários "portões" de cones espalhados. Cada um conduz a sua bola e passa pelo maior número de portões em 1 minuto. Depois, em duplas: 1x1 nos portões.',
    regras: ['não pode passar duas vezes seguidas no mesmo portão', 'contar os pontos em voz alta'],
    pontos: ['bola perto do pé', 'usar os dois pés e as partes de dentro e de fora', 'mudança de direção com a sola', 'olhar para cima para achar o portão livre'],
    progressao: 'só com o pé ruim, ou com um defensor', regressao: 'portões maiores', material: ['1 bola por jogador', 'muitos cones'],
  }),
  EX({
    id: 'velocidade-reacao', nome: 'Reação e arranque com finalização', fase: 'principal', temas: ['velocidade', 'finalizacao', 'transicao'], idade: 11, grupo: 6, espaco: [25, 15], pse: 8,
    descricao: 'Duplas lado a lado; ao estímulo (cor, número, palma) arrancam 10–20 m e disputam a bola que o treinador solta; quem ganha finaliza no golzinho. Pausa completa entre as tentativas.',
    regras: ['6 a 8 tentativas por dupla', 'pausa de 30 a 60 segundos entre as tentativas (um arranque de 2–3 s com pouca pausa vira treino de resistência, não de velocidade)'],
    pontos: ['primeiro passo curto e explosivo', 'braços ajudam', 'qualidade acima da quantidade: cansou, parou', 'decidir rápido depois do arranque'],
    progressao: 'estímulo visual em vez de sonoro', regressao: 'sem disputa, só o arranque', material: ['bolas', 'cones', 'golzinhos'],
  }),
  EX({
    id: 'goleiro-posicionamento', nome: 'Goleiro: posicionamento, 1x1 e saída', fase: 'principal', temas: ['goleiro'], idade: 10, grupo: 4, espaco: [30, 20], pse: 6,
    descricao: 'Sequência com o preparador: (1) chutes de ângulos diferentes com o goleiro ajustando a posição no arco imaginário; (2) 1x1 saindo do gol; (3) cruzamento para sair e pegar no alto.',
    regras: ['séries curtas (6 a 8 bolas) com descanso', 'o goleiro fala em todas as saídas'],
    pontos: ['posição de base: pés na largura do ombro, peso na frente', 'no 1x1, encurtar e ficar grande; não se jogar antes', 'na saída alta, pegar no ponto mais alto, com a perna de proteção', 'recomeço rápido: mão ou pé para o colega livre'],
    progressao: 'decisão: sair ou ficar, com 2 atacantes', regressao: 'bolas com a mão', material: ['muitas bolas', 'gol', 'cones'],
  }),
  // ---- jogo
  EX({
    id: 'jogo-condicionado', nome: 'Jogo coletivo com a regra do tema', fase: 'jogo', temas: ['*'], idade: 10, grupo: 14, espaco: [60, 45], pse: 7,
    descricao: 'Jogo com goleiros e a regra especial do tema de hoje (ver abaixo), para levar para o jogo o que foi treinado. O treinador para pouco e corrige rápido (congela a jogada só quando vale a pena).',
    regras: ['tempos de 6 a 10 minutos com 2 de descanso'],
    pontos: ['elogiar em voz alta quando a ideia do treino aparece no jogo', 'perguntar em vez de mandar: "o que você viu?"', 'corrigir 1 coisa de cada vez'],
    progressao: 'tirar a regra especial nos últimos minutos: o comportamento ficou?', regressao: 'curinga para quem tem a bola', material: ['bolas', '2 gols', 'coletes'],
  }),
  EX({
    id: 'festival-3x3', nome: 'Festival 3x3 / 4x4 (jogo das crianças)', fase: 'jogo', temas: ['*'], idade: 5, grupo: 8, espaco: [25, 20], pse: 6,
    descricao: 'Vários campinhos de 3x3 ou 4x4 com golzinhos, sem goleiro fixo: todo mundo toca muito na bola. A cada jogo, os times trocam de campo e de adversário.',
    regras: ['jogos de 4 a 5 minutos', 'todo mundo joga o mesmo tempo', 'sem placar geral: o que vale é jogar'],
    pontos: ['deixar jogar: pouca instrução, muito elogio ao esforço e à coragem', 'criança não é adulto pequeno: nada de posição fixa', 'pergunta simples no intervalo: "o que deu certo?"'],
    progressao: '4x4 com goleiro-linha (quem estiver mais atrás pode pegar com a mão)', regressao: '2x2', material: ['muitas bolas', 'golzinhos', 'coletes'],
  }),
  // ---- volta à calma
  EX({
    id: 'volta-calma', nome: 'Volta à calma e roda de conversa', fase: 'final', temas: ['*'], idade: 5, grupo: 30, espaco: [20, 20], pse: 2,
    descricao: 'Trote leve, alongamento suave dos músculos mais usados e a roda: o que aprendemos hoje, 1 elogio para o time e o que melhorar no próximo treino.',
    regras: ['água para todos', 'quem sentiu dor fala com o treinador agora'],
    pontos: ['fechar o treino com a mensagem do dia em uma frase', 'perguntas abertas: "o que vocês fizeram quando perderam a bola?"', 'lembrar o próximo compromisso'],
    material: [],
  }),
]);

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s) => semAcento(s).trim().toLowerCase().replace(/[\s_]+/g, '-');

function lerTema(t) {
  if (t === undefined || t === null || t === '') return 'posse';
  const k = chave(t);
  const tema = TEMAS[k] ? k : APELIDOS_TEMA[k];
  if (!tema) throw new Error(`tema desconhecido ("${t}"). Use: ${Object.keys(TEMAS).join(', ')}.`);
  return tema;
}

function lerCategoria(c) {
  if (c === undefined || c === null || c === '') return 'adulto';
  let k = chave(c).replace(/^sub(\d)/, 'sub-$1').replace(/^u-?(\d)/, 'sub-$1');
  if (/^(adultos?|profissional|amador|varzea|principal)$/.test(k)) k = 'adulto';
  if (/^(veteranos?|master|masters)$/.test(k)) k = 'veterano';
  if (/^\d{1,2}$/.test(k)) { // idade: "12" → a categoria dela
    const idade = Number(k);
    k = Object.keys(CATEGORIAS).find((n) => CATEGORIAS[n].idade >= idade) || 'adulto';
  }
  if (!CATEGORIAS[k]) throw new Error(`categoria desconhecida ("${c}"). Use: ${Object.keys(CATEGORIAS).join(', ')} (ou a idade, ex.: 12).`);
  return k;
}

const inteiro = (v, rotulo, min, max, padrao) => {
  if (v === undefined || v === null || v === '') return padrao;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${rotulo} precisa ser um número inteiro de ${min} a ${max}.`);
  return n;
};

// ---------------------------------------------------------------------------
// Treino
// ---------------------------------------------------------------------------
const arredondar5 = (n) => Math.max(5, Math.round(n / 5) * 5);

/** Como dividir o grupo e de que tamanho fazer o campo para o exercício (o espaço cresce com o grupo). */
function organizar(ex, jogadores) {
  if (ex.fase === 'final') return { grupos: 1, porGrupo: jogadores, campo: ex.espaco, texto: 'todos juntos' };
  const porGrupo = Math.min(jogadores, ex.grupo);
  const grupos = Math.max(1, Math.floor(jogadores / porGrupo));
  const sobra = jogadores - grupos * porGrupo;
  const tamanho = porGrupo + Math.ceil(sobra / grupos);
  const f = Math.sqrt(tamanho / ex.grupo);
  const [c, l] = ex.espaco.map((m) => arredondar5(m * f));
  const texto = grupos === 1
    ? `1 grupo de ${jogadores} em ${c}x${l} m`
    : `${grupos} grupos de ${porGrupo}${sobra ? ` (${sobra} ${sobra === 1 ? 'jogador entra' : 'jogadores entram'} como curinga ou revezam)` : ''}, cada um em ${c}x${l} m`;
  return { grupos, porGrupo, campo: [c, l], texto };
}

/** Os exercícios daquela fase que servem: do tema, senão os gerais, senão qualquer um da idade (nunca vazio). */
function candidatos(tema, fase, idade, jogadores) {
  const daFase = BIBLIOTECA.filter((e) => e.fase === fase && e.idade <= idade);
  const doTema = daFase.filter((e) => e.temas.includes(tema));
  const gerais = daFase.filter((e) => e.temas.includes('*'));
  const lista = doTema.length ? doTema : gerais.length ? gerais : daFase.length ? daFase : BIBLIOTECA.filter((e) => e.fase === fase);
  // primeiro o que é DESSE tema (o tema principal do exercício), depois o que cabe no número de jogadores (um
  // exercício de 11 com 6 jogadores fica ruim), depois o mais avançado que a idade permite
  const principal = (e) => Number(e.temas[0] !== tema);
  return [...lista].sort((a, b) => principal(a) - principal(b) || Number(a.grupo > jogadores) - Number(b.grupo > jogadores) || b.idade - a.idade);
}
const temaServeParaIdade = (tema, idade) => BIBLIOTECA.some((e) => e.fase === 'principal' && e.idade <= idade && e.temas.includes(tema));

/**
 * Monta a sessão de treino.
 * @param {{ tema?, categoria?, jogadores?, goleiros?, duracao?, objetivo? }} o
 * @returns {{ titulo, tema, nomeTema, categoria, jogadores, goleiros, duracao, blocos, carga, lembretes }}
 */
function planejarTreino(o = {}) {
  const tema = lerTema(o.tema || o.objetivo);
  const categoria = lerCategoria(o.categoria);
  const { idade, duracao: duracaoPadrao } = CATEGORIAS[categoria];
  const crianca = idade <= 9;
  const jogadores = inteiro(o.jogadores, 'o número de jogadores', 2, 40, crianca ? 12 : 18);
  const goleiros = inteiro(o.goleiros, 'o número de goleiros', 0, 6, jogadores >= 12 && !crianca ? 2 : 0);
  const duracao = inteiro(o.duracao, 'a duração (minutos)', 20, 150, duracaoPadrao);
  // a divisão do tempo: criança tem mais jogo e nenhum exercício analítico longo
  const partes = crianca
    ? [['aquecimento', 0.2], ['principal', 0.3], ['jogo', 0.4], ['final', 0.1]]
    : [['aquecimento', 0.18], ['principal', 0.3], ['principal', 0.22], ['jogo', 0.2], ['final', 0.1]];
  const usados = new Set();
  const blocos = [];
  let restante = duracao;
  partes.forEach(([fase, fracao], i) => {
    const minutos = i === partes.length - 1 ? restante : Math.max(fase === 'final' ? 5 : 6, Math.round(duracao * fracao));
    restante -= minutos;
    const ex = candidatos(tema, fase, idade, jogadores).find((e) => !usados.has(e.id));
    const anterior = blocos[blocos.length - 1];
    if (!ex && anterior && anterior.fase === fase) {
      // o tema só tem um exercício principal para a idade: mais tempo nele, em duas etapas (a segunda com a
      // progressão) — melhor do que repetir o mesmo exercício ou fugir do tema
      anterior.minutos += minutos;
      anterior.emDuasEtapas = true;
      return;
    }
    usados.add(ex.id);
    // os goleiros aquecem com o preparador (lembrete abaixo): o aquecimento se divide entre os de linha
    const aParte = fase === 'aquecimento' && goleiros > 0 && jogadores - goleiros >= 2;
    const organizacao = organizar(ex, aParte ? jogadores - goleiros : jogadores);
    if (aParte) organizacao.texto += goleiros === 1 ? '; o goleiro aquece à parte' : `; os ${goleiros} goleiros aquecem à parte`;
    blocos.push({ fase, nomeFase: FASES[fase], minutos, exercicio: ex, organizacao });
  });
  // corrige arredondamentos para a soma bater com a duração
  const soma = blocos.reduce((s, b) => s + b.minutos, 0);
  if (soma !== duracao) blocos[blocos.length - 1].minutos += duracao - soma;
  const pse = Math.round(blocos.reduce((s, b) => s + b.exercicio.pse * b.minutos, 0) / duracao * 10) / 10;
  const lembretes = [
    'Água à vontade e pausa para hidratar a cada 15–20 minutos (no calor forte, mais vezes e na sombra).',
    'Dor que não passa, pancada na cabeça ou tontura: tire do treino e procure avaliação médica — na dúvida, fora.',
  ];
  if (!temaServeParaIdade(tema, idade)) lembretes.unshift(`O tema "${TEMAS[tema].nome}" é avançado para ${categoria}: o treino foca em jogar e na técnica, que é o que prepara para ele.`);
  if (crianca) lembretes.unshift('Criança: o treino é brincar de jogar — muita bola por criança, todos jogam o mesmo tempo, sem trabalho físico sem bola nem cobrança de resultado.');
  else if (idade <= 13) lembretes.unshift('Sub-13 e menores: técnica e tomada de decisão primeiro; nada de musculação pesada; elogiar a tentativa.');
  if (goleiros) lembretes.push(`Goleiros (${goleiros}): aquecem com o preparador (mãos, quedas, saídas) e entram nos jogos; no exercício principal, um deles fica no gol.`);
  return {
    titulo: `Treino de ${TEMAS[tema].nome} — ${categoria}`,
    tema, nomeTema: TEMAS[tema].nome, categoria, jogadores, goleiros, duracao, blocos,
    carga: { pse, ua: Math.round(pse * duracao) },
    regraDoJogo: TEMAS[tema].regraJogo,
    lembretes,
  };
}

/** O treino em Markdown, para o chat e para o terminal. */
function textoDoTreino(p) {
  const L = [`## ${p.titulo}`, `${p.jogadores} jogadores${p.goleiros ? ` (${p.goleiros} goleiros)` : ''} · ${p.duracao} min · carga prevista ≈ ${p.carga.ua} UA (PSE média ${String(p.carga.pse).replace('.', ',')})`, ''];
  p.blocos.forEach((b, i) => {
    const e = b.exercicio;
    L.push(`### ${i + 1}. ${b.nomeFase} — ${b.minutos} min: ${e.nome}`);
    L.push(`**Organização:** ${b.organizacao.texto}.${e.material.length ? ` Material: ${e.material.join(', ')}.` : ''}`);
    L.push(e.descricao);
    if (e.regras.length) L.push(`**Regras:** ${e.regras.join('; ')}.`);
    if (b.fase === 'jogo') L.push(`**Regra do tema:** ${p.regraDoJogo}.`);
    if (e.pontos.length) L.push('**Pontos de correção:**', ...e.pontos.map((x) => `- ${x}`));
    if (b.emDuasEtapas) L.push(`**Em duas etapas:** metade do tempo como descrito${e.progressao ? `; na outra metade, com a progressão (${e.progressao})` : ', a outra metade com menos toques e menos espaço'}.`);
    if (e.progressao || e.regressao) L.push(`**Ficou fácil:** ${e.progressao || '—'}. **Ficou difícil:** ${e.regressao || '—'}.`);
    L.push('');
  });
  L.push('**Lembretes:**', ...p.lembretes.map((x) => `- ${x}`));
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Semana (periodização tática)
// ---------------------------------------------------------------------------
const DIAS = Object.freeze(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']);
const NOME_DIA = Object.freeze({ domingo: 'Domingo', segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado' });
const DIAS_APELIDOS = Object.freeze({ seg: 'segunda', ter: 'terca', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sabado', dom: 'domingo' });
const FOCOS = Object.freeze({
  recuperacao: { nome: 'Recuperação', detalhe: 'Quem jogou: regenerativo leve (trote, bola, alongamento). Quem jogou pouco: treino compensatório com bola.', pse: 3, temas: ['tecnica'] },
  tensao: { nome: 'Tensão (força específica)', detalhe: 'Jogos reduzidos em espaço curto (3x3 a 5x5), muitas acelerações, freadas e disputas; os princípios do jogo em pequenos grupos. Pausas maiores entre as séries.', pse: 7, temas: ['pressao', 'defesa', 'finalizacao'] },
  duracao: { nome: 'Duração (resistência específica)', detalhe: 'Espaços grandes e mais jogadores (8x8 a 11x11), exercícios mais longos: o modelo de jogo inteiro, com as transições.', pse: 7, temas: ['posse', 'transicao', 'saida'] },
  velocidade: { nome: 'Velocidade', detalhe: 'Exercícios curtos e rápidos, com pausa completa: arranques com decisão, finalização rápida, transições de poucos segundos. Pouca densidade.', pse: 6, temas: ['velocidade', 'transicao', 'finalizacao'] },
  ativacao: { nome: 'Ativação (pré-jogo)', detalhe: 'Carga baixa e curta: rondos, bola parada ensaiada, os detalhes do plano de jogo contra o adversário. Sair do treino com energia.', pse: 3, temas: ['bola-parada', 'posse'] },
});

function lerDia(d) {
  const k = chave(d).replace(/-feira$/, '');
  const dia = DIAS.includes(k) ? k : DIAS_APELIDOS[k.slice(0, 3)];
  if (!dia) throw new Error(`dia desconhecido ("${d}"). Use: ${DIAS.join(', ')}.`);
  return dia;
}

// "segunda,terça" · "segunda terça" · "quarta e domingo" · ['seg', 'qui']
const listaDeDias = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((d) => String(d).trim()).filter((d) => d && d.toLowerCase() !== 'e');

/**
 * O microciclo até o jogo. dias = dias de treino; jogo = o dia do jogo (ou os dias, numa semana com 2 jogos; ou nenhum).
 * Cada treino recebe o foco pela distância ao próximo jogo (MD-1 ativação, MD-2 velocidade, MD-3 duração, MD-4 tensão)
 * e o dia seguinte a um jogo é sempre recuperação.
 */
function planejarSemana(o = {}) {
  const categoria = lerCategoria(o.categoria);
  const { idade } = CATEGORIAS[categoria];
  const jogosLidos = [...new Set(listaDeDias(o.jogo).map(lerDia))];
  if (jogosLidos.length > 3) throw new Error('no máximo 3 jogos na semana.');
  // a ordem do microciclo: começa no dia seguinte ao último jogo da semana (segunda a domingo); sem jogo, na segunda
  const segundaPrimeiro = (d) => (DIAS.indexOf(d) + 6) % 7;
  const ultimo = jogosLidos.reduce((a, d) => (a === null || segundaPrimeiro(d) > segundaPrimeiro(a) ? d : a), null);
  const inicio = ultimo === null ? DIAS.indexOf('segunda') : (DIAS.indexOf(ultimo) + 1) % 7;
  const ordenar = (lista) => [...new Set(lista)].sort((a, b) => (DIAS.indexOf(a) - inicio + 7) % 7 - (DIAS.indexOf(b) - inicio + 7) % 7);
  const jogos = ordenar(jogosLidos);
  const dias = ordenar((o.dias === undefined || o.dias === null || o.dias === '' ? ['segunda', 'terca', 'quinta', 'sexta'] : listaDeDias(o.dias)).map(lerDia));
  if (!dias.length) throw new Error('informe os dias de treino.');
  const repetido = jogos.find((j) => dias.includes(j));
  if (repetido) throw new Error(`o dia do jogo (${NOME_DIA[repetido].toLowerCase()}) não pode ser também um dia de treino.`);
  const distancia = (de, ate) => (DIAS.indexOf(ate) - DIAS.indexOf(de) + 7) % 7 || 7;
  const plano = dias.map((dia, i) => {
    let foco;
    let md = null;
    if (jogos.length) {
      const antes = Math.min(...jogos.map((j) => distancia(dia, j))); // dias até o próximo jogo
      const depois = Math.min(...jogos.map((j) => distancia(j, dia))); // dias desde o último jogo
      md = depois === 1 || (depois === 2 && antes > 4) ? `MD+${depois}` : `MD-${antes}`;
      if (depois === 1) foco = 'recuperacao';
      else foco = antes === 1 ? 'ativacao' : antes === 2 ? 'velocidade' : antes === 3 ? 'duracao' : antes === 4 ? 'tensao' : 'recuperacao';
    } else foco = ['tensao', 'duracao', 'velocidade'][i % 3];
    if (idade <= 11) foco = foco === 'recuperacao' ? 'recuperacao' : 'crianca';
    const f = foco === 'crianca'
      ? { nome: 'Jogar e aprender', detalhe: 'Na idade deles não existe periodização de adulto: cada treino tem muita bola, jogos reduzidos e um tema técnico.', pse: 5, temas: ['tecnica', 'finalizacao', 'posse'] }
      : FOCOS[foco];
    const exemplos = f.temas.flatMap((t) => candidatos(t, 'principal', idade, 14).slice(0, 1)).map((e) => e.nome);
    return { dia, nomeDia: NOME_DIA[dia], md, foco, nomeFoco: f.nome, detalhe: f.detalhe, pse: f.pse, temas: f.temas, exemplos: [...new Set(exemplos)] };
  });
  const avisos = [];
  for (const jogo of jogos) {
    const vespera = DIAS[(DIAS.indexOf(jogo) + 6) % 7];
    if (!dias.includes(vespera) && !jogos.includes(vespera)) avisos.push(`Sem treino na véspera do jogo de ${NOME_DIA[jogo].toLowerCase()} (${NOME_DIA[vespera].toLowerCase()}): o último treino antes dele fica mais leve no fim (bola parada e ajustes).`);
  }
  if (jogos.length >= 2) avisos.push(`Semana com ${jogos.length} jogos: entre eles é recuperar e ativar — o treino forte (tensão, duração) fica para quem jogou pouco.`);
  if (plano.filter((p) => p.pse >= 7).length >= 3) avisos.push('Três ou mais dias fortes na semana: confira a carga (gemini-code futebol carga) para não exagerar.');
  // "até o jogo de sábado"; com mais de um: "com jogos na quarta e no domingo"
  const comArtigo = jogos.map((j) => `${j === 'sabado' || j === 'domingo' ? 'no' : 'na'} ${NOME_DIA[j].toLowerCase()}`);
  const nomeJogo = !jogos.length ? null : jogos.length === 1 ? NOME_DIA[jogos[0]].toLowerCase() : `${comArtigo.slice(0, -1).join(', ')} e ${comArtigo.at(-1)}`;
  return { categoria, jogo: jogos[0] || null, jogos, nomeJogo, plano, avisos };
}

function textoDaSemana(s) {
  const titulo = !s.nomeJogo ? '' : s.jogos.length > 1 ? ` com jogos ${s.nomeJogo}` : ` até o jogo de ${s.nomeJogo}`;
  const L = [`## Semana${titulo} — ${s.categoria}`, ''];
  for (const d of s.plano) {
    L.push(`### ${d.nomeDia}${d.md ? ` (${d.md})` : ''}: ${d.nomeFoco}`);
    L.push(d.detalhe);
    L.push(`Intensidade alvo: PSE ${d.pse}/10. Temas que combinam: ${d.temas.map((t) => TEMAS[t].nome).join(', ')}.`);
    if (d.exemplos.length) L.push(`Exercícios: ${d.exemplos.join('; ')}.`);
    L.push('');
  }
  if (s.avisos.length) L.push('**Atenção:**', ...s.avisos.map((a) => `- ${a}`));
  return L.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Carga (sRPE de Foster)
// ---------------------------------------------------------------------------
const DIA_MS = 24 * 3600 * 1000;
// o dia do calendário LOCAL (o de quem treina) como número, para contar dias sem horário de verão no meio
const diaDe = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const FORMATO_DATA = 'use 2026-11-04, 04/11/2026, 04/11, "ontem" ou "hoje"';

/**
 * sessoes: [{ data, pse: 0..10, minutos }] (sem data: uma por dia, em sequência, terminando hoje). A data é digitada
 * por gente: passa por src/datas.js (2026-11-04, 04/11/2026, 04/11, ontem) — nunca pelo new Date(texto).
 * Carga da sessão = PSE x minutos (UA). Aguda = soma dos últimos 7 dias; crônica = média semanal dos últimos 28;
 * ACWR = aguda / crônica; monotonia = média diária / desvio padrão (7 dias, contando os dias sem treino); tensão
 * (strain) = carga semanal x monotonia.
 */
function calcularCarga(sessoes, { hoje, agora = new Date() } = {}) {
  const { lerDataHora } = require('./datas');
  if (!Array.isArray(sessoes) || !sessoes.length) throw new Error('informe as sessões: [{ data: "2026-11-04", pse: 0-10, minutos }].');
  if (sessoes.length > 400) throw new Error('no máximo 400 sessões.');
  const ref = hoje === undefined || hoje === null || hoje === ''
    ? agora
    : lerDataHora(String(hoje), { agora, erroFormato: `"hoje" precisa ser uma data: ${FORMATO_DATA}.` });
  const fim = diaDe(ref);
  const fimDoDia = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59);
  const porDia = new Map();
  sessoes.forEach((s, i) => {
    const pse = Number(s && (s.pse ?? s.rpe));
    const minutos = Number(s && s.minutos);
    if (!Number.isFinite(pse) || pse < 0 || pse > 10) throw new Error(`sessão ${i + 1}: a PSE vai de 0 a 10.`);
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 300) throw new Error(`sessão ${i + 1}: minutos de 1 a 300.`);
    // "ontem", "hoje" e "04/11" (sem o ano) contam a partir do dia de referência
    const t = s.data === undefined || s.data === null || s.data === ''
      ? fim - (sessoes.length - 1 - i) * DIA_MS
      : diaDe(lerDataHora(String(s.data), { agora: fimDoDia, erroFormato: `sessão ${i + 1}: data inválida ("${String(s.data).slice(0, 40)}"): ${FORMATO_DATA}.` }));
    if (t > fim) throw new Error(`sessão ${i + 1}: a data (${String(s.data).slice(0, 40)}) é depois do dia de referência — confira o dia ou informe "hoje".`);
    porDia.set(t, (porDia.get(t) || 0) + pse * minutos);
  });
  const diaria = (k) => porDia.get(fim - k * DIA_MS) || 0;
  const ultimos7 = Array.from({ length: 7 }, (_, k) => diaria(k));
  const aguda = ultimos7.reduce((a, b) => a + b, 0);
  const soma28 = Array.from({ length: 28 }, (_, k) => diaria(k)).reduce((a, b) => a + b, 0);
  const cronica = soma28 / 4;
  const dias28 = [...porDia.keys()].filter((t) => fim - t >= 0 && fim - t < 28 * DIA_MS);
  const historico = dias28.length ? Math.round((fim - Math.min(...dias28)) / DIA_MS) + 1 : 0;
  const media = aguda / 7;
  const dp = Math.sqrt(ultimos7.reduce((s, v) => s + (v - media) ** 2, 0) / 7);
  const monotonia = dp > 0 ? media / dp : null;
  const acwr = cronica > 0 ? aguda / cronica : null;
  const r2 = (n) => (n === null ? null : Math.round(n * 100) / 100);
  const leitura = [];
  // sem 3 semanas de base, a crônica é pequena e o ACWR sai alto sem significar nada: não dá faixa de risco
  const comBase = historico >= 21;
  if (!comBase) leitura.push('Menos de 3 semanas de registros: a carga crônica ainda não é confiável, então o ACWR ainda não diz nada — continue registrando todos os treinos e jogos.');
  else if (acwr !== null && acwr > 1.5) leitura.push('ACWR acima de 1,5: aumento brusco de carga — reduza nos próximos dias (é a faixa associada a mais lesões).');
  else if (acwr !== null && acwr >= 0.8 && acwr <= 1.3) leitura.push('ACWR entre 0,8 e 1,3: faixa de progressão segura.');
  else if (acwr !== null && acwr < 0.8) leitura.push('ACWR abaixo de 0,8: carga baixa para o que o grupo está acostumado (destreino, ou semana de jogo).');
  else if (acwr !== null) leitura.push('ACWR entre 1,3 e 1,5: atenção, subindo rápido.');
  if (monotonia !== null && monotonia > 2) leitura.push('Monotonia acima de 2: os dias estão todos parecidos — alterne dias fortes e leves.');
  return { aguda: Math.round(aguda), cronica: Math.round(cronica), acwr: r2(acwr), comBase, monotonia: r2(monotonia), tensao: monotonia === null ? null : Math.round(aguda * monotonia), ultimos7, leitura };
}

function textoDaCarga(c) {
  return [
    '## Carga (PSE x minutos)',
    `- Últimos 7 dias (aguda): **${c.aguda} UA**`,
    `- Média semanal de 4 semanas (crônica): **${c.cronica} UA**`,
    `- ACWR (aguda/crônica): **${c.acwr === null ? '—' : String(c.acwr).replace('.', ',')}**${c.acwr !== null && c.comBase === false ? ' (ainda sem base)' : ''}`,
    `- Monotonia: **${c.monotonia === null ? '—' : String(c.monotonia).replace('.', ',')}**${c.tensao === null ? '' : ` · tensão (strain): **${c.tensao}**`}`,
    '',
    ...c.leitura.map((l) => `- ${l}`),
    '- Os números orientam o planejamento; não preveem lesão. Junte com o que cada jogador conta (sono, dor, cansaço, humor).',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Prancheta (formação)
// ---------------------------------------------------------------------------
/** "4-3-3" -> [4, 3, 3]; 3 a 10 jogadores de linha (futsal 4, society 6, campo 10). */
function lerFormacao(f) {
  const s = String(f || '4-3-3').trim().replace(/[–—x.\s]+/g, '-');
  if (!/^\d(?:-\d){1,4}$/.test(s)) throw new Error(`formação inválida ("${f}"): use algo como 4-3-3, 4-2-3-1, 3-5-2 (society: 2-3-1; futsal: 2-2).`);
  const linhas = s.split('-').map(Number);
  const total = linhas.reduce((a, b) => a + b, 0);
  if (linhas.some((n) => n < 1 || n > 6)) throw new Error('cada linha da formação tem de 1 a 6 jogadores.');
  if (total < 3 || total > 10) throw new Error(`a formação tem ${total} jogadores de linha: o máximo é 10 (mais o goleiro).`);
  return { texto: s, linhas, total };
}

/**
 * Posições (0 a 100) de cada jogador, ataque para cima: goleiro embaixo, linhas espaçadas até o ataque, e cada
 * linha distribuída na largura. @returns {{ x, y, linha }[]} (o goleiro primeiro)
 */
function posicoes(formacao) {
  const { linhas } = lerFormacao(formacao);
  const out = [{ x: 50, y: 92, linha: 0 }];
  const yDefesa = 76;
  const yAtaque = 20;
  linhas.forEach((n, i) => {
    const y = linhas.length === 1 ? 50 : yDefesa - (i * (yDefesa - yAtaque)) / (linhas.length - 1);
    for (let k = 0; k < n; k++) out.push({ x: Math.round(((k + 1) * 100) / (n + 1) * 10) / 10, y: Math.round(y * 10) / 10, linha: i + 1 });
  });
  return out;
}

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// sem caracteres de controle nem de direção (bidi), sem emoji (a fonte do PNG não tem: saía um buraco), cortado por
// caractere (nunca no meio de um par UTF-16) e com "…"
const PICTOGRAMA = /\p{Extended_Pictographic}/u;
const invisivel = (cp) => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfe0e || cp === 0xfe0f || cp === 0xfeff ||
  (cp >= 0x1f3fb && cp <= 0x1f3ff); // os tons de pele dos emoji
function textoCurto(s, max) {
  const t = Array.from(String(s || '')).filter((c) => !invisivel(c.codePointAt(0)) && !PICTOGRAMA.test(c)).join('').replace(/\s+/g, ' ').trim();
  const cps = Array.from(t);
  return cps.length > max ? `${cps.slice(0, max - 1).join('').trimEnd()}…` : t;
}

const W = 680;
const H = 1000;
const MARGEM = 30;
const px = (p) => ({ x: Math.round(MARGEM + (p.x / 100) * (W - 2 * MARGEM)), y: Math.round(MARGEM + 40 + (p.y / 100) * (H - 2 * MARGEM - 40)) });

/** Fonte e tamanho máximo do nome: o espaço dele é a distância até o vizinho da linha (nome comprido encostava). */
function medidaDoNome(naLinha) {
  const tamanho = naLinha >= 4 ? 15 : 17;
  const espaco = (W - 2 * MARGEM) / (naLinha + 1);
  // 0,72 em por letra: a média da DejaVu Sans Bold com maiúsculas (medido no PNG; 0,62 ainda encostava)
  return { tamanho, max: Math.max(6, Math.min(18, Math.floor((espaco - 10) / (0.72 * tamanho)))) };
}

/** Nomes (opcionais) e setas (de um jogador até um ponto 0..100) validados. */
function lerPrancheta(o = {}) {
  const f = lerFormacao(o.formacao);
  const pos = posicoes(f.texto);
  const naLinha = (i) => pos.filter((q) => q.linha === pos[i].linha).length;
  const brutos = (Array.isArray(o.nomes) ? o.nomes : String(o.nomes || '').split(',')).slice(0, pos.length);
  const medidas = pos.map((_, i) => medidaDoNome(naLinha(i)));
  const nomes = brutos.map((s, i) => textoCurto(s, medidas[i].max));
  const setas = (Array.isArray(o.setas) ? o.setas : []).slice(0, 12).map((s, i) => {
    const de = Number(s && s.de);
    const ate = Array.isArray(s && s.ate) ? s.ate.map(Number) : [];
    if (!Number.isInteger(de) || de < 1 || de > f.total + 1 || ate.length !== 2 || ate.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) {
      throw new Error(`seta ${i + 1}: use { de: número do jogador (1 = goleiro), ate: [x, y] de 0 a 100 }.`);
    }
    return { de, ate };
  });
  return { ...f, nomes, tamanhos: medidas.map((m) => m.tamanho), setas, titulo: textoCurto(o.titulo, 40) || f.texto, pos };
}

/** As linhas do campo, em coordenadas da imagem (iguais no SVG e no PNG). */
function linhasDoCampo() {
  const x0 = MARGEM; const y0 = MARGEM + 40; const x1 = W - MARGEM; const y1 = H - MARGEM;
  const cx = W / 2; const meio = (y0 + y1) / 2;
  const areaL = 300; const areaA = 120; const pequenaL = 140; const pequenaA = 44;
  return {
    retangulos: [[x0, y0, x1, y1], [cx - areaL / 2, y0, cx + areaL / 2, y0 + areaA], [cx - areaL / 2, y1 - areaA, cx + areaL / 2, y1],
      [cx - pequenaL / 2, y0, cx + pequenaL / 2, y0 + pequenaA], [cx - pequenaL / 2, y1 - pequenaA, cx + pequenaL / 2, y1]],
    linhas: [[x0, meio, x1, meio]],
    circulo: { cx, cy: meio, r: 70 },
    pontos: [[cx, meio], [cx, y0 + 85], [cx, y1 - 85]],
  };
}

function svgDaPrancheta(o) {
  const p = lerPrancheta(o);
  const c = linhasDoCampo();
  const el = [];
  el.push(`<rect width="${W}" height="${H}" fill="#2e7d32"/>`);
  for (let i = 0; i < 10; i++) if (i % 2) el.push(`<rect x="0" y="${MARGEM + 40 + i * 90}" width="${W}" height="90" fill="#2a7230"/>`);
  for (const [a, b, cc, d] of c.retangulos) el.push(`<rect x="${a}" y="${b}" width="${cc - a}" height="${d - b}" fill="none" stroke="#fff" stroke-width="3"/>`);
  for (const [a, b, cc, d] of c.linhas) el.push(`<line x1="${a}" y1="${b}" x2="${cc}" y2="${d}" stroke="#fff" stroke-width="3"/>`);
  el.push(`<circle cx="${c.circulo.cx}" cy="${c.circulo.cy}" r="${c.circulo.r}" fill="none" stroke="#fff" stroke-width="3"/>`);
  for (const [a, b] of c.pontos) el.push(`<circle cx="${a}" cy="${b}" r="4" fill="#fff"/>`);
  for (const s of p.setas) {
    const de = px(p.pos[s.de - 1]);
    const ate = px({ x: s.ate[0], y: s.ate[1] });
    el.push(`<line x1="${de.x}" y1="${de.y}" x2="${ate.x}" y2="${ate.y}" stroke="#ffd54f" stroke-width="4" stroke-dasharray="12 8" marker-end="url(#seta)"/>`);
  }
  p.pos.forEach((q, i) => {
    const { x, y } = px(q);
    el.push(`<circle cx="${x}" cy="${y}" r="24" fill="${i === 0 ? '#f9a825' : '#1565c0'}" stroke="#fff" stroke-width="3"/>`);
    el.push(`<text x="${x}" y="${y + 8}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="700" fill="#fff">${i + 1}</text>`);
    if (p.nomes[i]) el.push(`<text x="${x}" y="${y + 46}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${p.tamanhos[i]}" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${escXml(p.nomes[i])}</text>`);
  });
  el.push(`<text x="${W / 2}" y="${MARGEM + 22}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="700" fill="#fff">${escXml(p.titulo)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    '<defs><marker id="seta" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#ffd54f"/></marker></defs>' +
    `${el.join('')}</svg>\n`;
}

/** Os argumentos do ImageMagick para o PNG (o texto vai escapado e em argumento próprio; nenhum vem do shell). */
function argsDaPrancheta(o, saida, { fonte = null } = {}) {
  const { textoMagick } = require('./imagemEdicao');
  const p = lerPrancheta(o);
  const c = linhasDoCampo();
  const a = ['-size', `${W}x${H}`, 'xc:#2e7d32', '-fill', '#2a7230'];
  for (let i = 0; i < 10; i++) if (i % 2) a.push('-draw', `rectangle 0,${MARGEM + 40 + i * 90} ${W},${MARGEM + 40 + i * 90 + 90}`);
  a.push('-fill', 'none', '-stroke', '#ffffff', '-strokewidth', '3');
  for (const [x0, y0, x1, y1] of c.retangulos) a.push('-draw', `rectangle ${x0},${y0} ${x1},${y1}`);
  for (const [x0, y0, x1, y1] of c.linhas) a.push('-draw', `line ${x0},${y0} ${x1},${y1}`);
  a.push('-draw', `circle ${c.circulo.cx},${c.circulo.cy} ${c.circulo.cx + c.circulo.r},${c.circulo.cy}`);
  a.push('-fill', '#ffffff', '-stroke', 'none');
  for (const [x, y] of c.pontos) a.push('-draw', `circle ${x},${y} ${x + 4},${y}`);
  for (const s of p.setas) {
    const de = px(p.pos[s.de - 1]);
    const ate = px({ x: s.ate[0], y: s.ate[1] });
    const ang = Math.atan2(ate.y - de.y, ate.x - de.x);
    const ponta = (d, abre) => `${Math.round(ate.x - d * Math.cos(ang - abre))},${Math.round(ate.y - d * Math.sin(ang - abre))}`;
    a.push('-stroke', '#ffd54f', '-strokewidth', '4', '-fill', 'none', '-draw', `line ${de.x},${de.y} ${ate.x},${ate.y}`);
    a.push('-stroke', 'none', '-fill', '#ffd54f', '-draw', `polygon ${ate.x},${ate.y} ${ponta(18, 0.45)} ${ponta(18, -0.45)}`);
  }
  p.pos.forEach((q, i) => {
    const { x, y } = px(q);
    a.push('-stroke', '#ffffff', '-strokewidth', '3', '-fill', i === 0 ? '#f9a825' : '#1565c0', '-draw', `circle ${x},${y} ${x + 24},${y}`);
  });
  a.push('-stroke', 'none', '-fill', '#ffffff', ...(fonte ? ['-font', fonte] : []), '-gravity', 'NorthWest');
  const centrado = (texto, x, y, tamanho) => {
    // gravity Center: o deslocamento é a partir do meio da imagem
    const dx = Math.round(x - W / 2); const dy = Math.round(y - H / 2);
    return ['-gravity', 'Center', '-pointsize', String(tamanho), '-annotate', `${dx >= 0 ? '+' : '-'}${Math.abs(dx)}${dy >= 0 ? '+' : '-'}${Math.abs(dy)}`, textoMagick(texto)];
  };
  p.pos.forEach((q, i) => {
    const { x, y } = px(q);
    a.push('-stroke', 'none', '-fill', '#ffffff', ...centrado(String(i + 1), x, y, 22));
    if (p.nomes[i]) a.push('-stroke', '#000000', '-strokewidth', '3', '-fill', '#ffffff', ...centrado(p.nomes[i], x, y + 40, p.tamanhos[i]), '-stroke', 'none', ...centrado(p.nomes[i], x, y + 40, p.tamanhos[i]));
  });
  a.push('-stroke', 'none', '-fill', '#ffffff', ...centrado(p.titulo, W / 2, MARGEM + 14, 26));
  a.push(`png:${saida}`);
  return a;
}

/**
 * Desenha a prancheta: SVG sempre; PNG quando há ImageMagick. Arquivos novos (nunca sobrescreve).
 * @returns {Promise<{ svg: string, png: string|null }>}
 */
async function desenharPrancheta(o = {}, { saida, cwd = process.cwd(), magick } = {}) {
  const fs = require('fs');
  const imagem = require('./imagem');
  const { isProtected, isSecret } = require('./tools/protectedPaths');
  const p = lerPrancheta(o); // valida antes de criar qualquer arquivo
  // o PNG decide o nome (nunca sobrescreve: -2, -3...); o SVG vai ao lado, com o mesmo nome
  const pedido = saida ? String(saida).replace(/\.(svg|png)$/i, '') + '.png' : undefined;
  const png = imagem.destinoNovo({ saida: pedido, base: `prancheta-${p.texto}.png`, sufixo: '', ext: '.png', cwd });
  let svg = png.replace(/\.png$/i, '.svg');
  for (let i = 2; fs.existsSync(svg); i++) svg = png.replace(/\.png$/i, `-${i}.svg`);
  if (isProtected(svg) || isSecret(svg)) throw new Error('esse caminho é protegido do gemini-code; escolha outro lugar.');
  fs.writeFileSync(svg, svgDaPrancheta(o), { flag: 'wx' });
  const m = magick === undefined ? imagem.acharMagick() : magick;
  if (!m) return { svg, png: null };
  const { acharFonte } = require('./videoEdicao');
  await imagem.rodar(m, argsDaPrancheta(o, png, { fonte: acharFonte() }));
  return { svg, png: fs.existsSync(png) ? png : null };
}

// ---------------------------------------------------------------------------
// O aliado "treinador"
// ---------------------------------------------------------------------------
const INSTRUCOES_TREINADOR = [
  'Você é o "Professor": um treinador de futebol de elite, em português do Brasil. Você reúne o que os melhores treinadores da história ensinaram — jogo de posição e posse com propósito, pressão logo depois de perder a bola, bloco defensivo compacto, transições rápidas, bolas paradas ensaiadas, gestão de pessoas e a coragem de mudar o plano conforme o adversário — sem fingir ser nenhuma pessoa real.',
  'Como você trabalha: antes de planejar, entenda o contexto (categoria/idade, nível, quantos jogadores e goleiros, tamanho do campo, dias e horários, material, o próximo adversário e o objetivo da temporada); pergunte só o que faltar e siga com um padrão razoável.',
  'Pense o jogo nos 4 momentos (organização ofensiva, transição defensiva, organização defensiva, transição ofensiva) mais as bolas paradas, e treine como se joga: exercícios com bola, adversário e decisão, em espaços e números que puxem o comportamento que você quer. Explique o porquê de cada exercício, os pontos de correção e como progredir.',
  'Use a ferramenta "futebol": "treino" monta a sessão (tema, categoria, jogadores, minutos); "semana" faz o microciclo até o jogo (MD-4 tensão, MD-3 duração, MD-2 velocidade, MD-1 ativação, recuperação depois do jogo); "carga" calcula PSE x minutos, ACWR e monotonia; "prancheta" desenha a formação com os nomes e as setas das jogadas; "exercicios" lista a biblioteca. Ajuste o que ela entregar ao contexto da pessoa — ela é o ponto de partida, você é o treinador.',
  'Vídeo do jogo: com a ferramenta "video", corte os lances (gols, erros de saída, pressões que funcionaram) para mostrar ao time; com "imagem", crie artes do jogo.',
  'Liderança: feedback específico e curto, elogio em público e correção em particular, perguntas que fazem o jogador pensar ("o que você viu?"), um objetivo por treino. Plano de jogo: como o adversário ataca e defende, onde ele é fraco, 3 ideias simples para o time, bolas paradas a favor e contra, e as substituições planejadas.',
  'Base (até 13 anos): o treino é brincar de jogar — muita bola por criança, jogos reduzidos (3x3, 4x4, 7x7), todos jogam, técnica e tomada de decisão antes de tática, nada de físico pesado sem bola, nada de cobrança por resultado. Sub-15 em diante: princípios táticos e físico integrado à bola.',
  'Segurança, sempre: dor que não passa, lesão, pancada na cabeça (suspeita de concussão — na dúvida, fora e avaliação médica), mal-estar ou calor extremo: o treino para e quem decide é o médico ou o fisioterapeuta. Você não diagnostica nem receita, e nunca indica remédio ou suplemento. Hidratação e pausas no calor. Respeite o descanso: carga sobe aos poucos.',
  'Seja direto, prático e entusiasmado, como no campo: o que fazer, quanto tempo, onde e por quê.',
].join('\n');

const INICIADORES = Object.freeze([
  'Monta o treino de amanhã: sub-15, 18 jogadores, 75 minutos, foco em pressão pós-perda',
  'Planeja a semana até o jogo de sábado (treinos segunda, terça, quinta e sexta)',
  'Desenha o 4-3-3 com os nomes do meu time',
  'Como faço meu time sair jogando com o goleiro?',
  'Calcula a carga: segunda PSE 7 por 90 min, terça 5 por 60, quinta 8 por 80',
  'Corta os gols do vídeo do nosso jogo',
]);

module.exports = {
  TEMAS, APELIDOS_TEMA, CATEGORIAS, FASES, BIBLIOTECA, DIAS, FOCOS, INSTRUCOES_TREINADOR, INICIADORES,
  lerTema, lerCategoria, lerDia, lerFormacao, lerPrancheta,
  organizar, planejarTreino, textoDoTreino, planejarSemana, textoDaSemana, calcularCarga, textoDaCarga,
  posicoes, svgDaPrancheta, argsDaPrancheta, desenharPrancheta, escXml,
};

