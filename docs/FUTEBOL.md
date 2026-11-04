# Futebol — o treinador (v0.52.0)

O aliado **"treinador"** monta o treino, planeja a semana até o jogo, controla a carga, desenha a formação e analisa o
vídeo do jogo. Ele trabalha como um treinador de elite: pensa o jogo nos 4 momentos (organização ofensiva, transição
defensiva, organização defensiva e transição ofensiva) mais as bolas paradas. Treina como se joga, com bola, adversário e
decisão, e respeita a idade: criança brinca de jogar. Ele reúne o que os melhores treinadores ensinaram, **sem fingir
ser nenhuma pessoa real**.

```bash
gemini-code futebol aliado                  # cria o aliado "treinador" (uma vez)
gemini-code aliados chat treinador          # conversa no terminal
gemini-code site --chat --aliado treinador  # ou pelo navegador (mande o vídeo do jogo pelo clipe)
```

Exemplos do que pedir: "monta o treino de amanhã: sub-15, 18 jogadores, 75 minutos, foco em pressão pós-perda";
"planeja a semana até o jogo de sábado"; "desenha o 4-3-3 com os nomes do meu time"; "corta os gols do vídeo do nosso
jogo".

## A ferramenta `futebol`, sem IA

As partes abaixo são contas e regras fixas (`src/futebol.js`), sem modelo de IA nem internet. O aliado usa a
ferramenta e ajusta o resultado ao seu contexto. Do terminal, você também pode usar direto:

### Treino

```bash
gemini-code futebol treino --tema pressao --categoria sub-15 --jogadores 18 [--goleiros 2] [--duracao 75]
```

- **Temas:**
  - com bola: `posse`, `saida`, `cruzamento`, `finalizacao`, `bola-parada`;
  - sem bola: `pressao` (pós-perda), `pressao-alta`, `defesa`;
  - transição e base: `transicao`, `tecnica`, `velocidade`, `goleiro`.
  - Apelidos também valem: "jogo de posição", "saída de bola", "contra-ataque", "escanteio", "passe"...
- **Categorias:** `sub-7` a `sub-20`, `adulto` e `veterano`. Também vale a idade ("12" vira sub-13) e "U15".
- **A sessão:**
  - **Partes:** aquecimento, exercício principal (dois blocos), jogo condicionado (com a regra do tema) e volta à calma.
  - **Cada exercício traz:** organização (quantos grupos e o tamanho do campo, que cresce ou diminui com o grupo),
    regras, pontos de correção, progressão e regressão.
  - **Goleiros:** aquecem com o preparador, e o aquecimento se divide só entre os de linha. Nos outros blocos, entram
    com o grupo.
  - **Tempo:** a soma fecha com a duração pedida.
  - **Carga prevista:** em UA, com a PSE média.
- **A biblioteca:** 25 exercícios. Entre eles: rondos 4x1 e 5x2, jogo de posição 4x4+3, saída de bola 6x4, reação de
  5 segundos, gatilhos da pressão alta, contra-ataque em 8 segundos, linha de 4, 1x1, finalização, cruzamento,
  escanteios ensaiados, velocidade de reação, goleiro e o festival 3x3 dos pequenos.
  - O aquecimento segue a linha dos programas de prevenção de lesão, como o FIFA 11+.
  - Liste com `gemini-code futebol exercicios [--tema goleiro]`.
- **Idade:**
  - **Até 9 anos:** sem o bloco analítico, mais tempo de jogo, sessão curta e jogos de poucos (3x3).
  - **Até 13:** técnica e decisão primeiro.
  - **Tema avançado demais para a idade** (pressão alta no sub-7, por exemplo): o plano avisa e foca no que prepara para
    ele.
- **Um exercício só para o tema na idade:** quando o tema só tem um exercício principal para aquela idade, ele ganha o
  tempo dos dois blocos, em duas etapas: a segunda com a progressão. O plano não repete o exercício nem foge do tema.
- **Segurança, em todo plano:** hidratação e pausas no calor. Dor que não passa, pancada na cabeça ou tontura: tire do
  treino e procure avaliação médica (**na dúvida, fora**).

### Semana (periodização tática)

```bash
gemini-code futebol semana --jogo sabado --dias segunda,terca,quinta,sexta [--categoria adulto]
gemini-code futebol semana --jogo quarta,domingo --dias seg,ter,qui,sex,sab   # semana com 2 jogos
```

Cada dia de treino recebe o foco pela distância até o próximo jogo:

| Dia | Foco | Como é |
|---|---|---|
| MD+1 (e MD+2) | Recuperação | quem jogou: regenerativo; quem jogou pouco: compensatório com bola |
| MD-4 | Tensão | jogos reduzidos em espaço curto (3x3 a 5x5), muitas acelerações e disputas |
| MD-3 | Duração | espaços grandes e mais jogadores (8x8 a 11x11), o modelo de jogo inteiro |
| MD-2 | Velocidade | exercícios curtos e rápidos, pausa completa, pouca densidade |
| MD-1 | Ativação | carga baixa: rondos, bola parada ensaiada, o plano contra o adversário |

- **Ordem dos dias:** a semana começa no dia seguinte ao jogo (o microciclo).
- **Avisos:**
  - **sem treino na véspera:** o último treino antes do jogo fica mais leve no fim;
  - **2 jogos na semana:** entre eles é recuperar e ativar;
  - **3 dias fortes ou mais.**
- **Até 11 anos:** não existe periodização de adulto. Todo dia é "jogar e aprender".

### Carga

```bash
gemini-code futebol carga --sessao 02/11:7:90 --sessao ontem:5:60 [--hoje 04/11/2026]   # DATA:PSE:MINUTOS
```

O método é o da PSE da sessão (sRPE, de Foster). Ao fim do treino, cada jogador dá uma nota de 0 a 10 para o esforço.

- **Carga da sessão:** PSE x minutos, em UA.
- **Aguda:** a soma dos últimos 7 dias.
- **Crônica:** a média semanal das últimas 4 semanas.
- **ACWR:** aguda ÷ crônica.
  - 0,8 a 1,3: progressão segura;
  - acima de 1,5: aumento brusco, a faixa associada a mais lesões;
  - abaixo de 0,8: carga baixa.
  - Com menos de 3 semanas de registros, a crônica ainda não é confiável: o ACWR aparece marcado "ainda sem base", sem
    faixa de risco (senão, quem acabou de começar a registrar recebia um alarme falso de "aumento brusco").
- **Monotonia:** a média diária ÷ o desvio padrão dos 7 dias, contando os dias sem treino. Acima de 2, os dias estão
  parecidos demais.
- **Tensão (strain):** a carga da semana x a monotonia.
- **As datas:** `2026-11-04`, `04/11/2026`, `04/11`, "ontem" ou "hoje", lidas por `src/datas.js`.
  - O formato americano não vira outro dia.
  - Uma data depois do dia de referência é recusada.
  - O "hoje" é o dia do relógio deste aparelho.
- **O que os números não fazem:** eles orientam o planejamento, mas não preveem lesão. Junte com o que cada jogador
  conta (sono, dor, cansaço, humor).

### Prancheta

```bash
gemini-code futebol prancheta 4-3-3 --nomes "Marcos,Rafa,Thiago,Davi,Lucas,..." --titulo "Final de domingo" [--saida time.png]
```

- **Formações:** qualquer uma de 2 a 5 linhas, com 3 a 10 jogadores de linha. Exemplos: 4-3-3, 4-2-3-1, 3-5-2, society
  2-3-1 e futsal 2-2.
- **Os desenhos:**
  - o goleiro embaixo, em amarelo, e o ataque para cima;
  - os nomes na ordem: o goleiro, depois de trás para a frente, da esquerda para a direita;
  - pelo chat, também as setas das jogadas.
- **Os arquivos:**
  - um **PNG**, se houver ImageMagick (Termux: `pkg install imagemagick`);
  - e sempre um **SVG**, para editar ou imprimir.
  - Os dois são arquivos novos: um nome repetido vira `-2`, nada é sobrescrito.
- **No modo site:** a prancheta aparece na conversa.
- **Os nomes:** cortados para não encostar no do lado, com "…". Linhas de 4 ou mais usam fonte menor. Emoji e caracteres
  invisíveis (de controle ou que invertem o texto) saem, e o texto vai escapado no SVG e no ImageMagick.

## O aliado

- **Ferramentas:** o preset `futebol` traz `futebol`, `video` (cortar os lances do jogo), `imagem` (artes do jogo),
  `desafio` e `web_fetch`.
- **Sob demanda:** fora do aliado, a ferramenta `futebol` não aparece no chat comum. Para ligar:
  `gemini-code config ferramentas-extras futebol`.
- **Memória:** `confirmar`. Ele pergunta antes de lembrar algo do seu time.
- **Instruções** (`INSTRUCOES_TREINADOR`):
  - entender o contexto antes de planejar;
  - explicar o porquê de cada exercício;
  - liderança: feedback curto, elogio em público e correção em particular;
  - o plano de jogo contra o adversário;
  - as regras da base;
  - segurança: ele não diagnostica, não receita, nunca indica remédio ou suplemento, e o treino para diante de lesão ou
    suspeita de concussão.

## Limites honestos

- **Testado aqui:**
  - as contas: a carga conferida à mão, o tempo do treino em todas as combinações de tema, categoria e grupo, e os
    rótulos MD;
  - a prancheta de verdade, com ImageMagick: PNG conferido pelos pixels e SVG;
  - a ferramenta, o comando e a criação do aliado.
- **Não testado:** a conversa com o aliado. Este ambiente não tem modelo de IA, então a qualidade das respostas
  depende do modelo que você usar.
- **O que é cada coisa:**
  - os planos são pontos de partida, e o treinador de verdade é quem conhece o grupo;
  - a carga é um indicador de referência, não uma avaliação médica.
