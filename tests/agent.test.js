// tests/agent.test.js
// runOnce (src/agent.js) é o loop agentivo mais crítico do projeto: manda a
// conversa pro Gemini, executa as ferramentas que o modelo pedir e repete
// até fechar com texto. Usamos `deps` (ver comentário em src/agent.js) para
// simular o Gemini e as ferramentas, sem tocar a API, o disco real ou MCP.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runOnce, buildSystemInstruction, podarHistorico } = require('../src/agent');

function baseDeps(overrides = {}) {
  return {
    loadConfig: () => ({ model: 'modelo-fake' }),
    getAllDeclarations: async () => [{ name: 'ferramenta_fake' }],
    buildSystemInstruction: (extra) => `sistema${extra ? ' + ' + extra : ''}`,
    ...overrides,
  };
}

function respostaTexto(text) {
  return { functionCalls: () => [], text: () => text };
}

function respostaComChamada(calls, rawParts) {
  return { functionCalls: () => calls, text: () => '', rawParts: () => rawParts };
}

test('sem chamada de ferramenta, devolve o texto e fecha o turno no histórico', async () => {
  const chatWithTools = async () => respostaTexto('olá, tudo bem?');
  const { text, history } = await runOnce('oi', { deps: baseDeps({ chatWithTools }) });

  assert.equal(text, 'olá, tudo bem?');
  assert.deepEqual(history.at(-1), { role: 'model', parts: [{ text: 'olá, tudo bem?' }] });
  assert.deepEqual(history[0], { role: 'user', parts: [{ text: 'oi' }] });
});

test('executa a ferramenta pedida e manda o resultado de volta preservando o id', async () => {
  let chamada = 0;
  const historicoRecebido = [];
  const chatWithTools = async ({ history }) => {
    chamada += 1;
    historicoRecebido.push(history);
    if (chamada === 1) {
      return respostaComChamada(
        [{ name: 'read_file', args: { path: 'x.txt' }, id: 'call-1' }],
        [{ functionCall: { name: 'read_file', args: { path: 'x.txt' }, id: 'call-1' } }]
      );
    }
    return respostaTexto('o arquivo diz oi');
  };
  const execute = async (name, args) => {
    assert.equal(name, 'read_file');
    assert.deepEqual(args, { path: 'x.txt' });
    return 'conteúdo do arquivo';
  };

  const { text, history } = await runOnce('leia x.txt', { deps: baseDeps({ chatWithTools, execute }) });

  assert.equal(text, 'o arquivo diz oi');
  assert.equal(chamada, 2);

  // A 2ª chamada ao Gemini precisa ver a functionResponse com o mesmo id.
  const historicoDaSegundaChamada = historicoRecebido[1];
  const turnoDaFerramenta = historicoDaSegundaChamada.find((m) => m.role === 'user' && m.parts[0]?.functionResponse);
  assert.equal(turnoDaFerramenta.parts[0].functionResponse.id, 'call-1');
  assert.equal(turnoDaFerramenta.parts[0].functionResponse.response.result, 'conteúdo do arquivo');

  // E o histórico final também guarda essa troca, pro próximo runOnce.
  assert.ok(history.some((m) => m.parts[0]?.functionResponse));
});

test('erro na ferramenta vira texto de erro, sem travar o loop', async () => {
  let chamada = 0;
  const chatWithTools = async () => {
    chamada += 1;
    if (chamada === 1) {
      return respostaComChamada(
        [{ name: 'run_shell', args: { cmd: 'rm -rf /' } }],
        [{ functionCall: { name: 'run_shell', args: { cmd: 'rm -rf /' } } }]
      );
    }
    return respostaTexto('não deu certo');
  };
  const execute = async () => { throw new Error('comando bloqueado'); };

  const { history } = await runOnce('roda isso', { deps: baseDeps({ chatWithTools, execute }) });

  const turnoDaFerramenta = history.find((m) => m.parts[0]?.functionResponse);
  assert.equal(turnoDaFerramenta.parts[0].functionResponse.response.result, 'Erro: comando bloqueado');
});

test('trunca resultado de ferramenta muito grande e avisa quantos caracteres tinha', async () => {
  const textoGigante = 'x'.repeat(25000);
  let chamada = 0;
  const chatWithTools = async () => {
    chamada += 1;
    if (chamada === 1) {
      return respostaComChamada(
        [{ name: 'read_file', args: {} }],
        [{ functionCall: { name: 'read_file', args: {} } }]
      );
    }
    return respostaTexto('ok');
  };
  const execute = async () => textoGigante;

  const { history } = await runOnce('leia arquivo grande', { deps: baseDeps({ chatWithTools, execute }) });

  const resultado = history.find((m) => m.parts[0]?.functionResponse).parts[0].functionResponse.response.result;
  assert.ok(resultado.startsWith('x'.repeat(20000)));
  assert.match(resultado, /resultado truncado: mostrando 20000 de 25000 caracteres/);
});

test('para no limite de passos se o modelo só chamar ferramentas sem nunca fechar em texto', async () => {
  let chamadasGemini = 0;
  const chatWithTools = async () => {
    chamadasGemini += 1;
    return respostaComChamada(
      [{ name: 'ferramenta_fake', args: {} }],
      [{ functionCall: { name: 'ferramenta_fake', args: {} } }]
    );
  };
  // v0.32.0: o resultado muda a cada passo; senão o loopGuard (mesma chamada + mesmo resultado) encerraria antes dos 60.
  let n = 0;
  const execute = async () => `resultado ${++n}`;

  const { text, history } = await runOnce('nunca termina', { deps: baseDeps({ chatWithTools, execute }) });

  assert.equal(chamadasGemini, 60);
  assert.equal(text, '(número máximo de passos de ferramenta atingido)');
  // O aviso precisa entrar no histórico, senão o próximo runOnce com esse
  // history vê ferramentas sem nenhuma fala do modelo fechando o turno.
  assert.deepEqual(history.at(-1), { role: 'model', parts: [{ text: '(número máximo de passos de ferramenta atingido)' }] });
});

test('passa allowedTools adiante pro execute (ferramentas de uma persona)', async () => {
  let recebido;
  // 1ª resposta pede uma ferramenta (para o execute ser chamado de verdade), a 2ª fecha com texto.
  let passo = 0;
  const chamada = { name: 'read_file', args: { path: 'x.txt' }, id: 'c1' };
  const chatWithTools = async () => (passo++ === 0 ? respostaComChamada([chamada], [{ functionCall: chamada }]) : respostaTexto('ok'));
  const execute = async (name, args, allowedTools) => { recebido = allowedTools; return 'ok'; };
  // A lista chega nos dois pontos: getAllDeclarations (o que o modelo pode pedir) e execute (o que pode rodar).
  let allowedRecebidoEmDeclarations;
  const getAllDeclarations = async (allowedTools) => {
    allowedRecebidoEmDeclarations = allowedTools;
    return [];
  };

  await runOnce('oi', {
    allowedTools: ['read_file'],
    deps: baseDeps({ chatWithTools, execute, getAllDeclarations }),
  });

  assert.deepEqual(allowedRecebidoEmDeclarations, ['read_file']);
  assert.deepEqual(recebido, ['read_file']);
});

test('extraSystemInstruction chega até a chamada ao Gemini', async () => {
  let systemInstructionRecebida;
  const chatWithTools = async ({ systemInstruction }) => {
    systemInstructionRecebida = systemInstruction;
    return respostaTexto('ok');
  };

  await runOnce('oi', {
    extraSystemInstruction: 'seja breve',
    deps: baseDeps({ chatWithTools }),
  });

  assert.equal(systemInstructionRecebida, 'sistema + seja breve');
});

test('poda o histórico longo antes de mandar pro Gemini', async () => {
  let historicoRecebido;
  const chatWithTools = async ({ history }) => {
    historicoRecebido = history;
    return respostaTexto('ok');
  };
  const historicoLongo = Array.from({ length: 50 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'model',
    parts: [{ text: `mensagem ${i}` }],
  }));

  await runOnce('mais uma', { history: historicoLongo, deps: baseDeps({ chatWithTools }) });

  // 2 primeiras + aviso + 30 últimas + a mensagem nova = 34, bem menor que
  // as 51 que entrariam sem poda.
  assert.ok(historicoRecebido.length < historicoLongo.length + 1);
  assert.ok(historicoRecebido.some((m) => m.parts[0]?.text?.includes('omitido para economizar contexto')));
});

test('buildSystemInstruction inclui a instrução extra só quando ela é passada', () => {
  const semExtra = buildSystemInstruction();
  const comExtra = buildSystemInstruction('regra especial da persona');

  assert.ok(semExtra.includes('gemini-code'));
  assert.ok(!semExtra.includes('regra especial da persona'));
  assert.ok(comExtra.includes('regra especial da persona'));
  // v0.42.0: o extra entra antes do conhecimento fixo (se houver); fora ele, o texto é o mesmo.
  assert.equal(comExtra.replace('\n\nregra especial da persona', ''), semExtra);
});

test('podarHistorico não mexe em conversas curtas', () => {
  const curta = [{ role: 'user', parts: [{ text: 'oi' }] }];
  assert.equal(podarHistorico(curta), curta);
});

test('podarHistorico mantém as 2 primeiras + últimas 30 + aviso quando estoura o limite', () => {
  const longa = Array.from({ length: 45 }, (_, i) => ({ role: 'user', parts: [{ text: String(i) }] }));
  const podada = podarHistorico(longa);

  assert.equal(podada.length, 2 + 1 + 30);
  assert.deepEqual(podada[0], longa[0]);
  assert.deepEqual(podada[1], longa[1]);
  assert.match(podada[2].parts[0].text, /omitido para economizar contexto/);
  assert.deepEqual(podada.slice(3), longa.slice(-30));
});

// v0.3.6: o corte não pode separar um functionCall do seu functionResponse.
function parChamadaResposta(i) {
  return [
    { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: `f${i}` }, id: `c${i}` } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'read_file', id: `c${i}`, response: { result: String(i) } } }] },
  ];
}

test('podarHistorico nunca deixa functionResponse órfão nem functionCall sem resposta', () => {
  // 1 pedido do usuário + 30 pares chamada/resposta = 61 mensagens
  const convo = [{ role: 'user', parts: [{ text: 'faça a tarefa' }] }];
  for (let i = 0; i < 30; i++) convo.push(...parChamadaResposta(i));
  const podada = podarHistorico(convo);

  // sem texto de usuário no meio, não há fronteira segura: manda tudo
  assert.equal(podada.length, convo.length);

  // com um turno de texto no meio, corta numa fronteira segura
  const convo2 = [{ role: 'user', parts: [{ text: 'a' }] }, { role: 'model', parts: [{ text: 'ok' }] }];
  for (let i = 0; i < 12; i++) convo2.push(...parChamadaResposta(i));
  convo2.push({ role: 'user', parts: [{ text: 'agora outra coisa' }] });
  convo2.push({ role: 'model', parts: [{ text: 'certo' }] });
  for (let i = 12; i < 30; i++) convo2.push(...parChamadaResposta(i));
  const p2 = podarHistorico(convo2);
  assert.ok(p2.length < convo2.length);

  const apos = p2.slice(3); // depois de início(2) + aviso
  assert.equal(apos[0].role, 'user');
  assert.ok(!apos[0].parts.some((x) => x.functionResponse), 'trecho recente não pode começar num functionResponse');
  // todo functionCall tem seu functionResponse logo em seguida
  for (let i = 0; i < p2.length; i++) {
    if (p2[i].parts.some((x) => x.functionCall)) {
      assert.ok(p2[i + 1] && p2[i + 1].parts.some((x) => x.functionResponse));
    }
  }
});

test('podarHistorico não mantém um functionCall pendente no início preservado', () => {
  const convo = [{ role: 'user', parts: [{ text: 'tarefa' }] }];
  for (let i = 0; i < 25; i++) convo.push(...parChamadaResposta(i));
  convo.push({ role: 'user', parts: [{ text: 'continua' }] });
  for (let i = 25; i < 40; i++) convo.push(...parChamadaResposta(i));
  const podada = podarHistorico(convo);
  assert.ok(!(podada[1].role === 'model' && podada[1].parts.some((x) => x.functionCall)) || podada[2].parts.some((x) => x.functionResponse));
});
